//! DAWproject (.dawproject) read and write — twin of `dawproject.ts`.
//! Opens in Bitwig Studio, Studio One 6.5+, Cubase / Nuendo 14+.
//! Spec: https://github.com/bitwig/dawproject

use crate::audio::audio_info;
use crate::files::{basename, strip_ext};
use crate::model::*;
use crate::xml::{self, attrs, escape, num, Node};
use crate::zip::{self, ZipWriter};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const AUDIO_LIMIT: usize = 2 * 1024 * 1024 * 1024;

fn s(v: impl ToString) -> Option<String> {
    Some(v.to_string())
}

fn fmt(n: f64) -> String {
    fmt_round(n, 6)
}

/* ================================================================== */
/* read                                                               */
/* ================================================================== */

struct Param {
    track: usize,
    kind: AutoKind,
    unit: String,
}

struct Reader<'a> {
    buf: &'a [u8],
    entries: Vec<zip::Entry>,
    file_path: &'a Path,
    extract_dir: PathBuf,
    extracted: HashMap<String, PathBuf>,
}

impl Reader<'_> {
    fn resolve_file(&mut self, file_node: Option<&Node>) -> (Option<PathBuf>, String) {
        let p = file_node.and_then(|n| n.attr("path")).unwrap_or("").to_string();
        let file_name = basename(&p);
        if p.is_empty() {
            return (None, file_name);
        }
        if file_node.and_then(|n| n.attr("external")) == Some("true") {
            let pb = PathBuf::from(&p);
            let full = if pb.is_absolute() { pb } else { self.file_path.parent().unwrap_or(Path::new(".")).join(pb) };
            return (if full.exists() { Some(full) } else { None }, file_name);
        }
        if let Some(done) = self.extracted.get(&p) {
            return (Some(done.clone()), file_name);
        }
        let Some(entry) = self.entries.iter().find(|e| e.name == p) else { return (None, file_name) };
        let Some(data) = zip::read_entry(self.buf, entry, AUDIO_LIMIT) else { return (None, file_name) };
        let out = self.extract_dir.join(&p);
        if let Some(parent) = out.parent() {
            if std::fs::create_dir_all(parent).is_err() {
                return (None, file_name);
            }
        }
        if std::fs::write(&out, data).is_err() {
            return (None, file_name);
        }
        self.extracted.insert(p, out.clone());
        (Some(out), file_name)
    }
}

pub fn read(file_path: &Path) -> Result<Project, String> {
    let buf = std::fs::read(file_path).map_err(|e| e.to_string())?;
    let entries = zip::list_entries(&buf).ok_or("Not a DAWproject file (not a zip archive).")?;
    let project_entry = entries.iter().find(|e| e.name == "project.xml").ok_or("Not a DAWproject file (no project.xml inside).")?;
    let xml_bytes = zip::read_entry(&buf, project_entry, 256 * 1024 * 1024).ok_or("Could not unpack project.xml.")?;
    let doc = xml::parse(&String::from_utf8_lossy(&xml_bytes));
    let root = doc.child("Project").ok_or("project.xml has no Project element.")?;

    let stem = file_path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let mut project = Project::new(&stem, "DAWproject");
    let transport = root.child("Transport");
    let tempo = num(transport.and_then(|t| t.child("Tempo")).and_then(|t| t.attr("value")), 0.0);
    if tempo > 0.0 {
        project.bpm = tempo;
    }
    if let Some(sig) = transport.and_then(|t| t.child("TimeSignature")) {
        project.time_signature = (num(sig.attr("numerator"), 4.0) as u32, num(sig.attr("denominator"), 4.0) as u32);
    }

    /* tracks by id */
    let mut tracks: Vec<Track> = Vec::new();
    let mut by_id: HashMap<String, usize> = HashMap::new();
    let mut params: HashMap<String, Param> = HashMap::new();
    fn visit(
        node: Option<&Node>,
        tracks: &mut Vec<Track>,
        by_id: &mut HashMap<String, usize>,
        params: &mut HashMap<String, Param>,
        project: &mut Project,
    ) {
        let Some(node) = node else { return };
        for t in node.children_named("Track") {
            let channel = t.child("Channel");
            let role = channel.and_then(|c| c.attr("role"));
            let has_children = t.children_named("Track").next().is_some();
            if role != Some("master") && !has_children {
                let idx = tracks.len();
                tracks.push(track_from_xml(t, channel));
                if let Some(id) = t.attr("id") {
                    by_id.insert(id.to_string(), idx);
                }
                if let Some(id) = channel.and_then(|c| c.attr("id")).filter(|v| !v.is_empty()) {
                    by_id.insert(id.to_string(), idx);
                }
                for (name, kind) in [("Volume", AutoKind::Volume), ("Pan", AutoKind::Pan), ("Mute", AutoKind::Mute)] {
                    if let Some(param) = channel.and_then(|c| c.child(name)) {
                        if let Some(id) = param.attr("id").filter(|v| !v.is_empty()) {
                            params.insert(id.to_string(), Param { track: idx, kind, unit: param.attr("unit").unwrap_or("").to_string() });
                        }
                    }
                }
            } else if has_children {
                let name = t.attr("name").filter(|v| !v.is_empty()).unwrap_or("Group");
                project.warn(format!("Folder \"{name}\" was flattened — its tracks are converted individually."));
            }
            visit(Some(t), tracks, by_id, params, project);
        }
    }
    visit(root.child("Structure"), &mut tracks, &mut by_id, &mut params, &mut project);

    let mut reader = Reader {
        buf: &buf,
        entries,
        file_path,
        extract_dir: std::env::temp_dir().join("daw-buddy-convert").join(format!("{:012x}", fnv(file_path.to_string_lossy().as_bytes()) & 0xffff_ffff_ffff)),
        extracted: HashMap::new(),
    };

    /* arrangement */
    let arrangement = root.child("Arrangement");
    for m in arrangement.and_then(|a| a.child("Markers")).map(|m| m.find_all("Marker")).unwrap_or_default() {
        project.markers.push(Marker {
            name: m.attr("name").filter(|v| !v.is_empty()).unwrap_or("Marker").to_string(),
            time: num(m.attr("time"), 0.0),
        });
    }
    if let Some(ta) = arrangement.and_then(|a| a.child("TempoAutomation")) {
        if ta.find_all("RealPoint").len() > 1 {
            let bpm = js_number(project.bpm);
            project.warn(format!("Tempo changes found — the converted project uses a constant {bpm} BPM."));
        }
    }

    let mut other_automation = 0usize;
    struct Walk<'p> {
        params: &'p HashMap<String, Param>,
        by_id: &'p HashMap<String, usize>,
    }
    #[allow(clippy::too_many_arguments)] // recursive walker over disjoint borrows
    fn walk_lanes(
        node: &Node,
        track_id: Option<&str>,
        unit: &str,
        w: &Walk,
        tracks: &mut [Track],
        project: &mut Project,
        reader: &mut Reader,
        other: &mut usize,
    ) {
        let my_unit = node.attr("timeUnit").filter(|v| !v.is_empty()).unwrap_or(unit);
        let my_track = node.attr("track").filter(|v| !v.is_empty()).or(track_id);
        for c in &node.children {
            match c.name.as_str() {
                "Lanes" => walk_lanes(c, my_track, my_unit, w, tracks, project, reader, other),
                "Clips" => {
                    let Some(&idx) = my_track.and_then(|t| w.by_id.get(t)) else { continue };
                    for clip_node in c.children_named("Clip") {
                        let clips = clips_from_xml(clip_node, 0.0, my_unit, project, reader);
                        tracks[idx].clips.extend(clips);
                    }
                }
                "Points" => read_points(c, my_unit, w.params, tracks, project, other),
                _ => {}
            }
        }
    }
    let walk = Walk { params: &params, by_id: &by_id };
    if let Some(arr) = arrangement {
        for lanes in arr.children_named("Lanes") {
            walk_lanes(lanes, None, "beats", &walk, &mut tracks, &mut project, &mut reader, &mut other_automation);
        }
    }
    if other_automation > 0 {
        project.warn(format!(
            "{other_automation} automation lane(s) (plug-ins, sends or MIDI expression) were not converted — only track volume, pan and mute automation is."
        ));
    }

    project.tracks = tracks;
    if root.child("Structure").map(|s| s.find_all("Devices").iter().any(|d| !d.children.is_empty())).unwrap_or(false) {
        project.warn("Instruments and effects are not converted — re-insert them in the new DAW.");
    }
    Ok(project)
}

fn fnv(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x100_0000_01b3);
    }
    h
}

fn read_points(node: &Node, unit: &str, params: &HashMap<String, Param>, tracks: &mut [Track], project: &Project, other: &mut usize) {
    let param = node.child("Target").and_then(|t| t.attr("parameter")).filter(|v| !v.is_empty()).and_then(|p| params.get(p));
    let Some(param) = param else {
        if node.children.len() > 1 {
            *other += 1;
        }
        return;
    };
    let time_unit = node.attr("timeUnit").filter(|v| !v.is_empty()).unwrap_or(unit);
    let value_unit = node.attr("unit").filter(|v| !v.is_empty()).unwrap_or(&param.unit);
    let mut raw: Vec<(f64, f64, bool)> = Vec::new();
    for p in &node.children {
        if p.name != "RealPoint" && p.name != "BoolPoint" {
            continue;
        }
        let raw_time = num(p.attr("time"), 0.0);
        let mut v = if p.name == "BoolPoint" {
            if p.attr("value") == Some("true") { 1.0 } else { 0.0 }
        } else {
            let mut v = num(p.attr("value"), 0.0);
            if param.kind == AutoKind::Volume && value_unit == "decibel" {
                v = 10f64.powf(v / 20.0);
            }
            if param.kind == AutoKind::Pan && value_unit != "linear" {
                v = v * 2.0 - 1.0;
            }
            if param.kind == AutoKind::Mute {
                v = if v >= 0.5 { 1.0 } else { 0.0 };
            }
            v
        };
        match param.kind {
            AutoKind::Volume => v = clamp(v, 0.0, 4.0),
            AutoKind::Pan => v = clamp(v, -1.0, 1.0),
            AutoKind::Mute => {}
        }
        let time = if time_unit == "seconds" { seconds_to_beats(raw_time, project.bpm) } else { raw_time };
        raw.push((time, v, p.attr("interpolation") == Some("hold")));
    }
    // A hold point keeps its value until the next point: add a copy there.
    let mut points = Vec::new();
    for (i, &(time, value, hold)) in raw.iter().enumerate() {
        points.push(AutoPoint { time, value });
        if let Some(next) = raw.get(i + 1) {
            if hold && param.kind != AutoKind::Mute {
                points.push(AutoPoint { time: next.0, value });
            }
        }
    }
    set_lane(&mut tracks[param.track], param.kind, &points);
}

fn track_from_xml(t: &Node, channel: Option<&Node>) -> Track {
    let content = t.attr("contentType").unwrap_or("");
    let vol = channel.and_then(|c| c.child("Volume"));
    let mut volume = num(vol.and_then(|v| v.attr("value")), 1.0);
    if vol.and_then(|v| v.attr("unit")) == Some("decibel") {
        volume = 10f64.powf(volume / 20.0);
    }
    let pan_node = channel.and_then(|c| c.child("Pan"));
    let mut pan = num(pan_node.and_then(|p| p.attr("value")), 0.5);
    let pan_unit = pan_node.and_then(|p| p.attr("unit")).unwrap_or("");
    if pan_node.is_none() || pan_unit == "normalized" || pan_unit.is_empty() {
        pan = pan * 2.0 - 1.0;
    }
    let color = t
        .attr("color")
        .filter(|c| c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|ch| ch.is_ascii_hexdigit()))
        .map(|c| c.to_lowercase());
    let kind = if content.contains("notes") && !content.contains("audio") {
        TrackKind::Midi
    } else if content.contains("audio") {
        TrackKind::Audio
    } else {
        TrackKind::Midi
    };
    Track {
        name: t.attr("name").filter(|v| !v.is_empty()).unwrap_or("Track").to_string(),
        kind,
        volume: clamp(volume, 0.0, 4.0),
        pan: clamp(pan, -1.0, 1.0),
        mute: channel.and_then(|c| c.child("Mute")).and_then(|m| m.attr("value")) == Some("true"),
        color,
        clips: Vec::new(),
        automation: Automation::default(),
    }
}

fn clips_from_xml(clip: &Node, parent_offset: f64, unit: &str, project: &mut Project, reader: &mut Reader) -> Vec<Clip> {
    let bpm = project.bpm;
    let to_beats = |v: f64| if unit == "seconds" { seconds_to_beats(v, bpm) } else { v };
    let start = parent_offset + to_beats(num(clip.attr("time"), 0.0));
    let length = to_beats(num(clip.attr("duration"), 0.0));
    let play_start = num(clip.attr("playStart"), 0.0);
    let name = clip.attr("name").unwrap_or("").to_string();
    if clip.attr("enable") == Some("false") {
        return Vec::new();
    }
    if clip.attr("loopEnd").is_some() && num(clip.attr("loopEnd"), 0.0) - num(clip.attr("loopStart"), 0.0) < length - 1e-6 {
        let label = if name.is_empty() { "clip" } else { &name };
        project.warn(format!("Looped clip \"{label}\" was converted as a single pass."));
    }

    if let Some(nested) = clip.child("Clips") {
        let mut out = Vec::new();
        for c in nested.children_named("Clip") {
            out.extend(clips_from_xml(c, start - play_start, unit, project, reader));
        }
        return out;
    }

    let notes_node = clip.child("Notes").or_else(|| clip.child("Lanes").and_then(|l| l.find_all("Notes").into_iter().next()));
    if let Some(notes_node) = notes_node {
        let mut notes = Vec::new();
        for n in notes_node.children_named("Note") {
            let t = num(n.attr("time"), 0.0) - play_start;
            if t < -1e-9 || t >= length {
                continue;
            }
            notes.push(Note {
                start: t,
                length: num(n.attr("duration"), 0.0).min(length - t),
                pitch: clamp(js_round(num(n.attr("key"), 60.0)), 0.0, 127.0) as u8,
                velocity: clamp(js_round(num(n.attr("vel"), 0.8) * 127.0), 1.0, 127.0) as u8,
            });
        }
        return vec![Clip::Midi(MidiClip { name, start, length, notes })];
    }

    let warps = clip.child("Warps");
    let audio_node = warps.and_then(|w| w.child("Audio")).or_else(|| clip.child("Audio"));
    let Some(audio_node) = audio_node else { return Vec::new() };
    let (file, file_name) = reader.resolve_file(audio_node.child("File"));
    if file.is_none() {
        let shown = if file_name.is_empty() { "(unnamed)" } else { &file_name };
        project.warn(format!("Audio file not found: {shown}."));
    }
    let offset = if let Some(warps) = warps {
        let points: Vec<(f64, f64)> =
            warps.children_named("Warp").map(|w| (num(w.attr("time"), 0.0), num(w.attr("contentTime"), 0.0))).collect();
        let warp_sec = warps.attr("contentTimeUnit") != Some("beats");
        let mut offset = interpolate(&points, play_start);
        if !warp_sec {
            offset = beats_to_seconds(offset, bpm);
        }
        if points.len() >= 2 {
            let (a, b) = (points[0], points[points.len() - 1]);
            let rate = (b.1 - a.1) / (b.0 - a.0).max(1e-9);
            let expected = if warp_sec { 60.0 / bpm } else { 1.0 };
            if (rate / expected - 1.0).abs() > 0.002 {
                let label = if name.is_empty() { &file_name } else { &name };
                project.warn(format!("\"{label}\" is time-stretched — it is placed correctly but plays at its original speed."));
            }
        }
        offset
    } else {
        let content_unit = clip.attr("contentTimeUnit").filter(|v| !v.is_empty()).unwrap_or(unit);
        if content_unit == "seconds" { play_start } else { beats_to_seconds(play_start, bpm) }
    };
    vec![Clip::Audio(AudioClip {
        name: if name.is_empty() { strip_ext(&file_name) } else { name },
        start,
        length,
        file,
        file_name,
        offset: offset.max(0.0),
        gain: 1.0,
    })]
}

fn interpolate(points: &[(f64, f64)], t: f64) -> f64 {
    if points.is_empty() {
        return t;
    }
    if points.len() == 1 {
        return points[0].1 + (t - points[0].0);
    }
    let mut i = 0;
    while i < points.len() - 2 && t > points[i + 1].0 {
        i += 1;
    }
    let (a, b) = (points[i], points[i + 1]);
    if (b.0 - a.0).abs() < 1e-9 {
        return a.1;
    }
    a.1 + (t - a.0) * (b.1 - a.1) / (b.0 - a.0)
}

/* ================================================================== */
/* write                                                              */
/* ================================================================== */

pub fn write(project: &Project, out_file: &Path, embed_audio: bool) -> Result<Vec<String>, String> {
    let mut notes: Vec<String> = Vec::new();
    let mut next_id = 0usize;
    let mut id = || {
        let v = format!("id{next_id}");
        next_id += 1;
        Some(v)
    };
    let mut zip_out = ZipWriter::default();
    let mut embedded: HashMap<PathBuf, String> = HashMap::new();
    let mut used_names: Vec<String> = Vec::new();
    let mut embedded_bytes = 0usize;

    let master_channel_id = id();
    let mut structure: Vec<String> = Vec::new();
    let mut lanes: Vec<String> = Vec::new();

    for track in &project.tracks {
        let track_id = id();
        let channel_id = id();
        let mute_id = id();
        let pan_id = id();
        let volume_id = id();
        structure.push(format!(
            "    <Track{}>\n      <Channel{}>\n        <Mute{}/>\n        <Pan{}/>\n        <Volume{}/>\n      </Channel>\n    </Track>",
            attrs(&[
                ("contentType", s(if track.kind == TrackKind::Audio { "audio" } else { "notes" })),
                ("loaded", s("true")),
                ("id", track_id.clone()),
                ("name", s(&track.name)),
                ("color", track.color.clone()),
            ]),
            attrs(&[
                ("audioChannels", s(2)),
                ("destination", master_channel_id.clone()),
                ("role", s("regular")),
                ("solo", s("false")),
                ("id", channel_id),
            ]),
            attrs(&[("value", s(track.mute)), ("id", mute_id.clone()), ("name", s("Mute"))]),
            attrs(&[
                ("max", s(1)),
                ("min", s(0)),
                ("unit", s("normalized")),
                ("value", s(fmt((track.pan + 1.0) / 2.0))),
                ("id", pan_id.clone()),
                ("name", s("Pan")),
            ]),
            attrs(&[
                ("max", s(2)),
                ("min", s(0)),
                ("unit", s("linear")),
                ("value", s(fmt(track.volume))),
                ("id", volume_id.clone()),
                ("name", s("Volume")),
            ]),
        ));

        let mut clip_xml: Vec<String> = Vec::new();
        for clip in &track.clips {
            match clip {
                Clip::Midi(c) => {
                    let note_xml: Vec<String> = c
                        .notes
                        .iter()
                        .map(|n| {
                            format!(
                                "            <Note{}/>",
                                attrs(&[
                                    ("time", s(fmt(n.start))),
                                    ("duration", s(fmt(n.length))),
                                    ("channel", s(0)),
                                    ("key", s(n.pitch)),
                                    ("vel", s(fmt(n.velocity as f64 / 127.0))),
                                    ("rel", s("0.5")),
                                ])
                            )
                        })
                        .collect();
                    let body = if note_xml.is_empty() { String::new() } else { note_xml.join("\n") + "\n" };
                    clip_xml.push(format!(
                        "        <Clip{}>\n          <Notes{}>\n{body}          </Notes>\n        </Clip>",
                        attrs(&[
                            ("time", s(fmt(c.start))),
                            ("duration", s(fmt(c.length))),
                            ("playStart", s("0")),
                            ("name", Some(c.name.clone()).filter(|n| !n.is_empty())),
                        ]),
                        attrs(&[("id", id())]),
                    ));
                }
                Clip::Audio(c) => {
                    // Where the file lives inside (or outside) the DAWproject.
                    let (ref_path, external) = match &c.file {
                        None => (c.file_name.clone(), true),
                        Some(f) if !embed_audio => (f.to_string_lossy().to_string(), true),
                        Some(f) => {
                            if let Some(z) = embedded.get(f) {
                                (z.clone(), false)
                            } else {
                                let data = std::fs::read(f).map_err(|e| format!("Could not read {}: {e}", f.display()))?;
                                embedded_bytes += data.len();
                                if embedded_bytes > AUDIO_LIMIT {
                                    notes.push(format!("Audio over 2 GB — \"{}\" is referenced in place rather than embedded.", c.file_name));
                                    (f.to_string_lossy().to_string(), true)
                                } else {
                                    let base = f.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                                    let mut name = base.clone();
                                    let mut n = 2;
                                    while used_names.contains(&name.to_lowercase()) {
                                        name = match base.rfind('.') {
                                            Some(i) => format!("{} {n}{}", &base[..i], &base[i..]),
                                            None => format!("{base} {n}"),
                                        };
                                        n += 1;
                                    }
                                    used_names.push(name.to_lowercase());
                                    let zip_path = format!("audio/{name}");
                                    zip_out.add(&zip_path, &data, false)?;
                                    embedded.insert(f.clone(), zip_path.clone());
                                    (zip_path, false)
                                }
                            }
                        }
                    };
                    let info = c.file.as_deref().and_then(audio_info);
                    let length_sec = beats_to_seconds(c.length, project.bpm);
                    let duration = info.map(|i| i.duration).filter(|d| *d != 0.0).unwrap_or(c.offset + length_sec);
                    let warps_id = id();
                    let audio_id = id();
                    clip_xml.push(format!(
                        "        <Clip{}>\n          <Warps{}>\n            <Audio{}>\n              <File{}/>\n            </Audio>\n            <Warp{}/>\n            <Warp{}/>\n          </Warps>\n        </Clip>",
                        attrs(&[
                            ("time", s(fmt(c.start))),
                            ("duration", s(fmt(c.length))),
                            ("playStart", s("0")),
                            ("name", Some(c.name.clone()).filter(|n| !n.is_empty())),
                        ]),
                        attrs(&[("contentTimeUnit", s("seconds")), ("timeUnit", s("beats")), ("id", warps_id)]),
                        attrs(&[
                            ("algorithm", s("raw")),
                            ("channels", s(info.map(|i| i.channels).filter(|c| *c != 0).unwrap_or(2))),
                            ("duration", s(fmt(duration))),
                            ("sampleRate", s(info.map(|i| i.sample_rate).filter(|r| *r != 0).unwrap_or(44100))),
                            ("id", audio_id),
                        ]),
                        attrs(&[("path", s(&ref_path)), ("external", if external { s("true") } else { None })]),
                        attrs(&[("time", s("0")), ("contentTime", s(fmt(c.offset)))]),
                        attrs(&[("time", s(fmt(c.length))), ("contentTime", s(fmt(c.offset + length_sec)))]),
                    ));
                    if (c.gain - 1.0).abs() > 1e-3 {
                        notes.push("Clip gain is not part of DAWproject 1.0 — clip gain was dropped.".into());
                    }
                }
            }
        }

        let mut points_xml: Vec<String> = Vec::new();
        let mut lane = |param: &Option<String>, unit: &str, body: Vec<String>, id: Option<String>| {
            points_xml.push(format!(
                "        <Points{}>\n          <Target{}/>\n{}\n        </Points>",
                attrs(&[("id", id), ("unit", s(unit))]),
                attrs(&[("parameter", param.clone())]),
                body.join("\n")
            ));
        };
        let auto = &track.automation;
        if let Some(v) = auto.get(AutoKind::Volume) {
            let body = v
                .iter()
                .map(|p| {
                    format!(
                        "          <RealPoint{}/>",
                        attrs(&[("time", s(fmt(p.time))), ("value", s(fmt(clamp(p.value, 0.0, 2.0)))), ("interpolation", s("linear"))])
                    )
                })
                .collect();
            lane(&volume_id, "linear", body, id());
            if v.iter().any(|p| p.value > 2.0) {
                notes.push("Volume automation above +6 dB was limited to +6 dB (the DAWproject fader range).".into());
            }
        }
        if let Some(v) = auto.get(AutoKind::Pan) {
            let body = v
                .iter()
                .map(|p| {
                    format!(
                        "          <RealPoint{}/>",
                        attrs(&[("time", s(fmt(p.time))), ("value", s(fmt((p.value + 1.0) / 2.0))), ("interpolation", s("linear"))])
                    )
                })
                .collect();
            lane(&pan_id, "normalized", body, id());
        }
        if let Some(v) = auto.get(AutoKind::Mute) {
            let body = v
                .iter()
                .map(|p| {
                    format!(
                        "          <BoolPoint{}/>",
                        attrs(&[("time", s(fmt(p.time))), ("value", s(if p.value >= 0.5 { "true" } else { "false" }))])
                    )
                })
                .collect();
            lane(&mute_id, "linear", body, id());
        }
        let lanes_id = id();
        let clips_id = id();
        let clips_body = if clip_xml.is_empty() { String::new() } else { clip_xml.join("\n") + "\n" };
        let points_body = if points_xml.is_empty() { String::new() } else { points_xml.join("\n") + "\n" };
        lanes.push(format!(
            "      <Lanes{}>\n        <Clips{}>\n{clips_body}        </Clips>\n{points_body}      </Lanes>",
            attrs(&[("track", track_id), ("id", lanes_id)]),
            attrs(&[("id", clips_id)]),
        ));
    }

    let master_track_id = id();
    let (m_mute, m_pan, m_vol) = (id(), id(), id());
    structure.push(format!(
        "    <Track{}>\n      <Channel{}>\n        <Mute{}/>\n        <Pan{}/>\n        <Volume{}/>\n      </Channel>\n    </Track>",
        attrs(&[("contentType", s("audio notes")), ("loaded", s("true")), ("id", master_track_id), ("name", s("Master"))]),
        attrs(&[("audioChannels", s(2)), ("role", s("master")), ("solo", s("false")), ("id", master_channel_id)]),
        attrs(&[("value", s("false")), ("id", m_mute), ("name", s("Mute"))]),
        attrs(&[("max", s(1)), ("min", s(0)), ("unit", s("normalized")), ("value", s("0.5")), ("id", m_pan), ("name", s("Pan"))]),
        attrs(&[("max", s(2)), ("min", s(0)), ("unit", s("linear")), ("value", s("1")), ("id", m_vol), ("name", s("Volume"))]),
    ));

    let marker_xml = if project.markers.is_empty() {
        String::new()
    } else {
        let mid = id();
        let lines: Vec<String> = project
            .markers
            .iter()
            .map(|m| format!("      <Marker{}/>", attrs(&[("time", s(fmt(m.time))), ("name", s(&m.name))])))
            .collect();
        format!("    <Markers{}>\n{}\n    </Markers>\n", attrs(&[("id", mid)]), lines.join("\n"))
    };

    let tempo_id = id();
    let sig_id = id();
    let arr_id = id();
    let lanes_root_id = id();
    let xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Project version=\"1.0\">\n  <Application name=\"DAW Buddy\" version=\"1.0\"/>\n  <Transport>\n    <Tempo{}/>\n    <TimeSignature{}/>\n  </Transport>\n  <Structure>\n{}\n  </Structure>\n  <Arrangement{}>\n{marker_xml}    <Lanes{}>\n{}\n    </Lanes>\n  </Arrangement>\n  <Scenes/>\n</Project>\n",
        attrs(&[("max", s(666)), ("min", s(20)), ("unit", s("bpm")), ("value", s(fmt(project.bpm))), ("id", tempo_id), ("name", s("Tempo"))]),
        attrs(&[("denominator", s(project.time_signature.1)), ("numerator", s(project.time_signature.0)), ("id", sig_id)]),
        structure.join("\n"),
        attrs(&[("id", arr_id)]),
        attrs(&[("timeUnit", s("beats")), ("id", lanes_root_id)]),
        lanes.join("\n"),
    );
    let metadata = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<MetaData>\n  <Title>{}</Title>\n  <Comment>Converted from {} by DAW Buddy</Comment>\n</MetaData>\n",
        escape(&project.name),
        escape(&project.source)
    );
    zip_out.add("project.xml", xml.as_bytes(), true)?;
    zip_out.add("metadata.xml", metadata.as_bytes(), true)?;
    std::fs::write(out_file, zip_out.finish()).map_err(|e| e.to_string())?;

    let mut unique = Vec::new();
    for n in notes {
        if !unique.contains(&n) {
            unique.push(n);
        }
    }
    Ok(unique)
}
