# 0006 — Suno AI stem BPM lock and drift quantizer

- **Status:** Proposed
- **Date:** 2026-09-28

## Context

Generative AI music models (such as Suno AI and Udio) synthesize full songs and multi-track stems in the latent audio domain without an internal digital audio clock or rigid MIDI grid. While the generated music sounds coherent to human ears, the actual audio exhibits continuous **cumulative tempo drift** and micro-timing elasticity.

For example, a generation prompted for 120 BPM might begin at 119.7 BPM, drift to 121.4 BPM by bar 16, slow down in the chorus to 120.2 BPM, and continuously fluctuate across sections.

When music producers download these stems and import them into digital audio workstations (Ableton Live, Logic Pro, FL Studio, Bitwig, Pro Tools, Studio One):
1. **Grid Disconnect:** The stems do not align with the DAW project metronome or bar/beat grid. Looping sections, adding quantized drum machines, or sequencing virtual instruments is impossible without extensive manual correction.
2. **Tedious Manual Warping:** Producers currently have to place dozens or hundreds of manual warp markers / transient stretch markers across every stem.
3. **Phase & Groove Smearing:** If stems are warped independently (or with automated single-track warping), micro-timing variations between stems cause severe flamming, phase cancellation, and groove dissociation between drums, bass, and vocals.

DAW Buddy already contains stem categorization (`Smart Renamer`), offline audio analysis workers, onset detection algorithms, and non-destructive audio file processors (`AudioJobService`, Proposal 0005). What is missing is an automated stem quantizer that locks drifting AI stems to a fixed, reliable project tempo.

## Decision

Introduce a specialized offline processing tool in DAW Buddy: **Suno Stem BPM Lock & Drift Quantizer** (accessible via Tools tab and drag-and-drop workflow).

### 1. Multi-Stem Batch Ingestion & Role Classification
- The user drops a folder containing the Suno stems (e.g. `drums.wav`, `bass.wav`, `vocals.wav`, `other.wav`) or selects them from an existing project folder.
- DAW Buddy scans and groups the files as a stem cluster.
- Using DAW Buddy's stem classifier, the **drum / percussion** stem is identified automatically and designated as the **Timing Master**. (If no drums exist, the user can manually pick a rhythmically prominent stem such as bass or rhythm guitar).

### 2. Anchor BPM Detection (Bars 1–16)
- The tool analyzes the drum stem's transient onsets across the first 8 to 16 bars using spectral flux and energy envelope tracking.
- It calculates the primary intended base tempo (e.g. `124.0 BPM`), snapping to the nearest integer BPM or offering the user the option to match the active DAW Buddy project BPM.
- The user can adjust or confirm the target anchor tempo.

### 3. Drift Tracking & Master Warp Map Generation
- Once the anchor tempo and bar 1 downbeat are identified, the analyzer projects an ideal, rigid metronomic grid across the duration of the track.
- The drum stem's actual transient peaks (kick, snare, hi-hats, downbeats) are tracked against this ideal grid.
- The engine calculates the timing offset ($\Delta t$) at each bar and beat, generating a continuous **Warp Curve / Drift Map**.
- Outlier filtering (moving-median filter and transient confidence scoring) prevents drum fills, ghost notes, or swing grooves from creating unnatural jitter in the drift curve.

### 4. Phase-Locked Multi-Stem Quantization & Time-Stretching Algorithm
The engine applies the master warp curve simultaneously across **all sibling stems** (vocals, bass, melody, guitars, synths, FX). Because every stem is stretched and compressed using the exact same continuous warp function:
- Relative groove and timing between instruments remain 100% natural and synchronized.
- Inter-stem phase cancellation and transient flamming between drums, bass, and vocals are eliminated.

#### Time-Scale Modification (TSM) Algorithm Selection
To ensure the audio stretches naturally without changing pitch or introducing robotic phase flanging, the engine employs a **Dual-Mode Hybrid Architecture** using free, permissively-licensed DSP algorithms:

```
                       ┌─── Drum Stem ──────────► [Transient Slicing / WSOLA]
                       │                           (Attacks preserved, zero phase smearing)
Master Drift Curve ────┼─── Bass Stem ──────────► [WSOLA / Signalsmith Stretch]
(from Drums)           │                           (Tight low-end punch)
                       └─── Vocals & Melodic ───► [Signalsmith Stretch (WASM)]
                                                   (Natural formants, no robotic vibrato)
```

1. **Drum / Percussive Stems: Transient Slicing & WSOLA (Waveform Similarity Overlap-Add)**
   - Operates entirely in the time domain using normalized cross-correlation at zero-crossings.
   - For drum transients (kicks, snares, hats), time-domain slicing and relocation preserves the attack envelope 100% intact with **zero FFT smearing** (avoiding the classic "soft woosh" artifact of traditional phase vocoders).
   - Only the decay/ambient tail between transient hits is micro-stretched or cross-faded.
   - Free, open-source, and implemented in pure TypeScript or compiled via SoundTouch (LGPL/MIT).

2. **Vocal, Bass & Harmonic Stems: Signalsmith Stretch (0BSD / MIT)**
   - Uses **Signalsmith Stretch** (by Geraint Luff), a state-of-the-art open-source pitch-invariant time-stretching engine.
   - Algorithm: A multi-resolution sub-band phase vocoder specifically designed to eliminate the metallic phase flanging and unnatural vibrato warble typical of older phase vocoders.
   - Formants and pitch remain completely unaltered, preserving vocal warmth and natural breath.
   - Polyphonic instruments (guitars, keyboards, lush pads) stretch smoothly without chorus artifacts.
   - **Permissive 0BSD License:** Completely free for open-source and commercial use with zero copyleft restrictions (unlike GPL-licensed Rubber Band), keeping DAW Buddy cleanly MIT-compliant.
   - **Zero-Dependency WebAssembly (WASM):** Header-only C++ compiled to a compact WebAssembly module; runs in Node/Electron background workers at near-native C++ performance with no external binary or ffmpeg installation required.

### 5. Safe Export & DAW Integration
- **Strict Non-Destructive Invariant:** Original source stems are never touched or modified.
- Quantized stems are rendered into a dedicated output folder (e.g. `BpmLocked_Stems/` or `<project>_BpmLocked_<bpm>/`) with a clear naming convention (`drums_quantized_124bpm.wav`).
- **Ableton `.asd` Warp File Option:** Generates accompanying Ableton Live `.asd` files containing the warp markers, allowing Ableton users to use the stems in Complex Pro warp mode without rendering new audio files if preferred.
- **Background Execution:** The operation runs as an isolated background job through Proposal 0005's `AudioJobService`, reporting progress per stem and supporting clean cancellation.

## Consequences

### Positive
- Converts drifting, unusable AI stems into production-grade, tempo-locked audio tracks ready for instant arrangement and mixing in any DAW.
- Eliminates hours of manual warp-marker editing for producers working with Suno, Udio, or other generative audio tools.
- Preserves inter-stem groove and phase integrity by utilizing a single master timing curve derived from the drum track.
- Expands DAW Buddy's tool suite with a high-value, modern workflow solution tailored to contemporary production workflows.

### Costs & Constraints
- High-fidelity time-stretching on 4–8 simultaneous multi-minute stems is CPU-intensive; must run in chunked worker threads with bounded concurrency and progress reporting.
- Songs with intentional tempo changes (e.g. half-time breakdowns, rubato intros, tempo transitions) require section-boundary detection or user region markers to avoid forcing rubato passages onto a rigid grid.
- Must handle edge cases: tracks with no drums (fallback to bass/comping chord onsets), variable drum intros, or non-4/4 time signatures.

### Test Requirements
- Regression test on synthetic drifting audio: generate a drum pattern that linearly accelerates by +2% over 32 bars, verify drift curve extraction and successful lock to target BPM within $\pm 1$ ms tolerance.
- Multi-stem phase test: verify that two identical tracks with inverted phase cancel out after synchronized quantization.
- Safety and path validation: ensure outputs land inside approved directories and never overwrite source files.
