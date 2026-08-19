# DAW Buddy — context for a new conversation

Paste this as your first message in a fresh chat.

---

## Who I am and how to talk to me

I'm hrdsht, an EDM producer. Engineering background — I was good at C, Assembly
and Verilog HDL, but stopped coding in 2016 to do music full time. No
JavaScript, no TypeScript, no Electron, no databases.

Explain things at the level of bytes, memory layout and pointers and I'll
follow immediately. Explain JavaScript idioms and modern web tooling simply.
Don't over-explain fundamentals I already know.

I have ADHD, so ideas arrive out of order and sometimes half-finished. Write
decisions down in the repo's `docs/proposals/` files rather than assuming
I'll remember them.

## The project

**DAW Buddy** — an Electron desktop app that indexes my music production
sessions, reads tempo out of six proprietary DAW formats, and runs file tools
over the results. Inspired by a tool KSHMR built for himself.

Repo: `C:\Users\hpkal\Documents\Codebases\daw_buddy-main`
GitHub: `hrdsht/daw_buddy` (private)

I work on Windows. My cousin and a friend are on Linux; the friend is an
ethical hacker who'll review security. My cousin did a large TypeScript
rebuild — the codebase is now `src/main`, `src/renderer`, `src/preload`, with
tsc + esbuild, tests, CI on three OSes, and electron-builder packaging.

You have **read and write access** to that folder through the Filesystem
connector. Read the code directly rather than asking me to paste it.

## Read these first, in the repo

- `CLAUDE.md` — my cousin's architecture notes
- `docs/CHANGE_REPORT_2026-08-16.md` — what his rebuild changed
- `docs/proposals/` — numbered design docs, 0005 onwards are recent

## Invariants — each came from a real bug, don't break them

**No arbitrary limits that fail quietly.** Every scanner bug in this project
came from a cap producing a plausible wrong answer instead of an error — a
depth cap, a 12-subfolder cap, an 8,000-folder budget. If a limit is hit, it
must be reported.

**Two searches need two rule sets.** `Renders` and `Bounces` are skipped when
finding *projects* and must never be skipped when finding *audio*.

**Validate every path from the renderer.** `guardApproved()` in `main.ts`,
per file inside loops, not once per batch.

**Stamp cached values with a parser version.** Fixing a parser without
bumping its version leaves every wrong cached value in place, and looks
exactly like the fix failing.

**Refuse rather than guess when writing.** Tools skip inputs they don't fully
understand. Skipping a file is an annoyance; corrupting a master isn't.

**Temp file then rename for every write.** Rename is atomic.

**Preview before mutating, undo after.**

**Never touch `Samples/Processed` or `Samples/Recorded`** — consolidated
clips and original recordings, no copy exists anywhere else. The
de-duplicator links rather than deletes, deliberately.

## The data model, learned the hard way

**One row per session file, not per folder.** A folder with eight `.als`
files is eight projects. Assuming one-folder-one-project hid seven of every
eight and looked like a sorting bug.

**Records are keyed on session file path.** Version grouping is display only
and must not merge records.

**Renders live in sibling and ancestor folders**, not inside the project
folder — though the current decision is to scope the project page to the
project folder and below only.

## Where things stand

Working and shipped: multi-DAW parsing (Ableton, FL, REAPER, Cubase, Logic,
Fender Studio Pro), version grouping, parse cache, waveform player, key
detection, bulk renamer, ID3 stripper, silence removal, sample de-duplicator
with hard links, audio QC scanners, drone/reverb/soft-clip audition, cross-
platform support, single-instance lock.

**Not yet placed in the repo** — four packages of work from the last session:

1. `convert-feature` — format converter for ElevenLabs voice cloning.
   Concatenates WAVs, splits at silence within 5-minute AND 50 MB limits,
   renders to MP3 (128–320, default 192) or WAV (44.1/48k, 16/24/32-bit).
   12 tests passing. `lamejs` already installed.
2. `linux-support` — proposal 0005 plus `DAW Buddy.sh`
3. `smart-renamer` — proposal 0006 plus `instruments.js` (12 categories, 163
   subtypes), `matcher.js`, `renamelog.js`, `userdict.js`
4. `key-rework` — proposal 0007 plus `key2.js`, `midiwrite.js`,
   `scaleview.js`

They were written as `.js` and need renaming to `.ts` to match the build.

## The open bug that matters most

**Key detection reports the wrong key.** A raga-based track in A# was
reported as F# min during a demo. Reproduced and diagnosed:

- The 4096-point FFT is 10.77 Hz per bin; a semitone at A#2 is 6.9 Hz wide.
  Below ~250 Hz one bin spans more than a semitone, so a bass note smears
  across three pitch classes. The tonic is usually the lowest strong note —
  the most important pitch was the worst measured.
- Harmonics vote: a note at A# lights its fifth and third, so a strong bass
  note votes for keys a fifth away. At a 117 Hz tonic the old detector
  reported **F major** — the fifth of A#.
- And raga isn't in a Western key at all; forcing 24 major/minor profiles
  returns whichever wrong answer fits least badly.

`key2.js` fixes this: constant-Q chroma at 16384 FFT, harmonic suppression,
tonic found first with mode as a separate question, 16 scale shapes including
bhairav/bhairavi/yaman/todi. Tonic accuracy went 6/8 → 8/8 on synthetic
material.

**Wiring it in requires changing the FFT size from 4096 to 16384 AND bumping
the parser version**, or old wrong keys stay cached.

**Still unverified against real audio.** I have the actual A# raga track —
that's the test that matters.

## Also queued

- Project page: three buckets — Project files, Renders, Stems — sorted by
  date, scoped to the project folder and below
- Smart Renamer two-pane UI: originals left, Analyse in the middle,
  suggestions right, double-click to edit, Commit and Cancel bottom right,
  left pane re-sorts with unresolved on top, clicking either pane highlights
  both (pair by file path, not row index)
- Scale keyboard + Camelot wheel on the project page, with a drag-out MIDI
  file of the scale sustained across 4 bars
- Custom naming schemes editable in settings, stored separately so updates
  can't wipe them
- `npm test` is a hardcoded chain in `package.json` — new test files must be
  added to it or they never run

## Known concerns

- `app.ts` is ~950 lines carrying list, project page, six tool panels and
  settings. Splitting it is the next structural job.
- TypeScript is nominal: `strict: false`, `noImplicitAny: false`, lib files
  still CommonJS with almost no annotations. Build cost without the safety.
- `npm start` does a full clean rebuild every launch.
- `finisher.ts` `applyGain` clamps to ±1, which is wrong for 32-bit float
  where values above 1.0 are legitimate headroom.

---

**Start by reading `CLAUDE.md` and `docs/proposals/` in the repo, then tell
me what you'd do first.**
