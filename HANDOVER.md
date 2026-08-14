# Handover

You've been handed a working Electron app that someone else built, with a
substantial list of known bugs and planned features. This document is the
orientation; `BUILD_NOTES.md` is the actual work queue.

## Who this is for and what to expect

Hrdsht is an EDM producer, not a developer — engineering background in C,
Assembly and Verilog, no JavaScript. He directs, tests against his real drive,
and reports what's wrong. He does not want to read code. Explanations that
land are byte-level and structural; skip the JS idiom tour.

The app was built conversationally over several sessions with an AI, which is
why the comments are unusually verbose and why `BUILD_NOTES.md` reads like a
lab notebook. That's deliberate — it's the only continuity between sessions.
**Keep updating it.**

## Running it

```
npm install
npm start
```

Node LTS required. Or double-click `Project Browser.bat` on Windows, which
does both. `Project Browser.command` is the macOS equivalent and needs
`chmod +x` once.

## What it does

Scans configured folders for DAW projects, reads the tempo out of the session
files, shows a health bar from backup counts, plays and analyses renders for
musical key, and keeps per-project notes. Plus a bulk renamer, an ID3 tag
stripper, and a sample de-duplicator.

## Architecture in ninety seconds

Standard Electron split, taken seriously:

- **`main.js`** — Node. The only place that touches the filesystem. Every path
  arriving from the window is checked against the configured roots before
  anything is read, renamed or rewritten (see `guard()`). Several tools modify
  files, so this matters.
- **`preload.js`** — the contextBridge. The window gets exactly the listed
  functions and nothing else.
- **`src/app.js`** — the window. No file access at all. Three views share the
  main pane: project list, one project's page, sample cleanup.

`lib/` is all plain Node with no Electron dependency, so it's directly
testable — which is how most of the bugs in `BUILD_NOTES.md` were found.

```
lib/
├── daw.js        format registry — one entry per DAW, each with readTempo
│                 and countBackups. Everything else asks this rather than
│                 checking extensions itself
├── scanner.js    walks folders, produces project entries
├── media.js      finds audio, groups renders by base name + version
├── notes.js      the record store (notes.json)
├── notetext.js   writes notes as .txt files next to projects
├── dedupe.js     sample de-duplication, hard links only
├── renamer.js    plan / apply / undo
├── id3.js        byte-level ID3 tag stripping
├── watcher.js    chokidar, groups wav+mp3 of one render into one event
├── procs.js      detects running DAWs
├── settings.js   roots, ignore list, migrations
└── zipreader.js  minimal zip reader on Node's zlib, no dependency

src/
├── dsp.js        FFT, tempo via spectral flux + autocorrelation, key via
│                 chroma + Krumhansl-Kessler, Camelot mapping
├── player.js     Web Audio playback + waveform. Decodes once, uses the PCM
│                 for playback, waveform and analysis
└── app.js        everything else
```

## Read this before touching anything

**`BUILD_NOTES.md`, top to bottom.** Sections are numbered so the most recently
discovered problems sit at the top — `00000`, `0000`, `000`, `00`, `0`, then
`A` onwards. The most important are:

1. **`00` — the data model is wrong.** The app assumes one folder = one
   project. His drive has folders with eight different `.als` files in them,
   each a separate piece of work. Seven of every eight are invisible. This is
   the single biggest fix and most other things depend on it.
2. **`0-A` — the FL Studio tempo parser is broken.** Diagnosed down to the
   byte. FL 26 changed something in the event-size rules and the sequential
   walk derails at offset 48. There's a proposed fallback in the notes, tested
   against a real file.
3. **`00000` — the cache design**, including why a parser version stamp is
   non-negotiable.

## Things that will bite you

**Nothing about his folder structure is what you'd assume.** Projects nest
inside projects. Renders live in a `Renders` folder one or two levels *above*
the project. A stray `.als` sits loose in a folder containing forty projects.
Every single scanner bug so far came from a reasonable assumption meeting a
real drive. Test against real paths, not fixtures.

**Arbitrary limits are the recurring failure mode.** A depth cap, a
12-subfolder cap, an 8000-folder budget — each produced a plausible-looking
wrong answer instead of an error. If you add a limit, make it loud when it's
hit.

**Two searches, two rule sets.** `Renders` and `Bounces` are skipped when
looking for projects and must NOT be skipped when looking for audio.
Conflating those caused a whole class of bugs.

**The de-duplicator modifies files.** It hard links rather than deletes,
deliberately — every path keeps resolving and every session still opens.
Don't "simplify" that to deletion. It's also restricted to `Samples/Imported`
and `Samples/Splice` because `Processed` and `Recorded` contain audio that
exists nowhere else.

## Testing without his drive

The `lib/` modules are plain Node. Building fixture trees with `fs` and
running the scanner directly found more bugs than the UI ever did:

```js
const { scanRoots } = require('./lib/scanner');
scanRoots(['./fixtures/Jump'], { ignore: ['Backup', 'Samples'] })
  .then(r => r.entries.forEach(e => console.log(e.name, e.bpm, e.backupCount)));
```

Synthetic `.als` files are a gzipped XML string. Synthetic `.flp` files need a
`FLhd` header plus an `FLdt` chunk — there are working examples in the git
history of this conversation's test commands, or write them from the format
notes in `lib/daw.js`.

For DSP, generating a known chord at a known tempo and checking the analyser
returns the right key and Camelot number works well.

## Open questions he hasn't answered

- Cache in the app data folder, or in the Jump root so it travels with the
  drive?
- Silence removal output: mirror source folder names, or flat?
- RMS or Peak as the detection default? (Notes argue RMS; his reference tool
  uses Peak.)

## Order of work

Listed at the end of `BUILD_NOTES.md`. The short version: fix the model and
the FL parser before anything else. Caching wrong BPMs makes them sticky, and
wrong values baked into filenames by the renamer don't undo the way a rename
does.
