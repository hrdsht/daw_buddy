# 0004 — Feature roadmap

- **Status:** Accepted
- **Date:** 2026-08-16

## Context

DAW Buddy already understands each project's tempo, key, versions, renders and
backups across the whole drive. The biggest untapped leverage is turning that
understanding into **fast retrieval and auditioning** — the real pain for a
producer with hundreds of projects is finding the right idea in seconds, not
tidying. This roadmap orders the backlog (much of it from `../BUILD_NOTES.md`)
by value per unit of effort. Individual features may split out into their own
numbered proposals as they're built.

## Foundation (do first)

The renderer has **no tests** and `app.ts` is one ~2700-line file
([0002](0002-renderer-module-split.md)). Split it into modules and add a couple
of renderer smoke tests before piling on features, so each new feature lands on
something verifiable.

## Status audit (2026-08-16)

A read of the code shows **most of Tiers 1–2 already exist** — the roadmap
over-proposed. Version grouping (`versions.ts` + the grouping toggle), the DAW
sidebar filters, the harmonic drone (`Player.startDrone`), and the off-grid +
too-quiet scanners (`audioqc.ts` + the QC tab) are all built. Structured search
was added this session (`search.ts`, tested). **The remaining real work is
Tier 3 onward** — those features below are marked with their true status.

## Immediate priority — repair the Matches view

The **Matches** tab is currently a release-blocking UI defect and comes before
new feature work. Match results are rendering as extremely narrow white cards
against the dark interface, forcing paths and labels to wrap one word at a
time. The result is visually inconsistent and largely unreadable.

Required outcome:

- use the same dark panel/card surfaces and semantic theme colours as the rest
  of the app—no hard-coded white result backgrounds;
- render each match as a normal full-width row or a responsive multi-column
  card with a sensible minimum width;
- keep project name, key, BPM, location and match reason visually distinct;
- truncate long locations on one line with the full path available on hover;
- retain readable text/background contrast in Dark, Light and future AMOLED
  modes;
- verify at the app's minimum window width and at the user's usual maximized
  desktop size.

Do not proceed to the theme selector or the next reference-workflow feature
until this view has been manually checked in the running app.

## Next build — vocal timeline round trip

After repairing the Matches layout, the first new feature is the accepted
**Vocal timeline round trip** proposal ([0005](0005-vocal-timeline-round-trip.md)).
It splits a long vocal into active phrases, records every original position in
a sample-accurate manifest, and rebuilds externally converted phrases onto the
original timeline without touching any source file.

The initial build is WAV-first and strict about timing mismatches. Visual
waveform overlay, pinning and time-stretching are a later phase; the first
version must report drift rather than silently damaging or overlapping speech.

## Reference feature audit

This is the complete remaining gap collected from the reference workflow
supplied by the user. It deliberately separates **missing** features from
features that were missing when the first notes were written but have since
shipped. A working engine with no reachable interface does not count as done.

### Still missing from the reference workflow

| Feature | What DAW Buddy should eventually do | Priority / constraints |
|---|---|---|
| **Interactive waveform trimmer** | Show draggable start/end handles on the waveform, audition only the chosen region and export a safe copy. | High value, medium/large UI work. Never overwrite the source. |
| **Asterisk filename notes** | Parse text such as `Kick 01 *clips at 2s*.wav` into a clean note, and let the user add/edit/remove that note through the renamer. | Medium. Preserve compatibility with ordinary filenames and preview every rename. |
| **AI contextual descriptive naming** | Suggest useful names such as Granite, Avalanche or Nordic and allow cycling through alternatives before applying them. | Later. Requires a model/provider decision; a fixed adjective list must not be presented as AI. |
| **Dual-pane comparison** | Open two folders side by side and move samples into Keep/Reject or source/destination groups. | High-risk file operation. Requires preview, collision handling, undo and recoverable moves. |
| **Compact tray / menu-bar player** | Collapse into a small tray window whose current track, waveform and playback state stay synchronized with the full app. | Medium. Electron Tray plus shared player state. |
| **Always-on-top notes pop-out** | Open project notes in a small independent window that can float above the DAW. | Medium. Reuse the existing notes store; avoid two windows overwriting each other. |
| **Full project sorting dashboard** | Sort by modified date, BPM, favourites, unresolved notes/to-dos and other useful project facts. | Partial today: search, favourites and DAW filters exist; a clear multi-sort UI does not. |
| **Missing-sample / cloud-sync detection** | Warn when an Ableton-style project references unavailable, placeholder or not-yet-synced media. | Later. Detection comes first; automatic cloud actions need a separately approved design. |
| **Producer time-zone scheduler** | Compare collaborator time zones and show practical overlap windows. | Later. Useful for collaboration but outside the core local project browser. |
| **DAW auto-bounce and quick-save macros** | Help select loop regions, export stems and pass paths into DAW save dialogs. | Later/high risk. DAW-specific automation must be opt-in and tested per DAW/version. |

### Reference items now covered

| Reference capability | DAW Buddy status |
|---|---|
| Project browser, session BPM, backup/health count, favourites, render preview and DAW/Finder launch | **Done** across multiple DAWs. |
| Persistent project notes | **Done**; only the separate floating notes window remains. |
| Bounce watcher | **Done**. Opt-in Discord/Slack/Zapier webhook replaces email delivery. |
| Template renaming tokens | **Done** and reachable from Bulk renamer. |
| Harmonic reference drone | **Done** in the player. |
| Audition reverb and soft clipper | **Done** in the player. Reverb has persistent right-click controls for decay, size, pre-delay, low/high cut and wet/dry mix. |
| Peak normalization and BPM/bar-length trimming | **Done** in Audio finishing; creates copies. |
| Deep subfolder / all-audio view | **Done** in the project view. |
| Start/end silence, too-quiet and off-grid scanners | **Done**. |
| Duplicate sample checker | **Done** through Sample cleanup. |
| Batch ID3 cleanup | **Done** and expanded into an ID3 editor for bulk add/remove. |

**Explicit exclusion: bounce email.** The user does not want email delivery.
Do not add SMTP credentials, SendGrid or Nodemailer. The existing opt-in
webhook is the accepted lightweight notification route.

## Theme selector

Theme choice should become a small, understandable visual preference—not a
complex design editor.

### Phase 1 — preset colour picker

Replace the single Light/Dark toggle with a popover or Settings card containing:

- **Accent swatches:** Green (current/default), Blue, Yellow, Amber and Red.
  Each should use the same restrained saturation and state hierarchy as the
  current green: bright for primary actions and analysis results, softer for
  hover/selection, and muted for borders or secondary metadata.
- **Surface modes:** Dark, Light and **AMOLED**. AMOLED uses true `#000000` for
  the window and major panels, while retaining the chosen accent colour.
- A compact live preview and a clear **Reset to default** action.
- Local persistence so the app remembers the choice after restart.

Implementation should separate semantic colour tokens (`accent`,
`accent-hover`, `background`, `panel`, `text`, `muted`, `danger`) from component
CSS. Selection, focus, waveform progress, badges and charts must all remain
legible. Yellow and amber in particular need dark foreground text on bright
buttons. Theme changes must not alter the meaning of warnings or destructive
actions.

### Phase 2 — custom colour (optional)

After the presets are stable, a full colour picker may accept a custom accent
and derive accessible hover/muted variants. This is optional: the five curated
accents plus AMOLED cover the initial request with fewer ways to create an
unreadable interface.

## Tier 1 — Make the core genuinely great

_Search: **done** (this session). Version grouping and DAW filters: **already
built**._

| Feature | Why | Effort |
|---|---|---|
| **Search / filter bar** ⭐ | Query by name, BPM range, key, DAW, date, note text. All that metadata is already extracted — this is the app's killer feature and turns it into a daily tool. | Medium |
| **Version grouping** (BUILD_NOTES N0) | Collapse `Song 1 / 2 / 3 bounced` into one expandable row. Same folder + stem only, never across folders. | Medium |
| **DAW filters + render-matcher fix** (N2b, N1) | Sidebar filter per DAW (`entry.daw` already present); make the row count and the render list use one matcher. | Low |

## Tier 2 — Cash in the existing DSP

_Drone, off-grid scanner and too-quiet scanner: **all already built**._


| Feature | Why | Effort |
|---|---|---|
| **Harmonic reference drone** | Hold the detected root note under a loop/vocal while auditioning. A Web Audio oscillator on the player. | Low |
| **Off-grid loop scanner** | `duration × bpm / 60` should be a whole beat count; flag loops that aren't. Duration + tempo already known. | Low |
| **Too-quiet / clipping scanner** | Reuses the RMS measurement in `silence.ts` with a different threshold. | Low |

## Tier 3 — Differentiators

| Feature | Why | Status |
|---|---|---|
| **Cross-project key/tempo matching** | Mashup/collab superpower. | **Done** — `matching.ts` + "Matches" tab, tested |
| **Bounce webhook** | POST to Discord/Slack on a new bounce. | **Done** — `webhook.ts` + Settings field, tested |
| **Disk-space insights** | Which projects / `Samples/Imported` folders eat the most space. | **Done** — bounded, cancellable `disk.ts` scan + sidebar view, tested |

**Disk-space insights (implemented).** The read-only scan measures known
project folders, ranks project and `Samples/Imported` usage, reports progress,
can be cancelled, skips links/junctions, and stops loudly at a 250,000-file
safety budget. Synthetic-folder tests cover ranking and truncation. Real-drive
performance should still be observed during user testing.

## Tier 4 — Bigger bets (later)

| Feature | Why | Notes |
|---|---|---|
| **"This week" dashboard** | What you worked on recently, at a glance. | Cheapest of the three — all data already scanned; a filtered/sorted view. Good next pick. |
| **Waveform drag-to-trim** | The waveform and WAV writer both exist; this is the UI in between. | Large, interaction-heavy UI — best done with the app running to verify. |
| **AI descriptive naming** | Contextual names rather than a fixed adjective list. | Needs a model/API call and a provider decision; out of scope until that's chosen. |
| **Theme selector** | Makes the app feel personal without changing its workflow. | Start with five curated accent swatches plus Dark/Light/AMOLED; custom colour later. |

## Decision

Continue from the audited status instead of blindly following the old tier
order. First repair the broken **Matches** results layout, then implement the
accepted **Vocal timeline round trip** ([0005](0005-vocal-timeline-round-trip.md)).
After that, the safest small visual addition is the **preset theme selector**.
The next major reference-workflow feature is the **waveform trimmer**, followed
by asterisk notes and the dual-pane comparison only after its move/undo rules
are specified. Each feature must be `tsc`-clean, tested where practical and
manually clicked through in the running app.

## Consequences

- Search remains the anchor feature; everything else compounds on the metadata
  it surfaces (e.g. Tier 3 matching is "search, but cross-project").
- Theme is represented by semantic tokens so new accents do not require
  component-by-component CSS rewrites.
- The reference feature audit is now one canonical checklist, preventing completed features
  from repeatedly returning to the backlog.
- Renderer changes still need a manual click-through until smoke tests exist.
