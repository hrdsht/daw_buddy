//! Ableton Live sets (.als) → neutral project. Twin of `read-ableton.ts`.
//!
//! Arrangement clips live under each track's MainSequencer →
//! ArrangerAutomation → Events. Session View clips are a launcher, not a
//! timeline, and are not converted. Warped clips measure content in beats
//! (mapped to seconds through warp markers); unwarped clips in seconds.
//! Looped clips longer than their loop are unrolled one pass per clip.

use crate::files::{basename, strip_ext, FileFinder};
use crate::model::*;
use crate::xml::{self, num, opt_find_all, opt_path, opt_value, Node};
use flate2::read::GzDecoder;
use std::io::Read;
use std::path::Path;

const STRETCH_TOLERANCE: f64 = 0.002;

fn non_empty(s: Option<&str>) -> Option<&str> {
    s.filter(|v| !v.is_empty())
}

pub fn read(file: &Path) -> Result<Project, String> {
    let raw = std::fs::read(file).map_err(|e| e.to_string())?;
    let text = if raw.len() > 1 && raw[0] == 0x1f && raw[1] == 0x8b {
        let mut s = String::new();
        GzDecoder::new(&raw[..]).read_to_string(&mut s).map_err(|e| format!("Could not unpack set: {e}"))?;
        s
    } else {
        String::from_utf8_lossy(&raw).to_string()
    };
    let doc = xml::parse(&text);
    let live_set = doc
        .path(&["Ableton", "LiveSet"])
        .ok_or("This does not look like an Ableton Live set (no LiveSet element).")?;

    let stem = file.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let mut project = Project::new(&stem, "Ableton Live");
    let mut finder = FileFinder::new(file.parent().unwrap_or(Path::new(".")));

    /* tempo + time signature live on the master track's mixer */
    let master = live_set.child("MainTrack").or_else(|| live_set.child("MasterTrack"));
    let master_mixer = opt_path(master, &["DeviceChain", "Mixer"]);
    let bpm = num(opt_value(master_mixer, &["Tempo", "Manual"]), 0.0);
    if bpm > 0.0 {
        project.bpm = bpm;
    }
    if opt_find_all(opt_path(master_mixer, &["Tempo", "ArrangerAutomation"]), "FloatEvent").len() > 1 {
        let shown = fmt_round(project.bpm, 2);
        project.warn(format!("Tempo automation found — the converted project uses a constant {shown} BPM."));
    }
    let sig = num(opt_value(master_mixer, &["TimeSignature", "Manual"]), f64::NAN);
    if sig.is_finite() {
        project.time_signature = decode_time_signature(sig);
    }

    let tempo_id = automation_target_id(opt_path(master_mixer, &["Tempo"]));
    let sig_id = automation_target_id(opt_path(master_mixer, &["TimeSignature"]));
    let master_other = envelopes_of(master)
        .into_iter()
        .filter(|env| {
            let id = pointee_id(env);
            id != tempo_id && id != sig_id
        })
        .count();
    if master_other > 0 {
        project.warn(format!(
            "{master_other} automation lane(s) on the Main track were not converted — only track volume, pan and mute automation is."
        ));
    }

    /* locators */
    for loc in opt_find_all(live_set.path(&["Locators", "Locators"]), "Locator") {
        project.markers.push(Marker {
            name: non_empty(loc.value(&["Name"])).unwrap_or("Marker").to_string(),
            time: num(loc.value(&["Time"]), 0.0),
        });
    }

    /* tracks */
    let mut session_only = 0usize;
    if let Some(tracks) = live_set.child("Tracks") {
        for track_node in &tracks.children {
            let kind = track_node.name.as_str();
            let name = track_name(track_node);
            match kind {
                "GroupTrack" => {
                    project.warn(format!("Group \"{name}\" was flattened — its tracks are converted individually."));
                    continue;
                }
                "ReturnTrack" => {
                    project.warn(format!("Return track \"{name}\" was skipped — effects and sends are not converted."));
                    continue;
                }
                "AudioTrack" | "MidiTrack" => {}
                _ => continue,
            }
            let mixer = track_node.path(&["DeviceChain", "Mixer"]);
            let mut track = Track {
                name: name.clone(),
                kind: if kind == "AudioTrack" { TrackKind::Audio } else { TrackKind::Midi },
                volume: clamp(num(opt_value(mixer, &["Volume", "Manual"]), 1.0), 0.0, 4.0),
                pan: clamp(num(opt_value(mixer, &["Pan", "Manual"]), 0.0), -1.0, 1.0),
                mute: opt_value(mixer, &["Speaker", "Manual"]) == Some("false"),
                color: None,
                clips: Vec::new(),
                automation: Automation::default(),
            };

            let sequencer = track_node.path(&["DeviceChain", "MainSequencer"]);
            let arranger = opt_find_all(sequencer, "ArrangerAutomation").into_iter().next();
            let clip_name = if track.kind == TrackKind::Audio { "AudioClip" } else { "MidiClip" };
            session_only += opt_find_all(opt_path(sequencer, &["ClipSlotList"]), clip_name).len();

            for clip_node in opt_find_all(arranger, clip_name) {
                if clip_node.value(&["Disabled"]) == Some("true") {
                    project.warn(format!("A deactivated clip on \"{name}\" was skipped."));
                    continue;
                }
                if track.kind == TrackKind::Audio {
                    let clips = audio_clips(clip_node, &mut project, &mut finder, &name);
                    track.clips.extend(clips.into_iter().map(Clip::Audio));
                } else if let Some(c) = midi_clip(clip_node) {
                    track.clips.push(Clip::Midi(c));
                }
            }

            read_track_automation(track_node, mixer, &mut track, &mut project);

            let has_devices = !track_node.find_all("PluginDevice").is_empty()
                || opt_find_all(track_node.path(&["DeviceChain", "DeviceChain"]), "Devices")
                    .iter()
                    .any(|d| !d.children.is_empty());
            if has_devices {
                project.warn("Instruments and effects (plugins and Live devices) are not converted — re-insert them in the new DAW.");
            }
            project.tracks.push(track);
        }
    }

    if session_only > 0 {
        project.warn(format!(
            "{session_only} Session View clip(s) were not converted — only the Arrangement timeline is. Record or drag any you need into the Arrangement first."
        ));
    }
    Ok(project)
}

fn track_name(n: &Node) -> String {
    non_empty(n.value(&["Name", "UserName"]))
        .or_else(|| non_empty(n.value(&["Name", "EffectiveName"])))
        .map(str::to_string)
        .unwrap_or_else(|| n.name.replacen("Track", " track", 1))
}

/// Ableton packs time signature as denominatorIndex * 99 + (numerator - 1).
pub fn decode_time_signature(encoded: f64) -> (u32, u32) {
    let numerator = (encoded % 99.0) + 1.0;
    let denominator = 2f64.powf((encoded / 99.0).floor());
    if !(1.0..=99.0).contains(&numerator) || ![1.0, 2.0, 4.0, 8.0, 16.0, 32.0].contains(&denominator) {
        return (4, 4);
    }
    (numerator as u32, denominator as u32)
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Segment {
    pub arr_start: f64,
    pub arr_length: f64,
    pub content_start: f64,
}

/// Which slices of a clip's content play where on the timeline.
pub fn clip_segments(
    arr_start: f64,
    arr_length: f64,
    content_start: f64,
    loop_start: f64,
    loop_end: f64,
    loop_on: bool,
    content_per_beat: f64,
) -> Vec<Segment> {
    let loop_length = (loop_end - loop_start) / content_per_beat;
    if !loop_on || loop_length <= 1e-6 {
        return vec![Segment { arr_start, arr_length, content_start }];
    }
    let mut segments = Vec::new();
    let mut at = 0.0;
    let mut cs = content_start;
    let mut first = (loop_end - content_start) / content_per_beat;
    if first <= 1e-6 {
        first = loop_length;
    }
    let mut seg_len = first.min(arr_length);
    let mut guard = 0;
    while at < arr_length - 1e-6 && guard < 10_000 {
        segments.push(Segment { arr_start: arr_start + at, arr_length: seg_len, content_start: cs });
        at += seg_len;
        cs = loop_start;
        seg_len = loop_length.min(arr_length - at);
        guard += 1;
    }
    segments
}

struct Frame {
    name: String,
    arr_start: f64,
    arr_length: f64,
    loop_start: f64,
    loop_end: f64,
    content_start: f64,
    loop_on: bool,
}

fn clip_frame(clip: &Node) -> Frame {
    let arr_start_attr = num(clip.attr("Time"), num(clip.value(&["CurrentStart"]), 0.0));
    let current_start = num(clip.value(&["CurrentStart"]), arr_start_attr);
    let current_end = num(clip.value(&["CurrentEnd"]), current_start);
    let lp = clip.child("Loop");
    let loop_start = num(opt_value(lp, &["LoopStart"]), 0.0);
    let loop_end = num(opt_value(lp, &["LoopEnd"]), loop_start);
    let start_relative = num(opt_value(lp, &["StartRelative"]), 0.0);
    Frame {
        name: clip.value(&["Name"]).unwrap_or("").to_string(),
        arr_start: current_start,
        arr_length: (current_end - current_start).max(0.0),
        loop_start,
        loop_end,
        content_start: loop_start + start_relative,
        loop_on: opt_value(lp, &["LoopOn"]) == Some("true"),
    }
}

/* ------------------------------ audio ------------------------------ */

#[derive(Clone, Copy)]
pub struct WarpMarker {
    pub sec: f64,
    pub beat: f64,
}

/// Content beat → seconds in the file, piecewise linear through warp markers.
pub fn beat_to_sec(beat: f64, markers: &[WarpMarker], bpm: f64) -> f64 {
    if markers.is_empty() {
        return beat * 60.0 / bpm;
    }
    if markers.len() == 1 {
        return markers[0].sec + (beat - markers[0].beat) * 60.0 / bpm;
    }
    let mut i = 0;
    while i < markers.len() - 2 && beat > markers[i + 1].beat {
        i += 1;
    }
    let (a, b) = (markers[i], markers[i + 1]);
    let span = b.beat - a.beat;
    if span.abs() < 1e-9 {
        return a.sec;
    }
    a.sec + (beat - a.beat) * (b.sec - a.sec) / span
}

fn audio_clips(clip: &Node, project: &mut Project, finder: &mut FileFinder, track_name: &str) -> Vec<AudioClip> {
    let frame = clip_frame(clip);
    if frame.arr_length <= 0.0 {
        return Vec::new();
    }
    let warped = clip.value(&["IsWarped"]) == Some("true");
    let mut markers: Vec<WarpMarker> = if warped {
        opt_find_all(clip.child("WarpMarkers"), "WarpMarker")
            .iter()
            .map(|m| WarpMarker { sec: num(m.attr("SecTime"), 0.0), beat: num(m.attr("BeatTime"), 0.0) })
            .collect()
    } else {
        Vec::new()
    };
    markers.sort_by(|a, b| a.beat.partial_cmp(&b.beat).unwrap());
    let content_per_beat = if warped { 1.0 } else { 60.0 / project.bpm };

    let (file, file_name) = resolve_sample(clip, finder);
    if file.is_none() {
        let shown = if file_name.is_empty() { "(unnamed)" } else { &file_name };
        project.warn(format!("Audio file not found: {shown} on \"{track_name}\"."));
    }
    let gain = clamp(num(clip.value(&["SampleVolume"]), 1.0), 0.0, 8.0);
    let segments = clip_segments(
        frame.arr_start,
        frame.arr_length,
        frame.content_start,
        frame.loop_start,
        frame.loop_end,
        frame.loop_on,
        content_per_beat,
    );
    let bpm = project.bpm;
    let to_sec = |c: f64| if warped { beat_to_sec(c, &markers, bpm) } else { c };

    if warped && markers.len() >= 2 {
        let span = frame.arr_length.min(4.0);
        let played = to_sec(frame.content_start + span) - to_sec(frame.content_start);
        let wall = span * 60.0 / bpm;
        if wall > 0.0 && (played / wall - 1.0).abs() > STRETCH_TOLERANCE {
            let label = if frame.name.is_empty() { &file_name } else { &frame.name };
            project.warn(format!(
                "\"{label}\" on \"{track_name}\" is time-stretched by warping — it is placed at the right position, but plays at its original speed. Re-warp it in the new DAW."
            ));
        }
    }

    let name = if frame.name.is_empty() { strip_ext(&file_name) } else { frame.name.clone() };
    segments
        .iter()
        .map(|s| AudioClip {
            name: name.clone(),
            start: s.arr_start,
            length: s.arr_length,
            file: file.clone(),
            file_name: file_name.clone(),
            offset: to_sec(s.content_start).max(0.0),
            gain,
        })
        .collect()
}

fn resolve_sample(clip: &Node, finder: &mut FileFinder) -> (Option<std::path::PathBuf>, String) {
    let file_ref = clip.path(&["SampleRef", "FileRef"]);
    let mut candidates = Vec::new();
    let mut file_name = String::new();

    let absolute = non_empty(opt_value(file_ref, &["Path"]));
    if let Some(a) = absolute {
        candidates.push(a.to_string());
    }
    let rel_value = non_empty(opt_value(file_ref, &["RelativePath"]));
    if let Some(r) = rel_value {
        candidates.push(finder.root.join(r).to_string_lossy().to_string());
    }
    if let Some(name) = non_empty(opt_value(file_ref, &["Name"])) {
        file_name = name.to_string();
        let dirs: Vec<String> = file_ref
            .and_then(|f| f.child("RelativePath"))
            .map(|r| {
                r.children_named("RelativePathElement")
                    .map(|e| match e.attr("Dir").unwrap_or("") {
                        "" => "..".to_string(),
                        d => d.to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        if !dirs.is_empty() {
            let mut p = finder.root.clone();
            for d in &dirs {
                p.push(d);
            }
            p.push(name);
            candidates.push(p.to_string_lossy().to_string());
        }
    }
    if let Some(data) = file_ref.and_then(|f| f.child("Data")) {
        if let Some(decoded) = decode_utf16_hex(&data.text) {
            candidates.push(decoded);
        }
    }
    if file_name.is_empty() {
        file_name = basename(absolute.or(rel_value).unwrap_or(""));
    }
    let file = finder.resolve(&candidates, &file_name);
    (file, file_name)
}

fn decode_utf16_hex(hex: &str) -> Option<String> {
    let clean: String = hex.chars().filter(|c| !c.is_whitespace()).collect();
    if clean.is_empty() || !clean.len().is_multiple_of(4) || !clean.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let bytes: Vec<u8> = (0..clean.len()).step_by(2).map(|i| u8::from_str_radix(&clean[i..i + 2], 16).unwrap()).collect();
    let units: Vec<u16> = bytes.chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    let text = String::from_utf16_lossy(&units).trim_end_matches('\u{0}').to_string();
    let b = text.as_bytes();
    if b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/') {
        Some(text)
    } else {
        None
    }
}

/* ------------------------------ midi ------------------------------- */

fn midi_clip(clip: &Node) -> Option<MidiClip> {
    let frame = clip_frame(clip);
    if frame.arr_length <= 0.0 {
        return None;
    }
    let mut source = Vec::new();
    for key_track in opt_find_all(clip.path(&["Notes", "KeyTracks"]), "KeyTrack") {
        let pitch = num(key_track.value(&["MidiKey"]), -1.0);
        if !(0.0..=127.0).contains(&pitch) {
            continue;
        }
        for ev in opt_find_all(key_track.child("Notes"), "MidiNoteEvent") {
            if ev.attr("IsEnabled") == Some("false") {
                continue;
            }
            source.push(Note {
                start: num(ev.attr("Time"), 0.0),
                length: num(ev.attr("Duration"), 0.0),
                pitch: pitch as u8,
                velocity: clamp(js_round(num(ev.attr("Velocity"), 100.0)), 1.0, 127.0) as u8,
            });
        }
    }
    let segments = clip_segments(frame.arr_start, frame.arr_length, frame.content_start, frame.loop_start, frame.loop_end, frame.loop_on, 1.0);
    let mut notes = Vec::new();
    for seg in &segments {
        let seg_end = seg.content_start + seg.arr_length;
        for n in &source {
            if n.start < seg.content_start - 1e-9 || n.start >= seg_end - 1e-9 {
                continue;
            }
            let start = seg.arr_start - frame.arr_start + (n.start - seg.content_start);
            let length = n.length.min(seg_end - n.start);
            if length > 1e-6 {
                notes.push(Note { start, length, ..n.clone() });
            }
        }
    }
    notes.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap().then(a.pitch.cmp(&b.pitch)));
    Some(MidiClip { name: frame.name, start: frame.arr_start, length: frame.arr_length, notes })
}

/* ---------------------------- automation --------------------------- */

fn automation_target_id(param: Option<&Node>) -> Option<String> {
    param?.child("AutomationTarget")?.attr("Id").filter(|v| !v.is_empty()).map(str::to_string)
}

fn envelopes_of(track: Option<&Node>) -> Vec<&Node> {
    opt_find_all(opt_path(track, &["AutomationEnvelopes", "Envelopes"]), "AutomationEnvelope")
}

fn pointee_id(env: &Node) -> Option<String> {
    env.value(&["EnvelopeTarget", "PointeeId"]).map(str::to_string)
}

fn read_track_automation(track_node: &Node, mixer: Option<&Node>, track: &mut Track, project: &mut Project) {
    let vol = automation_target_id(opt_path(mixer, &["Volume"]));
    let pan = automation_target_id(opt_path(mixer, &["Pan"]));
    let mute = automation_target_id(opt_path(mixer, &["Speaker"]));
    let mut other = 0;
    let mut curved = false;
    for env in envelopes_of(Some(track_node)) {
        let id = pointee_id(env);
        let kind = match &id {
            None => None,
            Some(_) if id == vol => Some(AutoKind::Volume),
            Some(_) if id == pan => Some(AutoKind::Pan),
            Some(_) if id == mute => Some(AutoKind::Mute),
            _ => None,
        };
        let Some(kind) = kind else {
            other += 1;
            continue;
        };
        let mut points = Vec::new();
        if kind == AutoKind::Mute {
            for ev in env.find_all("BoolEvent") {
                points.push(AutoPoint {
                    time: num(ev.attr("Time"), 0.0),
                    value: if ev.attr("Value") == Some("true") { 0.0 } else { 1.0 },
                });
            }
        } else {
            for ev in env.find_all("FloatEvent") {
                if ev.attr("CurveControl1X").is_some() || ev.attr("CurveControl1Y").is_some() {
                    curved = true;
                }
                let v = num(ev.attr("Value"), 0.0);
                let value = if kind == AutoKind::Volume { clamp(v, 0.0, 4.0) } else { clamp(v, -1.0, 1.0) };
                points.push(AutoPoint { time: num(ev.attr("Time"), 0.0), value });
            }
        }
        set_lane(track, kind, &points);
    }
    if curved {
        project.warn(format!("Curved automation on \"{}\" was converted as straight ramps.", track.name));
    }
    if other > 0 {
        project.warn(format!(
            "{other} automation lane(s) on \"{}\" (plug-ins, devices or sends) were not converted — only volume, pan and mute automation is.",
            track.name
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_signatures() {
        assert_eq!(decode_time_signature(201.0), (4, 4));
        assert_eq!(decode_time_signature(200.0), (3, 4));
        assert_eq!(decode_time_signature(302.0), (6, 8));
    }

    #[test]
    fn looped_clip_unrolls() {
        let s: Vec<_> = clip_segments(0.0, 10.0, 0.0, 0.0, 4.0, true, 1.0)
            .iter()
            .map(|s| (s.arr_start, s.arr_length, s.content_start))
            .collect();
        assert_eq!(s, vec![(0.0, 4.0, 0.0), (4.0, 4.0, 0.0), (8.0, 2.0, 0.0)]);
        let s: Vec<_> = clip_segments(0.0, 6.0, 3.0, 2.0, 4.0, true, 1.0)
            .iter()
            .map(|s| (s.arr_start, s.arr_length, s.content_start))
            .collect();
        assert_eq!(s, vec![(0.0, 1.0, 3.0), (1.0, 2.0, 2.0), (3.0, 2.0, 2.0), (5.0, 1.0, 2.0)]);
    }

    #[test]
    fn warp_markers() {
        let m = [WarpMarker { sec: 0.0, beat: 0.0 }, WarpMarker { sec: 4.0, beat: 8.0 }];
        assert!((beat_to_sec(2.0, &m, 120.0) - 1.0).abs() < 1e-12);
        assert!((beat_to_sec(2.0, &[], 120.0) - 1.0).abs() < 1e-12);
    }
}
