//! The "works in any DAW" pack — twin of `universal.ts`: one multitrack MIDI
//! file plus one WAV stem per audio track, every stem starting at bar 1.

use crate::audio::{decode_wav, encode_wav_float, Decoded};
use crate::model::*;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const TPQ: f64 = 960.0;

fn vlq(value: u32) -> Vec<u8> {
    let mut bytes = vec![(value & 0x7f) as u8];
    let mut rest = value >> 7;
    while rest > 0 {
        bytes.insert(0, ((rest & 0x7f) | 0x80) as u8);
        rest >>= 7;
    }
    bytes
}

fn text_event(kind: u8, text: &str) -> Vec<u8> {
    let data = text.as_bytes();
    let mut out = vec![0xff, kind];
    out.extend(vlq(data.len() as u32));
    out.extend_from_slice(data);
    out
}

struct Ev {
    tick: i64,
    bytes: Vec<u8>,
    order: u8,
}

fn chunk(mut events: Vec<Ev>) -> Vec<u8> {
    events.sort_by(|a, b| a.tick.cmp(&b.tick).then(a.order.cmp(&b.order)));
    let mut body = Vec::new();
    let mut last = 0i64;
    for e in &events {
        body.extend(vlq((e.tick - last).max(0) as u32));
        body.extend_from_slice(&e.bytes);
        last = e.tick;
    }
    body.extend_from_slice(&[0x00, 0xff, 0x2f, 0x00]);
    let mut out = b"MTrk".to_vec();
    out.extend_from_slice(&(body.len() as u32).to_be_bytes());
    out.extend(body);
    out
}

fn tick(beats: f64) -> i64 {
    js_round(beats * TPQ) as i64
}

/// Volume → CC7 (GM curve: cc = 127·sqrt(gain)), pan → CC10, sampled every
/// 1/32 note, writing only changes.
fn controller_events(automation: &Automation, channel: u8) -> Vec<Ev> {
    let mut out = Vec::new();
    type Lane<'a> = (Option<&'a Vec<AutoPoint>>, u8, fn(f64) -> f64);
    let lanes: [Lane; 2] = [
        (automation.get(AutoKind::Volume), 7, |g| js_round(127.0 * g.max(0.0).sqrt())),
        (automation.get(AutoKind::Pan), 10, |p| js_round(64.0 + p * 63.0)),
    ];
    for (lane, cc, to_cc) in lanes {
        let Some(lane) = lane else { continue };
        let mut cursor = LaneCursor::new(lane, false);
        let step = 1.0 / 8.0;
        let end = lane[lane.len() - 1].time;
        let mut last = -1.0;
        let mut t = 0.0;
        while t <= end + step {
            let tt = t.min(end);
            let v = to_cc(cursor.at(tt)).clamp(0.0, 127.0);
            if v != last {
                out.push(Ev { tick: tick(tt), order: 0, bytes: vec![0xb0 | channel, cc, v as u8] });
                last = v;
            }
            t += step;
        }
    }
    out
}

/// Format 1 SMF: a conductor track, then one track per MIDI track.
pub fn project_to_midi(project: &Project, warn: &mut Vec<String>) -> Option<Vec<u8>> {
    let midi_tracks: Vec<&Track> = project.tracks.iter().filter(|t| t.kind == TrackKind::Midi && !t.clips.is_empty()).collect();
    let mut conductor = Vec::new();
    let us = js_round(60_000_000.0 / project.bpm) as u32;
    conductor.push(Ev { tick: 0, order: 0, bytes: text_event(0x03, &project.name) });
    conductor.push(Ev { tick: 0, order: 0, bytes: vec![0xff, 0x51, 0x03, (us >> 16) as u8, (us >> 8) as u8, us as u8] });
    let (num_, den) = project.time_signature;
    conductor.push(Ev { tick: 0, order: 0, bytes: vec![0xff, 0x58, 0x04, num_ as u8, js_round((den as f64).log2()) as u8, 24, 8] });
    for m in &project.markers {
        conductor.push(Ev { tick: tick(m.time), order: 1, bytes: text_event(0x06, &m.name) });
    }
    let mut chunks = vec![chunk(conductor)];
    for (i, track) in midi_tracks.iter().enumerate() {
        let channel = if i % 16 == 9 { 10 } else { (i % 16) as u8 };
        let mut events = vec![Ev { tick: 0, order: 0, bytes: text_event(0x03, &track.name) }];
        for clip in &track.clips {
            let Clip::Midi(c) = clip else { continue };
            for n in &c.notes {
                let on = tick(c.start + n.start);
                let off = (on + 1).max(tick(c.start + n.start + n.length));
                events.push(Ev { tick: on, order: 2, bytes: vec![0x90 | channel, n.pitch, n.velocity] });
                events.push(Ev { tick: off, order: 1, bytes: vec![0x80 | channel, n.pitch, 0] });
            }
        }
        events.extend(controller_events(&track.automation, channel));
        if track.automation.get(AutoKind::Mute).is_some() {
            warn.push(format!("Mute automation on MIDI track \"{}\" can't be stored in a MIDI file and was left out.", track.name));
        }
        chunks.push(chunk(events));
    }
    if midi_tracks.is_empty() && project.markers.is_empty() {
        return None;
    }
    let mut out = b"MThd".to_vec();
    out.extend_from_slice(&6u32.to_be_bytes());
    out.extend_from_slice(&1u16.to_be_bytes());
    out.extend_from_slice(&(chunks.len() as u16).to_be_bytes());
    out.extend_from_slice(&(TPQ as u16).to_be_bytes());
    for c in chunks {
        out.extend(c);
    }
    Some(out)
}

fn is_wav(p: &Path) -> bool {
    p.extension().map(|e| e.eq_ignore_ascii_case("wav") || e.eq_ignore_ascii_case("wave")).unwrap_or(false)
}

/// Render one audio track to a WAV that starts at bar 1, with clip gain and
/// the track's automation baked in; faders and static pan are not applied.
pub fn render_stem(clips: &[&AudioClip], project: &Project, total_sec: f64, warn: &mut Vec<String>, automation: &Automation) -> Option<Vec<u8>> {
    let usable: Vec<&AudioClip> = clips.iter().copied().filter(|c| c.file.as_deref().map(is_wav).unwrap_or(false)).collect();
    for c in clips {
        if let Some(f) = &c.file {
            if !is_wav(f) {
                warn.push(format!("\"{}\" is not a WAV, so it was copied to the Audio folder instead of rendered into a stem.", c.file_name));
            }
        }
    }
    if usable.is_empty() {
        return None;
    }
    let mut decoded: Vec<(PathBuf, Decoded)> = Vec::new();
    let mut failed: Vec<PathBuf> = Vec::new();
    for c in &usable {
        let f = c.file.clone().unwrap();
        if decoded.iter().any(|(p, _)| *p == f) || failed.contains(&f) {
            continue;
        }
        match decode_wav(&f) {
            Ok(d) => decoded.push((f, d)),
            Err(e) => {
                warn.push(format!("Could not read \"{}\": {e}", c.file_name));
                failed.push(f);
            }
        }
    }
    if decoded.is_empty() {
        return None;
    }
    // Most common rate wins (first seen on a tie); others are resampled.
    let mut rates: Vec<(u32, usize)> = Vec::new();
    for (_, d) in &decoded {
        match rates.iter_mut().find(|(r, _)| *r == d.sample_rate) {
            Some(e) => e.1 += 1,
            None => rates.push((d.sample_rate, 1)),
        }
    }
    let mut sorted = rates.clone();
    sorted.sort_by_key(|r| std::cmp::Reverse(r.1));
    let rate = sorted[0].0;
    if rates.len() > 1 {
        warn.push("Clips with different sample rates were resampled to match their track.".into());
    }
    let stereo = decoded.iter().any(|(_, d)| d.channels.len() > 1);
    let out_ch = if stereo || automation.get(AutoKind::Pan).is_some() { 2 } else { 1 };
    let frames = (total_sec * rate as f64).ceil() as usize;
    let mut out = vec![vec![0f32; frames]; out_ch];
    let by_path: HashMap<&PathBuf, &Decoded> = decoded.iter().map(|(p, d)| (p, d)).collect();

    for c in &usable {
        let Some(src) = by_path.get(c.file.as_ref().unwrap()) else { continue };
        let start_frame = js_round(beats_to_seconds(c.start, project.bpm) * rate as f64) as i64;
        let len_frames = js_round(beats_to_seconds(c.length, project.bpm) * rate as f64) as i64;
        let ratio = src.sample_rate as f64 / rate as f64;
        let src_start = c.offset * src.sample_rate as f64;
        let src_len = src.channels[0].len();
        for (ch, o) in out.iter_mut().enumerate() {
            let s = &src.channels[ch.min(src.channels.len() - 1)];
            for i in 0..len_frames.max(0) {
                let dst = start_frame + i;
                if dst >= frames as i64 {
                    break;
                }
                let pos = src_start + i as f64 * ratio;
                let p0 = pos.floor();
                if p0 >= src_len as f64 {
                    break;
                }
                let p0u = p0 as usize;
                let frac = pos - p0;
                let a = s[p0u] as f64;
                let b = if p0u + 1 < src_len { s[p0u + 1] as f64 } else { a };
                if dst >= 0 {
                    let d = dst as usize;
                    o[d] = (o[d] as f64 + (a + (b - a) * frac) * c.gain) as f32;
                }
            }
        }
    }
    apply_automation(&mut out, rate, project.bpm, automation);
    Some(encode_wav_float(&out, rate))
}

/// Bake volume, pan (balance) and mute automation into rendered audio.
pub fn apply_automation(channels: &mut [Vec<f32>], rate: u32, bpm: f64, automation: &Automation) {
    let mut vol = automation.get(AutoKind::Volume).map(|l| LaneCursor::new(l, false));
    let mut pan = if channels.len() == 2 { automation.get(AutoKind::Pan).map(|l| LaneCursor::new(l, false)) } else { None };
    let mut mute = automation.get(AutoKind::Mute).map(|l| LaneCursor::new(l, true));
    if vol.is_none() && pan.is_none() && mute.is_none() {
        return;
    }
    let frames = channels[0].len();
    let beats_per_frame = bpm / 60.0 / rate as f64;
    for f in 0..frames {
        let beat = f as f64 * beats_per_frame;
        let mut gain = vol.as_mut().map(|v| v.at(beat)).unwrap_or(1.0);
        if let Some(m) = mute.as_mut() {
            if m.at(beat) >= 0.5 {
                gain = 0.0;
            }
        }
        if let Some(p) = pan.as_mut() {
            let p = p.at(beat);
            channels[0][f] = (channels[0][f] as f64 * (gain * if p > 0.0 { 1.0 - p } else { 1.0 })) as f32;
            channels[1][f] = (channels[1][f] as f64 * (gain * if p < 0.0 { 1.0 + p } else { 1.0 })) as f32;
        } else {
            for ch in channels.iter_mut() {
                ch[f] = (ch[f] as f64 * gain) as f32;
            }
        }
    }
}

fn gain_db(linear: f64) -> String {
    if linear <= 0.0 {
        return "-inf dB".into();
    }
    let db = 20.0 * linear.log10();
    format!("{}{:.1} dB", if db >= 0.0 { "+" } else { "" }, db)
}

fn pan_text(pan: f64) -> String {
    if pan.abs() < 0.005 {
        return "C".into();
    }
    format!("{}{}", js_round(pan.abs() * 100.0), if pan < 0.0 { "L" } else { "R" })
}

/// Safe file name: like `safe()` in universal.ts.
pub fn safe(name: &str) -> String {
    let base = if name.is_empty() { "Untitled" } else { name };
    let replaced: String = base
        .chars()
        .map(|c| if matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || (c as u32) < 0x20 { '_' } else { c })
        .collect();
    // JS slice(0, 120) counts UTF-16 units.
    let units: Vec<u16> = replaced.trim().encode_utf16().take(120).collect();
    let trimmed = String::from_utf16_lossy(&units);
    if trimmed.is_empty() {
        "Untitled".into()
    } else {
        trimmed
    }
}

pub fn write(project: &Project, out_dir: &Path, progress: &mut dyn FnMut(&str)) -> Result<Vec<String>, String> {
    let mut notes: Vec<String> = Vec::new();
    std::fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
    if let Some(midi) = project_to_midi(project, &mut notes) {
        std::fs::write(out_dir.join(format!("{}.mid", safe(&project.name))), midi).map_err(|e| e.to_string())?;
    }
    let total_sec = beats_to_seconds(project.length(), project.bpm) + 0.5;
    let stems = out_dir.join("Stems");
    let audio_dir = out_dir.join("Audio");
    for (i, track) in project.tracks.iter().enumerate() {
        if track.kind != TrackKind::Audio || track.clips.is_empty() {
            continue;
        }
        progress(&format!("Rendering stem: {}", track.name));
        let audio: Vec<&AudioClip> = track.clips.iter().filter_map(|c| if let Clip::Audio(a) = c { Some(a) } else { None }).collect();
        if let Some(wav) = render_stem(&audio, project, total_sec, &mut notes, &track.automation) {
            std::fs::create_dir_all(&stems).map_err(|e| e.to_string())?;
            std::fs::write(stems.join(format!("{:02} {}.wav", i + 1, safe(&track.name))), wav).map_err(|e| e.to_string())?;
        }
        for c in &audio {
            let Some(f) = &c.file else { continue };
            if is_wav(f) {
                continue;
            }
            std::fs::create_dir_all(&audio_dir).map_err(|e| e.to_string())?;
            if let Some(name) = f.file_name() {
                let _ = std::fs::copy(f, audio_dir.join(name));
            }
        }
    }

    let mixer: Vec<String> = project
        .tracks
        .iter()
        .map(|t| {
            let a = &t.automation;
            let how = if t.kind == TrackKind::Audio { "in stem" } else { "as CC" };
            let vol = if a.get(AutoKind::Volume).is_some() { format!("auto ({how})") } else { gain_db(t.volume) };
            let pan = if a.get(AutoKind::Pan).is_some() { format!("auto ({how})") } else { pan_text(t.pan) };
            let mute = if a.get(AutoKind::Mute).is_some() {
                if t.kind == TrackKind::Audio { "   mute auto (in stem)" } else { "" }
            } else if t.mute {
                "   MUTED"
            } else {
                ""
            };
            format!("  {:<28} {:>14}   pan {:>13}{mute}", t.name, vol, pan)
        })
        .collect();
    let bpm = fmt_round(project.bpm, 3);
    let readme = format!(
        "{name} — converted from {source} by DAW Buddy

Tempo:          {bpm} BPM
Time signature: {n}/{d}

HOW TO OPEN IN ANY DAW
1. Create a new project and set the tempo to {bpm} BPM.
2. Drag everything in \"Stems\" onto the timeline at bar 1 (the very start).
   Every stem starts at bar 1 — that is what keeps them in sync.
3. Drag \"{safe_name}.mid\" in at bar 1 for the MIDI parts, tempo and markers.
   - Ableton Live: drag into the Arrangement; each MIDI track becomes its own track.
   - FL Studio: File > Import > MIDI file (tick \"Start at bar 1\").
   - Logic Pro: File > Import > MIDI File.
   - Pro Tools: File > Import > MIDI (import tempo map from MIDI file).
4. Add instruments to the MIDI tracks and set faders using the table below.

Stems are 32-bit float WAV. Track faders and pan are NOT baked in, so you
keep full control — set them from the table below. The exception is
automation: where a track had volume, pan or mute automation, the moves are
baked into its stem (\"in stem\" below) — leave that fader at 0 dB and that
pan centred. On MIDI tracks, volume and pan automation is written into the
MIDI file as CC7 / CC10 (\"as CC\").

MIXER (from the original project)
{mixer}
",
        name = project.name,
        source = project.source,
        n = project.time_signature.0,
        d = project.time_signature.1,
        safe_name = safe(&project.name),
        mixer = mixer.join("\n"),
    );
    std::fs::write(out_dir.join("READ ME — how to open.txt"), readme).map_err(|e| e.to_string())?;

    let mut unique = Vec::new();
    for n in notes {
        if !unique.contains(&n) {
            unique.push(n);
        }
    }
    Ok(unique)
}
