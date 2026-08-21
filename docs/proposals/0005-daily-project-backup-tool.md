# 0005 — Automated Daily Project Backup & External Drive Mirroring Tool

- **Status:** Proposed
- **Date:** 2026-08-20

## Context

Music production projects contain irreplaceable audio recordings, arrangements, presets, and sample edits. Hardware failures, drive corruption, accidental overwrites, or losing an external project drive can cause catastrophic data loss.

DAW Buddy already runs a local file watcher (`chokidar`) that indexes project roots, tracks versioned session files, and alerts when new bounces land on disk. However, producers currently have to rely on manual drag-and-drop or separate backup utilities to mirror their active projects to external hard drives or secondary storage.

## Decision

Add a dedicated **Project Backup & Mirroring Tool** inside the Tools section that coordinates with the file watcher to automatically synchronize active project directories to a designated destination (such as an external SSD/HDD, secondary internal drive, or local network share) once a day.

### 1. Tool Section & Configuration UI
- **Tool Card**: Add **`Backup & Mirroring`** (`💾 Backup`) to the standalone Tools suite and project settings.
- **Target Selection**: Pick any backup folder or drive (e.g., `E:\Music_Backups` or `D:\Studio_Archive`).
- **Schedule & Mode**:
  - Daily automatic backup trigger (e.g. daily at user-selected time, or automatically during idle periods after file watcher detects changes).
  - Manual **"Backup Now"** button with real-time transfer progress bar and file count.
  - Modes:
    - **Incremental Mirror**: Fast mirror copying only modified/new files since last run.
    - **Versioned Snapshots / Zip Archives**: Retains timestamped snapshots for session rollback.

### 2. File Watcher & Incremental Sync Engine
- Leverages the existing `chokidar` watcher in `src/main/` to track projects that have been edited during the day.
- Incremental comparison compares file modification time (`mtime`) and byte size before copying, skipping unchanged audio files to save disk I/O and SSD endurance.
- Atomic file copy: writes to a `.tmp` file before renaming to prevent corrupted files if a drive is disconnected mid-copy.

### 3. Drive Detection & Safety Invariants
- **Presence Check**: Verifies the target backup path/drive is mounted before starting. If the external drive is unplugged, it cleanly pauses without throwing errors and displays a reminder badge.
- **Source Protection**: Strictly read-only on source projects — never deletes, renames, or moves source project files.
- **Audio Performance Priority**: Sync runs in background with throttled chunk I/O to ensure zero audio dropouts or glitches in open DAWs.

## Consequences

- **Pros**:
  - Automatic, peace-of-mind backup with zero cloud dependencies and complete privacy.
  - Seamlessly integrates with DAW Buddy's existing project scanning and file watcher architecture.
  - Incremental copying makes daily runs fast (typically under 10 seconds if only small `.als`/`.flp` session files changed).
- **Follow-up Work**:
  - Implement IPC channels in `src/main/lib/backup.ts` (`backup:config`, `backup:run`, `backup:status`).
  - Add Backup UI card and settings in `src/renderer/app.ts`.
  - Add test suite in `test/backup.test.js` verifying incremental copy, drive disconnect handling, and atomic writes.
