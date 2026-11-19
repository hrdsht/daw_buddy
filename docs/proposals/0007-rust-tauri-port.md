# 0007 — Move to Rust with Tauri

- **Status:** Accepted
- **Date:** 2026-11-18

## Context

DAW Buddy ships as an Electron app: a bundled Chromium plus a Node back end.
That costs about 150 MB to install, several hundred MB of memory at idle, and
a slow cold start. The heavy jobs (walking project roots, parsing DAW files,
audio DSP, project conversion) run in Node, which is the slowest part of the
stack for that kind of work.

A full native rewrite (Rust UI toolkit) would also rebuild ~30k lines of
screens and styles from scratch — months with no features and a high risk of
regressions. The screens are not where the time goes.

## Decision

Move to **Tauri 2**: a Rust back end, with the existing web UI running in the
system web view.

- **Same screens, same calls.** The renderer keeps calling `window.api.*`.
  Under Tauri, `src/renderer/tauri-bridge.ts` defines `window.api` as a proxy
  onto one Rust command (`api(method, args)`) and maps `onX(cb)` to events.
  Nothing in the screens has to know which shell it runs in.
- **Port in slices.** Each slice moves one area of `src/main/lib` into a Rust
  crate under `crates/`, with the existing TypeScript tests ported alongside
  and the two implementations compared on the same fixtures. A slice that
  isn't ported yet answers "not available in this build yet" — never a silent
  wrong result.
- **Shared data.** The Tauri build reads and writes the same `settings.json`
  and `notes.json` in the same folder Electron uses (`<config>/daw-buddy`), so
  switching builds keeps your folders, favourites and notes. Don't run both
  at once.
- **Electron keeps shipping** until the Tauri build reaches parity; then
  Electron is removed in its own reviewed change (RULES.md §2).

Order of slices (each its own PR):

1. Shell + bridge + settings/records + **project converter** (done first: it is
   self-contained and already has a full test suite to compare against).
2. Scanner, DAW tempo parsing, version grouping — the main list. **Done:**
   `crates/catalogue`, byte-for-byte parity with the TypeScript scanner on a
   fixture drive covering every format. On a 6,000-session drive it scans in
   0.66 s against 163 s in Node, so the Rust build needs neither the parse
   cache nor the project index (the screens already keep the last list for
   instant start-up). The folder watcher moves with slice 6.
3. Renders, media, videos, notes text, versions, samples audit.
4. Audio tools: silence, trim, finisher, QC, convert/encoders, vocal split.
5. Renamer / smart rename, ID3, dedupe, disk insights, webhook, crash log.
6. Window chrome: tray, mini player, drag-out, navigation buttons, hotkeys.
7. Packaging, signing (with 0003), auto-release; remove Electron.

## Consequences

- Expected: installer ~10 MB instead of ~150 MB, much lower idle memory,
  faster start, and native-speed scanning and DSP.
- The system web view is WebKit on macOS and Linux and WebView2 (Chromium) on
  Windows. Web Audio features (player, metronome, drone, reverb, Audio → MIDI)
  must be checked on each platform; differences get fixed in the renderer.
- Two back ends exist during the move. Every slice must keep the TypeScript
  tests green and add Rust tests, and CI runs both.
- Linux builds need the WebKitGTK 4.1 development packages.
