//! DAW project converter — the Rust port of `src/main/lib/projectconvert`.
//!
//! read (format-specific) → neutral [`model::Project`] → write (format-specific)
//!
//! Readers: Ableton Live (.als), DAWproject (.dawproject), REAPER (.rpp).
//! Writers: DAWproject (Bitwig, Studio One, Cubase, Nuendo), REAPER, and a
//! MIDI + stems pack for Ableton, FL Studio, Logic, Pro Tools and any DAW.
//! Every conversion writes a log naming what could not be carried.

pub mod ableton;
pub mod audio;
pub mod dawproject;
pub mod files;
pub mod model;
pub mod reaper;
pub mod universal;
pub mod xml;
pub mod zip;

use model::{dedupe_warnings, summarise, Project, Summary};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct Target {
    pub key: &'static str,
    pub name: &'static str,
    pub ext: &'static str,
    pub daws: &'static str,
    pub detail: &'static str,
}

pub const TARGETS: [Target; 3] = [
    Target {
        key: "dawproject",
        name: "DAWproject",
        ext: ".dawproject",
        daws: "Bitwig Studio · Studio One · Cubase · Nuendo",
        detail: "One self-contained file with tracks, clips, MIDI, mixer, markers and the audio itself.",
    },
    Target {
        key: "reaper",
        name: "REAPER project",
        ext: ".rpp",
        daws: "REAPER",
        detail: "A native .rpp with tracks, items, MIDI, faders, pan, colours and markers. Audio stays where it is.",
    },
    Target {
        key: "universal",
        name: "MIDI + stems",
        ext: "folder",
        daws: "Ableton Live · FL Studio · Logic Pro · Pro Tools · any DAW",
        detail: "A multitrack MIDI file (tempo, markers, every MIDI part) and one WAV stem per audio track, all starting at bar 1.",
    },
];

fn ext_of(p: &Path) -> String {
    p.extension().map(|e| format!(".{}", e.to_string_lossy().to_lowercase())).unwrap_or_default()
}

type ReadFn = fn(&Path) -> Result<Project, String>;

fn reader_for(ext: &str) -> Option<(&'static str, ReadFn)> {
    match ext {
        ".als" => Some(("Ableton Live", ableton::read)),
        ".dawproject" => Some(("DAWproject", dawproject::read)),
        ".rpp" => Some(("REAPER", reaper::read)),
        _ => None,
    }
}

fn closed_reason(ext: &str) -> Option<&'static str> {
    Some(match ext {
        ".flp" => "FL Studio projects are a closed binary format. In FL Studio use File > Export > All stems (and MIDI), or open the tracks here after exporting.",
        ".logicx" | ".logic" => "Logic projects are a closed format. In Logic use File > Export > All Tracks as Audio Files, plus File > Export > Selection as MIDI File.",
        ".ptx" => "Pro Tools sessions are a closed format. In Pro Tools use File > Export > Selected Tracks as AAF, or bounce tracks and export MIDI.",
        ".cpr" => "Cubase 14+ can save this directly: File > Export > DAWproject. Convert that file here.",
        ".song" => "Studio One 6.5+ can save this directly: File > Export > DAWproject. Convert that file here.",
        ".bwproject" => "Bitwig can save this directly: File > Export > DAWproject. Convert that file here.",
        _ => return None,
    })
}

const UNSUPPORTED: &str = "This file type cannot be converted yet. Supported: Ableton .als, DAWproject, REAPER .rpp.";

#[derive(Debug, Clone, Serialize)]
pub struct Support {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

pub fn supports(file: &Path) -> Support {
    let ext = ext_of(file);
    if let Some((name, _)) = reader_for(&ext) {
        return Support { ok: true, format: Some(name.into()), reason: None };
    }
    Support { ok: false, format: None, reason: Some(closed_reason(&ext).unwrap_or(UNSUPPORTED).into()) }
}

pub fn read(file: &Path) -> Result<Project, String> {
    let ext = ext_of(file);
    let (_, read) = reader_for(&ext).ok_or_else(|| supports(file).reason.unwrap_or_default())?;
    read(file)
}

pub fn inspect(file: &Path) -> Result<Summary, String> {
    Ok(summarise(&read(file)?))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertResult {
    pub output_path: PathBuf,
    pub log_path: PathBuf,
    pub summary: Summary,
    pub warnings: Vec<String>,
}

pub fn convert(file: &Path, target: &str, output_root: &Path, progress: &mut dyn FnMut(&str)) -> Result<ConvertResult, String> {
    let ext = ext_of(file);
    let (reader_name, read) = reader_for(&ext).ok_or_else(|| supports(file).reason.unwrap_or_default())?;
    let spec = TARGETS.iter().find(|t| t.key == target).ok_or_else(|| format!("Unknown target: {target}"))?;

    progress(&format!("Reading {reader_name} project…"));
    let project = read(file)?;
    let folder = unique_dir(&output_root.join(format!("{} ({})", universal::safe(&project.name), spec.name)));
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;

    progress(&format!("Writing {}…", spec.name));
    let (output_path, writer_notes) = match target {
        "dawproject" => {
            let out = folder.join(format!("{}.dawproject", universal::safe(&project.name)));
            let notes = dawproject::write(&project, &out, true)?;
            (out, notes)
        }
        "reaper" => {
            let out = folder.join(format!("{}.rpp", universal::safe(&project.name)));
            let notes = reaper::write(&project, &out)?;
            (out, notes)
        }
        _ => {
            let notes = universal::write(&project, &folder, progress)?;
            (folder.clone(), notes)
        }
    };

    let mut all = project.warnings.clone();
    all.extend(writer_notes);
    let warnings = dedupe_warnings(&all);
    let summary = summarise(&project);
    let log_path = folder.join("Conversion log.txt");
    std::fs::write(&log_path, log_text(file, spec.name, &summary, &warnings)).map_err(|e| e.to_string())?;
    progress("Done");
    Ok(ConvertResult { output_path, log_path, summary, warnings })
}

fn log_text(source: &Path, target: &str, s: &Summary, warnings: &[String]) -> String {
    let mut lines = vec![
        "DAW Buddy — project conversion".to_string(),
        format!("Source: {} ({})", source.display(), s.source),
        format!("Target: {target}"),
        format!("Date:   {}", iso_now()),
        String::new(),
        format!("Tempo {} BPM · {}", model::js_number(s.bpm), s.time_signature),
        format!("{} tracks ({} audio, {} MIDI)", s.tracks, s.audio_tracks, s.midi_tracks),
        format!(
            "{} audio clips · {} MIDI clips · {} notes · {} markers · {} automation lanes",
            s.audio_clips, s.midi_clips, s.notes, s.markers, s.automation_lanes
        ),
        String::new(),
        if warnings.is_empty() { "Everything in the arrangement was carried.".into() } else { "NOT CARRIED / CHECK THESE".into() },
    ];
    lines.extend(warnings.iter().map(|w| format!("  - {w}")));
    lines.extend(
        [
            "",
            "Always carried when present: tempo, time signature, markers, track names,",
            "fader, pan, mute, colours (where the source has them), track volume / pan /",
            "mute automation, audio clip positions and trims, MIDI notes and velocities.",
            "Never carried by this converter: plug-ins and their settings or automation,",
            "sends/buses, warping/time-stretch, tempo changes.",
            "",
        ]
        .iter()
        .map(|s| s.to_string()),
    );
    lines.join("\n")
}

/// UTC ISO-8601 with milliseconds, like Date.prototype.toISOString.
fn iso_now() -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    let ms = now.as_millis() as i64;
    let (days, rem) = (ms.div_euclid(86_400_000), ms.rem_euclid(86_400_000));
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3_600_000,
        (rem / 60_000) % 60,
        (rem / 1000) % 60,
        rem % 1000
    )
}

fn unique_dir(base: &Path) -> PathBuf {
    let mut candidate = base.to_path_buf();
    let mut n = 2;
    while candidate.exists() {
        candidate = PathBuf::from(format!("{} ({n})", base.display()));
        n += 1;
    }
    candidate
}
