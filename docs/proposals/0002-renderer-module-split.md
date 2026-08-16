# 0002 — Split the renderer into modules

- **Status:** Proposed (partially implemented)
- **Date:** 2026-08-16

## Context

`src/renderer/app.ts` is one ~2700-line file. It is now TypeScript and bundled,
but still a monolith. The pure helpers (`el`, `headRow`, `formatBpm`, …) have
already been pulled into `dom.ts`; the stateful UI (list, project page, the tab
renderers, dedupe, records, settings sheet, audition controls) has not.

The blocker is shared mutable state: ~25 module-level `let`s that many functions
read *and* reassign. ESM imports are read-only live bindings, so splitting across
modules means promoting that state into a single mutable `state` object all
modules import — a wide, mechanical rewrite. `tsc` catches every missed
reference (a removed global becomes a compile error), so it is verifiable, but
the runtime behaviour (DOM wiring, event handlers) can only be confirmed by
launching the app.

## Decision

Extract in this order, each step `tsc`-clean and its own commit:
`state.ts` → `dom.ts` (done) → `list.ts` → `project.ts` → `tab-*.ts` →
`dedupe.ts` / `records.ts` / `settings-sheet.ts` / `audition.ts`, leaving
`app.ts` as a thin orchestrator.

## Consequences

- Each module becomes independently readable and testable.
- Must be verified by running the app after each step (no renderer tests yet), so
  it is best done in an environment where the Electron GUI can be launched.
- Also fixes the latent `buildVersionRow` bug properly (currently aliased to
  `buildRow` as a stopgap).
