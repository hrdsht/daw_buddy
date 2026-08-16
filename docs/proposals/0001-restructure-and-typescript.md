# 0001 — Repo restructure + TypeScript migration

- **Status:** Implemented
- **Date:** 2026-08-16

## Context

The project had grown organically: `main.js`, `preload.js`, `lib/` and `src/`
loose at the root, docs and launchers scattered, a duplicate `DOCS.html`, and no
`.gitignore` or build step. Plain JS with no type checking meant the recurring
bugs — byte-offset parsers, the preload↔main IPC contract, record/entry shapes —
had no safety net.

## Decision

- **Layout:** standard Electron split — `src/main` (+ `lib/`), `src/preload`,
  `src/renderer`; docs under `docs/`, launchers under `scripts/`.
- **TypeScript** across the whole codebase, compiled by `tsc`
  structure-preserving (`src/` → `dist/`) so runtime `__dirname` joins resolve
  identically. The renderer is bundled by esbuild (two entry points: app +
  splash). Tests run via `tsx`.
- **`CLAUDE.md`** as the primary entry point (run/test, architecture, the
  invariants that must not break).

## Consequences

- `npm start` now builds first; `main` points at `dist/main/main.js`. The
  double-click launchers still "just work".
- Type checking caught a real latent bug (`buildVersionRow` was called but never
  defined — see [0002](0002-renderer-module-split.md)).
- Cost: a build step now exists where there wasn't one; mitigated with `tsx` so
  the lib stays directly runnable/testable.
- Done as granular, individually-signed commits; carried across the PR #2 (0.2.0
  splash/video) merge by rebuilding the mechanical restructure on top.
