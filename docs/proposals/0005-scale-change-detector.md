# 0005 — Musical Scale Change & Key Modulation Detector

- **Status:** Proposed
- **Date:** 2026-08-20
- **Priority:** Next Core Audio/DSP Innovation

---

## Context

Many songs do not stay in a single static key from start to finish:
- **Pop, EDM & Rock:** Truck driver's gear-shift modulation (e.g. +1 or +2 semitone lift into the final chorus/drop), verse-to-chorus relative major/minor key shifts.
- **Film & Game Soundtracks:** Dynamic mood shifts, cinematic transitions, modal interchange, and chromatic mediants.
- **Indian Classical & Fusion (Ragamalika):** Compositions that seamlessly transition between multiple Raagas across different sections of a track.

Currently, DAW Buddy analyses a representative audio window to determine the global tonic, scale, and Camelot code. However, producers, DJs, and arrangers need to identify **where, when, and to what scale an audio track modulates**, without manually scrub-auditioning the entire arrangement.

---

## Decision

Implement a **Timeline Scale & Modulation Analyzer** in the DSP engine and display it dynamically in the project window:

### 1. Sliding-Window Chroma & Modulation Segmentation (`dsp.ts`)
- Segment audio into time-windowed frames (e.g. 4-bar / 8-bar windows or energy-informed musical sections).
- Compute localized pitch-class chroma vectors for each window.
- Detect persistent tonal center shifts vs transient accidentals using confidence thresholds:
  - Identify **transition timestamp (start & duration in seconds)**.
  - Determine **source scale/key** (e.g., `C Minor / 5A`) and **target scale/key** (e.g., `D Minor / 7A` or `Eb Major / 5B`).
  - Calculate **modulation type** (e.g., *Direct Half-Step / Whole-Step Lift*, *Relative Major/Minor Modulation*, *Parallel Mode Switch*, *Raga Transition*).

### 2. Conditional Project Window UI (Zero Clutter)
- **Strict Visibility Rule:** The Scale Changes / Modulation section is **displayed in the project window ONLY when scale changes are actually detected**.
- Single-key tracks remain clean and uncluttered.

### 3. Visual Waveform Overlay
- When modulations are detected:
  - Render color-coded section overlays directly on the project audio waveform canvas.
  - Display clear visual transition pins/markers with timestamp labels (e.g. `🚩 02:14 · Key Change to D Min (7A)`).
  - Clicking any transition pin seeks and auditions playback immediately at the modulation point.

### 4. Modulation Details Panel
- Displays an interactive timeline:
  - **Section Badges:** `[ 00:00 – 01:45 · C Minor (5A) ] ➔ [ 01:45 – 03:30 · D Minor (7A) (+2 st lift) ]`
  - **Camelot Shift Indicator:** Highlights the wheel step (e.g. `5A ➔ 7A (+2 steps)`).
  - **Scale Degree Comparison:** Shows which notes changed during the modulation.
  - **Scale Export:** One-click drag of the new modulated scale's MIDI into the DAW.

---

## Acceptance Criteria

1. **Accuracy:** Successfully identifies classic gear-shift key changes (+1/+2 st), relative major/minor shifts, and modal/raga changes across test audio files.
2. **Conditional Rendering:** If no modulation is detected in the audio file, the UI remains identical to the standard project view with zero extra visual noise.
3. **Interactive Waveform:** Markers on the waveform canvas correspond to exact audio playback timestamps and support click-to-seek auditioning.
4. **Performance:** Windowed analysis runs efficiently inside the background analysis worker without blocking UI responsiveness.

---

## Consequences

- Gives producers and DJs instantaneous visibility into complex song arrangements and key changes.
- Eliminates harmonic mismatches when mixing or dropping vocal/synth layers over modulated sections.
