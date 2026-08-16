# 0003 — Installers + release CI

- **Status:** Implemented
- **Date:** 2026-08-16

## Context

Distribution meant "install Node and run `npm start`". Non-technical users need a
double-click installer, and there was no automated way to produce one per
platform.

## Decision

- **electron-builder** (`electron-builder.yml`) packages `dist/` + production
  deps into an NSIS `.exe` (Windows), a `.dmg` (macOS) and an AppImage (Linux).
  Local: `npm run dist` (or `dist:win` / `dist:mac` / `dist:linux`).
- **Release CI** (`.github/workflows/release.yml`) fans out across
  macOS/Windows/Linux runners on a published GitHub Release, type-checks, tests,
  builds, and uploads the installers to the release.

## Consequences

- A macOS `.dmg` can only be built on a macOS runner (Apple's tooling) — the CI
  matrix handles that.
- Installers are **unsigned** for now, so SmartScreen/Gatekeeper warn on first
  launch. Signing needs paid certificates (Apple ~$99/yr, Windows ~$200/yr) wired
  in as CI secrets — deferred until distribution widens.
