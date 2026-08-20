# 0002 — Linux support

**Status:** Proposed  
**Author:** Drafted for review  
**Date:** 2026-08-17  

---

## Context

Collaborators run Linux. The primary motivating case is **an external drive carrying projects made on Windows and macOS, mounted on Linux**, and expecting the app to behave consistently.

DAW support is not the question. A project browser doesn't need the DAW installed to read a `.als`, `.flp`, or audio stems and show what's inside.

## What already works

Most platform handling is already structured properly:
- `process.platform` branches cleanly where appropriate (`procs.ts`, `settings.ts`, `main.ts`).
- `lib/` is platform-agnostic Node.
- `dedupe.ts` uses `stat.dev` for volume identity.
- Paths are built with `path.join`, never manual string concatenation.

## Key Challenge: Cross-Platform Drive Paths

The same file has different absolute paths across operating systems:
```
Windows   E:\JUMP\2026\May 2026\Suraag\song.als
Linux     /media/hpkal/JUMP/2026/May 2026/Suraag/song.als
macOS     /Volumes/JUMP/2026/May 2026/Suraag/song.als
```

### Proposed Design: Store paths relative to root

A record key becomes `<root id>::<path relative to that root>`, normalized with `/` separators:
```
JUMP::2026/May 2026/Suraag/song.als
```

- **Root IDs:** Stable identifiers stored in `settings.json`.
- **Filesystem Awareness:**
  - Case-sensitivity matching on Linux filesystems.
  - Capability probes for hard links on FAT/exFAT drives.
  - Linux packaging targets (AppImage and deb via `electron-builder.yml`).
