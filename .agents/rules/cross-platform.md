# Cross-Platform Compatibility Policy (macOS, Windows, Linux)

DAW Buddy supports **Windows, macOS (Apple Silicon & Intel), and Linux**. Every release must maintain 100% cross-platform parity without breaking functionality or introducing platform-specific assumptions.

---

## 1. File System & Path Handling
- **Path Separators & Comparison**:
  - Never assume backslashes (`\`) or forward slashes (`/`). Always normalize with `path.normalize()` or use `samePath(a, b)` / `isInside(child, parent)`.
  - Windows file systems (NTFS) and macOS default APFS are case-insensitive, whereas Linux (ext4/btrfs) is strictly case-sensitive.
  - Audio extensions must always be checked with `.toLowerCase()` (`.wav`, `.mp3`, `.flac`, `.aif`, `.aiff`, `.ogg`, `.m4a`).
- **OS Metadata Filtering**:
  - macOS AppleDouble files (`._*`) and metadata (`.DS_Store`, `.localized`) must never be scanned as audio or project session files.
  - Linux hidden dotfiles (`.*`) must be skipped from audio indexing.
- **Default Storage Directories**:
  - Always use Electron's `app.getPath('music')` or `app.getPath('userData')` rather than hardcoding Windows `%USERPROFILE%`, macOS `~/Music`, or Linux `/home/user`.

---

## 2. Process & DAW Detection
- **macOS**: Parses `ps -ax -o comm`. Output contains full application bundle paths (e.g. `/Applications/Ableton Live 12 Suite.app/Contents/MacOS/Live`, `/Applications/Logic Pro.app/Contents/MacOS/Logic Pro`).
- **Linux**: Parses `ps -e -o comm`. Output contains binary basenames (e.g. `bitwig-studio`, `reaper`, `ardour-8.6.0`, `lmms`).
- **Windows**: Parses `wmic` / `tasklist` (e.g. `Live.exe`, `FL64.exe`, `Bitwig Studio.exe`).
- **Kernel & Background Guard**: Linux kernel threads like `oom_reaper` must never falsely trigger DAW detection for REAPER.

---

## 3. Audio Processing & Encoders
- Always provide pure JavaScript / WebAssembly fallbacks (e.g. `lamejs` for MP3, PCM converters for WAV) so all rendering works offline without requiring external `ffmpeg` binaries.

---

## 4. Pre-Release Verification Protocol
Before any release or version tag:
1. `npm run typecheck` (tsc + tsconfig.renderer.json) — 0 errors.
2. `npm test` — all unit and cross-platform compatibility suites (`linux-compat.test.js`, `cross-platform-compat.test.js`) must pass.
3. `npm run test:e2e` (Playwright) — all Electron browser end-to-end tests must pass.
