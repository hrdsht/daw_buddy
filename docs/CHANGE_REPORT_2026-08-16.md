# DAW Buddy change report — 2026-08-16

## Audience and purpose

This is a handoff for `shreyasbhat0`. It describes the changes made after
`main` reached `cf78c4c`, the user-facing reasons for them, how they were
implemented, what was validated, and which discussed features are still
missing.

## Summary

This change set adds a standalone Bulk renamer, makes version grouping
unambiguous in the sidebar, automatically analyses the newest matching render
for musical key and tempo, adds bounded Disk insights, provides safe WAV
normalization/musical trimming, and extends silence removal to the beginning,
end or both sides. It also adds a persistent project catalogue for fast startup
and fixes the drone using a stale project's key. Audio analysis runs in a Web
Worker so it does not block playback or the renderer UI. A root-level Windows
launcher is also retained.

## User-facing changes

### 1. Standalone Bulk renamer

- Added **Bulk renamer** to the left sidebar beside Sample cleanup, ID3 editor,
  and Strip silence.
- Reuses the existing safe renamer, preview, collision checking and undo flow.
- Starts without a project context and asks the user to choose a folder.
- The project Tools version remains available and still supplies project BPM,
  key and project-name template values.
- Standalone template tokens use sensible fallbacks when there is no selected
  DAW project.

Files: `src/renderer/index.html`, `src/renderer/app.ts`.

### 2. Version grouping controls restored and clarified

The grouping engine in `src/main/lib/versions.ts` was still working. The UI
problem was a self-renaming toggle: when grouping was switched off, the
"Grouping versions" row renamed itself to "Every file". That made the grouping
feature appear to have disappeared.

The sidebar now permanently exposes two explicit modes:

- **Grouping versions** — one expandable row for related numbered/bounced
  versions in the same folder.
- **Every file** — every DAW session file as an individual row.

Grouping remains the default. A regression test uses the real Nava Bharat Jodo
naming pattern to ensure four numbered/bounced files collapse into one project
with four versions.

Files: `src/renderer/app.ts`, `test/regression.js`.

### 3. Play now triggers automatic key and BPM analysis

Clicking Play in the main project list now performs this sequence:

1. Find the newest matching render using the existing render matcher.
2. Read and decode the audio once through `Player.load()`.
3. Start playback immediately.
4. Copy the decoded mono channel to `analysis-worker.js`.
5. Estimate tempo and key in the worker using the existing DSP module.
6. Save `key`, `camelot`, confidence values, `detectedBpm`, and source filename
   in the existing project record.
7. Refresh the project row and show a result toast.

While analysis is running, an empty key cell displays **Analysing…** and an
empty BPM cell displays an ellipsis. Concurrent requests for the same audio
path share one analysis promise, preventing duplicate heavy jobs.

The DAW project's parsed BPM remains authoritative when available. The detected
audio BPM is used as a fallback when the DAW file has no readable tempo. That
fallback is also used for BPM sorting, structured BPM search, project headers,
renamer tokens and cross-project Matches.

Files: `src/renderer/app.ts`, `src/renderer/analysis-worker.ts`, `package.json`.

### 4. Audio-analysis execution model

`DSP.analyse()` still examines at most 60 seconds from the middle of the audio.
It does not currently scan the whole song or identify section changes.

- Tempo: spectral-flux onset envelope followed by autocorrelation, folded into
  the 90–180 BPM range to reduce half/double-time errors.
- Key: FFT chroma accumulation across 12 pitch classes, correlated against
  major/minor Krumhansl-Kessler profiles, then mapped to Camelot notation.
- Key is an informed estimate. Dense mixes, tuning ambiguity and relative
  major/minor relationships can lower reliability.

Moving the calculation to a worker keeps the Electron renderer responsive. It
does require one `Float32Array` copy of the decoded first channel per analysis.

### 5. Windows launch convenience

The repository's main launcher lives at `scripts/DAW Buddy.bat`. A tiny
root-level `DAW Buddy.bat` forwards to it so the user can continue launching
the app from the folder root exactly as before.

`npm start` now uses `scripts/launch.js`. A missing or stale `dist` build is
compiled automatically; an unchanged daily launch starts Electron directly.
`npm run start:dev` retains the explicit build-then-launch development flow.

### 6. Disk insights

- Read-only sidebar tool ranking indexed project folders and
  `Samples/Imported` folders by size.
- Reports progress, supports cancellation, skips links/junctions and stops at
  a visible 250,000-file safety limit.

Files: `src/main/lib/disk.ts`, main/preload IPC, renderer Disk view.

### 7. Audio finishing

- Standalone WAV tool for peak normalization and optional BPM/bar-length
  trimming.
- Caps extreme boosts at +24 dB, never pads or stretches short files, writes
  atomic ` - finished.wav` copies below the output folder and preserves the
  source.

Files: `src/main/lib/finisher.ts`, main/preload IPC, renderer Audio finishing view.

### 8. Beginning/end silence removal

- Strip silence now offers Beginning, End and Both modes.
- Uses the existing Peak/RMS threshold logic and retains configurable safety
  padding on both sides to protect attacks and decays.
- Preview reports beginning and ending removals separately; processing still
  writes safe copies only.

Files: `src/main/lib/silence.ts`, renderer Strip silence view.

### 9. Fast startup catalogue

- The existing parse cache still protects BPM extraction by path, modified
  time, size and parser version.
- A separate `project-index.json` stores the last complete project catalogue.
- The first launch or a changed roots/ignore configuration performs the full
  scan before showing the list and then creates the index.
- Later launches return the saved catalogue immediately, verify the folders in
  the background and send the refreshed list to the renderer when complete.
- Truncated or errored scans never replace the last-known-good catalogue.

Files: `src/main/lib/projectindex.ts`, main/preload project update IPC,
renderer startup handling.

### 10. Drone follows the playing project

The list Play button stops its click from bubbling into the row, so the old
highlighted project could remain selected after new audio began playing. The
analyser stored the correct new key, but the drone read the old selection.
Playback now records its project context explicitly, and the drone resolves
that context before any older selection. Flat key spellings are normalized for
the oscillator as well.

Files: `src/renderer/drone.ts`, `src/renderer/app.ts`.

## Validation

The following were run successfully from the installed repository:

- `npm run typecheck`
- `npm test`
- `npm run build`
- `git diff --check`

The suite currently reports 38 passing checks. New coverage includes:

- the Nava Bharat Jodo version-grouping regression;
- a deterministic synthetic A-minor track with 120-BPM pulses, expected to
  return `A min`, Camelot `8A`, and a tempo within 115–125 BPM.
- disk ranking and hard-budget truncation;
- normalization plus exact musical trimming while preserving the source;
- short-audio no-padding protection;
- beginning/end and beginning-only silence removal.
- persistent project-catalogue restore and settings invalidation;
- playing-project drone priority over a stale selected project, plus flat-key
  normalization.

The renderer build now emits three bundles:

- `app.js`
- `splash.js`
- `analysis-worker.js`

## Remaining discussed backlog

### High-value product work

1. **Multi-section key/BPM and beat-switch detection**
   Analyse beginning, middle and end independently; report stable tracks or
   transitions such as `A min → C min` and `120 → 140 BPM`. This is the natural
   extension of the worker added here.
2. **Waveform drag-to-trim**
   Select a region or drag start/end handles, preview it and write a safe copy.
   The waveform and WAV writer already exist, but the interaction and format
   policy need design and manual testing.
3. **Dual-pane sample comparison**
   Side-by-side Keep/Reject or source/destination folders with safe file moves,
   undo and collision handling.
4. **This-week dashboard**
   Recently modified projects, newest bounces and unfinished notes. Most source
   data already exists.

### KSHMR-inspired workflow features not yet built

- Compact system-tray / menu-bar player synchronized with the main window.
- Separate always-on-top pop-out notes window.
- Asterisk notes parsed from filenames and displayed as clean annotations.
- AI/contextual descriptive sample naming with selectable alternatives.
- Missing-sample / cloud-sync detection for Ableton-style project folders.
- Producer time-zone/collaboration scheduler.
- DAW auto-bounce and quick-save automation/macros.

### Engineering foundation

- Split the still-large `src/renderer/app.ts` into list, project, tools,
  settings and analysis controllers.
- Add Electron renderer smoke tests for sidebar navigation, list Play, worker
  completion and record refresh.
- Decide whether audio analysis should be cached against file path + modified
  time so unchanged renders are not recomputed on later Play clicks.
- Add cancellation/staleness rules if the user rapidly starts different
  analyses for the same project row.

## Explicitly excluded

**Email broadcasting is not wanted by the user.** Do not add SMTP credentials,
SendGrid, Nodemailer or automatic email delivery. The existing optional
Discord/Slack/Zapier webhook is the accepted lightweight notification route
and remains opt-in.

## Suggested next order

1. Multi-section analysis/beat-switch reporting.
2. Renderer smoke test around Play → worker → saved result.
3. This-week dashboard (smallest user-facing win).
4. Waveform trimming, then dual-pane comparison.
