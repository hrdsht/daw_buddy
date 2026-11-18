//! REAPER (.rpp) read and write — twin of `reaper.ts`. Plain text with
//! nested `<BLOCK … >` sections; positions in seconds; in-project MIDI as
//! `E <delta> <status> <d1> <d2>` hex lines.

use crate::files::{basename, strip_ext, FileFinder};
use crate::model::*;
use std::path::Path;

/// Envelope value = PAN_ENV_SIGN × model pan (-1 left … 1 right).
pub const PAN_ENV_SIGN: f64 = -1.0;
/// Envelope value that means "muted" (the other is 1 − it).
pub const MUTE_ENV_MUTED: f64 = 0.0;

const TPQ: i64 = 960;

#[derive(Debug, Default)]
pub struct Block {
    pub head: Vec<String>,
    pub lines: Vec<Vec<String>>,
    pub blocks: Vec<Block>,
}

impl Block {
    fn line(&self, key: &str) -> Option<&Vec<String>> {
        self.lines.iter().find(|l| l.first().map(|s| s == key).unwrap_or(false))
    }
    fn head0(&self) -> &str {
        self.head.first().map(|s| s.as_str()).unwrap_or("")
    }
    fn head1(&self) -> &str {
        self.head.get(1).map(|s| s.as_str()).unwrap_or("")
    }
}

fn kind_of(name: &str) -> Option<AutoKind> {
    match name {
        "VOLENV2" => Some(AutoKind::Volume),
        "PANENV2" => Some(AutoKind::Pan),
        "MUTEENV" => Some(AutoKind::Mute),
        _ => None,
    }
}

/// Split one RPP line into tokens, honouring "double", 'single' and `back` quotes.
pub fn tokenize(line: &str) -> Vec<String> {
    let chars: Vec<char> = line.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if i >= chars.len() {
            break;
        }
        let q = chars[i];
        if q == '"' || q == '\'' || q == '`' {
            let end = chars[i + 1..].iter().position(|&c| c == q).map(|p| i + 1 + p);
            let stop = end.unwrap_or(chars.len());
            out.push(chars[i + 1..stop].iter().collect());
            i = end.map(|e| e + 1).unwrap_or(chars.len());
        } else {
            let mut j = i;
            while j < chars.len() && !chars[j].is_whitespace() {
                j += 1;
            }
            out.push(chars[i..j].iter().collect());
            i = j;
        }
    }
    out
}

pub fn parse_rpp(text: &str) -> Block {
    let mut stack: Vec<Block> = vec![Block::default()];
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix('<') {
            stack.push(Block { head: tokenize(rest), ..Default::default() });
        } else if line == ">" {
            if stack.len() > 1 {
                let b = stack.pop().unwrap();
                stack.last_mut().unwrap().blocks.push(b);
            }
        } else {
            stack.last_mut().unwrap().lines.push(tokenize(line));
        }
    }
    while stack.len() > 1 {
        let b = stack.pop().unwrap();
        stack.last_mut().unwrap().blocks.push(b);
    }
    stack.pop().unwrap()
}

/// parseFloat with a default for NaN, as `n()` in the TypeScript.
fn n(v: Option<&String>, d: f64) -> f64 {
    crate::xml::num(v.map(|s| s.as_str()), d)
}

fn tok(l: Option<&Vec<String>>, i: usize) -> Option<&String> {
    l.and_then(|l| l.get(i))
}

pub fn read(file: &Path) -> Result<Project, String> {
    let text = std::fs::read_to_string(file).map_err(|e| e.to_string())?;
    let root = parse_rpp(&text);
    let rp = root
        .blocks
        .iter()
        .find(|b| b.head0() == "REAPER_PROJECT")
        .ok_or("This does not look like a REAPER project (no REAPER_PROJECT block).")?;
    let stem = file.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let mut project = Project::new(&stem, "REAPER");
    let mut finder = FileFinder::new(file.parent().unwrap_or(Path::new(".")));

    if let Some(t) = rp.line("TEMPO") {
        let bpm = n(t.get(1), 0.0);
        if bpm > 0.0 {
            project.bpm = bpm;
        }
        let num_ = n(t.get(2), 4.0);
        let den = n(t.get(3), 4.0);
        project.time_signature = (if num_ == 0.0 { 4 } else { num_ as u32 }, if den == 0.0 { 4 } else { den as u32 });
    }
    if let Some(env) = rp.blocks.iter().find(|b| b.head0() == "TEMPOENVEX") {
        if env.lines.iter().filter(|l| l[0] == "PT").count() > 1 {
            let bpm = js_number(project.bpm);
            project.warn(format!("Tempo changes found — the converted project uses a constant {bpm} BPM."));
        }
    }

    for l in &rp.lines {
        if l[0] != "MARKER" {
            continue;
        }
        let name_tok = l.get(3).filter(|s| !s.is_empty());
        let is_region_end = (n(l.get(4), 0.0) as i64) & 1 == 1 && name_tok.is_none();
        if is_region_end {
            continue;
        }
        let name = name_tok.cloned().unwrap_or_else(|| format!("Marker {}", l.get(1).map(|s| s.as_str()).unwrap_or("undefined")));
        project.markers.push(Marker { name, time: seconds_to_beats(n(l.get(2), 0.0), project.bpm) });
    }

    for tb in rp.blocks.iter().filter(|b| b.head0() == "TRACK") {
        let volpan = tb.line("VOLPAN");
        let mut track = Track {
            name: tok(tb.line("NAME"), 1).filter(|s| !s.is_empty()).cloned().unwrap_or_else(|| "Track".into()),
            kind: TrackKind::Audio,
            volume: clamp(n(tok(volpan, 1), 1.0), 0.0, 4.0),
            pan: clamp(n(tok(volpan, 2), 0.0), -1.0, 1.0),
            mute: n(tok(tb.line("MUTESOLO"), 1), 0.0) == 1.0,
            color: reaper_color(n(tok(tb.line("PEAKCOL"), 1), 0.0) as i64),
            clips: Vec::new(),
            automation: Automation::default(),
        };
        let is_folder = n(tok(tb.line("ISBUS"), 1), 0.0) == 1.0;
        if is_folder {
            project.warn(format!("Folder \"{}\" was flattened — its tracks are converted individually.", track.name));
        }
        if tb.blocks.iter().any(|b| b.head0() == "FXCHAIN" && !b.blocks.is_empty()) {
            project.warn("Instruments and effects are not converted — re-insert them in the new DAW.");
        }
        read_envelopes(tb, &mut track, &mut project);

        let (mut midi, mut audio) = (0, 0);
        for ib in tb.blocks.iter().filter(|b| b.head0() == "ITEM") {
            let Some(clip) = item_to_clip(ib, &mut project, &mut finder, &track.name) else { continue };
            match clip {
                Clip::Midi(_) => midi += 1,
                Clip::Audio(_) => audio += 1,
            }
            track.clips.push(clip);
        }
        if midi > 0 && audio > 0 {
            project.warn(format!("\"{}\" mixes audio and MIDI items — it is converted as a MIDI track; the audio stays on it.", track.name));
        }
        track.kind = if midi > audio { TrackKind::Midi } else { TrackKind::Audio };
        if is_folder && track.clips.is_empty() {
            continue;
        }
        project.tracks.push(track);
    }
    Ok(project)
}

fn reaper_color(value: i64) -> Option<String> {
    if value & 0x100_0000 == 0 {
        return None;
    }
    let r = value & 0xff;
    let g = (value >> 8) & 0xff;
    let b = (value >> 16) & 0xff;
    Some(format!("#{r:02x}{g:02x}{b:02x}"))
}

fn item_to_clip(ib: &Block, project: &mut Project, finder: &mut FileFinder, track_name: &str) -> Option<Clip> {
    let pos_sec = n(tok(ib.line("POSITION"), 1), 0.0);
    let len_sec = n(tok(ib.line("LENGTH"), 1), 0.0);
    let soffs = n(tok(ib.line("SOFFS"), 1), 0.0);
    let rate = n(tok(ib.line("PLAYRATE"), 1), 1.0);
    let mute = n(tok(ib.line("MUTE"), 1), 0.0) == 1.0;
    let name = tok(ib.line("NAME"), 1).cloned().unwrap_or_default();
    if len_sec <= 0.0 {
        return None;
    }
    let label = if name.is_empty() { "item".to_string() } else { name.clone() };
    if mute {
        project.warn(format!("Muted item \"{label}\" on \"{track_name}\" was converted unmuted."));
    }
    if (rate - 1.0).abs() > 1e-4 {
        project.warn(format!("\"{label}\" on \"{track_name}\" has a play rate of {} — it is converted at normal speed.", js_number(rate)));
    }

    let mut source = ib.blocks.iter().find(|b| b.head0() == "SOURCE");
    let mut section_offset = 0.0;
    while let Some(s) = source.filter(|s| s.head1() == "SECTION") {
        section_offset += n(tok(s.line("STARTPOS"), 1), 0.0);
        source = s.blocks.iter().find(|b| b.head0() == "SOURCE");
    }
    let source = source?;
    let start = seconds_to_beats(pos_sec, project.bpm);
    let length = seconds_to_beats(len_sec, project.bpm);

    if source.head1() == "MIDI" {
        let Some(has_data) = source.line("HASDATA") else {
            project.warn(format!("MIDI item \"{label}\" uses an external MIDI file and was skipped."));
            return None;
        };
        let tpq = match n(has_data.get(2), 960.0) {
            0.0 => 960.0,
            v => v,
        };
        let offset_beats = seconds_to_beats(soffs + section_offset, project.bpm);
        let mut notes = Vec::new();
        let mut open: std::collections::HashMap<i64, (f64, i64)> = std::collections::HashMap::new();
        let mut tick = 0.0;
        for l in &source.lines {
            if l[0] != "E" && l[0] != "e" {
                continue;
            }
            tick += n(l.get(1), 0.0);
            let hex = |i: usize| l.get(i).and_then(|s| i64::from_str_radix(s, 16).ok());
            let (Some(status), Some(d1)) = (hex(2), hex(3)) else { continue };
            let d2 = hex(4).unwrap_or(0);
            let kind = status & 0xf0;
            let key = ((status & 0x0f) << 8) | d1;
            if kind == 0x90 && d2 > 0 {
                open.insert(key, (tick, d2));
            } else if kind == 0x80 || (kind == 0x90 && d2 == 0) {
                let Some((on_tick, vel)) = open.remove(&key) else { continue };
                let s = on_tick / tpq - offset_beats;
                let e = (tick / tpq - offset_beats).min(length);
                if s < -1e-9 || s >= length || e <= s {
                    continue;
                }
                notes.push(Note { start: s, length: e - s, pitch: d1.clamp(0, 127) as u8, velocity: vel.clamp(1, 127) as u8 });
            }
        }
        notes.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap().then(a.pitch.cmp(&b.pitch)));
        return Some(Clip::Midi(MidiClip { name, start, length, notes }));
    }

    let stored = tok(source.line("FILE"), 1).cloned().unwrap_or_default();
    let file_name = basename(&stored);
    let file = finder.resolve(std::slice::from_ref(&stored), &file_name);
    if file.is_none() {
        let shown = if file_name.is_empty() { "(unnamed)" } else { &file_name };
        project.warn(format!("Audio file not found: {shown} on \"{track_name}\"."));
    }
    Some(Clip::Audio(AudioClip {
        name: if name.is_empty() { strip_ext(&file_name) } else { name },
        start,
        length,
        file,
        file_name,
        offset: (soffs + section_offset).max(0.0),
        gain: clamp(n(tok(ib.line("VOLPAN"), 1), 1.0), 0.0, 8.0),
    }))
}

fn read_envelopes(tb: &Block, track: &mut Track, project: &mut Project) {
    let mut curved = false;
    for env in &tb.blocks {
        let Some(kind) = kind_of(env.head0()) else { continue };
        if n(tok(env.line("ACT"), 1), 1.0) == 0.0 {
            continue;
        }
        if kind == AutoKind::Volume && n(tok(env.line("VOLTYPE"), 1), 0.0) == 1.0 {
            project.warn(format!("Volume automation on \"{}\" uses fader scaling and was not converted.", track.name));
            continue;
        }
        let pts: Vec<&Vec<String>> = env.lines.iter().filter(|l| l[0] == "PT").collect();
        let mut points = Vec::new();
        for (i, l) in pts.iter().enumerate() {
            let time = seconds_to_beats(n(l.get(1), 0.0), project.bpm);
            let raw = n(l.get(2), 0.0);
            let shape = n(l.get(3), 0.0);
            let value = match kind {
                AutoKind::Volume => clamp(raw, 0.0, 4.0),
                AutoKind::Pan => clamp(raw * PAN_ENV_SIGN, -1.0, 1.0),
                AutoKind::Mute => {
                    if (raw - MUTE_ENV_MUTED).abs() < 0.5 { 1.0 } else { 0.0 }
                }
            };
            points.push(AutoPoint { time, value });
            if let Some(next) = pts.get(i + 1) {
                if shape == 1.0 && kind != AutoKind::Mute {
                    points.push(AutoPoint { time: seconds_to_beats(n(next.get(1), 0.0), project.bpm), value });
                }
            }
            if shape != 0.0 && shape != 1.0 {
                curved = true;
            }
        }
        set_lane(track, kind, &points);
    }
    fn count_other(b: &Block, other: &mut usize) {
        for c in &b.blocks {
            let name = c.head0();
            if kind_of(name).is_none() && name.contains("ENV") && c.lines.iter().any(|l| l[0] == "PT") {
                *other += 1;
            }
            count_other(c, other);
        }
    }
    let mut other = 0;
    count_other(tb, &mut other);
    if curved {
        project.warn(format!("Curved automation on \"{}\" was converted as straight ramps.", track.name));
    }
    if other > 0 {
        project.warn(format!(
            "{other} automation lane(s) on \"{}\" (plug-ins, sends, width, pre-FX or take envelopes) were not converted — only volume, pan and mute automation is.",
            track.name
        ));
    }
}

/* ================================================================== */
/* write                                                              */
/* ================================================================== */

fn q(v: &str) -> String {
    if !v.contains('"') {
        format!("\"{v}\"")
    } else if !v.contains('\'') {
        format!("'{v}'")
    } else {
        format!("`{}`", v.replace('`', "'"))
    }
}

fn f(x: f64) -> String {
    fmt_round(x, 10)
}

fn source_type(file_name: &str) -> &'static str {
    let ext = file_name.rfind('.').map(|i| file_name[i..].to_lowercase()).unwrap_or_default();
    match ext.as_str() {
        ".wav" | ".wave" | ".aif" | ".aiff" => "WAVE",
        ".mp3" => "MP3",
        ".flac" => "FLAC",
        ".ogg" => "VORBIS",
        ".opus" => "OPUS",
        _ => "WAVE",
    }
}

pub fn write_text(project: &Project) -> String {
    let mut out: Vec<String> = Vec::new();
    out.push("<REAPER_PROJECT 0.1 \"7.0/daw-buddy\" 0".into());
    out.push(format!("  TEMPO {} {} {}", f(project.bpm), project.time_signature.0, project.time_signature.1));
    for (i, m) in project.markers.iter().enumerate() {
        out.push(format!("  MARKER {} {} {} 0 0 1", i + 1, f(beats_to_seconds(m.time, project.bpm)), q(&m.name)));
    }
    for track in &project.tracks {
        out.push("  <TRACK".into());
        out.push(format!("    NAME {}", q(&track.name)));
        if let Some(c) = &track.color {
            if let Ok(hex) = i64::from_str_radix(&c[1..], 16) {
                let (r, g, b) = ((hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff);
                out.push(format!("    PEAKCOL {}", 0x100_0000 | (b << 16) | (g << 8) | r));
            }
        }
        out.push(format!("    VOLPAN {} {} -1 -1 1", f(track.volume), f(track.pan)));
        out.push(format!("    MUTESOLO {} 0 0", if track.mute { 1 } else { 0 }));
        for (block, kind) in [("VOLENV2", AutoKind::Volume), ("PANENV2", AutoKind::Pan), ("MUTEENV", AutoKind::Mute)] {
            let Some(lane) = track.automation.get(kind) else { continue };
            let hold = kind == AutoKind::Mute;
            let shape = if hold { 1 } else { 0 };
            out.push(format!("    <{block}"));
            out.push("      ACT 1 -1".into());
            out.push("      VIS 1 1 1".into());
            out.push("      LANEHEIGHT 0 0".into());
            out.push("      ARM 0".into());
            out.push(format!("      DEFSHAPE {shape} -1 -1"));
            for p in lane {
                let v = match kind {
                    AutoKind::Volume => p.value,
                    AutoKind::Pan => p.value * PAN_ENV_SIGN,
                    AutoKind::Mute => {
                        if p.value >= 0.5 { MUTE_ENV_MUTED } else { 1.0 - MUTE_ENV_MUTED }
                    }
                };
                out.push(format!("      PT {} {} {shape}", f(beats_to_seconds(p.time, project.bpm)), f(v)));
            }
            out.push("    >".into());
        }
        for clip in &track.clips {
            out.push("    <ITEM".into());
            out.push(format!("      POSITION {}", f(beats_to_seconds(clip.start(), project.bpm))));
            out.push(format!("      LENGTH {}", f(beats_to_seconds(clip.length(), project.bpm))));
            match clip {
                Clip::Audio(c) => {
                    let label = if c.name.is_empty() { c.file_name.clone() } else { c.name.clone() };
                    out.push(format!("      NAME {}", q(&label)));
                    out.push(format!("      SOFFS {}", f(c.offset)));
                    out.push(format!("      VOLPAN {} 0 1 -1", f(c.gain)));
                    out.push(format!("      <SOURCE {}", source_type(&c.file_name)));
                    let path = c.file.as_ref().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| c.file_name.clone());
                    out.push(format!("        FILE {}", q(&path)));
                    out.push("      >".into());
                }
                Clip::Midi(c) => {
                    let label = if c.name.is_empty() { "MIDI".to_string() } else { c.name.clone() };
                    out.push(format!("      NAME {}", q(&label)));
                    out.push("      <SOURCE MIDI".into());
                    out.push(format!("        HASDATA 1 {TPQ} QN"));
                    let mut events: Vec<(i64, [u8; 3], u8)> = Vec::new();
                    for note in &c.notes {
                        let on = js_round(note.start * TPQ as f64) as i64;
                        let off = (on + 1).max(js_round((note.start + note.length) * TPQ as f64) as i64);
                        events.push((on, [0x90, note.pitch, note.velocity], 1));
                        events.push((off, [0x80, note.pitch, 0], 0));
                    }
                    events.sort_by(|a, b| a.0.cmp(&b.0).then(a.2.cmp(&b.2)));
                    let mut last = 0i64;
                    for (tick, bytes, _) in &events {
                        out.push(format!("        E {} {:02x} {:02x} {:02x}", tick - last, bytes[0], bytes[1], bytes[2]));
                        last = *tick;
                    }
                    let end = last.max(js_round(c.length * TPQ as f64) as i64);
                    out.push(format!("        E {} b0 7b 00", end - last));
                    out.push("      >".into());
                }
            }
            out.push("    >".into());
        }
        out.push("  >".into());
    }
    out.push(">".into());
    out.join("\n") + "\n"
}

pub fn write(project: &Project, out_file: &Path) -> Result<Vec<String>, String> {
    std::fs::write(out_file, write_text(project)).map_err(|e| e.to_string())?;
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tokenizer_quotes() {
        assert_eq!(tokenize("NAME \"My 'quoted' track\""), vec!["NAME", "My 'quoted' track"]);
        assert_eq!(tokenize("FILE `a \"b\" c` 1"), vec!["FILE", "a \"b\" c", "1"]);
    }
}
