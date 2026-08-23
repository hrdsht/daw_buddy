# Changelog

All notable changes to DAW Buddy. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/). Per-release detail (every merged PR)
is auto-generated on each GitHub Release; this file is the curated summary.

## [Unreleased]

- _Nothing yet._

## [0.5.0-beta] — 2026-08-23

### Added
- **Slowed + Reverb Studio**:
  - Full algorithmic slow-down and reverb generator inspired by slowedreverb.com.
  - **Dual Invocations**:
    - Popup modal via the `Verb` button beside the main waveform in the player transport.
    - Inline standalone tool inside the **Tools** section.
  - **Speed (%) & Pitch Controls**:
    - Speed (%) mode (50%–100%) vs. "Slow by Pitch" semitones mode (-12 to 0 st) with live synchronized math conversions.
    - Algorithmic Freeverb stereo impulse synthesis with 8 comb filters and 4 allpass filters per channel.
    - Equal-power dry/wet mix curves and natural reverb tail preservation.
    - RMS and peak loudness normalization to match original audio level without clipping.
  - **Audio Quality & Export Format Selectors**:
    - Sample rate selector: `44.1 kHz (44,100 Hz)` (default) or `48.0 kHz (48,000 Hz)`.
    - WAV bit depth: `16-bit PCM` (default), `24-bit PCM`, or `32-bit Float`.
    - MP3 bitrate slider: `128 kbps` to `320 kbps` (default `192 kbps`).
    - Smart re-rendering on save when format/sample-rate/DSP settings change with progress bar.
  - **Interactive Seekable Waveform Visualizer**:
    - Amplitude peak waveform canvas with playhead cursor, duration timecode (`0:00 / 3:45`), and click-to-seek scrubbing.
  - **Scale Suggestions Ranking Stability**:
    - Fixed Raaga ranking stability by anchoring chroma match calculations to the base key and scale.

## [0.5.0-beta.2] — 2026-08-23

### Added
- **10 Authentic DAW Metronome Soundsets**:
  - Bundled authentic high-resolution downbeat/upbeat soundsets for Ableton Live (Default Clave), FL Studio, Logic Pro, Steinberg Cubase, Pro Tools (Default & Marimba), NI Maschine, Akai MPC, Reason Studios, Cakewalk Sonar, and Electronic Synth.
  - Right-click metronome sound picker popup with instant 1-2-3-4 audition playback.
- **Drag-and-Drop Metronome (Audio & MIDI) into DAWs**:
  - Added companion drag button in project window allowing instant dragging of rendered Audio (.wav) and MIDI (.mid) click tracks into any DAW.
  - Added dedicated Metronome & Click Tracks section in Settings with custom BPM, Time Signature (`4/4`, `3/4`, `6/8`, `7/8`, `5/4`, `12/8`), and Bar Length (`2`, `4`, `8`, `16`) dragcards.
- **Collapsible Missing Samples Callout**:
  - Interactive animated header with rotating chevron (`^` $\rightarrow$ `v`) to expand/collapse sample audit lists and preserve vertical workspace.

### Fixed
- **Drag & Drop Process Crash (Windows OLE / COM Collision)**:
  - Added `e.preventDefault()` across all 22 native file and MIDI `dragstart` event listeners, resolving hard Windows OLE `DRAGDROP_E_ALREADYREGISTERED` collisions when starting drag-and-drop operations into DAWs and File Explorer.
  - Hardened `getDragIcon` in the main process with a non-empty 16×16 base64 PNG icon fallback, preventing Windows Shell null-pointer dereferences.
  - Added synchronous file existence validation before triggering `webContents.startDrag()`.
- **Scale Change Detector Audio File Resolution**:
  - Fixed "No audio file or bounce found" false-positive by properly resolving primary group renders, in-flight decoded buffers, and session sibling bounces.
- **Native Process Termination Capture in Crash Logger**:
  - Registered Electron's `app.on('render-process-gone')` and `app.on('child-process-gone')` to capture native Chromium/GPU process crashes in `latest-crash.json` and present the crash recovery banner upon restart.
- **Fretboard SVG Anti-Flicker & Layout Stability**:
  - Replaced dynamic CSS `filter: drop-shadow(...)` and `transform: translateY()` on SVG `<line>` / `<g>` with hardware-accelerated expanding SVG ripple circles (`<circle class="fret-note-ripple">`) and acoustic stroke shimmer (`@keyframes stringShimmer`).
  - Eliminated full-document `getBoundingClientRect()` reflow bottlenecks on note clicks.

### Performance
- **WebAudio Idle CPU Reduction & Auto-Suspension**:
  - Implemented automatic idle suspension for `AudioContext` instances in both the main app and player transport after 2.5 seconds of silence, releasing OS WASAPI audio processing thread polling and reducing idle CPU from ~5.8% to <0.5%.
  - Added DOM connection and visibility guards to 3D Globe animation loops, pausing rendering while minimized or hidden.

## [0.5.0-beta] — 2026-08-23

### Added
- **Interactive 6-String Guitar Fretboard Visualizer**:
  - Full 12-fret standard guitar fretboard (`EADGBE`) with fret wires, inlay markers (frets 3, 5, 7, 9, 12), and gauge-differentiated strings.
  - Interactive note plucking with acoustic string shimmer wave animations and synthesized note playback.
  - Highlighted root tonic (gold glow) and scale degree notes.
- **Centered & Expanded Scale Notes & Sargam Solfege**:
  - Centered layout displaying note badges with Western note names, Indian Sargam (`Sa`, `Re`, `Ga`, `ma`, `Pa`, `Dha`, `ni`), scale degrees, and exact tuning frequencies (Hz). Clicking any badge triggers note playback and plucks matching fretboard notes.
- **2-Row Scale Suggestions Grid & Camelot Wheel**:
  - 2-column, 2-row clean grid for World Musical Traditions & Scale Suggestions with Audition and Drag to DAW features.
- **Persistent Audio Analysis Knowledge Base**:
  - Permanent caching of detected musical keys, Camelot codes, BPMs, time signatures, and Talas.
  - Interactive "Are you sure?" confirmation dialog when manually requesting re-analysis of already analyzed files.
- **Dynamic In-Place Project Harmony Updates**:
  - Real-time animated updates to keyboard, fretboard, and Camelot wheel on audio analysis without full page reloads.

### Fixed
- **Strict Single-Instance Lock**:
  - Enforced single-instance application locking via `app.requestSingleInstanceLock()`. Secondary instances immediately exit and bring the running window into focus.
- **Mini Player Background Playback Synchronization**:
  - Implemented continuous 100ms background playback state broadcasting and `timeupdate` listeners, ensuring the Mini Player seek bar and time counter update smoothly even when DAW Buddy's main window is minimized.

### Fixed
- **Audio Analysis Decoding**: Resolved issue where `Player.load()` returned unawaited promises, causing `"That file could not be decoded."` toast errors during manual render analysis. Added dedicated `Player.decode()` pipeline for uninterrupted background analysis of large multi-megabyte WAV bounces.
- **Social Media Studio Export Enhancements**:
  - Un-scaled `html2canvas` render pipeline to output full-bleed, crisp 1080×1350 JPEG carousel slides with zero white borders.
  - Resolved `html2canvas` gradient bar visual artifact by replacing pseudo-element shadows with clean semantic markup.
  - Added smart aspect-ratio adaptive window shrink-wrapping for screenshots of any native display resolution.

## [0.4.9-beta] — 2026-08-22

### Fixed
- **Waveform Rendering & Web Audio API ArrayBuffer Compatibility**: Fixed IPC buffer transfer mismatch (`Uint8Array` to isolated `ArrayBuffer` conversion) for `audioContext.decodeAudioData()`, restoring smooth progressive waveform visualization across all audio tracks.
- **Dynamic Version Reporting**: Replaced hardcoded static version strings with dynamic `app.getVersion()` runtime IPC synchronization in Settings and diagnostics.
- **Cache Invalidation & Redundant Asset Cleanup**: Ensured missing peaks always trigger background audio re-decoding without getting blocked by cached audio stream URLs.

## [0.4.8-beta] — 2026-08-22

### Added & Optimized (Performance Enhancements)
- **Instant Audio Playback**: Priority-1 playback starts audio streaming immediately via zero-copy Blob buffer creation without waiting on synchronous decoding or analysis.
- **Asynchronous Adaptive Waveform Generation**: Subsampled peak calculation (~1ms) scheduled off the critical playback path so waveform populates smoothly with a 60fps progressive scan sweep.
- **Zero-Latency Transport Controls**: Transport play button and Spacebar instantly load and play the latest available render if clicked before a track is selected.
- **Waveform Contrast in Light Mode**: Clean, high-contrast visual styling for waveform fills and played regions across dark, AMOLED, and light themes.
- **Decoupled Background Tasks**: File system watching, directory scanning, and audio DSP key/BPM analysis remain strictly isolated on worker/background threads so UI and playback never hitch.

## [0.4.2] — 2026-08-21

### Added
- **Project list sorting** by saves, audio, favourites and notes (plus name /
  BPM / key / modified), via a topbar Sort control that persists across restarts.
- **Missing-media detection** — flags Ableton samples referenced by a set that no
  longer exist on disk (conservative: only when neither the relative nor absolute
  path resolves).
- Ableton-inspired theming, AMOLED surface, clip-colour tagging, draggable
  WAV/MP3 format pills, and an interactive feature tour.
- `RULES.md` + `AGENTS.md` (versioning/release discipline) and a machine-agnostic
  external-assets policy.

### Fixed
- **Linux packaging restored** — AppImage / `.deb` / `.rpm` / `.tar.gz` build and
  attach again (the break was a packager requiring an author email).

### Changed
- App publisher/author set to **ba55ick**.
- Unified icon nav, stat-chip project header, responsive tool grid.
- CI runners on Node 22; Dependabot enabled.

_Note: `v0.3.0` was skipped during an uncoordinated release; see `RULES.md` §1._

## [0.2.0] — 2026-08-20

### Added
- **Waveform drag-to-trim** tool — crop a WAV to a chosen region, audition it,
  export a safe copy.
- **"This week"** dashboard of recently-touched projects.
- Modern dark UI refresh (icon nav, stat chips), theme options, system tray +
  floating mini-player, native file drag-and-drop.

## [0.1.0] — 2026-08-20

First public (pre-release) build.

### Added
- Multi-DAW project browser (Ableton, FL Studio, Logic, REAPER, Cubase, Bitwig,
  Pro Tools, Fender) — one row per session, with tempo, health/backup counts and
  render matching.
- Key / scale / raga detection with an interactive Camelot wheel and
  drag-MIDI-to-DAW.
- Tidy tools (originals never touched): silence strip, audio finishing, sample
  de-duplication (hard-links), ID3 editor, smart/bulk renamer, vocal
  reconstruction, disk-usage insights.
- Bounce watcher with optional Discord/Slack/Zapier webhooks.
- Cross-platform installers built automatically per release.

[Unreleased]: https://github.com/hrdsht/daw_buddy/compare/v0.4.2...HEAD
[0.4.2]: https://github.com/hrdsht/daw_buddy/releases/tag/v0.4.2
[0.2.0]: https://github.com/hrdsht/daw_buddy/releases/tag/v0.2.0
[0.1.0]: https://github.com/hrdsht/daw_buddy/releases/tag/v0.1.0
