//! Finds projects — the Rust twin of `src/main/lib/scanner.ts`.
//!
//! One entry per SESSION FILE, not per folder: a folder holding eight .als
//! files is eight pieces of work. Logic's .logicx is the exception — a folder
//! that IS one project, claimed whole and never opened.
//!
//! The walk also indexes loose and rendered audio as it goes, so knowing
//! whether a project has audio costs no extra pass.

use crate::daw::{self, Format};
use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use std::time::UNIX_EPOCH;

const HEALTH_CEILING: f64 = 40.0;
const MAX_DEPTH: usize = 64;
pub const SCAN_BUDGET: i64 = 200_000;

/// Folders that can never contain a project.
const NEVER_PROJECTS: [&str; 7] = ["backup", "samples", "presets", "ableton project info", "freeze", "node_modules", ".git"];

const RENDER_FOLDERS: [&str; 22] = [
    "renders", "render", "rendered", "bounces", "bounce", "bounced files", "stems", "ai stems", "stem", "mixdown", "mixdowns",
    "mixes", "exports", "export", "masters", "master", "audio", "outs", "out", "multitrack", "multitracks", "tracks",
];

const AUDIO_EXTS: [&str; 6] = [".wav", ".mp3", ".aiff", ".aif", ".flac", ".ogg"];
const VIDEO_EXTS: [&str; 11] = [".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".wmv", ".mpeg", ".mpg", ".mts", ".m2ts"];

const CASE_INSENSITIVE_FS: bool = cfg!(any(target_os = "windows", target_os = "macos"));

pub fn is_render_folder_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    let lower = lower.trim();
    if RENDER_FOLDERS.contains(&lower) {
        return true;
    }
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?i)(?-u:\b)(stems?|bounces?|mixdowns?|exports?|masters?|mix(?:es)?|outs?|multitracks?)(?-u:\b)").unwrap())
        .is_match(lower)
}

/* ------------------------------- output ----------------------------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub path: String,
    pub session_path: String,
    pub project_file: String,
    pub folder: String,
    pub root: String,
    pub root_name: String,
    pub name: String,
    pub location: String,
    pub daw: Option<&'static str>,
    pub ext: String,
    pub is_package: bool,
    pub bpm: Option<f64>,
    pub bpm_error: Option<String>,
    pub time_signature: Option<String>,
    pub backup_count: usize,
    pub health: f64,
    pub packaged: bool,
    pub packaged_at: Option<f64>,
    pub modified: f64,
    pub render_modified: f64,
    pub last_activity: f64,
    pub size: u64,
    pub audio_count: usize,
    pub video_count: usize,
    pub from_cache: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanError {
    pub root: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub entries: Vec<Entry>,
    pub errors: Vec<ScanError>,
    pub truncated: bool,
    /// Only set by scan_roots, as in the TypeScript.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folders_read: Option<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct Options {
    pub ignore: Vec<String>,
    pub follow_links: bool,
}

/* ------------------------------- state ------------------------------ */

struct Found {
    session_path: PathBuf,
    folder: PathBuf,
    root: PathBuf,
    is_package: bool,
}

struct AudioItem {
    stem: String,
    flat: String,
    mtime: f64,
}

struct State {
    ignore: HashSet<String>,
    follow_links: bool,
    budget: i64,
    hit_ceiling: bool,
    visited: HashSet<String>,
    /// Normalised folder → audio stems found there, in discovery order.
    audio_index: Vec<(String, Vec<AudioItem>)>,
    audio_slot: HashMap<String, usize>,
}

impl State {
    fn new(options: &Options) -> Self {
        State {
            ignore: options.ignore.iter().map(|n| n.to_lowercase()).collect(),
            follow_links: options.follow_links,
            budget: SCAN_BUDGET,
            hit_ceiling: false,
            visited: HashSet::new(),
            audio_index: Vec::new(),
            audio_slot: HashMap::new(),
        }
    }

    fn add_audio(&mut self, dir: &Path, stem: &str, mtime: f64) {
        let key = normalise(dir);
        let slot = match self.audio_slot.get(&key) {
            Some(&i) => i,
            None => {
                self.audio_index.push((key.clone(), Vec::new()));
                self.audio_slot.insert(key, self.audio_index.len() - 1);
                self.audio_index.len() - 1
            }
        };
        self.audio_index[slot].1.push(AudioItem { stem: stem.to_string(), flat: flatten(stem), mtime });
    }
}

/* ------------------------------ paths ------------------------------- */

/// path.resolve for an absolute path: drop "." and resolve ".." lexically.
fn resolve(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// normalisePath(): resolved, lower-cased on case-insensitive systems.
fn normalise(p: &Path) -> String {
    let s = resolve(p).to_string_lossy().to_string();
    if CASE_INSENSITIVE_FS {
        s.to_lowercase()
    } else {
        s
    }
}

fn components(s: &str) -> Vec<String> {
    Path::new(s).components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect()
}

/// Node's path.relative for two absolute paths (case-insensitive on Windows).
fn relative(from: &str, to: &str) -> String {
    let a = components(&resolve(Path::new(from)).to_string_lossy());
    let b = components(&resolve(Path::new(to)).to_string_lossy());
    let eq = |x: &String, y: &String| if cfg!(windows) { x.eq_ignore_ascii_case(y) } else { x == y };
    let mut i = 0;
    while i < a.len() && i < b.len() && eq(&a[i], &b[i]) {
        i += 1;
    }
    let mut parts: Vec<String> = std::iter::repeat_n("..".to_string(), a.len() - i).collect();
    parts.extend(b[i..].iter().cloned());
    parts.join(std::path::MAIN_SEPARATOR_STR)
}

fn same_path(a: &str, b: &str) -> bool {
    normalise(Path::new(a)) == normalise(Path::new(b))
}

fn is_inside_or_equal(child: &str, parent: &str) -> bool {
    if same_path(child, parent) {
        return true;
    }
    let rel = relative(&normalise(Path::new(parent)), &normalise(Path::new(child)));
    !rel.is_empty() && !rel.starts_with("..") && !Path::new(&rel).is_absolute()
}

fn relative_parent(folder: &Path, root: &Path) -> String {
    let rel = relative(&root.to_string_lossy(), &folder.to_string_lossy());
    if rel.is_empty() || rel.starts_with("..") {
        return String::new();
    }
    rel.split(std::path::MAIN_SEPARATOR).collect::<Vec<_>>().join(" / ")
}

pub fn flatten(name: &str) -> String {
    name.to_lowercase().chars().filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit()).collect()
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

/// mtimeMs as Node computes it: seconds × 1000 + nanoseconds / 1e6.
fn mtime_ms(meta: &std::fs::Metadata) -> f64 {
    match meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()) {
        Some(d) => d.as_secs() as f64 * 1000.0 + d.subsec_nanos() as f64 / 1e6,
        None => 0.0,
    }
}

fn describe_read_error(e: &std::io::Error) -> String {
    use std::io::ErrorKind::*;
    match e.kind() {
        PermissionDenied => {
            if cfg!(target_os = "macos") {
                "macOS is blocking access. Open System Settings, then Privacy & Security, and give this app permission to the folder.".into()
            } else if cfg!(target_os = "linux") {
                "Permission denied. Check Linux file read permissions (chmod/chown) or group access for this mount point.".into()
            } else {
                "Permission denied. Check the folder is not read-only or in use.".into()
            }
        }
        NotFound => "Folder not found. If it is on an external drive, plug it in and rescan.".into(),
        _ if e.raw_os_error() == Some(36) || e.raw_os_error() == Some(206) => {
            "That path is longer than Windows allows (260 characters) unless long path support is enabled.".into()
        }
        _ => e.to_string(),
    }
}

/// Directory entries in the order Node's fs.readdir returns them: libuv sorts
/// names byte-wise (scandir + strcmp) on Unix; Windows keeps NTFS order. The
/// walk order decides entry order among equal timestamps, so it must match.
pub fn read_dir_ordered(dir: &Path) -> std::io::Result<Vec<std::fs::DirEntry>> {
    let mut entries: Vec<std::fs::DirEntry> = std::fs::read_dir(dir)?.flatten().collect();
    if cfg!(unix) {
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStrExt;
            entries.sort_by(|a, b| a.file_name().as_bytes().cmp(b.file_name().as_bytes()));
        }
    }
    Ok(entries)
}

/* ------------------------------- walk ------------------------------- */

fn ext_lower(name: &str) -> String {
    daw::extname(name).to_lowercase()
}

fn walk(dir: &Path, root: &Path, depth: usize, st: &mut State, out: &mut Vec<Found>) -> std::io::Result<()> {
    if st.budget <= 0 || depth > MAX_DEPTH {
        st.hit_ceiling = true;
        return Ok(());
    }
    st.budget -= 1;

    // Cycle guard: never walk the same real folder twice.
    let real = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
    let key = if cfg!(windows) { real.to_string_lossy().to_lowercase() } else { real.to_string_lossy().to_string() };
    if !st.visited.insert(key) {
        return Ok(());
    }

    let contents: Vec<std::fs::DirEntry> = match read_dir_ordered(dir) {
        Ok(rd) => rd,
        Err(e) => {
            if depth == 0 {
                return Err(e);
            }
            return Ok(());
        }
    };

    let typed: Vec<(std::fs::DirEntry, std::fs::FileType, String)> = contents
        .into_iter()
        .filter_map(|e| {
            let t = e.file_type().ok()?;
            let n = e.file_name().to_string_lossy().to_string();
            Some((e, t, n))
        })
        .collect();
    let has_file_ext = |ext: &str| typed.iter().any(|(_, t, n)| t.is_file() && ext_lower(n) == ext);
    let owns_studio_history = has_file_ext(".song");
    let owns_bitwig_backups = has_file_ext(".bwproject");
    let owns_pro_tools = has_file_ext(".ptx");

    for (entry, ft, name) in &typed {
        if name.starts_with('.') {
            continue;
        }
        let full = entry.path();

        if ft.is_dir() {
            if daw::is_session_package(name) {
                out.push(Found { session_path: full, folder: dir.to_path_buf(), root: root.to_path_buf(), is_package: true });
                continue;
            }
            let lower = name.to_lowercase();
            if (lower == "history" && owns_studio_history)
                || (lower == "auto-backup" && owns_bitwig_backups)
                || ((lower == "session file backups" || lower == "audio files") && owns_pro_tools)
                || NEVER_PROJECTS.contains(&lower.as_str())
            {
                continue;
            }
            if is_render_folder_name(name) {
                index_audio(&full, st);
                continue;
            }
            if st.ignore.contains(&lower) {
                continue;
            }
            walk(&full, root, depth + 1, st, out)?;
            continue;
        }

        if ft.is_symlink() {
            if !st.follow_links {
                continue;
            }
            if let Ok(meta) = std::fs::metadata(&full) {
                if meta.is_dir() {
                    walk(&full, root, depth + 1, st, out)?;
                }
            }
            continue;
        }

        if !ft.is_file() {
            continue;
        }
        if !st.follow_links && name.to_lowercase().ends_with(".lnk") {
            continue;
        }

        let ext = ext_lower(name);
        if AUDIO_EXTS.contains(&ext.as_str()) {
            // Node's basename(name, ext) strips only an exact-case match.
            let stem = name.strip_suffix(ext.as_str()).unwrap_or(name);
            let mtime = std::fs::metadata(&full).map(|m| mtime_ms(&m)).unwrap_or(0.0);
            st.add_audio(dir, stem, mtime);
            continue;
        }

        if !daw::is_session_file(name) || daw::is_backup_file(name) {
            continue;
        }
        out.push(Found { session_path: full, folder: dir.to_path_buf(), root: root.to_path_buf(), is_package: false });
    }
    Ok(())
}

fn index_audio(dir: &Path, st: &mut State) {
    let Ok(rd) = read_dir_ordered(dir) else { return };
    for entry in rd {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let Ok(ft) = entry.file_type() else { continue };
        let full = entry.path();
        if ft.is_dir() {
            index_audio(&full, st);
            continue;
        }
        let ext = ext_lower(&name);
        if AUDIO_EXTS.contains(&ext.as_str()) {
            let stem = name.strip_suffix(ext.as_str()).unwrap_or(&name).to_string();
            let mtime = std::fs::metadata(&full).map(|m| mtime_ms(&m)).unwrap_or(0.0);
            st.add_audio(dir, &stem, mtime);
        }
    }
}

/* ---------------------------- audio match --------------------------- */

fn words(s: &str) -> Vec<String> {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?i)[^a-z0-9]+").unwrap())
        .split(&s.to_lowercase())
        .filter(|w| w.encode_utf16().count() >= 2)
        .map(str::to_string)
        .collect()
}

fn shares_title_word(a: &str, b: &str) -> bool {
    let (fa, fb) = (flatten(a), flatten(b));
    if fa.is_empty() || fb.is_empty() {
        return false;
    }
    if fa == fb || fa.starts_with(&fb) || fb.starts_with(&fa) {
        return true;
    }
    let (wa, wb) = (words(a), words(b));
    if wa.is_empty() || wb.is_empty() {
        return false;
    }
    wa[0] == wb[0] || (wa.len() >= 2 && wb.len() >= 2 && wa[1] == wb[1])
}

/// Audio may be inside the project, loose in an ancestor folder, or below a
/// render-named folder attached to an ancestor — never in an unrelated branch.
/// The reference rule, step by step as in scanner.ts. The scan uses
/// belongs_fast(); a test holds the two to the same answers.
#[cfg_attr(not(test), allow(dead_code))]
fn audio_folder_belongs(audio_folder: &str, project_folder: &str, root: &str) -> bool {
    if is_inside_or_equal(audio_folder, project_folder) {
        return true;
    }
    let mut current = normalise(Path::new(project_folder));
    let stop = normalise(Path::new(root));
    for _ in 0..MAX_DEPTH {
        if same_path(audio_folder, &current) {
            return true;
        }
        let rel = relative(&current, audio_folder);
        if !rel.is_empty() && !rel.starts_with("..") && !Path::new(&rel).is_absolute() {
            let first = rel.split(std::path::MAIN_SEPARATOR).next().unwrap_or("").to_lowercase();
            if is_render_folder_name(&first) {
                return true;
            }
        }
        if same_path(&current, &stop) {
            break;
        }
        let parent = Path::new(&current).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| current.clone());
        if parent == current || !is_inside_or_equal(&parent, &stop) {
            break;
        }
        current = parent;
    }
    false
}

/// The project folder and its ancestors up to (and including) the root,
/// normalised — the chain audio_folder_belongs() climbs, worked out once.
fn ancestor_chain(project_folder: &str, root: &str) -> Vec<String> {
    let mut chain = Vec::new();
    let mut current = normalise(Path::new(project_folder));
    let stop = normalise(Path::new(root));
    for _ in 0..MAX_DEPTH {
        chain.push(current.clone());
        if same_path(&current, &stop) {
            break;
        }
        let parent = Path::new(&current).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| current.clone());
        if parent == current || !is_inside_or_equal(&parent, &stop) {
            break;
        }
        current = parent;
    }
    chain
}

/// `folder` followed by a separator, so "/a/b" never prefixes "/a/bc".
fn with_sep(folder: &str) -> String {
    if folder.ends_with(std::path::MAIN_SEPARATOR) {
        folder.to_string()
    } else {
        format!("{folder}{}", std::path::MAIN_SEPARATOR)
    }
}

/// Same answer as audio_folder_belongs(), using the precomputed chain and
/// plain prefix tests instead of rebuilding paths for every pair.
fn belongs_fast(audio: &str, chain: &[(String, String)]) -> bool {
    let Some((project, project_sep)) = chain.first() else { return false };
    if audio == project || audio.starts_with(project_sep.as_str()) {
        return true;
    }
    for (folder, folder_sep) in chain {
        if audio == folder {
            return true;
        }
        if let Some(rest) = audio.strip_prefix(folder_sep.as_str()) {
            let first = rest.split(std::path::MAIN_SEPARATOR).next().unwrap_or("").to_lowercase();
            if is_render_folder_name(&first) {
                return true;
            }
        }
    }
    false
}

/// Indices into the audio index that belong to this project folder.
fn audio_folders_for(folder: &Path, root: &Path, st: &State) -> Vec<usize> {
    let chain: Vec<(String, String)> = ancestor_chain(&folder.to_string_lossy(), &root.to_string_lossy())
        .into_iter()
        .map(|f| {
            let sep = with_sep(&f);
            (f, sep)
        })
        .collect();
    (0..st.audio_index.len()).filter(|&i| belongs_fast(&st.audio_index[i].0, &chain)).collect()
}

fn audio_stats(session_name: &str, folders: &[usize], st: &State) -> (usize, f64) {
    let wanted = flatten(session_name);
    if wanted.len() < 3 {
        return (0, 0.0);
    }
    let (mut count, mut latest) = (0, 0.0f64);
    for &i in folders {
        for item in &st.audio_index[i].1 {
            if item.flat.is_empty() {
                continue;
            }
            let matches = item.flat == wanted
                || item.flat.starts_with(&wanted)
                || wanted.starts_with(&item.flat)
                || shares_title_word(session_name, &item.stem);
            if matches {
                count += 1;
                if item.mtime > latest {
                    latest = item.mtime;
                }
            }
        }
    }
    (count, latest)
}

/* ------------------------------ entries ----------------------------- */

#[derive(Clone)]
struct FolderFacts {
    backups: usize,
    videos: usize,
    zips: Vec<(String, f64)>,
}

fn folder_facts(folder: &Path, format: Option<&Format>, session: &Path, is_package: bool, cache: &mut HashMap<String, FolderFacts>) -> FolderFacts {
    // REAPER's count is per session name and each Logic package owns its
    // backups; everything else is shared by every session in the folder.
    let scoped = is_package || format.map(|f| f.ext == ".rpp").unwrap_or(false);
    let key = format!(
        "{}::{}::{}",
        folder.display(),
        format.map(|f| f.ext).unwrap_or("?"),
        if scoped { session.to_string_lossy().to_string() } else { "folder".into() }
    );
    if let Some(f) = cache.get(&key) {
        return f.clone();
    }
    let mut facts = FolderFacts { backups: 0, videos: 0, zips: Vec::new() };
    if let Some(f) = format {
        facts.backups = daw::count_backups(f, if is_package { session } else { folder }, session);
    }
    if let Ok(rd) = read_dir_ordered(folder) {
        for e in rd {
            if !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            let name = e.file_name().to_string_lossy().to_string();
            let ext = ext_lower(&name);
            if VIDEO_EXTS.contains(&ext.as_str()) {
                facts.videos += 1;
            }
            if ext != ".zip" {
                continue;
            }
            let modified = std::fs::metadata(e.path()).map(|m| mtime_ms(&m)).unwrap_or(0.0);
            facts.zips.push((name, modified));
        }
    }
    cache.insert(key, facts.clone());
    facts
}

/// "Nava bharat jodo.flp" pairs with "Nava Bharat Jodo v2.zip".
fn matching_zip(session_name: &str, zips: &[(String, f64)]) -> Option<f64> {
    let stem = flatten(session_name);
    if stem.len() < 4 {
        return None;
    }
    zips.iter()
        .find(|(name, _)| {
            let base = name.strip_suffix(".zip").unwrap_or(name);
            let z = flatten(base);
            z.len() >= 4 && (z.starts_with(&stem) || stem.starts_with(&z))
        })
        .map(|(_, m)| *m)
}

fn build_entry(
    found: &Found,
    st: &State,
    facts_cache: &mut HashMap<String, FolderFacts>,
    audio_cache: &mut HashMap<(PathBuf, PathBuf), Vec<usize>>,
) -> Entry {
    let session = &found.session_path;
    let session_str = session.to_string_lossy().to_string();
    let base = file_name(session);
    let ext = daw::extname(&base).to_string();
    let name = base[..base.len() - ext.len()].to_string();
    let format = daw::format_for(&session_str);

    let (modified, size) = match std::fs::metadata(session) {
        Ok(m) => (mtime_ms(&m), m.len()),
        Err(_) => (0.0, 0),
    };
    let tempo = format.map(|f| daw::read_tempo(f, session)).unwrap_or_default();
    let facts = folder_facts(&found.folder, format, session, found.is_package, facts_cache);
    let folders = audio_cache
        .entry((found.folder.clone(), found.root.clone()))
        .or_insert_with(|| audio_folders_for(&found.folder, &found.root, st));
    let (audio_count, render_modified) = audio_stats(&name, folders, st);
    let packaged_at = matching_zip(&name, &facts.zips);

    Entry {
        kind: "project",
        path: session_str.clone(),
        session_path: session_str.clone(),
        project_file: session_str,
        folder: found.folder.to_string_lossy().to_string(),
        root: found.root.to_string_lossy().to_string(),
        root_name: file_name(&found.root),
        name,
        location: relative_parent(&found.folder, &found.root),
        daw: format.map(|f| f.name),
        ext: ext.to_lowercase(),
        is_package: found.is_package,
        bpm: tempo.bpm,
        bpm_error: tempo.error,
        time_signature: tempo.time_signature,
        backup_count: facts.backups,
        health: (facts.backups as f64 / HEALTH_CEILING).min(1.0),
        packaged: packaged_at.is_some(),
        packaged_at,
        modified,
        render_modified,
        last_activity: modified.max(render_modified),
        size,
        audio_count,
        video_count: facts.videos,
        from_cache: false,
    }
}

fn hydrate(found: &[Found], st: &State) -> Vec<Entry> {
    let mut facts = HashMap::new();
    let mut audio = HashMap::new();
    let mut entries: Vec<Entry> = found.iter().map(|f| build_entry(f, st, &mut facts, &mut audio)).collect();
    // Newest first by whichever happened last: a save or a render.
    entries.sort_by(|a, b| {
        let at = a.modified.max(a.render_modified).max(a.last_activity);
        let bt = b.modified.max(b.render_modified).max(b.last_activity);
        bt.partial_cmp(&at).unwrap_or(std::cmp::Ordering::Equal)
    });
    entries
}

pub fn scan_roots(roots: &[PathBuf], options: &Options) -> ScanResult {
    let mut st = State::new(options);
    let mut found = Vec::new();
    let mut errors = Vec::new();
    for root in roots {
        if let Err(e) = walk(root, root, 0, &mut st, &mut found) {
            errors.push(ScanError { root: root.to_string_lossy().to_string(), message: describe_read_error(&e) });
        }
    }
    let entries = hydrate(&found, &st);
    ScanResult { entries, errors, truncated: st.hit_ceiling, folders_read: Some(SCAN_BUDGET - st.budget) }
}

pub fn scan_folder(dir: &Path, root: &Path, options: &Options) -> ScanResult {
    let mut st = State::new(options);
    let mut found = Vec::new();
    let mut errors = Vec::new();
    if let Err(e) = walk(dir, root, 0, &mut st, &mut found) {
        errors.push(ScanError { root: dir.to_string_lossy().to_string(), message: describe_read_error(&e) });
    }
    let entries = hydrate(&found, &st);
    ScanResult { entries, errors, truncated: st.hit_ceiling, folders_read: None }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_folder_names() {
        assert!(is_render_folder_name("Bounces"));
        assert!(is_render_folder_name("DTS Stems"));
        assert!(is_render_folder_name("Final Mixdowns"));
        assert!(!is_render_folder_name("Samples"));
        assert!(!is_render_folder_name("Outstanding"));
    }

    #[test]
    fn relative_paths() {
        assert_eq!(relative("/a/b", "/a/b/c/d"), format!("c{}d", std::path::MAIN_SEPARATOR));
        assert_eq!(relative("/a/b", "/a/x"), format!("..{}x", std::path::MAIN_SEPARATOR));
        assert_eq!(relative("/a/b", "/a/b"), "");
        assert!(is_inside_or_equal("/a/b/c", "/a/b"));
        assert!(!is_inside_or_equal("/a/bc", "/a/b"));
    }

    #[test]
    fn fast_audio_rule_matches_reference() {
        let sep = std::path::MAIN_SEPARATOR;
        let p = |s: &str| s.replace('/', &sep.to_string());
        let root = p("/music");
        let projects = ["/music/clients/a/song project", "/music/x", "/music", "/elsewhere/y"];
        let audio = [
            "/music/clients/a/song project",
            "/music/clients/a/song project/bounces",
            "/music/clients/a/song project/deep/er",
            "/music/clients/a",
            "/music/clients/a/stems/v1",
            "/music/clients/a/other project",
            "/music/clients/bounces",
            "/music/final mixdowns/x",
            "/music/samples",
            "/music",
            "/music/x/renders",
            "/musicians/renders",
            "/elsewhere/y/out",
            "/elsewhere/renders",
        ];
        for proj in projects {
            let chain: Vec<(String, String)> =
                ancestor_chain(&p(proj), &root).into_iter().map(|f| (f.clone(), with_sep(&f))).collect();
            for a in audio {
                let key = normalise(Path::new(&p(a)));
                assert_eq!(belongs_fast(&key, &chain), audio_folder_belongs(&key, &p(proj), &root), "{a} for {proj}");
            }
        }
    }

    #[test]
    fn zips_and_words() {
        assert_eq!(matching_zip("Nava bharat jodo", &[("Nava Bharat Jodo v2.zip".into(), 5.0)]), Some(5.0));
        assert!(shares_title_word("Yogi mom reunion 2", "yogi teaser"));
        assert!(!shares_title_word("ab", "cd"));
    }
}
