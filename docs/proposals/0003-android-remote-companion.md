# 0003 — Android remote companion

- **Status:** Proposed
- **Date:** 2026-08-16
- **Priority:** Future companion feature

## Context

A producer may leave their studio computer running and need a quick render or stems while away from the studio.

Key workflow:
1. Browse indexed projects from an Android phone/tablet.
2. View existing renders, WAVs, and stems.
3. Download a file or request a prepared stems ZIP bundle.
4. Pass the downloaded audio to WhatsApp, Google Drive, WeTransfer, or email via Android's native system Share menu.

## Zero-Server, Zero-Trust Architecture

- **Strictly Read-Only:** Phone can browse and download audio, but cannot delete, rename, overwrite, or mutate studio project files.
- **No Open Ports or Exposed Servers:** Direct WebRTC P2P DataChannels or encrypted pairing (ephemeral QR code / short-lived pairing key). Zero port forwarding or static public IPs needed.
- **Native Android Share Handoff:** Received audio is handed directly to Android's OS share sheet for immediate distribution without needing third-party cloud API keys on the desktop.
