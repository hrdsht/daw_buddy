# 0001 — Split the renderer into modules

- **Status:** Proposed (partially implemented)
- **Date:** 2026-08-16

## Context

`src/renderer/app.ts` is a large central orchestrator. It is written in TypeScript and bundled,
but still holds multiple subsystem concerns. Pure helpers (`el`, `headRow`, `formatBpm`, …) have
already been pulled into `dom.ts`, `dsp.ts`, `search.ts`, `player.ts`, etc.; remaining stateful UI
(list, project page, tab renderers, dedupe, records, settings sheet, audition controls) will be modularised.

The architectural requirement is managing shared mutable state: promoting relevant state into
clean domain modules and exported controllers so `app.ts` remains a lean coordinator.

## Decision

Extract in logical dependency order, each step `tsc`-clean:
`state.ts` → `dom.ts` (done) → `list.ts` → `project.ts` → `tab-*.ts` →
`dedupe.ts` / `records.ts` / `settings-sheet.ts` / `audition.ts`, leaving
`app.ts` as a thin orchestrator.

## Consequences

- Each module becomes independently readable and testable.
- Domain features (Scale tools, Randomizer, Finisher, Smart Renamer) can be maintained in isolation.
- Runtime DOM wiring and event handling remain intact across builds.
