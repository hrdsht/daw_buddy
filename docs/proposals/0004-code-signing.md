# 0004 — Code signing & notarization

- **Status:** Planned
- **Date:** 2026-08-20
- **Context:** Automated unsigned builds currently trigger macOS Gatekeeper and Windows SmartScreen alerts.

## Decision

- **macOS:** Developer ID Application certificate + Apple notarization workflow (`notarize: true` in `electron-builder.yml`).
- **Windows:** Azure Trusted Signing / cloud HSM certificate in CI release workflow (`.github/workflows/release.yml`).
- **Linux:** AppImage builds remain unsigned (or optionally SHA256 / GPG signed).
