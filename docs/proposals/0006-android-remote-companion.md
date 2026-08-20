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

### Connection and Security Boundary (Zero-Server, Zero-Trust)

To eliminate the need for running paid servers and protect against open-internet phishing, open-port vulnerabilities, and credential sniffing:

1. **No Open Ports or Traditional Web Servers**:
   - The desktop never runs an open HTTP/FTP daemon listening on the public internet.
   - Zero router configuration or port forwarding required.

2. **Zero-Server, Free & End-to-End Encrypted (E2EE) Architectural Options**:

   - **Option A: WebRTC Direct P2P DataChannels with Ephemeral QR Code (Recommended)**
     - *How it works:* Desktop generates an ephemeral pairing token encoded into a QR code. When scanned by your phone (or opened via a short-lived link), the devices establish a direct, end-to-end encrypted WebRTC DataChannel via free public STUN servers (e.g. Google STUN).
     - *Cost:* **$0 (100% Free, serverless)**.
     - *Security:* DTLS 1.3 / SRTP encryption. Neither ISPs nor intermediate NAT traversal nodes can inspect or tamper with the audio stream.
     - *Workflow:* Phone requests a render/stems bundle → Desktop streams it chunk-by-chunk to the phone → Transfer ends immediately.

   - **Option B: SPAKE2 / Magic Wormhole Protocol (One-Time Passphrase)**
     - *How it works:* Password Authenticated Key Exchange (PAKE) over Curve25519 and ChaCha20-Poly1305.
     - *Cost:* **$0 (Uses free public rendezvous relays for encrypted signalling only)**.
     - *Security:* Cryptographically immune to man-in-the-middle attacks and phishing. Relays only see randomized encrypted noise and cannot decrypt file bytes.

   - **Option C: Tailscale / WireGuard Private Mesh Network**
     - *How it works:* Uses WireGuard peer-to-peer mesh. Free for individual users (up to 100 devices).
     - *Security:* Direct encrypted point-to-point tunnel between your studio PC and phone over cellular data (5G/4G) without exposing any service to the outside world.

3. **Strict One-Way Transmit Boundary & Native Share Handoff**:
   - DAW Buddy's desktop agent is strictly **read-only / transmit-only**.
   - The Android companion receives the requested audio file directly into device storage or memory.
   - The user then uploads or shares the file to their chosen service (**WeTransfer, Google Drive, WhatsApp, Telegram, Dropbox, Email**) using Android's native system Share Sheet.
   - DAW Buddy never needs to implement third-party upload credentials, WeTransfer API keys, or cloud storage accounts on the desktop.

## Delivery Phases

1. **Desktop Groundwork:** Safe file allow-list, read-only manifest generator, bundle compression queue, and sha256 checksums.
2. **E2EE Peer-to-Peer Transfer Engine:** WebRTC DataChannel / P2P signalling handshake (ephemeral QR pairing) with zero server setup.
3. **Android Companion App / PWA:** Mobile UI for browsing project renders/stems, initiating direct downloads, and triggering Android's native Share Sheet.
4. **Resilience & Background Resume:** Chunked resume support for cellular network drops.

## Acceptance Criteria

1. **Zero Open Ports**: No open ports or unauthenticated services are exposed to the public internet.
2. **Zero Hosting Cost**: The system operates 100% peer-to-peer using free, blind STUN/signalling mechanisms.
3. **Strict Read-Only Guarantee**: The phone cannot delete, overwrite, rename, or modify any files on the studio computer.
4. **Native Android Share Handoff**: Completed transfers immediately invoke Android's system share menu (WeTransfer, Drive, etc.).
5. **Session Isolation**: Pairing tokens expire automatically; revoked devices cannot reconnect.

## Consequences

- The desktop app must remain running and the computer awake to serve files.
- Reliable access outside the studio is a networking and security feature,
  not just an Android screen, so it belongs after the local app is stable.
- ZIP solves convenient delivery more than compression; lossless FLAC is the
  honest data-saving option when the recipient supports it.
- A hosted relay would create ongoing operating cost and privacy obligations,
  so it requires a separate decision before implementation.
