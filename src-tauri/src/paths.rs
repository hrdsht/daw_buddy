//! Where DAW Buddy keeps its data, and path checks shared by commands.

use std::path::{Component, Path, PathBuf};

/// The same folder Electron's app.getPath('userData') uses for an app named
/// "daw-buddy", so both builds share settings.json and notes.json:
/// ~/.config/daw-buddy, ~/Library/Application Support/daw-buddy,
/// %APPDATA%\daw-buddy.
pub fn data_dir() -> PathBuf {
    dirs::config_dir().unwrap_or_else(std::env::temp_dir).join("daw-buddy")
}

fn normalise(p: &Path) -> PathBuf {
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

/// True when `target` is `base` or below it (lexically, case-insensitive on
/// Windows and macOS, matching isInside() in settings.ts).
pub fn is_inside(target: &Path, base: &Path) -> bool {
    let t = normalise(target);
    let b = normalise(base);
    if cfg!(any(target_os = "windows", target_os = "macos")) {
        let t = t.to_string_lossy().to_lowercase();
        let b = b.to_string_lossy().to_lowercase();
        let b = b.trim_end_matches(['/', '\\']);
        t == b || t.starts_with(&format!("{b}{}", std::path::MAIN_SEPARATOR))
    } else {
        t.starts_with(&b)
    }
}

/// Output folder for a tool: settings.outputFolder, else Music/DAW Buddy,
/// else the first root's "DAW Buddy Output", else the data folder — the same
/// order as ensureOutputFolder() in main.ts.
pub fn ensure_tool_output(settings: &crate::settings::Settings, sub: &str) -> Result<PathBuf, String> {
    let base = settings
        .output_folder()
        .or_else(|| dirs::audio_dir().or_else(|| dirs::home_dir().map(|h| h.join("Music"))).map(|m| m.join("DAW Buddy")))
        .or_else(|| settings.roots().first().map(|r| r.join("DAW Buddy Output")))
        .unwrap_or_else(|| data_dir().join("DAW Buddy Output"));
    let target = base.join(sub);
    std::fs::create_dir_all(&target).map_err(|e| format!("Could not create the output folder {}: {e}", target.display()))?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inside() {
        assert!(is_inside(Path::new("/music/a/b.als"), Path::new("/music")));
        assert!(is_inside(Path::new("/music"), Path::new("/music")));
        assert!(!is_inside(Path::new("/musicians/x"), Path::new("/music")));
        assert!(!is_inside(Path::new("/music/../etc/passwd"), Path::new("/music")));
    }
}
