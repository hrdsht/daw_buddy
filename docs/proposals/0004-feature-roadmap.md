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

| Feature | Why | Effort |
|---|---|---|
| **Cross-project key/tempo matching** | "Show everything in the same key & tempo" — a mashup/collab superpower. Both values already computed. | Medium |
| **Disk-space insights** | Which projects / `Samples/Imported` folders eat the most space. Pairs with the de-duper. | Medium |
| **Bounce webhook** | POST to Discord/Slack on a new bounce — a revocable URL, safer than storing an SMTP password. | Medium |

## Tier 4 — Bigger bets (later)

| Feature | Why | Effort |
|---|---|---|
| **Waveform drag-to-trim** | The waveform and WAV writer both exist; this is the UI in between. | High |
| **AI descriptive naming** | Contextual names (Granite, Avalanche) rather than a fixed adjective list — needs a model. | High |
| **"This week" dashboard** | What you worked on recently, at a glance. | Medium |

## Decision

Build in tier order, starting with the **search / filter bar** (highest
value-per-effort), each feature `tsc`-clean and verified by running the app.
Fold the foundation split in alongside — search is a good forcing function to
carve the list view out of `app.ts` into its own module.

## Consequences

- Search is the anchor feature; everything else compounds on the metadata it
  surfaces (e.g. Tier 3 matching is "search, but cross-project").
- Renderer changes still need a manual click-through until smoke tests exist.
