//! Finding the audio a project points at — twin of `files.ts`. Try each
//! stored path, then fall back to a one-time index of the project folder.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

const MAX_INDEXED: usize = 20_000;
const MAX_DEPTH: usize = 6;

pub struct FileFinder {
    pub root: PathBuf,
    index: Option<HashMap<String, PathBuf>>,
}

impl FileFinder {
    pub fn new(root: &Path) -> Self {
        FileFinder { root: root.to_path_buf(), index: None }
    }

    pub fn resolve(&mut self, candidates: &[String], file_name: &str) -> Option<PathBuf> {
        for raw in candidates {
            if raw.is_empty() {
                continue;
            }
            let normalised = normalise_separators(raw);
            let p = PathBuf::from(&normalised);
            let full = if p.is_absolute() { p } else { self.root.join(p) };
            if full.is_file() {
                return Some(full);
            }
        }
        if file_name.is_empty() {
            return None;
        }
        self.build_index().get(&file_name.to_lowercase()).cloned()
    }

    fn build_index(&mut self) -> &HashMap<String, PathBuf> {
        if self.index.is_none() {
            let mut index = HashMap::new();
            let mut count = 0usize;
            walk(&self.root, 0, &mut index, &mut count);
            self.index = Some(index);
        }
        self.index.as_ref().unwrap()
    }
}

fn walk(dir: &Path, depth: usize, index: &mut HashMap<String, PathBuf>, count: &mut usize) {
    if depth > MAX_DEPTH || *count > MAX_INDEXED {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let Ok(ft) = entry.file_type() else { continue };
        let full = entry.path();
        if ft.is_dir() {
            walk(&full, depth + 1, index, count);
        } else if ft.is_file() {
            *count += 1;
            index.entry(name.to_lowercase()).or_insert(full);
        }
    }
}

/// A Windows path read on macOS/Linux (or vice versa) still needs trying.
fn normalise_separators(p: &str) -> String {
    if std::path::MAIN_SEPARATOR == '/' {
        p.replace('\\', "/")
    } else {
        p.replace('/', "\\")
    }
}

pub fn basename(p: &str) -> String {
    let p = p.replace('\\', "/");
    p.rsplit('/').next().unwrap_or("").to_string()
}

pub fn strip_ext(name: &str) -> String {
    // Like name.replace(/\.[^.]+$/, ''): only when something follows the dot.
    match name.rfind('.') {
        Some(i) if i + 1 < name.len() => name[..i].to_string(),
        _ => name.to_string(),
    }
}
