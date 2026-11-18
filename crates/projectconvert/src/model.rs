//! The neutral project every reader produces and every writer consumes —
//! the Rust twin of `model.ts`. Time is in beats (quarter notes) at the
//! project tempo; audio offsets into a file are in seconds.

use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq)]
pub struct Note {
    pub start: f64,
    pub length: f64,
    pub pitch: u8,
    pub velocity: u8,
}

#[derive(Debug, Clone)]
pub struct AudioClip {
    pub name: String,
    pub start: f64,
    pub length: f64,
    pub file: Option<PathBuf>,
    pub file_name: String,
    pub offset: f64,
    pub gain: f64,
}

#[derive(Debug, Clone)]
pub struct MidiClip {
    pub name: String,
    pub start: f64,
    pub length: f64,
    pub notes: Vec<Note>,
}

#[derive(Debug, Clone)]
pub enum Clip {
    Audio(AudioClip),
    Midi(MidiClip),
}

impl Clip {
    pub fn start(&self) -> f64 {
        match self {
            Clip::Audio(c) => c.start,
            Clip::Midi(c) => c.start,
        }
    }
    pub fn length(&self) -> f64 {
        match self {
            Clip::Audio(c) => c.length,
            Clip::Midi(c) => c.length,
        }
    }
}

/// `value` uses the matching Track unit: volume = linear gain, pan = -1..1,
/// mute = 1 (muted) or 0.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AutoPoint {
    pub time: f64,
    pub value: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoKind {
    Volume,
    Pan,
    Mute,
}

#[derive(Debug, Clone, Default)]
pub struct Automation {
    pub volume: Option<Vec<AutoPoint>>,
    pub pan: Option<Vec<AutoPoint>>,
    pub mute: Option<Vec<AutoPoint>>,
}

impl Automation {
    pub fn get(&self, kind: AutoKind) -> Option<&Vec<AutoPoint>> {
        match kind {
            AutoKind::Volume => self.volume.as_ref(),
            AutoKind::Pan => self.pan.as_ref(),
            AutoKind::Mute => self.mute.as_ref(),
        }
        .filter(|l| !l.is_empty())
    }
    fn slot(&mut self, kind: AutoKind) -> &mut Option<Vec<AutoPoint>> {
        match kind {
            AutoKind::Volume => &mut self.volume,
            AutoKind::Pan => &mut self.pan,
            AutoKind::Mute => &mut self.mute,
        }
    }
    pub fn lanes(&self) -> usize {
        [AutoKind::Volume, AutoKind::Pan, AutoKind::Mute].iter().filter(|k| self.get(**k).is_some()).count()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrackKind {
    Audio,
    Midi,
}

#[derive(Debug, Clone)]
pub struct Track {
    pub name: String,
    pub kind: TrackKind,
    pub volume: f64,
    pub pan: f64,
    pub mute: bool,
    pub color: Option<String>,
    pub clips: Vec<Clip>,
    pub automation: Automation,
}

#[derive(Debug, Clone)]
pub struct Marker {
    pub name: String,
    pub time: f64,
}

#[derive(Debug, Clone)]
pub struct Project {
    pub name: String,
    pub source: String,
    pub bpm: f64,
    pub time_signature: (u32, u32),
    pub markers: Vec<Marker>,
    pub tracks: Vec<Track>,
    pub warnings: Vec<String>,
}

impl Project {
    pub fn new(name: &str, source: &str) -> Self {
        Project {
            name: name.to_string(),
            source: source.to_string(),
            bpm: 120.0,
            time_signature: (4, 4),
            markers: Vec::new(),
            tracks: Vec::new(),
            warnings: Vec::new(),
        }
    }

    pub fn warn(&mut self, w: impl Into<String>) {
        self.warnings.push(w.into());
    }

    /// Where the last clip ends, in beats.
    pub fn length(&self) -> f64 {
        self.tracks
            .iter()
            .flat_map(|t| t.clips.iter())
            .map(|c| c.start() + c.length())
            .fold(0.0, f64::max)
    }
}

pub fn beats_to_seconds(beats: f64, bpm: f64) -> f64 {
    beats * 60.0 / bpm
}

pub fn seconds_to_beats(seconds: f64, bpm: f64) -> f64 {
    seconds * bpm / 60.0
}

pub fn clamp(v: f64, min: f64, max: f64) -> f64 {
    v.max(min).min(max)
}

/// Sort and clamp to the start of the song, keeping only the last of several
/// points that land on time 0 (Ableton's "before the song" default).
pub fn clean_lane(points: &[AutoPoint]) -> Option<Vec<AutoPoint>> {
    let mut sorted: Vec<(usize, AutoPoint)> = points
        .iter()
        .filter(|p| p.time.is_finite() && p.value.is_finite())
        .map(|p| AutoPoint { time: p.time.max(0.0), value: p.value })
        .enumerate()
        .collect();
    sorted.sort_by(|a, b| a.1.time.partial_cmp(&b.1.time).unwrap().then(a.0.cmp(&b.0)));
    let sorted: Vec<AutoPoint> = sorted.into_iter().map(|(_, p)| p).collect();
    let mut first = 0;
    while first + 1 < sorted.len() && sorted[first + 1].time == 0.0 {
        first += 1;
    }
    let lane: Vec<AutoPoint> = sorted[first.min(sorted.len())..].to_vec();
    if lane.is_empty() {
        None
    } else {
        Some(lane)
    }
}

/// Attach a lane; a lane that never moves becomes the track's static value.
pub fn set_lane(track: &mut Track, kind: AutoKind, points: &[AutoPoint]) {
    let Some(lane) = clean_lane(points) else { return };
    let flat = lane.iter().all(|p| (p.value - lane[0].value).abs() < 1e-9);
    if flat {
        match kind {
            AutoKind::Volume => track.volume = lane[0].value,
            AutoKind::Pan => track.pan = lane[0].value,
            AutoKind::Mute => track.mute = lane[0].value >= 0.5,
        }
        return;
    }
    *track.automation.slot(kind) = Some(lane);
}

/// Reads a lane at steadily increasing times without rescanning it.
pub struct LaneCursor<'a> {
    points: &'a [AutoPoint],
    hold: bool,
    i: usize,
}

impl<'a> LaneCursor<'a> {
    pub fn new(points: &'a [AutoPoint], hold: bool) -> Self {
        LaneCursor { points, hold, i: 0 }
    }
    pub fn at(&mut self, time: f64) -> f64 {
        let p = self.points;
        while self.i < p.len() && p[self.i].time <= time {
            self.i += 1;
        }
        if self.i == 0 {
            return p[0].value;
        }
        if self.i >= p.len() {
            return p[p.len() - 1].value;
        }
        let a = p[self.i - 1];
        let b = p[self.i];
        if self.hold || b.time - a.time < 1e-12 {
            return a.value;
        }
        a.value + (time - a.time) * (b.value - a.value) / (b.time - a.time)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub name: String,
    pub source: String,
    pub bpm: f64,
    pub time_signature: String,
    pub tracks: usize,
    pub audio_tracks: usize,
    pub midi_tracks: usize,
    pub audio_clips: usize,
    pub midi_clips: usize,
    pub notes: usize,
    pub markers: usize,
    pub automation_lanes: usize,
    pub missing_files: usize,
    pub length_beats: f64,
    pub warnings: Vec<String>,
}

pub fn summarise(project: &Project) -> Summary {
    let (mut audio_clips, mut midi_clips, mut notes, mut missing, mut lanes) = (0, 0, 0, 0, 0);
    for t in &project.tracks {
        lanes += t.automation.lanes();
        for c in &t.clips {
            match c {
                Clip::Audio(a) => {
                    audio_clips += 1;
                    if a.file.is_none() {
                        missing += 1;
                    }
                }
                Clip::Midi(m) => {
                    midi_clips += 1;
                    notes += m.notes.len();
                }
            }
        }
    }
    Summary {
        name: project.name.clone(),
        source: project.source.clone(),
        bpm: project.bpm,
        time_signature: format!("{}/{}", project.time_signature.0, project.time_signature.1),
        tracks: project.tracks.len(),
        audio_tracks: project.tracks.iter().filter(|t| t.kind == TrackKind::Audio).count(),
        midi_tracks: project.tracks.iter().filter(|t| t.kind == TrackKind::Midi).count(),
        audio_clips,
        midi_clips,
        notes,
        markers: project.markers.len(),
        automation_lanes: lanes,
        missing_files: missing,
        length_beats: project.length(),
        warnings: dedupe_warnings(&project.warnings),
    }
}

/// Collapse repeats into "… (×12)", keeping first-seen order.
pub fn dedupe_warnings(warnings: &[String]) -> Vec<String> {
    let mut order: Vec<(String, usize)> = Vec::new();
    for w in warnings {
        if let Some(e) = order.iter_mut().find(|(k, _)| k == w) {
            e.1 += 1;
        } else {
            order.push((w.clone(), 1));
        }
    }
    order.into_iter().map(|(w, n)| if n > 1 { format!("{w} (×{n})") } else { w }).collect()
}

/// JS-style number text: `String(Math.round(n * 10^d) / 10^d)`.
pub fn fmt_round(n: f64, decimals: i32) -> String {
    let scale = 10f64.powi(decimals);
    let v = js_round(n * scale) / scale;
    js_number(v)
}

/// Math.round: halves go up (toward +∞), unlike f64::round.
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

/// Format like JavaScript's String(number) for ordinary magnitudes.
pub fn js_number(v: f64) -> String {
    if v == 0.0 {
        return "0".into();
    }
    // Rust's Display gives the shortest round-trip form, as JS does.
    format!("{v}")
}
