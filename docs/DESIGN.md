# Design System: DAW Buddy (Studio Companion)

> **Active Theme:** Meadow-Glass Ledger (Pro-Audio Adaptation of Wise Design System)  
> **Source Reference:** [wise-design.md](file:///C:/Users/hpkal/Downloads/wise-design.md)  
> **Stitch Screen:** `DAW Buddy — Desktop Audio Companion (Meadow-Glass Ledger)` (`cf42a69e90024892a09d01cd260f6313`) in Project `6373947903837220850`  
> **Local Assets:** [.stitch/designs/meadow_glass_ledger_screen.png](file:///c:/Users/hpkal/Documents/Codebases/daw_buddy-main/.stitch/designs/meadow_glass_ledger_screen.png) | [.stitch/designs/meadow_glass_ledger_screen.html](file:///c:/Users/hpkal/Documents/Codebases/daw_buddy-main/.stitch/designs/meadow_glass_ledger_screen.html)

---

## 1. Visual Theme & Atmosphere
- **Atmosphere:** High-precision architectural ledger companion. Sits flush beside heavyweight DAWs (Ableton Live, FL Studio, Logic Pro, Pro Tools, Cubase, Bitwig). It is a surgical studio ledger, not a consumer streaming app or AI toy.
- **Density:** Cockpit Dense (8.5/10). Dense, scannable technical metadata without optical claustrophobia. Zero dead whitespace, zero decorative fluff.
- **Structure:** 0px flat modular ledger tables and panels bound by crisp 1px hairline dividers (`#23331b`). Zero blurry AI drop shadows.
- **Motion:** Snappy Hardware Spring Physics (0.35s decelerated cubic-bezier curves for settles, instant 0.15s for toggles). Hardware-accelerated transforms only.

---

## 2. Color Palette & Roles ("Meadow-Glass Ledger")

### Studio Canvas & Chassis Hierarchy
- **Canvas Base Void (`#0c120a` / `#081006`)** — Deep studio obsidian; completely eliminates eye strain in low-light mixing rooms.
- **Chassis Surface Baseline (`#111a0e`)** — Primary panel baseline and sidebar deck.
- **Surface Elevation Low (`#151e12` / `#0e160b`)** — Base rack chassis and fader well floor.
- **Surface Elevation High (`#232d1f` / `#192415`)** — Hovered trays and selected stem ledger rows.
- **Interactive Container (`#2e372a`)** — Modal frames and elevated parameter blocks.
- **Structural Hairline (`#23331b` / `#1f2d18`)** — 1px razor-sharp boundary lines between functional decks.

### Functional Accents & Signals
- **Electric Lime (`#9FE870`)** — Primary hero event color, affirmative CTA buttons, active chord keycaps, peak meter tracking, and live sync diode.
- **Deep Forest (`#163300`)** — High-authority contrast backing, harmonic advisor warnings, and inverted container text.
- **Signal Routing Cyan (`#0097C7`)** — Sidechain patching, MIDI routing, and active loop markers.
- **Safety Amber (`#F59E0B`)** — Buffer alerts, phase warnings, and non-destructive notices.
- **Peak Red (`#EF4444`)** — Hard clipping (+0.0 dBTP overs) and record-arm destructive alerts.

### Typography Neutrals
- **High-Contrast Pure White (`#FFFFFF`)** — Primary headlines, active track names, and crisp silkscreen markings.
- **Light Mint Gray (`#DBE6D2` / `#E6EDF3`)** — Secondary headings and readable body text.
- **Muted Herb / Slate (`#8B9481` / `#6A6C6A`)** — Parameter labels, file paths, extensions, and inactive status indicators.

---

## 3. Typographic Architecture

- **Condensed Display Headlines:** `Wise Sans` / `Anton` / `Archivo Black` at 900 weight with tight `0.85` line-height for track titles, BPM displays, and section headers. High-impact architectural silhouette that does not waste vertical viewport height.
- **System Interface & Labels:** `Inter` (11px–15px) for general UI labels, navigation buttons, descriptions, and inspector text.
- **Musical & Quantitative Telemetry:** `JetBrains Mono` (tabular numbers) mandatory for:
  - BPM numbers (`124.00 BPM`)
  - Camelot & Musical Keys (`8A / A MIN`)
  - Meter & Time Signatures (`4/4`, `7/8`)
  - Loudness & dB readouts (`-14.2 LUFS`, `+2.1 dB True Peak`)
  - Sample Frequencies & Timecodes (`48.0 kHz`, `01:24:16:04`)

---

## 4. Components & Radii Discipline

### Geometric Contract: 0px Flat vs 9999px Pills
- **Containers, Rows & Tables:** **`0px` corner radius**. All channel strips, stem tables, waveform frames, and inspector boxes are completely flat and rectangular to maintain pixel grid precision.
- **Interactive Controls:** **`9999px` full-pill capsules**. Every button, chip, badge, and toggle switch is a rounded capsule. This immediately distinguishes actionable controls from structural surfaces.

### Button Hierarchy
1. **Primary Hero Pill (`#9FE870`):** Solid electric lime background, `#163300` bold text, `9999px` radius, 32px or 40px height. Used for the single primary action on screen (e.g., `SEND HARMONY TO DAW TRACK`).
2. **Glass Utility Pill (`rgba(255, 255, 255, 0.08)`):** Translucent fill, 1px `rgba(255, 255, 255, 0.14)` border, `#DBE6D2` text, `9999px` radius. Used for secondary actions (e.g., `CAPTURE MIDI`, `DRAG TO DAW`, `AUDITION FIX`).
3. **Deep Forest Nav Pill (`#163300`):** Dark forest background, `#9FE870` text, 1px `#163300` border, `9999px` radius.

### Audio Ledger Stems (Lists)
- Flush `0px` rows, 28px–32px height, alternating between `#151e12` and `#111a0e`, separated by 1px `#23331b` borders.
- Each row contains: channel index, track name, format badge (`MIDI`, `WAV 24b`), real-time mini peak bar, LUFS readout, and a tactile `Drag to DAW` glass pill.
- Pinned drag-and-drop zone at the bottom styled with `1.5px dashed #23331b` border.

### Precision Visualizers
- **Piano Ribbon:** Sleek 2-octave keyboard with ivory naturals and dark accidentals, featuring electric lime dot indicators and root pitch markers.
- **Spectrum & Correlation:** Surgical 1/3-octave frequency profile with lime peak trace curve and `+1.0` to `-1.0` mono-safe phase correlation meter.
- **Docked Transport Bar (Bottom 44px):** Fixed strip with active stem name, monospace SMPTE timecode, seekable playhead, and tactile `Play`, `Stop`, `Rec` controls.

---

## 5. Anti-Patterns (Strictly Banned)

- ❌ No emojis anywhere in the interface.
- ❌ No AI purple/magenta neon glows or blurry ambient drop shadows.
- ❌ No rounded cards-in-cards (boxes-inside-boxes).
- ❌ No muddy or swampy greens — strictly Electric Lime `#9FE870` and deep obsidian `#0c120a`.
- ❌ No consumer music streaming widgets (no artist social follow buttons, album art carousels, or public playlists).
- ❌ No destructive actions without clear staging and preview manifests.
