# CLAUDE.md

Entry point for working on **DAW Buddy** — a local Electron desktop app that
browses, analyses and tidies music-production project folders. Everything runs
locally: no server, no accounts, no network calls except two web-font files.

## Run and test

```bash
npm install     # first time only (Electron is ~250 MB)
npm start       # builds (tsc), then launches Electron
npm test        # tsx test/regression.js — runs the .ts lib directly, no Electron
npm run build   # tsc -> dist/, then copy-assets.js carries html/css across
npm run typecheck   # tsc --noEmit
```

Node LTS required. The main side (`src/main`, `src/preload`) is **TypeScript**,
compiled by `tsc` structure-preserving (`src/` → `dist/`) so the runtime
`__dirname` joins resolve identically in the build output. `main` points at
`dist/main/main.js`. `lib/` has no Electron dependency, which is why it is
directly testable (via `tsx`) and where most bugs are caught. The renderer is
also TypeScript, bundled by esbuild into `dist/renderer/`.

## Architecture

Standard Electron split, enforced strictly:

- **`src/main/main.ts`** — the Node/main process. The **only** place that
  touches the filesystem. Every IPC handler lives here.
- **`src/preload/preload.ts`** — the contextBridge "airlock". The renderer gets
  exactly the ~40 whitelisted functions on `window.api` and nothing else
  (`contextIsolation: true`, `nodeIntegration: false`).
- **`src/renderer/`** — the windows (main app + the startup splash). **No
  filesystem access at all.** TypeScript bundled by esbuild — two entry points,
  `app.ts` and `splash.ts` — into `dist/renderer/`. `dsp.ts`/`player.ts` export
  their APIs; `app.ts` imports them.

The split is the security model: a malicious file name can never become a
malicious file operation, because the renderer cannot perform operations.

## Layout

```
daw-buddy/
├── CLAUDE.md              this file
├── README.md             end-user setup instructions
├── package.json          scripts (build/start/test/typecheck), deps (chokidar)
├── tsconfig.json         tsc config — src/ -> dist/, structure-preserving
├── src/
│   ├── main/             main process — all IPC + all file access
│   │   ├── main.ts
│   │   └── lib/          main-process modules (TypeScript, testable via tsx)
│   ├── preload/          contextBridge airlock (preload.ts)
│   └── renderer/         app + splash windows (TypeScript, esbuild-bundled)
├── dist/                 tsc build output (git-ignored) — what Electron runs
├── test/regression.js    lib-level regression tests (run via tsx)
├── docs/                 HANDOVER.md, BUILD_NOTES.md (work queue), manual.html
└── scripts/              copy-assets.js + DAW Buddy.bat / .command launchers
```

### `lib/` map

| Module | Responsibility |
|---|---|
| `daw.js` | Format registry — one entry per DAW, each with `readTempo` + `countBackups`. Everything else asks this rather than checking extensions itself. |
| `scanner.js` | Walks folders, produces one entry per session file. |
| `videos.js` | Finds video files belonging to a project (counted + listed). |
| `renders.js` / `media.js` | Find audio; group renders by base name + version. |
| `notes.js` / `notetext.js` | Record store (`notes.json`) + `.txt` notes beside projects. |
| `dedupe.js` | Sample de-duplication — **hard links only, never deletes**. |
| `renamer.js` | Bulk rename: plan / apply / undo, with collision detection. |
| `silence.js` | Silence trimming — writes copies to the output folder, never in place. |
| `audioqc.js` | Audio QC scan. |
| `id3.js` | Byte-level ID3 tag stripping. |
| `watcher.js` | chokidar bounce watcher; groups wav+mp3 of one render into one event. |
| `cache.js` | Parse cache, keyed on path + mtime + size + parser version. |
| `settings.js` / `migrate.js` | Roots, ignore list, data-folder migration. |
| `versions.js` / `zipreader.js` / `procs.js` | Version grouping; zip reader on zlib; running-DAW detection. |

## Invariants — do not break these

Pulled from `docs/HANDOVER.md`; each was a real bug or a deliberate safety
decision.

1. **Every path from the window is guarded.** `guard()` / `guardApproved()` in
   `main.ts` check a path is inside a configured root (or a folder the user
   explicitly picked) before any read, rename or rewrite. Several tools modify
   files — this is load-bearing.
2. **The de-duplicator hard-links, never deletes.** Every path keeps resolving,
   every session still opens. Do not "simplify" to deletion. It is restricted
   to `Samples/Imported` and `Samples/Splice`; `Processed` and `Recorded`
   contain audio that exists nowhere else.
3. **One row per session file, not per folder.** A folder can hold eight
   different `.als` projects. Name/date/BPM come from the session file, not the
   folder.
4. **Two searches, two rule sets.** `Renders` and `Bounces` are skipped when
   looking for *projects* and must NOT be skipped when looking for *audio*.
5. **No silent limits.** A depth cap, folder budget, or truncation must be
   **loud** when hit — a truncated scan must never look like a complete one.
6. **Parser version stamp per format** (`PARSER_VERSIONS` in `daw.js`). Fixing a
   parser must invalidate only that format's cached entries. Bump it when you
   change a parser, or the cache serves wrong values forever.

## Where the work is

`docs/BUILD_NOTES.md` is the work queue — a lab notebook, **newest-first**
(sections `00000`, `0000`, `000`, `00`, `0`, then `A` onward). Keep updating it;
it is the continuity between sessions.

## Testing without the real drive

The `lib/` modules are plain Node (run via `tsx`). Build fixture trees with `fs` and run the
scanner directly — this finds more bugs than the UI. For DSP, generate a known
chord at a known tempo and check the analyser returns the right key/Camelot.

## Commit conventions

Granular commits with Conventional-Commit semantics (`feat:`, `fix:`,
`refactor:`, `docs:`, `chore:`, `test:`, `build:`). Concise subject; body only
when it adds context. Clean, hand-written messages — no AI/co-author trailers.
