# 0006 — Android remote companion

- **Status:** Proposed
- **Date:** 2026-08-16
- **Priority:** Later, after the desktop workflow and security model are stable

## Context

A producer may leave the studio computer running, then need a render or a set
of stems while away from the studio. The useful workflow is:

1. browse DAW Buddy's indexed projects from an Android phone;
2. find an existing render, WAV or stems folder;
3. download one file or ask the computer to prepare one transfer bundle;
4. hand the downloaded file to WhatsApp, Drive, email or another client app
   through Android's normal Share menu.

The phone only needs access to deliverable audio. It must not become a remote
file manager with permission to rename, move or delete studio projects.

"FTP" describes the desired transfer experience, not a required protocol.
Plain FTP and an openly forwarded router port would expose studio files and
credentials. DAW Buddy should use an encrypted, authenticated connection.

## Decision

Design a future Android companion around a small **read-only desktop service**.
The desktop remains the authority: it supplies the already indexed project
list and prepares downloads. The phone never scans the computer's drive.

### Phone capabilities

- Pair with one studio computer using a one-time QR code or short code.
- Browse and search projects, then view only their renders, stems and other
  explicitly approved audio files.
- Preview a lightweight listening copy when available.
- Download one file, selected files or a prepared stems bundle.
- Show preparation and transfer progress, resume interrupted downloads and
  verify the completed file with a checksum.
- Open the completed download in Android's system Share menu.
- Clearly show when the studio computer is offline, asleep or DAW Buddy is not
  running.

The first version cannot delete, rename, upload, edit metadata, launch DAWs,
run cleanup tools or browse arbitrary folders. Those restrictions are part of
the security boundary, not merely hidden buttons.

### Packaging stems

When a project contains a stems folder, the phone can request **Prepare stem
bundle**. The desktop then:

1. displays an estimated source size, free-space requirement and likely
   transfer size before starting;
2. creates a uniquely named archive in a managed transfer-cache folder;
3. includes a small manifest listing the project, files, sizes and checksums;
4. reports progress and supports cancellation;
5. leaves every source stem untouched;
6. removes expired cached bundles only under a visible retention policy.

Use ZIP first because Android, Windows and client services understand it
without extra software. Do not promise large savings: PCM WAV files often
shrink only slightly in ZIP. Offer clearly labelled alternatives later:

- **Original-quality ZIP** — maximum compatibility; mainly combines files.
- **Lossless FLAC bundle** — potentially smaller, only when the recipient can
  accept FLAC; never replace the studio WAV files.
- **Listening copy** — optional AAC/MP3 for approval, never labelled or used as
  production stems.

RAR is deferred. It adds another tool/dependency and is less universally
available; it should be considered only if measured results justify it.

### Connection and security

- Never expose unauthenticated HTTP or plain FTP to the public internet.
- Encrypt traffic, pair devices explicitly and give each phone a revocable
  identity. A lost phone must be removable from DAW Buddy Settings.
- Use short-lived download authorizations rather than permanent URLs.
- Restrict every requested path to DAW Buddy's approved indexed audio. Resolve
  paths before access and reject traversal, links and stale cache entries.
- Rate-limit requests, cap archive size/file count and keep a local activity
  log showing which device downloaded what and when.
- Default to no remote access until the owner turns it on.

For a personal beta, support the same Wi-Fi network or a trusted private VPN
such as Tailscale rather than opening a router port. A polished internet-wide
version would need a separately approved encrypted relay/service, including a
decision about hosting cost, accounts and privacy.

## Delivery phases

1. **Desktop groundwork:** read-only API, safe file allow-list, bundle queue,
   checksums, cleanup policy and transfer tests.
2. **Personal Android beta:** QR pairing and LAN/private-VPN browsing,
   downloads, resume and Share-menu hand-off.
3. **Remote product:** optional secure relay, device management, notifications
   and a simple setup that does not require networking knowledge.
4. **Later conveniences:** Wake-on-LAN where supported, download history and
   owner-approved temporary links for individual files.

Native Android versus an installable web app should be decided with a small
prototype. The protocol and security boundary must not depend on that UI
choice.

## Acceptance criteria

1. A paired phone can list only the renders and stems DAW Buddy explicitly
   exposes; arbitrary paths and project source files are rejected.
2. One file and one multi-stem ZIP survive an interrupted/resumed transfer and
   match the desktop checksums.
3. Bundle creation never changes source audio and fails safely when disk space
   is insufficient.
4. Revoking the phone immediately blocks new browsing and downloads.
5. The main DAW Buddy window and audio player remain usable during packaging
   and transfer.
6. Remote access is off by default and no plain FTP/public unauthenticated port
   is introduced.

## Consequences

- The desktop app must remain running and the computer awake to serve files.
- Reliable access outside the studio is a networking and security feature,
  not just an Android screen, so it belongs after the local app is stable.
- ZIP solves convenient delivery more than compression; lossless FLAC is the
  honest data-saving option when the recipient supports it.
- A hosted relay would create ongoing operating cost and privacy obligations,
  so it requires a separate decision before implementation.
