# DAW Buddy 🎵

> **The intelligent, private desktop companion built specifically for music producers, sound designers, and audio engineers.**

[![Tests](https://img.shields.io/badge/tests-21%20passing-brightgreen.svg)]()
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue.svg)]()
[![License](https://img.shields.io/badge/license-MIT-green.svg)]()
[![Version](https://img.shields.io/badge/version-v0.4.2--beta.1-orange.svg)]()

---

## 🎯 Why DAW Buddy Was Created

Every music producer knows the chaos of the studio drive: hundreds of cryptic project versions (`Track_v3_final_FINAL2.als`), gigabytes of duplicated sample pack copies, unorganized stem bounces, and lost session notes. 

Standard operating system file explorers (Windows Explorer, macOS Finder, Linux File Manager) are "musically blind" — they cannot tell you the **tempo (BPM)**, **musical key**, **Camelot wheel code**, **tuning deviation in cents**, **project save history**, or **render versions** without forcing you to launch heavy DAWs and wait for gigabytes of plugins to load.

**DAW Buddy was built to solve this exact problem.** 

Inspired by custom in-house tools built by world-class producers like KSHMR, DAW Buddy is a fast, lightweight, and **100% private** desktop workstation companion. It reads musical metadata straight out of raw session files (`.als`, `.flp`, `.logicx`, `.ptx`, `.cpr`, `.rpp`, `.bwproject`), organizes your discography, and provides a powerful suite of lossless audio and music theory tools.

---

## 🚀 Built for Both Pros and Beginners

Whether you are mixing a multi-platinum album or producing your very first beat, DAW Buddy is engineered to elevate your workflow:

### 🏆 For Pro Producers, Mix Engineers & Sound Designers:
- ⚡ **Instant Session Indexing**: Reads BPM, key, version count, and save timelines across Ableton Live, FL Studio, Logic Pro, Pro Tools, Cubase, Bitwig, and REAPER in milliseconds without touching your CPU.
- 🏷️ **Smart Stem Classifier & Bulk Renamer**: AI-assisted heuristic engine that categorizes messy bounce stems into mix-ready instrument groups (*Kicks, Snares, Basses, Leads, Vocals, FX*) with custom dictionary learning and reversible rollback manifests.
- 🎛️ **Lossless Audio Finisher & Silence Stripper**: Peak/RMS normalization, beat/bar boundary fitting, and threshold-based leading/trailing silence removal with safety transient padding.
- 🎙️ **Vocal Reconstruction Suite**: Split continuous vocal takes into isolated blocks for third-party pitch-correction (Melodyne, Auto-Tune), and re-assemble them with sample-accurate timing.
- 💾 **Duplicate Sample Auditor & Disk Insights**: Identifies duplicate sample copies across projects and reclaims gigabytes of disk space using safe filesystem hard links without breaking session references.
- 🌐 **Cross-Platform Parity**: Full native support across **Windows, macOS (Apple Silicon & Intel), and Linux**.

### 🎓 For Beginners, Arrangers & Songwriters:
- 🎲 **Producer Randomizer & Genre Challenge**: Beat creative block instantly with one-click idea generation: random key, scale, tempo, time signatures, and 48+ curated genre challenges across 9 categories (*Afro House, Organic & Botanica, Bollywood Fusion, Dubstep, Drum & Bass, Melodic Techno*, etc.) with YouTube reference search.
- 🌍 **Interactive 3D Globe & World Scales**: An interactive 3D globe with authentic scale traditions across **Western & Jazz Modes, Indian Classical Raagas & Thaats (with Sargam swaras & Prahar times), Arabic Maqamat, Chinese Pentatonic Modes, Mediterranean & Spanish Flamenco, and Celtic Folk**.
- 🎹 **Scale & Raaga Detector**: Drop any raw audio sample or MIDI file to instantly detect key, scale, tuning deviation in cents, and discover matching cultural traditions.
- 🎼 **Live Phrase Audition & Drag-to-DAW MIDI**: Audition authentic ascending (*Aaroh*) and descending (*Avaroh*) melodic phrases in real-time, and drag SMF MIDI guide tracks directly into your DAW's piano roll.
- ❓ **Interactive Tool Tutorials**: Built-in non-intrusive step-by-step interactive walkthrough tours for every studio tool, re-playable anytime with one click.
- 🎨 **Comic Speech Bubble Theme Lab**: Right-click the theme button to choose from Dark, Light, AMOLED, Minimalist, Ableton-style, and Studio Classic surfaces with 14+ accent colors.

---

### 🌟 Key Features Summary

- **🎲 Producer Randomizer & Genre Challenge**: Full world scale database, BPM, Tala meters, and 48+ curated genre challenges with YouTube inspiration.
- **🎹 Scale & World Tradition Detector**: Instant Chroma matching, cents tuning, Sargam swaras, and direct Drag-to-DAW MIDI export.
- **🌐 Interactive 3D World Globe**: Spin and explore global musical traditions with regional onboarding and customizable DAW scale filters.
- **🏷️ Smart Stem Classifier & Renamer**: Heuristic stem grouping with dictionary overrides and rollback manifests.
- **🎛️ Lossless Audio Finisher**: RMS/Peak normalization, bar/beat boundary trimming, and zero-loss silence padding.
- **🎙️ Vocal Reconstruction**: Lossless silence-split for external tuning workflows and sample-accurate re-assembly.
- **💾 Duplicate Sample Auditor**: Reclaims drive space via non-destructive hard-linking.
- **⚡ Zero-Friction Export**: Drag `[ WAV ]`, `[ MP3 ]`, and `[ FLAC ]` pills directly from the session browser straight into Discord, Telegram, or your DAW tracks.


## Part 1 — Install Node.js (once)

Go to <https://nodejs.org> and download the **LTS** version. Run the installer
and click through the defaults. Node is the engine that runs this app; Electron
is just Node with a window bolted on.

Check it worked — open a terminal:

- **Windows:** press Start, type `cmd`, hit Enter
- **macOS:** press Cmd+Space, type `Terminal`, hit Enter

Then run:

```
node --version
```

If you see something like `v20.11.0`, you're set. If you see "not recognised",
close the terminal, open a new one, and try again — the installer needs a fresh
window to take effect.

---

## Part 2 — Get the app running

**1. Put the `daw-buddy` folder somewhere sensible** — your Downloads or
Documents folder is fine. Avoid OneDrive-synced folders; the file watcher and
OneDrive fight over the same files and you get phantom events.

**2. Point the terminal at that folder.** Type `cd ` (with the trailing space),
then drag the `daw-buddy` folder from Explorer/Finder onto the terminal window —
it pastes the full path for you — and press Enter. It looks like this:

- **Windows:** `cd Downloads\daw-buddy`
- **macOS:** `cd ~/Downloads/daw-buddy`

**3. Install the dependencies.** This reads `package.json` and fetches Electron
and the build tools into a `node_modules` folder:

```
npm install
```

First run takes a few minutes — Electron is a full browser, around 250 MB. You
only do this once.

**4. Start it.**

```
npm start
```

This compiles the TypeScript, bundles the window, and launches the app.

**From then on, just double-click the launcher** instead of using a terminal:

- **Windows:** `DAW Buddy.bat`
- **macOS:** `scripts/DAW Buddy.command` — run `chmod +x "scripts/DAW Buddy.command"`
  once so macOS will let it launch

The launcher checks Node is installed, runs `npm install` on a fresh copy, and
starts the app. Keep the terminal window open while you use it — closing it
quits DAW Buddy, and new bounces are logged there as they're detected.

A window opens. Click **Settings**, then **Add folder**, and pick the folder your
sessions live in. Add as many as you want. The list is yours to edit any time.

---

## Part 3 — Build an installer (optional)

To produce a real installer that any user can double-click — no terminal, no
Node — build it with electron-builder:

```
npm run dist          # installer for the platform you're on
npm run dist:win      # Windows .exe (NSIS)
npm run dist:mac      # macOS .dmg (build on a Mac)
npm run dist:linux    # Linux AppImage
```

The result lands in a `release/` folder. A macOS `.dmg` can only be built on
macOS. The installers are currently **unsigned**, so Windows SmartScreen and
macOS Gatekeeper will warn on first launch until code-signing certificates are
added.

**Automated releases:** `.github/workflows/release.yml` builds all three
platforms and attaches the installers to a GitHub Release whenever you publish
one — no local build needed.

---

## Part 4 — What each part does

```
daw-buddy/
├── package.json          scripts (start / build / test / dist) and dependencies
├── tsconfig*.json        TypeScript config — src/ compiles to dist/
├── src/
│   ├── main/             the Node process — owns the windows and ALL file access
│   │   ├── main.ts
│   │   └── lib/          format parsing, scanning, notes, dedupe, renamer, …
│   ├── preload/          the security airlock between main and each window
│   └── renderer/         the windows — app + splash, no file access at all
├── dist/                 compiled output (generated by the build, git-ignored)
├── docs/                 handover notes, build notes, the manual
└── scripts/              the double-click launchers + build helpers
```

**The one concept worth internalising:** Electron runs two separate programs.
`src/main` is Node — it can read your entire hard drive. `src/renderer` is a web
page — it can't touch a single file. They talk only through the narrow list of
functions in `src/preload`. That split is deliberate: it means a malicious file
name can never become a malicious file operation.

---

## Part 5 — The Settings panel

**Project folders.** Add as many as you like. Each is watched and scanned
independently. The list protects itself from double-counting: add a folder
already inside one on the list and it's refused; add a folder *above* ones on the
list and the redundant children fold into the new parent. Folders that no longer
exist — an unplugged external drive — are quietly dropped at launch.

**How deep it looks.** As deep as your folders go. There's no depth setting. The
scan stops the moment it finds a session file, so a project's insides — samples,
freeze files, stems — are never walked.

**Folder names to skip.** Comma separated. These are never opened and never
listed. `Backup` stays on this list so a 3am auto-save isn't mistaken for your
main session.

Every change applies immediately: the list rescans and the watcher restarts.

---

## Part 6 — Windows and macOS

The app runs the same on both and adapts where they differ:

- **Paths** are built with Node's `path` module, never by gluing strings, so
  they're correct on both.
- **Case.** Windows and macOS treat `C:\Projects` and `c:\projects` as the same
  folder; Linux doesn't. Path comparisons lowercase themselves only where that's
  true.
- **Wording.** The reveal button says "Show in Finder" on macOS, "Show in File
  Explorer" on Windows.
- **File watching.** Windows uses ReadDirectoryChangesW, macOS uses FSEvents;
  chokidar handles the difference. Network shares send neither — that's what the
  polling toggle in Settings is for.

**macOS permissions.** The first time you add a folder in Documents, Desktop,
Downloads or an external drive, macOS asks for permission. If you decline, the
folder shows an error explaining which setting to change.

---

## Part 7 — About the DAW formats

One module, `src/main/lib/daw.ts`, knows every supported format — Ableton,
FL Studio, REAPER, Bitwig Studio, Pro Tools, Studio One / Fender Studio Pro,
Cubase and Logic. Everything else asks it rather than checking file extensions
itself.

- **`.als` (Ableton)** is gzipped XML — un-gzipped in memory, the `<Tempo>` block
  read straight out.
- **`.flp` (FL Studio)** is a binary event stream walked byte by byte; tempo is
  event 156 stored as BPM × 1000. Newer FL versions changed the layout, so a
  bounded header scan is used as a fallback.
- **REAPER `.rpp`** is plain text (`TEMPO 128 4 4`).
- **Bitwig `.bwproject`** files are listed and opened, and copies in
  `auto-backup` are counted instead of appearing as separate songs.
- **Pro Tools `.ptx`** sessions are listed and opened. `Session File Backups`
  contributes to project health, `Audio Files` is treated as recorded source,
  and finished audio in `Bounced Files` is available as a render.
- **Bitwig, Pro Tools, Cubase and Logic** tempos aren't readable yet — those
  rows show `— — —` for BPM but still list with everything else working.

Backups are counted per DAW: Ableton and FL use a `Backup` folder (FL also
writes `(autosaved…)` siblings), REAPER uses `.rpp-bak`, and so on. A project
that can't give up its BPM is still listed with name, date, health bar, notes,
renders and key detection intact.

---

## Part 8 — Where your data lives

Notes and settings are stored in Electron's standard app-data location:

- **Windows:** `C:\Users\<you>\AppData\Roaming\daw-buddy\`
- **macOS:** `~/Library/Application Support/daw-buddy/`

You'll find `notes.json`, `settings.json` and `cache.json` there — all plain
text. Back up `notes.json` if the notes start mattering.

---

## Part 9 — The bounce watcher

The watcher watches your project roots for new audio. When a render appears, a
line prints in the terminal and a toast slides into the corner of the window.
`awaitWriteFinish` means it waits until the file stops growing for a few seconds
before saying anything, so you never get an alert for a half-written file.

Bounce alerts stay local — DAW Buddy does not send files, notifications or
account details anywhere.

---

## When something goes wrong

- **`npm` is not recognised** — Node didn't install, or you need a fresh terminal.
- **Window opens blank** — press Ctrl+Shift+I (Cmd+Option+I on Mac) and read the
  red text in the Console tab.
- **A project shows `— — —` for BPM** — hover the meta line; the reason is printed
  there. Usually a DAW version whose tempo layout isn't recognised.
- **Nothing appears after adding a folder** — check the skip list in Settings
  hasn't caught a folder name you actually use.
- **A folder disappeared from Settings** — it wasn't connected at launch. Plug the
  drive in, restart, add it back.

---

## For developers

```
npm start        build + launch
npm run build    compile main (tsc) + bundle renderer (esbuild) into dist/
npm test         run the lib regression tests (via tsx)
npm run typecheck   type-check main and renderer without emitting
npm run dist     package an installer
```

See `CLAUDE.md` for the architecture and the invariants to preserve, and
`docs/` for the running build notes.
