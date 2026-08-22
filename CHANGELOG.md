# Changelog

All notable changes to DAW Buddy. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/). Per-release detail (every merged PR)
is auto-generated on each GitHub Release; this file is the curated summary.

## [Unreleased]

- _Nothing yet._

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
