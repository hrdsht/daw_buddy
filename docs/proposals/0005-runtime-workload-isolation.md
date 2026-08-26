# 0005 — Isolate UI, catalogue, and audio workloads

- **Status:** Proposed
- **Date:** 2026-08-26

## Context

DAW Buddy currently runs lifecycle coordination, project-root scanning, DAW-file
parsing, cache/index writes, filesystem watching, and many audio operations close
to the Electron main process or UI renderer. As the application grows, a slow
external drive, expensive parse, large audio decode, or faulty graphics/worker
path can make unrelated parts of the app appear frozen.

The startup fixes keep drive verification out of the first-paint path, but timing
alone is not a durable isolation boundary. Proposal 0001 splits renderer source
code into maintainable modules; this proposal splits runtime responsibilities so
heavy or failure-prone work cannot starve window lifecycle or UI input.

## Decision

Adopt four explicit runtime components with versioned message contracts:

1. **UI renderer** — owns DOM rendering, navigation, cached presentation state,
   playback controls, and user gestures. It must never walk project roots or run
   offline DSP on the UI thread. Audio playback may remain in Web Audio, but file
   discovery, decoding for analysis, and offline rendering are jobs.
2. **Electron main supervisor** — owns windows, tray, permissions, path guards,
   dialogs, and IPC routing. It validates every renderer request and passes only
   approved roots/files to workers; existing path-containment invariants remain
   authoritative.
3. **Catalogue service** — an Electron `utilityProcess` owns root scanning, DAW
   parsing, `ProjectIndex`, `ParseCache`, and filesystem watching. It publishes
   immutable catalogue snapshots, incremental updates, progress, and explicit
   truncation/error states. A disconnected drive preserves the last-known-good
   snapshot.
4. **Audio job service** — a separate bounded worker runs waveform analysis,
   tempo/key detection, silence scans, conversion, finishing, and other offline
   DSP. Playback is never required to wait for it, and no audio file is loaded at
   startup merely to pre-populate the transport.

Every job carries a job ID, configuration generation, progress events,
cancellation, and a terminal result. Results from stale generations are ignored.
Workers use bounded concurrency (one disk-heavy job by default) and yield between
chunks so DAWs and the UI retain priority.

Startup order becomes fixed:

`app ready → create splash and main window → render cached snapshot → start services → verify drives`

Worker crashes do not close either window. The supervisor reports degraded state,
retains cached data, and restarts a service with bounded backoff. No automatic
retry may loop indefinitely or hide a scan budget/depth limit.

Implementation proceeds incrementally:

1. Define typed catalogue/audio job protocols and add timing/heartbeat tests.
2. Move `scanRoots`, parsers, cache/index ownership, and then `watcher.ts` into the
   catalogue service.
3. Consolidate existing `analysis-worker.ts` work and offline audio operations
   behind the audio job protocol.
4. Reduce `main.ts` to supervision and IPC authorization; continue Proposal 0001
   to reduce `app.ts` to UI coordination.

## Consequences

- The splash and main UI remain responsive while drives sleep, scans run, or
  audio analysis fails.
- Catalogue and audio work gain cancellation, progress, restart, and measurable
  resource budgets instead of ad-hoc promises.
- IPC schemas and serialization add complexity; large audio buffers should use
  transferable objects or worker-side file access, not repeated copies.
- Tests must cover worker termination, unplugged drives, stale results,
  cancellation, and fallback to the last-known-good catalogue.
- Acceptance requires that first paint performs no project-root I/O, a forced
  worker crash leaves search/navigation interactive, and a deliberately stalled
  drive cannot block window events or audio playback.
