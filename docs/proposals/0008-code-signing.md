# 0008 — Code signing & notarization

- **Status:** Planned
- **Date:** 2026-08-20
- **Prompted by:** the v0.1.0 pre-release ships **unsigned** installers, so macOS
  Gatekeeper and Windows SmartScreen warn on first launch. Signing removes those
  warnings and is the prerequisite for widening distribution past testers.

## Context

`release.yml` already builds `.dmg` / `.exe` / `.AppImage` across three runners
and attaches them to a published GitHub Release. What's missing is a trusted
signature on the macOS and Windows artifacts. Signing is entirely a matter of
(1) obtaining certificates, (2) storing them as CI secrets, and (3) letting
electron-builder pick them up — **no app-code changes**.

Until then, releases stay marked **pre-release** (as v0.1.0 is), which is the
honest label for an unsigned build.

## macOS — Developer ID signing + notarization

Two steps are required for a `.dmg` to open without warnings: **sign** with a
Developer ID Application certificate, then **notarize** with Apple.

1. **Apple Developer Program** — $99/yr. Individual is fine.
2. **Developer ID Application** certificate — create in the Apple Developer
   portal (or via Xcode), export as `.p12` with a password.
3. **Notarization credentials** — use an **App Store Connect API key** (more
   robust in CI than an Apple ID + app-specific password): create the key, keep
   the `.p8` file, its Key ID and Issuer ID.
4. **GitHub secrets:**
   - `CSC_LINK` — base64 of the `.p12`
   - `CSC_KEY_PASSWORD` — the `.p12` password
   - `APPLE_API_KEY` — the `.p8` contents (written to a file in CI), plus
     `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`
5. **`electron-builder.yml`** (mac block):
   ```yaml
   mac:
     hardenedRuntime: true
     gatekeeperAssess: false
     entitlements: build/entitlements.mac.plist
     entitlementsInherit: build/entitlements.mac.plist
     notarize: true
   ```
   Add `build/entitlements.mac.plist` with the Electron essentials
   (`com.apple.security.cs.allow-jit`,
   `com.apple.security.cs.allow-unsigned-executable-memory`,
   `com.apple.security.cs.disable-library-validation`).
6. electron-builder auto-signs when `CSC_LINK` is present and notarizes when the
   `APPLE_API_*` env vars are set — both only on the `macos-latest` runner.

## Windows — the 2023+ reality

Since June 2023, OV/EV code-signing private keys must live on FIPS hardware
(HSM) or a cloud service — **you can no longer sign with a plain `.pfx` file for
a newly issued certificate**. Options, cheapest/most-CI-friendly first:

1. **Azure Trusted Signing** (recommended) — Microsoft cloud signing, ~$10/month.
   Sign in a post-build CI step with `AzureSignTool` / the Trusted Signing
   action. Caveat: identity validation — individuals are supported, but an *org*
   certificate requires ~3 years of verifiable history.
2. **SSL.com eSigner** — cloud signing (~$249+/yr) with an electron-builder
   integration via env (`WIN_CSC_LINK` pointing at their cloud, or their
   CodeSignTool).
3. **Traditional file `.pfx`** — only if you already hold a legacy file-based
   cert: `CSC_LINK` (base64 `.pfx`) + `CSC_KEY_PASSWORD`. Not available for new
   certs.

Because Windows signing is usually a separate tool invocation, the cleanest wire-up
is: build unsigned on the `windows-latest` runner, then a **"Sign Windows
installer"** step runs the chosen signer over `release/*.exe` before the upload
step attaches it.

## Linux

AppImage has no Gatekeeper equivalent, so **no signing is required**. Optionally
publish a `SHA256SUMS` file (and a GPG signature of it) alongside the release for
integrity — cheap to add later.

## Cost summary

| Platform | One-off / recurring |
|---|---|
| macOS | Apple Developer $99/yr |
| Windows | Azure Trusted Signing ~$10/mo, **or** SSL.com eSigner ~$249+/yr, **or** existing file cert |
| Linux | free (optional checksums) |

## Rollout

1. Acquire the Apple cert + API key; add the four macOS secrets; add the mac
   block + entitlements to `electron-builder.yml`. Verify: a fresh `.dmg` opens
   on a clean Mac with no Gatekeeper prompt (`spctl -a -vv` passes).
2. Choose the Windows signer; add its secrets; add the sign step to `release.yml`.
   Verify: the `.exe` shows a valid publisher and no SmartScreen block.
3. Once both pass on a test tag, drop the **pre-release** flag from future
   releases and mark them `--latest`.

## Consequences

- No application code changes — purely CI/config + paid certificates.
- Notarization adds a few minutes to the macOS job (Apple's service round-trip).
- Supersedes the "signing deferred" note in [0003](0003-packaging-and-release.md).
