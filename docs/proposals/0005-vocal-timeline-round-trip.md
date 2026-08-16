# 0005 — Vocal timeline round trip

- **Status:** Accepted for the next build
- **Date:** 2026-08-16
- **Priority:** First new feature after the Matches UI repair

## Context

Long studio vocals are often sent through an external speech-to-speech or
voice-conversion service. Uploading minutes of silence wastes time and quota,
so the useful phrases should be exported separately. The difficult part is
putting the returned phrases back at their exact original positions without
manually finding every line on the DAW timeline.

This is not a conventional two-take alignment tool. It is a non-destructive
round trip:

1. split one reference recording into active vocal blocks;
2. process those blocks outside DAW Buddy;
3. reconstruct a new continuous track from the saved timeline.

## Decision

Add a standalone sidebar tool provisionally named **Vocal reconstruction**.
Clicking it opens a separate DAW Buddy tool window with two clearly separated
steps: **Split vocal** and **Rebuild timeline**. The main DAW Buddy window must
remain responsive and fully usable while this tool is open or processing. No
external AI account or upload API is part of the initial feature.

Long analysis and export work must run outside the renderer thread and report
progress to the pop-out window. Closing the pop-out should offer to cancel or
leave an active job running; it must not quit or freeze the main application.

### Phase 1 — split vocal

- Start with WAV input for predictable, sample-accurate output. Other formats
  may be added after the WAV workflow is proven.
- Let the user set minimum silence length, silence threshold in dBFS and a
  small keep-padding value around each phrase.
- Analyse first and show the detected phrases and gaps before writing anything.
- Create a new sibling output folder unique to the source name; never modify,
  move or replace the source recording.
- Export stable, ordered filenames such as `0001.wav`, `0002.wav`, etc. These
  identifiers must survive external processing even if display labels change.
- Write a versioned JSON manifest beside the blocks. Store positions as integer
  sample frames—not rounded milliseconds—including:
  - source filename, duration, sample rate, channels and bit depth;
  - every active block's ID, original start/end frame and exported filename;
  - every removed gap's start/end frame and length;
  - leading and trailing silence;
  - file hashes needed to detect accidental replacement or stale manifests.

### Phase 2 — rebuild timeline

- The user selects the manifest and the folder containing externally processed
  blocks with the same stable IDs.
- Validate missing, duplicate and unexpected blocks before reconstruction.
- Validate sample rate, channels and duration; convert format only through an
  explicit previewed option.
- Place each processed block at its original absolute start frame and recreate
  the saved silence with exact zero-valued PCM frames.
- Write a new unified WAV beside the job output. Never overwrite the original
  vocal, exported blocks or externally processed files.
- Produce a reconstruction report describing every accepted block, warning and
  timing mismatch.

### Duration mismatch policy

External conversion can change vowels, breaths and phrase duration. Therefore,
reinserting the old gaps is not by itself enough to promise 1:1 timing.

The initial rebuild uses a **strict** policy:

- blocks within a small configurable tolerance are placed at their saved start;
- shorter blocks leave silence until the next original block position;
- a block that would run into the next block is flagged before export;
- DAW Buddy does not silently time-stretch, truncate or overlap speech.

The user can reconstruct all safe blocks and receive a list of blocks requiring
alignment. Automatic stretching is deferred until its audio-quality policy and
preview are designed.

## Future phase — waveform alignment

Add an editor for mismatched blocks with the original reference and converted
audio shown as side-by-side or overlaid waveforms/envelopes. It should support:

- zooming to one phrase while retaining its absolute timeline position;
- draggable start/end anchors and internal pin points;
- auditioning original, converted and overlay states;
- optional local stretch between pins rather than stretching the whole phrase;
- visible stretch percentage and a reset action;
- preview-first export to a new file with the manifest updated as a new
  revision, never rewritten invisibly.

The architecture should keep silence detection, manifest IO, reconstruction
and future alignment as separate modules. DAW Buddy is already an Electron and
TypeScript application, so a separate Python application is not required for
Phase 1. A Python worker may be evaluated later only if a proven DSP library
materially improves stretching or alignment enough to justify packaging a
second runtime.

## Safety and edge cases

- All-silence and no-silence recordings must produce clear previews, not empty
  or misleading jobs.
- Leading/trailing silence, stereo files, different sample rates, tiny phrases,
  rerunning a job, cancelled writes and moved job folders need coverage.
- Manifest paths should be portable relative paths where possible.
- Output creation must be atomic; interrupted reconstruction must not leave a
  final-looking corrupt WAV.
- Threshold changes invalidate the previous preview.
- Processed blocks are untrusted input: enforce file-count, duration and size
  limits and reject malformed audio without crashing the app.

## Acceptance criteria

1. A synthetic reference with known phrases and gaps splits into the expected
   frame ranges.
2. Unchanged exported blocks rebuild to the original length with phrase starts
   at the exact original sample frames.
3. Missing/extra blocks and duration collisions are reported before writing.
4. Originals remain byte-for-byte unchanged through split and rebuild.
5. The UI makes the two-step workflow understandable without requiring the
   user to read or edit JSON.
6. The tool runs in its own window, and the main DAW Buddy window remains
   usable throughout analysis and reconstruction.

## Consequences

- The manifest becomes a small edit-decision format and needs explicit version
  handling from its first release.
- WAV-first limits convenience initially but makes the timing promise honest.
- Exact placement is deterministic; creative alignment remains a visible,
  reversible future operation instead of hidden DSP.
