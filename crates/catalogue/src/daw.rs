//! One place that knows about DAW file formats — the Rust twin of
//! `src/main/lib/daw.ts`. The scanner asks this module rather than checking
//! extensions itself.
//!
//! Each format knows its display name, whether the "file" is really a folder
//! (Logic), how to read tempo and time signature, which sibling files are its
//! own backups, and how many backups a project has.

use flate2::read::GzDecoder;
use projectconvert::zip;
use regex::bytes::Regex as BRegex;
use regex::Regex;
use std::io::Read;
use std::path::Path;
use std::sync::OnceLock;

#[derive(Debug, Clone, Default)]
pub struct Tempo {
    /// May be NaN when a tag held something like "." — serialises as null,
    /// exactly as the TypeScript scanner's NaN does.
    pub bpm: Option<f64>,
    pub time_signature: Option<String>,
    pub error: Option<String>,
}

fn err(message: impl Into<String>) -> Tempo {
    Tempo { bpm: None, time_signature: None, error: Some(message.into()) }
}

/// Math.round(n * 100) / 100 — halves round up, like JavaScript.
pub fn round2(n: f64) -> f64 {
    ((n * 100.0) + 0.5).floor() / 100.0
}

/// parseFloat semantics: leading number or NaN.
fn parse_float(s: &str) -> f64 {
    projectconvert::xml::num(Some(s), f64::NAN)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Ableton,
    Fl,
    Reaper,
    Bitwig,
    ProTools,
    StudioOne,
    Cubase,
    Logic,
}

#[derive(Debug, Clone, Copy)]
pub struct Format {
    pub ext: &'static str,
    pub name: &'static str,
    pub is_package: bool,
    pub kind: Kind,
}

pub const FORMATS: [Format; 9] = [
    Format { ext: ".als", name: "Ableton", is_package: false, kind: Kind::Ableton },
    Format { ext: ".flp", name: "FL Studio", is_package: false, kind: Kind::Fl },
    Format { ext: ".rpp", name: "REAPER", is_package: false, kind: Kind::Reaper },
    Format { ext: ".bwproject", name: "Bitwig Studio", is_package: false, kind: Kind::Bitwig },
    Format { ext: ".ptx", name: "Pro Tools", is_package: false, kind: Kind::ProTools },
    Format { ext: ".song", name: "Fender Studio Pro", is_package: false, kind: Kind::StudioOne },
    Format { ext: ".cpr", name: "Cubase", is_package: false, kind: Kind::Cubase },
    Format { ext: ".logicx", name: "Logic Pro", is_package: true, kind: Kind::Logic },
    Format { ext: ".logic", name: "Logic Pro", is_package: true, kind: Kind::Logic },
];

const AUDIO_MEDIA_EXTS: [&str; 9] = [".wav", ".mp3", ".aiff", ".aif", ".flac", ".ogg", ".m4a", ".aac", ".wma"];

/// Node's path.extname: the last ".xxx" of the base name, "" for none or a
/// leading-dot-only name like ".bashrc".
pub fn extname(name: &str) -> &str {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    match base.rfind('.') {
        Some(0) | None => "",
        Some(i) => &base[i..],
    }
}

pub fn format_for(name: &str) -> Option<&'static Format> {
    let ext = extname(name).to_lowercase();
    FORMATS.iter().find(|f| f.ext == ext)
}

pub fn is_session_file(name: &str) -> bool {
    let ext = extname(name);
    if format_for(name).is_none() {
        return false;
    }
    // "Bass.wav.rpp" is an exported stem proxy or take subproject.
    let base = &name[..name.len() - ext.len()];
    let second = extname(base).to_lowercase();
    !(!second.is_empty() && AUDIO_MEDIA_EXTS.contains(&second.as_str()))
}

/// True for a folder that is really a project — Logic's .logicx.
pub fn is_session_package(name: &str) -> bool {
    format_for(name).map(|f| f.is_package).unwrap_or(false)
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("valid regex"))
}

fn bre(cell: &'static OnceLock<BRegex>, pattern: &str) -> &'static BRegex {
    cell.get_or_init(|| BRegex::new(pattern).expect("valid regex"))
}

/// FL backups: "Name (autosaved on 06-08-2026 at 17h06).flp".
pub fn is_fl_backup(filename: &str) -> bool {
    static R: OnceLock<Regex> = OnceLock::new();
    let stem = match filename.rfind('.') {
        Some(i) if i + 1 < filename.len() => &filename[..i],
        _ => filename,
    };
    re(&R, r"(?i)\((?:autosaved|overwritten)(?-u:\b)[^)]*\)\s*$").is_match(stem)
}

/// True when this file is a DAW's own backup rather than a session.
pub fn is_backup_file(name: &str) -> bool {
    let Some(f) = format_for(name) else { return false };
    match f.kind {
        Kind::Fl => is_fl_backup(name),
        Kind::Reaper => {
            static A: OnceLock<Regex> = OnceLock::new();
            static B: OnceLock<Regex> = OnceLock::new();
            let lower = name.to_lowercase();
            lower.ends_with(".rpp-bak")
                || lower.ends_with(".rpp-undo")
                || re(&A, r"(?i)\.(wav|mp3|aiff?|flac|ogg|m4a|aac)\.rpp$").is_match(&lower)
                || re(&B, r"(?i)\((?:autosaved|overwritten|backup)(?-u:\b)[^)]*\)\.rpp$").is_match(&lower)
        }
        Kind::Cubase => name.to_lowercase().ends_with(".bak"),
        _ => false,
    }
}

/* ------------------------------ counting ---------------------------- */

/// Regular, non-hidden files directly inside `dir`.
fn count_files_in(dir: &Path) -> usize {
    let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
    rd.flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false) && !e.file_name().to_string_lossy().starts_with('.'))
        .count()
}

fn files_matching(dir: &Path, pred: impl Fn(&str) -> bool) -> usize {
    let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
    rd.flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false) && pred(&e.file_name().to_string_lossy()))
        .count()
}

/// Backups for a project. `project` is the folder (or the package itself for
/// Logic); `session` is the session file, used where the count is per file.
pub fn count_backups(format: &Format, project: &Path, session: &Path) -> usize {
    match format.kind {
        Kind::Ableton => count_files_in(&project.join("Backup")),
        Kind::Fl => {
            let in_folder = count_files_in(&project.join("Backup"));
            let siblings = files_matching(project, |n| extname(n).eq_ignore_ascii_case(".flp") && is_fl_backup(n));
            in_folder + siblings
        }
        Kind::Reaper => {
            let file = session.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            // path.basename(sessionPath, '.rpp') strips only an exact ".rpp".
            let stem = file.strip_suffix(".rpp").unwrap_or(&file).to_lowercase();
            files_matching(project, |n| {
                let lower = n.to_lowercase();
                lower.ends_with(".rpp-bak") && lower.starts_with(&stem)
            })
        }
        Kind::Bitwig => {
            let root = project.join("auto-backup");
            [root.clone(), root.join("versions")]
                .iter()
                .map(|d| files_matching(d, |n| extname(n).eq_ignore_ascii_case(".bwproject")))
                .sum()
        }
        Kind::ProTools => files_matching(&project.join("Session File Backups"), |n| extname(n).eq_ignore_ascii_case(".ptx")),
        Kind::StudioOne => count_files_in(&project.join("History")),
        Kind::Cubase => files_matching(project, |n| n.to_lowercase().ends_with(".bak")),
        Kind::Logic => {
            let direct = count_files_in(&project.join("Project File Backups"));
            if direct > 0 {
                return direct;
            }
            let Ok(rd) = std::fs::read_dir(project.join("Alternatives")) else { return 0 };
            rd.flatten().filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false)).count()
        }
    }
}

/* ------------------------------- tempo ------------------------------ */

pub fn read_tempo(format: &Format, file: &Path) -> Tempo {
    match format.kind {
        Kind::Ableton => read_ableton(file),
        Kind::Fl => read_flp(file),
        Kind::Reaper => read_reaper(file),
        Kind::Bitwig => opens(file, "Bitwig tempo not readable yet", "Could not read project"),
        Kind::ProTools => opens(file, "Pro Tools tempo not readable yet", "Could not read session"),
        Kind::StudioOne => read_studio_one(file),
        Kind::Cubase => opens(file, "Cubase tempo not readable yet", "Could not read project"),
        Kind::Logic => {
            if file.join("Alternatives").exists() {
                err("Logic tempo not readable yet")
            } else {
                err("Logic package looks incomplete")
            }
        }
    }
}

/// Formats with no published schema: confirm the file opens, report no tempo.
fn opens(file: &Path, ok: &str, prefix: &str) -> Tempo {
    match std::fs::File::open(file) {
        Ok(_) => err(ok),
        Err(e) => err(format!("{prefix}: {e}")),
    }
}

fn cap_str(c: &regex::bytes::Captures, i: usize) -> String {
    String::from_utf8_lossy(c.get(i).map(|m| m.as_bytes()).unwrap_or_default()).to_string()
}

fn read_ableton(file: &Path) -> Tempo {
    let raw = match std::fs::read(file) {
        Ok(r) => r,
        Err(e) => return err(format!("Could not read set: {e}")),
    };
    let xml: Vec<u8> = if raw.len() > 1 && raw[0] == 0x1f && raw[1] == 0x8b {
        let mut out = Vec::new();
        if let Err(e) = GzDecoder::new(&raw[..]).read_to_end(&mut out) {
            return err(format!("Could not read set: {e}"));
        }
        out
    } else {
        raw
    };

    static MODERN: OnceLock<BRegex> = OnceLock::new();
    static LEGACY: OnceLock<BRegex> = OnceLock::new();
    let mut bpm = None;
    if let Some(c) = bre(&MODERN, r#"(?s-u)<Tempo>.{0,400}?<Manual Value="([\d.]+)""#).captures(&xml) {
        bpm = Some(round2(parse_float(&cap_str(&c, 1))));
    } else if let Some(c) = bre(&LEGACY, r#"(?-u)<CurrentTempo[^>]*Value="([\d.]+)""#).captures(&xml) {
        bpm = Some(round2(parse_float(&cap_str(&c, 1))));
    }

    static NUM: OnceLock<[BRegex; 3]> = OnceLock::new();
    static DEN: OnceLock<[BRegex; 3]> = OnceLock::new();
    let build = |field: &str| {
        ["TimeSignature", "RemoteableTimeSignature", "SongMasterTimeSignature"].map(|tag| {
            BRegex::new(&format!(r#"(?is-u)<{tag}>.{{0,300}}?<{field}\s+Value="(\d+)""#)).expect("valid regex")
        })
    };
    let num = NUM.get_or_init(|| build("Numerator")).iter().find_map(|r| r.captures(&xml).map(|c| cap_str(&c, 1)));
    let den = DEN.get_or_init(|| build("Denominator")).iter().find_map(|r| r.captures(&xml).map(|c| cap_str(&c, 1)));
    let time_signature = match (num, den) {
        (Some(n), Some(d)) => Some(format!("{n}/{d}")),
        _ => None,
    };

    match bpm {
        Some(_) => Tempo { bpm, time_signature, error: None },
        None => Tempo { bpm: None, time_signature, error: Some("No tempo tag found".into()) },
    }
}

/* -------------------------------- FL -------------------------------- */

const EVT_TIME_SIG_NUM: u8 = 17;
const EVT_TIME_SIG_DENOM: u8 = 18;
const EVT_BAR_NUM: u8 = 22;
const EVT_TEMPO_OLD: u8 = 66;
const EVT_TEMPO_FINE: u8 = 156;

fn u16le(b: &[u8], at: usize) -> u32 {
    u16::from_le_bytes([b[at], b[at + 1]]) as u32
}
fn u32le(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

fn sig(num: Option<u8>, den: Option<u8>) -> Option<String> {
    num.map(|n| format!("{n}/{}", den.unwrap_or(4)))
}

/// The classic FLP event walk, with the FL 26 fallback scan. Same rules and
/// the same limits as daw.ts, including its quirks.
fn read_flp(file: &Path) -> Tempo {
    let buf = match std::fs::read(file) {
        Ok(b) => b,
        Err(e) => return err(format!("Could not read project: {e}")),
    };
    if buf.len() < 16 || &buf[0..4] != b"FLhd" {
        return err("Not a recognisable FL project");
    }
    let mut pos = 8usize + u32le(&buf, 4) as usize;
    if buf.get(pos..pos + 4) != Some(b"FLdt") || pos + 8 > buf.len() {
        return err("FL data chunk missing");
    }
    let end = (pos + 8 + u32le(&buf, pos + 4) as usize).min(buf.len());
    pos += 8;

    let mut fallback: Option<u32> = None;
    let (mut num, mut den): (Option<u8>, Option<u8>) = (None, None);
    let mut steps = 0;

    while pos < end {
        steps += 1;
        if steps > 200_000 {
            return finish_flp(fallback, &buf, num, den);
        }
        let prev = pos;
        let id = buf[pos];
        pos += 1;
        if id < 64 {
            if pos + 1 > end {
                break;
            }
            let v = buf[pos];
            if (id == EVT_TIME_SIG_NUM || id == EVT_BAR_NUM) && v > 0 && v <= 32 {
                num = Some(v);
            } else if id == EVT_TIME_SIG_DENOM && v > 0 && v <= 32 {
                den = Some(v);
            }
            pos += 1;
        } else if id < 128 {
            if pos + 2 > end {
                break;
            }
            let v = u16le(&buf, pos);
            pos += 2;
            if id == EVT_TEMPO_OLD && fallback.is_none() {
                fallback = Some(v);
            }
        } else if id < 192 {
            if pos + 4 > end {
                break;
            }
            let v = u32le(&buf, pos);
            pos += 4;
            if id == EVT_TEMPO_FINE {
                return Tempo { bpm: Some(round2(v as f64 / 1000.0)), time_signature: sig(num, den), error: None };
            }
        } else {
            let mut length: f64 = 0.0;
            let mut shift = 0i32;
            loop {
                if pos >= end {
                    return finish_flp(fallback, &buf, num, den);
                }
                let byte = buf[pos];
                pos += 1;
                length += (byte & 0x7f) as f64 * 2f64.powi(shift);
                shift += 7;
                if shift > 35 {
                    return finish_flp(fallback, &buf, num, den);
                }
                if byte & 0x80 == 0 {
                    break;
                }
            }
            let next = pos as f64 + length;
            if length < 0.0 || next > end as f64 || next <= pos as f64 {
                return finish_flp(fallback, &buf, num, den);
            }
            pos = next as usize;
        }
        if pos <= prev {
            break;
        }
    }
    finish_flp(fallback, &buf, num, den)
}

fn finish_flp(fallback: Option<u32>, buf: &[u8], num: Option<u8>, den: Option<u8>) -> Tempo {
    let time_signature = sig(num, den);
    if let Some(v) = fallback {
        return Tempo { bpm: Some(v as f64), time_signature, error: None };
    }
    if let Some(v) = scan_flp_tempo(buf, 8192) {
        return Tempo { bpm: Some(v), time_signature, error: None };
    }
    Tempo { bpm: None, time_signature, error: Some("No tempo event found".into()) }
}

/// FL 26 fallback: look for event 156 with a plausible value near the top.
fn scan_flp_tempo(buf: &[u8], limit: usize) -> Option<f64> {
    let end = (buf.len() as i64 - 5).min(limit as i64);
    let mut i = 22i64;
    while i < end {
        let at = i as usize;
        if buf[at] == EVT_TEMPO_FINE {
            let v = u32le(buf, at + 1);
            if (20_000..=400_000).contains(&v) {
                return Some(round2(v as f64 / 1000.0));
            }
        }
        i += 1;
    }
    None
}

/* ------------------------------ REAPER ------------------------------ */

fn read_reaper(file: &Path) -> Tempo {
    let mut head = Vec::with_capacity(65536);
    match std::fs::File::open(file) {
        Ok(f) => {
            if let Err(e) = f.take(65536).read_to_end(&mut head) {
                return err(format!("Could not read project: {e}"));
            }
        }
        Err(e) => return err(format!("Could not read project: {e}")),
    }
    let text = String::from_utf8_lossy(&head);
    static R: OnceLock<Regex> = OnceLock::new();
    match re(&R, r"(?m)^\s*TEMPO\s+([0-9.]+)(?:\s+([0-9]+)\s+([0-9]+))?").captures(&text) {
        Some(c) => Tempo {
            bpm: Some(round2(parse_float(&c[1]))),
            time_signature: match (c.get(2), c.get(3)) {
                (Some(n), Some(d)) => Some(format!("{}/{}", n.as_str(), d.as_str())),
                _ => None,
            },
            error: None,
        },
        None => err("No TEMPO line found"),
    }
}

/* ---------------------------- Studio One ---------------------------- */

fn read_studio_one(file: &Path) -> Tempo {
    let buf = match std::fs::read(file) {
        Ok(b) => b,
        Err(e) => return err(format!("Could not read song: {e}")),
    };
    let Some(entries) = zip::list_entries(&buf) else { return err("Not a readable .song container") };
    static MEDIA: OnceLock<Regex> = OnceLock::new();
    let media = re(&MEDIA, r"(?i)\.(wav|aiff|flac|mp3|png|jpg)$");
    static TEMPO: OnceLock<[Regex; 3]> = OnceLock::new();
    let tempo_res = TEMPO.get_or_init(|| {
        [
            Regex::new(r#"["']?[Tt]empo["']?\s*[=:]\s*["']?([0-9.]+)"#).unwrap(),
            Regex::new(r#"<Tempo[^>]*[Vv]alue\s*=\s*"([0-9.]+)""#).unwrap(),
            Regex::new(r#"name\s*=\s*"[Tt]empo"[^>]*value\s*=\s*"([0-9.]+)""#).unwrap(),
        ]
    });
    static SIG: OnceLock<[Regex; 2]> = OnceLock::new();
    let sig_res = SIG.get_or_init(|| {
        [
            Regex::new(r#"<TimeSignature[^>]*[Nn]umerator\s*=\s*"([0-9]+)"[^>]*[Dd]enominator\s*=\s*"([0-9]+)""#).unwrap(),
            Regex::new(r#"["']?[Tt]ime[Ss]ignature["']?\s*[=:]\s*["']?([0-9]+)/([0-9]+)["']?"#).unwrap(),
        ]
    });

    let mut bpm: Option<f64> = None;
    let mut time_signature: Option<String> = None;
    let candidates = entries.iter().filter(|e| e.size > 0 && e.size < 4 * 1024 * 1024 && !media.is_match(&e.name)).take(40);
    for entry in candidates {
        let Some(data) = zip::read_entry(&buf, entry, 8 * 1024 * 1024) else { continue };
        let text = String::from_utf8_lossy(&data);
        if bpm.is_none() {
            for r in tempo_res {
                let Some(c) = r.captures(&text) else { continue };
                let v = parse_float(&c[1]);
                if (20.0..=400.0).contains(&v) {
                    bpm = Some(round2(v));
                    break;
                }
            }
        }
        if time_signature.is_none() {
            for r in sig_res {
                if let Some(c) = r.captures(&text) {
                    time_signature = Some(format!("{}/{}", &c[1], &c[2]));
                    break;
                }
            }
        }
        if bpm.is_some() && time_signature.is_some() {
            break;
        }
    }
    match bpm {
        Some(_) => Tempo { bpm, time_signature, error: None },
        None => Tempo { bpm: None, time_signature, error: Some("Tempo not found in this .song".into()) },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extensions_and_sessions() {
        assert_eq!(extname("a/b/Song.ALS"), ".ALS");
        assert_eq!(extname(".hidden"), "");
        assert!(is_session_file("Song.als"));
        assert!(!is_session_file("Bass.wav.rpp"));
        assert!(!is_session_file("notes.txt"));
        assert!(is_session_package("Tune.logicx"));
    }

    #[test]
    fn backups() {
        assert!(is_backup_file("Align yogi (autosaved on 06-08-2026 at 17h06).flp"));
        assert!(!is_backup_file("Align yogi.flp"));
        assert!(is_backup_file("Song (backup 2).rpp"));
        assert!(is_backup_file("vox.wav.rpp"));
        assert!(!is_backup_file("Song.cpr.bak")); // ext is .bak, not a format
    }

    #[test]
    fn rounding_matches_js() {
        assert_eq!(round2(120.005), (120.005f64 * 100.0 + 0.5).floor() / 100.0);
        assert_eq!(round2(-0.005), 0.0);
    }
}
