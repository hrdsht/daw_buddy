# DAW Buddy

Current source build: **0.2.0**

A local desktop app that lists your music production project folders, reads the
BPM straight out of the session file, shows how many backups each project has,
keeps per-project mix notes, and tells you when a new bounce lands on disk.
Each project opens on a list of its DAW files, while separate Renders and Stems
pages let you audition related audio without leaving the app. Numbered and
bounced session files in the same folder are treated as versions of one song,
so opening version 4 can still find a render made from version 3.

Build 0.2.0 adds the animated startup screen and scans projects behind it,
groups project utilities into a focused Tools page, provides a standalone
Strip silence workflow for any chosen folder, and adds Select all controls to
Sample cleanup.

You tell it which folders to look at, in Settings. It never scans your whole
computer — the only folders ever opened are the ones on your list.

Nothing leaves your machine. There is no server, no account, no internet call
except the two font files the window loads.

---

## Part 1 — Install the two things you need (once)

**1. Install Node.js.** Go to <https://nodejs.org> and download the **LTS**
version. Run the installer, click through the defaults. Node is the engine that
runs this app; Electron is just Node with a window bolted on.

**2. Check it worked.** Open a terminal:

- Windows: press Start, type `cmd`, hit Enter
- macOS: press Cmd+Space, type `Terminal`, hit Enter

Type this and press Enter:

```
node --version
```

If you see something like `v20.11.0`, you're set. If you see "not recognised",
close the terminal, open a new one, and try again — the installer needs a fresh
window to take effect.

---

## Part 2 — Get the app running

**1. Put the `daw-buddy` folder somewhere sensible.** Your Downloads
folder is fine. Avoid OneDrive-synced folders — the file watcher and OneDrive
fight over the same files and you get phantom events.

**2. Point the terminal at that folder.** Type `cd ` (with the space), then drag
the `daw-buddy` folder from Explorer/Finder onto the terminal window. It
pastes the path for you. Press Enter.

```
cd C:\Users\hpkal\Downloads\daw-buddy
```

**3. Download the app's dependencies.** This reads `package.json` and fetches
Electron and chokidar into a `node_modules` folder:

```
npm install
```

First run takes a few minutes — Electron is a full browser, around 250 MB. You
only do this once.

**4. Start it.**

```
npm start
```

**From then on, just double-click `DAW Buddy.bat`.** It does all of the
above for you — checks Node is installed, runs `npm install` if this is a fresh
copy, and starts the app. On a Mac the equivalent is `DAW Buddy.command`,
which needs `chmod +x` run on it once before macOS will let it launch.

Keep the black window open while you use the app; closing it quits Project
Browser. New bounces are logged there as they're detected.

A window opens. Click **Settings**, then **Add folder**, and pick the folder
your sessions live in. Add as many as you want — internal drive, external
drive, archive. The list is yours to edit any time.

To quit, close the window. To start it again, `cd` back into the folder and run
`npm start`.

---

## Part 3 — What each file does

```
daw-buddy/
├── package.json      the shopping list of dependencies + the "npm start" command
├── main.js           the Node process. Owns the window and all file access.
├── preload.js        the security airlock between the two halves
├── lib/
│   ├── settings.js   your folder list and ignore list
│   ├── scanner.js    walks your folders, builds one record per project
│   ├── ableton.js    un-gzips .als in memory, pulls BPM out of the XML
│   ├── flp.js        walks the .flp binary format, pulls BPM out of the events
│   ├── notes.js      reads and writes notes.json
│   └── watcher.js    chokidar — fires when a new .wav appears
└── src/
    ├── index.html    the window's markup
    ├── styles.css    the dark theme
    └── renderer.js   draws the list, handles clicks. No file access at all.
```

**The one concept worth internalising:** Electron runs two separate programs.
`main.js` is Node — it can read your entire hard drive. `renderer.js` is a web
page — it can't touch a single file. They talk through the narrow list of
functions in `preload.js`. That split is deliberate. It means a malicious file
name can never become a malicious file operation.

---

## Part 3.5 — The Settings panel

**Project folders.** Add as many as you like. Each one is watched and scanned
independently, and the folder name shows as a tag on every project inside it
once you have more than one.

The list protects itself from double-counting. Add a folder that's already
inside one on the list and it's refused with an explanation. Add a folder that
sits *above* ones already on the list and the redundant children get folded
into the new parent. Folders that no longer exist — an external drive that's
unplugged — are quietly dropped at launch rather than throwing errors.

**How deep it looks.** As deep as your folders go. There's no setting,
because asking you how deep your own folders are is the app avoiding its job.

The scan stops the moment it finds a session file, so a project's insides —
samples, freeze files, 900 stems — are never walked. A project can't contain
another project. That's what keeps a bottomless scan cheap. Each project shows
its trail under the name, so `2026 / May 2026 / Suraag` tells you where it
came from.

**Folder names to skip.** Comma separated. These are never opened and never
listed. `Backup` stays on this list — it's how a 3am auto-save avoids being
mistaken for your main session.

Every change applies immediately: the list rescans and the file watcher
restarts over the new folder list.

---

## Part 3.6 — Windows and macOS

The app runs the same on both. Where the two differ, it adapts rather than
picking a favourite.

- **Paths.** Never assembled by gluing strings with `\` or `/`. Node's `path`
  module does it, so it's correct on both.
- **Case.** Windows and macOS treat `C:\Projects` and `c:\projects` as the
  same folder; Linux doesn't. Path comparisons lowercase themselves only on
  the platforms where that's true.
- **Wording.** The reveal button says "Show in Finder" on macOS and "Show in
  File Explorer" on Windows.
- **Window chrome.** macOS hides the title bar and floats the traffic lights
  over the app's own bar. Windows keeps its normal frame — faking one there
  gets you a window that misbehaves when snapped or maximised.
- **File watching.** Windows uses ReadDirectoryChangesW, macOS uses FSEvents.
  chokidar handles the difference. Network shares and some external drives
  send neither, which is what the polling toggle in Settings is for.

**macOS permissions.** The first time you add a folder in Documents, Desktop,
Downloads or an external drive, macOS will ask for permission. If you decline,
the folder shows an error explaining exactly which setting to change. Windows
has no equivalent prompt.

**Not yet done:** packaging into a real `.exe` and `.dmg`. Right now both
platforms run it the same way, with `npm start`.

---

## Part 4 — About the two DAW formats

Your brief assumed `.als` and `.flp` work the same way. They don't, and this is
the one place the plan needed changing.

**`.als` is gzipped XML.** Exactly as you described. `ableton.js` reads the file
into memory, un-gzips it in memory, and searches the resulting text for the
`<Tempo>` block. Nothing touches disk.

**`.flp` is a binary format**, closer to a MIDI file than to XML. There is no
XML in there to find. `flp.js` walks the file byte by byte: read an ID byte, and
the ID tells you how many bytes of data follow. Tempo is event 156, stored as
BPM × 1000, so `174000` means 174 BPM. Older projects use event 66 instead,
which we fall back to.

Because the format is undocumented and Image-Line changes it between versions,
`flp.js` fails gracefully — the row shows `– – –` for BPM rather than the app
crashing.

**One more FL caveat:** FL Studio doesn't put backups in a `Backup` folder next
to your project. It keeps them in one shared folder under your FL Studio user
data. So FL projects will usually show 0 backups. Ableton projects will show
real numbers. That's a limitation of how FL works, not a bug here.

---

## Part 5 — Where your data lives

Notes and settings are stored in Electron's standard app-data location:

- Windows: `C:\Users\<you>\AppData\Roaming\daw-buddy\`
- macOS: `~/Library/Application Support/daw-buddy/`

You'll find `notes.json` and `settings.json` there. Both are plain text — open
them in Notepad any time. Back up `notes.json` if the notes start mattering.

---

## Part 6 — The bounce watcher

`watcher.js` watches the whole Projects root for new `.wav` files. When one
appears, two things happen: a line prints in the terminal where you ran
`npm start`, and a toast slides into the bottom-right of the window.

The setting that makes this actually usable is `awaitWriteFinish`. A bounce
appears on disk the instant your DAW starts writing it and keeps growing for
however long the render takes. Without that setting you'd get an alert for a
44-byte file. With it, chokidar waits until the file size stops changing for
3 seconds before saying anything.

Bounce alerts deliberately stay local: DAW Buddy does not send files,
notifications or account details over email.

---

## When something goes wrong

**`npm` is not recognised** — Node didn't install, or you need a fresh terminal
window.

**Window opens blank/white** — press Ctrl+Shift+I (Cmd+Option+I on Mac) to open
developer tools and read the red text in the Console tab. That message is
almost always a typo'd filename.

**A project shows `– – –` for BPM** — hover the meta line under the project
name; the reason is printed there. Usually it means the newest session file is
from a Live version with a different tag layout, or an FL version this parser
doesn't recognise.

**A folder shows as "Folder" with a project count** — that's a container, not
a project. Click it to go inside; the breadcrumb bar at the top takes you back
out. Folders like this only appear when they hold nothing but empty folders —
anything with a real project inside gets listed flat instead.

**Nothing appears after adding a folder** — check the skip list in Settings
hasn't caught a folder name you actually use.

**A folder disappeared from Settings** — it wasn't there at launch. Usually an
external drive that wasn't connected. Plug it in, restart the app, add it back.

**Scanning feels slow** — every project's newest session file gets un-gzipped on
each scan. With 200+ projects that adds up. The fix, when you get there, is to
cache results by file modification time and only re-parse what changed.

---

## Ideas for the next pass

- Cache parsed BPM so rescans are instant
- Search box filtering by name, BPM range, or note contents
- Read the sample rate and time signature out of the same XML
- Colour the spine by DAW rather than by "newest"
- Package it into a real installable `.exe` with `electron-builder`
