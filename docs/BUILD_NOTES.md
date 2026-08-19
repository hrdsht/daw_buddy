# Build notes

## BUILT 19 Aug — Key detection rework & Scale/Camelot UI (proposal 0007)

- **Key detection engine rework**:
  - `src/renderer/dsp.ts` upgraded to 16,384-point FFT (`RECOMMENDED_FFT = 16384`) with sub-60Hz frequency resolution (2.69 Hz/bin).
  - Constant-Q chroma integration (`chromaFromSpectrum`) measuring semitone energy directly across MIDI 33–96 with octave weighting.
  - Subtractive harmonic suppression (`suppressHarmonics`) removing 5th, 3rd, and 7th overtone leakage to eliminate false fifth/third votes (e.g. F for A#).
  - Decoupled tonic-first analysis (`findTonic`) using presence, frame stability, and 5th/4th support.
  - 16 scale shapes recognised (`findScale`): Major, Minor, Harmonic/Melodic Minor, Dorian, Phrygian, Lydian, Mixolydian, Bhairav, Bhairavi, Todi, Yaman, Charukesi, Pentatonic Major/Minor, Blues.
  - Reports `tonic`, `scale`, `key` (only for Western major/minor), `camelot` (only for Western major/minor), and `modal` flag.
- **Data storage & drone playback**:
  - `notes.ts` updated with `tonic`, `scale`, `modal`, `scaleConfidence` fields.
  - `drone.ts` `rootNoteOf` updated to prioritize `record.tonic`, allowing modal and raga tracks without a Western key to play the correct root drone.
- **Scale view & Camelot wheel UI on Project Page**:
  - Integrated 2-octave proportioned Scale Keyboard (`scaleview.ts`), highlighting Tonic in amber, in-scale notes in crisp tint, and out-of-scale notes dimmed, with hover scale degree tooltips.
  - Added **Drag MIDI to DAW** button (`midiwrite.ts` generating 4-bar sustained chord SMF format 0 at project tempo), supporting native Electron file dragging into DAWs (`tools:dragMidi`) and click-to-export.
  - Added Camelot Wheel SVG widget (`scaleview.ts`) showing the 12-position circle of fifths with active key and compatible neighbours (relative, +1, -1), or displaying modal status when outside the Western circle.
- **Verified**:
  - Tested on synthetic raga at 58 Hz, 117 Hz, 233 Hz (A# Bhairav correctly identified at all registers).
  - `test/scaleview.test.js`, `test/midiwrite.test.js`, `test/dsp.test.js`, `test/drone.test.js` all pass.

## BUILT 17 Aug — vocal timeline round trip (proposal 0005, Phase 1 + 2)

- New sidebar tool **Vocal reconstruction**, with **Split vocal** and
  **Rebuild timeline** sub-tabs. Implements 0005's round trip end to end;
  the waveform-alignment editor for mismatched blocks stays deferred, as the
  proposal itself specifies.
- **Split**: `lib/vocalSplit.ts` walks a WAV in 50ms windows (RMS or Peak,
  same math as `silence.ts`), merges any silent run shorter than the
  configured minimum gap into the block(s) either side (a breath shouldn't
  fragment a phrase), then grows each block into its bordering silence by
  the pad amount — clamped so two blocks reaching for the same gap can never
  overlap. Writes numbered block WAVs (`0001.wav`, ...) and a versioned
  `manifest.json` into a new sibling folder next to the source; the source
  itself is only ever read.
- **Rebuild**: `lib/vocalRebuild.ts` places each processed block at its own
  saved absolute start frame in a zero-filled buffer sized to the original
  file — not appended one after another — so a shorter processed block
  automatically leaves the right silence before whatever comes next with no
  special-casing. A block that would run past the next block's original
  position is left silent and reported, never overlapped or truncated.
  Missing files, format mismatches and blocks identical to their own
  original export are all reported per-block before anything is written.
- Verified against a synthetic WAV with known active/silence timing: split
  finds the expected block count and durations; unmodified blocks round-trip
  to PCM-identical output; a deliberately oversized replacement block is
  flagged and excluded rather than corrupting the timeline (`test/regression.js`).
- `writeWav` (new in `vocalWav.ts`) is the first from-scratch WAV writer in
  the codebase — `silence.ts`'s `buildHeader` only rebuilds a header from an
  existing buffer's own chunks, which doesn't cover synthesizing a new file
  out of many sources.

## BUILT 14 Aug — this session

- **One entry per session file**, not per folder. A folder with eight `.als`
  files now produces eight rows, each with its own name, date and BPM.
  Verified against a replica of `Olaala bgm idea 3 Project`: 1 row became 8,
  including "Yogi babu intro opt 2 85bpm" correctly reading 85.
- **FL Studio tempo fixed.** The sequential event walk still runs; when it
  comes back empty a bounded scan of the header region looks for event 156
  directly. Verified on the real `Reel alignment ai voice.flp` (FL 26.1.3):
  was "no tempo found", now 140 BPM.
- **FL backups counted from both places** — the `Backup` subfolder and
  `(autosaved…)` siblings. That file went from 0 saves to 7.
- **Renders matched by name across folders.** `Bangalore entry.als` now finds
  `Suraag/Renders/Bangalore entry.wav` two levels up, and
  `Bangalore entry 2.als` finds its mp3 in `Bounces`. The more specific
  session name wins, so version 1's render doesn't get claimed by the base
  name.
- **Render folders matched by reading directories**, not by joining a guessed
  lowercase name — that worked on Windows by luck and failed everywhere else,
  and would never have found "Ai Stems".
- **Parse cache** keyed on path + mtime + size + parser version. Second scan
  went 22ms → 2ms with 12 cached / 0 parsed. Touching one file re-parsed
  exactly one. Bumping a parser version invalidates only that format.
- **De-duplicator**: budget raised from 8,000 to 250,000 and truncation is now
  reported; `Samples/Splice` added; Max devices (`.amxd`) added; matching on
  relative path shape so `Samples/Imported` and `Max Audio Effect/Imported`
  can't be confused. Verified `Processed` and `Recorded` still untouched.
- **Renamer**: points at any folder via a picker, one Remove box, one Add box,
  and Beginning/End as an either-or. Added text is literal.
- **Shortcuts and linked folders** skipped by default, with a settings toggle.
  Cycle detection via `realpath` added; depth ceiling raised to 64 as a
  backstop only.
- **Output folder** created on first run inside the first root, and added to
  the skip list immediately.
- `Presets` added to the never-a-project list — five wasted levels on every
  Ableton project.

## KSHMR feature gap analysis (from the XLNT Show walkthrough)

Source: member-only video, summarised by Gemini into a built/missing table.
Checked against the codebase — the table is broadly right, with two errors
worth knowing.

### Two things marked "Built" that you can't actually reach

**Template renaming tokens.** `applyTemplate` exists in `lib/renamer.js` and
works — `{project}_{name}_{n:02}`, `{bpm}`, `{key}`, `{date}` all tested. But
there are **zero references to it in `src/app.js`**. The Rename tab only
exposes Remove/Add with prefix-or-suffix. The engine is finished and has no
button. Cheapest high-value work on this whole list.

**Deep subfolder view.** `listAllAudio` exists in `lib/renders.js` and also
has zero UI references. KSHMR's version flattens every audio file across all
nested folders into one list. The function is written; it needs a view.

Lesson worth carrying: "built" in the notes has meant "the module works", not
"you can use it". Those are different, and only the second one counts.

### Missing, ordered by value per hour of work

| Feature | Effort | Notes |
|---|---|---|
| **Harmonic reference drone** | Low | We already detect the root note. A Web Audio oscillator on that pitch, toggle on the player. Small change, big feel — auditioning a vocal against a held root is genuinely useful. |
| **Too-quiet file scanner** | Low | Reuses the RMS measurement in `silence.js` verbatim. Different threshold, different verdict. Nearly free. |
| **Off-grid loop scanner** | Low | `duration × bpm / 60` should land near a whole number of beats. Flag files that don't. We have both duration and detected tempo already. |
| **Audition soft clipper** | Low | `WaveShaperNode` with a tanh curve. Twenty lines. |
| **Audition reverb** | Medium | `ConvolverNode` needs an impulse response. Can be synthesised — decaying noise burst — rather than shipping an IR file. |
| **Waveform drag-to-trim** | Medium | The waveform and the WAV writer both exist. This is the UI in between: drag handles, then write the trimmed region. Arguably more useful than most of this list, and Gemini's table omits it entirely despite listing it in the walkthrough. |
| **Asterisk note tagging** | Medium | `Kick_01 *clips at 2s*.wav` — note carried in the filename, parsed out for display. Clever because the note survives outside any app. Fits naturally with the renamer. |
| **Mini tray window** | Medium | Electron `Tray` plus a compact always-on-top window sharing player state. Fits the existing "On top" workflow. |
| **Dual-pane comparison** | High | Split browser, drag files between keep and reject. Moves files, so it needs the same preview-and-undo treatment as the renamer. |
| **AI descriptive naming** | High | KSHMR's generates contextual names — Granite, Avalanche, Nordic. A fixed adjective dictionary is a much weaker thing wearing the same name. Worth being honest that we'd be building the weaker version unless a model is involved. |

### What we have that the video didn't show

Worth noting so it doesn't get lost: multi-DAW parsing beyond Ableton, the FL
26 tempo workaround, hard-link de-duplication, cross-platform support, and the
parse cache. Those aren't in KSHMR's tool as far as the walkthrough showed.

---

## N0. Club similar session names into one project with versions

Six rows for what is one piece of work:

```
Nava bharat jodo 3            75 BPM   18h ago
Nava bharat jodo 3 bounced_3  75 BPM    1d ago
Nava bharat jodo 3 bounced_2  75 BPM    1d ago
Nava bharat jodo 3 bounced    75 BPM    2d ago
Nava bharat jodo 2            75 BPM    2d ago
Nava bharat jodo              75 BPM    2d ago
```

Same folder, same tempo, same song. Should be **one row reading "Nava bharat
jodo", newest date, expandable to six versions.**

### The rule, and the safeguard that makes it safe

Reduce a name to a stem by stripping, from the end, repeatedly:

- trailing numbers and version markers — `3`, `_2`, `v4`
- state words — `bounced`, `final`, `master`, `mixdown`, `mix`, `export`,
  `rough`, `edit`, `wip`, `copy`

`Nava bharat jodo 3 bounced_3` → strip `_3` → strip `bounced` → strip `3` →
**`Nava bharat jodo`**.

**The safeguard: never strip unless the result matches a sibling.** Stripping
blindly would turn a project genuinely called "Studio 54" into "Studio", and a
one-off named "Take 2" into "Take". Only collapse a name when the stem
actually matches another session **in the same folder** — grouping happens
only where there's evidence for it, and a lone file always keeps its full
name.

### Same folder only — deliberately

From the same screenshot:

```
Adi - Kannamaniye   ADI - Olave / … / Adi - Kannamaniye · FL Studio
Adi - Kanmaniye     ADI - Olave / … / Adi - Kanmaniye Project · Ableton
Adi - Kannamaniye   ADI - Olave / … / Adi - Drums Programming · Ableton
```

Nearly the same name — one is a typo variant — across three folders and two
DAWs. Fuzzy-matching across folders would merge these, and possibly merge
things that only look alike. Folder boundaries are a real signal about intent;
same-folder-only keeps the rule honest.

### What the grouped row shows

| Field | Value |
|---|---|
| Name | the shared stem |
| Badge | `6 versions` — click to expand in place |
| BPM | the newest version's |
| Date | the newest version's |
| Saves | the folder's backup count, as now |
| Play | live if any version has a render |

Expanded, each version is its own row: full filename, own date, own BPM, and
its own Open button.

### Must not break

- **Notes stay per session file.** Each version keeps its own note and its own
  txt file. Grouping is a display concern only — it must not touch the data
  model, which is keyed on the session path.
- **Renders match the version family.** Opening `Nava bharat jodo 4` also
  shows audio rendered from `Nava bharat jodo 3` or its bounced variants.
  Unrelated project names in the same folder remain excluded.
- **A toggle to switch grouping off**, next to the DAW filters. Some days you
  want all 678.
- The count in the sidebar should show groups, with the raw number available —
  "412 projects (678 files)".

### Open question

`Yogi babu intro opt 2` and `Yogi babu intro opt 3` reduce to the same stem,
but "opt" suggests deliberate alternatives rather than versions of one thing.
Group them or not? Leaning group-with-expand, since nothing is lost and one
click shows both — but worth your call.

---

## NEXT UP — from 14 Aug testing

### N1. BUG: "Audio 70" and "No render found" on the same page

Screenshot: `Nava bharat jodo 3` shows **Audio 70** in the facts line, and
immediately below, "No render found matching Nava bharat jodo 3".

Two different matchers disagreeing:

- the row/page count comes from `countAudioFor` in `scanner.js` — a cheap
  global name match over every audio stem the walk indexed, ignoring location
- the render list comes from `findRenders` in `renders.js` — location-aware,
  walks the project folder and ancestor render folders, and lets a more
  specific sibling name win

Likely cause: the count matches loosely on a shorter name (the folder is
`Nava Bharat Jodo`, the session is `Nava bharat jodo 3`) while the page
demands the full one. Needs checking against the real folder rather than
guessed.

**Fix direction: one matcher, used by both.** Have the scan run the real
match once and store the count, or drop the count from the row entirely. A
number the page then contradicts is worse than no number at all.

### N2. Project files box on the project page

A fourth selectable box alongside Renders / Notes / Rename / Strip tags,
listing **the other session files in this folder**.

Behaviour:

- The box lists every `.als` / `.flp` / etc. in the same folder — the eight
  Yogi files, the three Bangalore entry files
- Click one → it becomes the selected project, showing its own versions
- Click a session file → its renders list, mp3 and wav, exactly as the
  Renders tab does now

This is the same information the "N in folder" row badge hints at, but
reachable from inside a project rather than only from the list. It's how you'd
move between eight versions of the same idea without going back out to the
list and searching.

Note the wording distinction to keep straight in the UI: **versions** are the
other session files in the folder; **renders** are the audio each one
produced. Conflating those two is what made the old model wrong in the first
place.

### N2b. DAW filters in the left pane

A DAWS section in the sidebar, below FOLDERS, one row per DAW with a count:

```
COLLECTIONS
  All projects      678
  Favourites          0

DAWS
  Ableton           512
  FL Studio         160
  REAPER              6

FOLDERS
  Jump              678
```

- Built from what the scan actually found — never list a DAW with zero
  projects. A REAPER row on a machine with no REAPER projects is noise.
- Click to filter, click again to clear, same behaviour as the folder rows.
- Stacks with the folder filter: Ableton **and** Jump narrows to both.
- Also worth adding as a sort option on the Name column header, so the list
  can be grouped by DAW without filtering.

Cheap to build — `entry.daw` is already on every row.

### N2c. Location breadcrumb is truncating

Visible in the same screenshot:

```
ADI - Olave / Adi - Drums Programming / Adi - Kannamaniye / Adi - Kannamaniye Project · Abl…
```

The DAW name gets cut off because the path ate the width. Two fixes worth
doing together:

- Move the DAW out of the breadcrumb — once there's a DAW filter and column
  it's redundant there anyway
- Truncate the path from the **middle**, not the end. The last folder is the
  most useful part and it's currently the first thing lost:
  `ADI - Olave / … / Adi - Kannamaniye Project`

### N3. Colour palette in Settings — with measured contrast

One accent per VIBGYOR family, all chosen to sit on near-black without
glowing. **Live preview: applying on click, not on save.** It's only setting
variables on `:root`, and you'll know in a second whether green feels right.

Contrast measured against the real background (`#0d0d0e`) and against both
candidate ink colours. WCAG wants 4.5:1 for normal text, 3:1 for large text
and UI:

| Family | Hex | As text on bg | Dark ink on fill | White ink on fill |
|---|---|---|---|---|
| Violet | `#9B6DFF` | 5.6:1 | **5.5:1** | 3.5:1 |
| Indigo | `#7C83FF` | 6.1:1 | **5.9:1** | 3.2:1 |
| Blue | `#3EA6FF` | 7.5:1 | **7.3:1** | 2.6:1 |
| Green | `#2FD46B` | 9.9:1 | **9.7:1** | 2.0:1 |
| Yellow | `#F2CE4B` | 12.7:1 | **12.4:1** | 1.5:1 |
| Orange | `#F0A63A` | 9.5:1 | **9.3:1** | 2.1:1 |
| Red | `#F0574B` | 5.7:1 | **5.6:1** | 3.4:1 |

**Correction to an earlier assumption.** I said violet, indigo and blue would
need white ink on their fills. Measured, that's wrong — white ink fails on
every single one, badly (2.0 to 3.5), while dark ink passes 4.5:1 on all
seven. These accents are light and saturated enough that dark ink always wins.

So the design is simpler than expected: **one shared dark ink** (`#12100a`)
across the whole palette, no per-colour ink field needed. Every accent also
clears 4.5:1 as text on the background, so accent-coloured text is safe
everywhere too.

Amber sits between yellow and orange, so it takes the orange slot rather than
being an eighth option — `#F0A63A` is the current colour exactly, and stays
the default.

**Each palette entry still carries four values**, just not the one I expected:

```
accent      the fill and accent text
ink         #12100a — shared, dark, passes on all seven
hover       accent lightened ~10% for hover on solid buttons
soft        accent at 14% alpha, for badges and tinted rows
```

**The key colour still collides.** Musical key and Camelot use sage green
deliberately so tempo and key never blur together, and choosing green as the
accent merges them. Derive the key colour by rotating the accent's hue far
enough away — that keeps them distinct whatever is chosen, and looks better
than a fixed neutral sitting next to a strong accent. Needs a check that the
derived colour also clears 4.5:1; worth measuring rather than assuming, given
the above.

Also to check when built: the waveform gradient, the play button, the meter
fill and the focus ring all read the accent, so all four need looking at on
the darkest option (violet) and the brightest (yellow) before it ships.

---

## STILL TO BUILD

- **Silence removal.** Needs the WAV encoder (RIFF chunks, 16/24-bit and
  32-bit float). Settings agreed: RMS default, −72 dB, End-only, 10ms tail.
  Writes to the output folder, never in place.
- Rename templates with `{bpm}` `{key}` tokens
- REAPER/Cubase/Logic verification against real files
- Packaging to .exe / .dmg


Everything agreed but not yet built. Updated 13 Aug 2026.

Nothing in here has been written yet. Ordered roughly by what should happen
first — bugs before features, and anything that modifies your files last.

---

## 00000. Cache, output folder, and the two audio tools

### The cache — stop rescanning from scratch every launch

Scanning on every open is the wrong default. What's slow is not reading the
folder tree — `readdir` and `stat` are cheap — it's **opening and gunzipping
every `.als` to read the tempo**. Roughly 50-100ms per set, so 300 projects is
30 seconds of pure decompression.

Aside on why we can't do what Everything does: it never walks folders at all.
It opens the NTFS volume and reads the Master File Table — one flat table
where every file has a fixed-size record pointing at its parent — then keeps
current from the USN Change Journal. Chasing a linked list versus reading a
contiguous array. But it needs admin rights, only works on NTFS, and crucially
**it never opens a file** — it knows names, sizes and dates, nothing more. It
could never tell you a BPM. So the index isn't the win here; not re-parsing
unchanged files is.

**Design:**

- One `cache.json` beside `notes.json` and `settings.json`
- Written atomically — temp file then rename, so a crash can't corrupt it
- Keyed per session file on **path + mtime + size**. Size is in there because
  mtime alone misses same-second writes
- Unchanged file → reuse the parsed BPM. Changed → re-parse
- On launch: load cache, **render immediately**, rescan in the background and
  update rows in place. Projects appear the moment the window opens

**Non-negotiable: a parser version stamp per format.** When the FL tempo
parser gets fixed, every cached FL BPM is wrong. Without a version stamp the
cache would serve those wrong numbers forever, and it would look like the fix
failed. Bumping the FL parser version invalidates FL entries only and leaves
Ableton's intact. A cache without this is worse than no cache.

Folder mtime can be a hint but never the sole test — Ableton and FL save via
temp-file-and-rename which does bump the parent folder, but a plain in-place
write doesn't. Always stat the files.

**Open:** app data folder (tidy) or written into the Jump root so it travels
with the drive and the cousin's machine picks it up (portable)?

### Output folder

Created on **first startup**, inside the project root.

- With several roots configured, create it in the first one, but show the path
  in Settings and allow changing it. Writing processed audio to whichever
  drive happens to be first is a default that's fine until it isn't
- **Added to the skip list the moment it's created.** Otherwise the app scans
  its own output and processed files start showing up as renders belonging to
  projects — fine on day one, baffling on day thirty
- Silence removal mirrors the source folder name inside it —
  `Output/Suraag stems/`, not one flat pile

---

## Tool 1 — Advanced renamer (build first)

Priority. No DSP, no encoder, bounded piece of work.

**Works on a folder you point at**, not the selected project. Folder picker
plus a list of recently used folders, since the same stems folders come up
repeatedly.

**Controls, as specified:**

- **Remove** — one text box. That string is stripped from every name.
- **Add** — one text box, with **prefix / suffix as an either-or choice**.
  Never both at once. Radio buttons or a two-option segmented control, one
  always selected, defaulting to prefix.

**Added text is literal, no separator inserted.** Prefix `MIX` on `Vocals_01`
gives `MIXVocals_01`. Want the underscore, type `MIX_`. Predictable beats
clever.

Remove and Add apply in one pass, both reflected in the preview.

**Templates, later in the same tool:** `{name}` `{ext}` `{parent}` `{n}`
`{n:03}` `{bpm}` `{key}` `{date}` `{project}`. So `{project}_{name}_{n:02}`
reproduces the stem convention. Saved templates matter more than the token
list — renaming stems the same way every time should be one dropdown pick.

**Blocked on the model fix:** `{bpm}` and `{key}` must not ship until BPM and
key read correctly, or wrong values get baked into filenames permanently.

**Keep from the current version:** full old → new preview before anything
moves, collision detection, undo. Not features — the reason a bulk rename is
runnable without fear.

---

## Tool 2 — Silence removal (build second)

**Never in place.** Reads from the folder you point at, writes to the output
folder. Originals untouched. A destructive default on a sample library is the
one mistake with no undo.

**Four settings:**

| Setting | Options | Default | Why |
|---|---|---|---|
| Detection | Peak / RMS | **RMS**, short window | Peak treats one stray sample as audio; real recordings have noise floor. His tool defaults Peak — I'd differ |
| Threshold | dB | **−72 dB** | Near the noise floor of a 16-bit file. Conservative, matches his |
| Where | Start / End / Both | **End** | End-only is safe. Trimming the start shifts everything downstream in time, which changes meaning for loops and grid-aligned material |
| Tail | ms of padding | **10 ms** + short fade | Cutting at the exact sample where audio drops below threshold truncates a decaying waveform mid-cycle and clicks. This detail is the difference between a tool you trust and one that adds artefacts to everything |

**The real work is the WAV encoder.** Parsing RIFF chunks, handling 16-bit,
24-bit and 32-bit float, preserving sample rate and channel count. 24-bit is
where it goes wrong — no native type, so it's three bytes assembled by hand.

**It must refuse what it doesn't fully understand** rather than guessing.
Skipping a file is a minor annoyance; writing a corrupted one over a master is
not. Unknown chunk layouts, exotic bit depths, compressed WAV — skip and say
so.

---

## Order

1. Model fix (one row per session file, render matching by name)
2. FL parser fix, FL Backup folder counting
3. Cache with parser version stamps
4. De-duplicator fixes — budget, Splice, Max devices
5. Advanced renamer
6. Output folder + silence removal

Everything below 3 depends on 1 and 2 being right first.

---

## 0000. De-duplicator is missing most of the drive — diagnosed

Reported: only ~100 samples turned up. Read the real drive and found three
reasons, plus a fourth thing worth adding.

### Reality check: one project's Imported folder

`Suraag/Oh Andava/Oh andava Project/Samples/Imported` — **124 files, 649 MB.**
In a single project. There are hundreds of projects.

So ~100 samples across the whole scan is not "less than expected", it's
roughly one folder's worth. Something is stopping the walk early.

### Cause 1 — the folder budget runs out silently

`dedupe.js` has `MAX_FOLDERS = 8000` and stops when it's spent, with **no
warning and no message**. Your Jump tree is far bigger than that. The scan
almost certainly dies partway through and reports whatever it managed.

Same class of mistake as the old depth setting: an arbitrary limit that
produces a plausible-looking wrong answer instead of an error.

Fix: raise it a long way, and when it *is* hit, say so loudly. A truncated
scan must never look like a complete one.

### Cause 2 — only `Samples/Imported` is looked at

The real layout has four categories, not three:

```
Oh andava Project/Samples/
├── Imported/     124 files, 649 MB   scanned today
├── Processed/                        correctly excluded — Ableton made these
├── Recorded/                         correctly excluded — your takes
└── Splice/       Splice downloads    NOT SCANNED AT ALL
```

`Splice` is pack material by definition — the clearest possible dedupe
candidate — and the code walks straight past it because it only knows the name
`Imported`.

Fix: treat `Samples/Imported` **and** `Samples/Splice` as fair game. Keep
`Processed` and `Recorded` excluded; that rule was right.

### Cause 3 — the walk stops at `Samples` and never looks deeper

On finding a `Samples` folder the walk checks for `Imported`, then `continue`s
without descending. Any structure that doesn't match exactly is skipped
entirely rather than explored.

### New: Max devices

```
Oh andava Project/Presets/Audio Effects/Max Audio Effect/Imported/
├── ClipGain.amxd          332 KB
└── Shortcut Buddy.amxd    330 KB
```

Every project that uses a Max device gets its own copy. Same device, same
bytes, once per project. Add `.amxd` to the dedupe extensions and include
`Presets/**/Imported` as a scan location.

Worth noting these are only ~330 KB each, so the space win is small compared
to samples — but they're perfectly safe to link and there could be a lot of
them.

**Careful with the folder-name matching here.** `Presets/.../Max Audio
Effect/Imported` and `Samples/Imported` are both called "Imported". Matching
on the bare folder name would conflate them. Match on the relative path shape
instead — a rule worth applying anyway, since a false match in a tool that
modifies files is a worse mistake than one in a scanner.

### Also spotted: Ableton's own collision naming

```
OH Andava Guitar 1 - Guitar 1.wav        39.20 MB
OH Andava Guitar 1 - Guitar 1(2).wav     39.20 MB
OH Andava Guitar 1 - Guitar 2.wav        39.20 MB
OH Andava Guitar 1 - Guitar 2(2).wav     39.20 MB
OH Andava Guitar 1 - Starting.wav        39.20 MB
OH Andava Guitar 1 - Starting(2).wav     39.20 MB
```

`(2)` is what Ableton appends when Collect All imports a file whose name is
already taken. Often the same audio collected twice — 39 MB a copy, in one
folder alone.

The hash check will confirm or deny it; no assumption needed. Worth surfacing
these prominently since the sizes are large. Note the twelve `39.20 MB` files
are also a perfect illustration of why size grouping alone is not enough —
same length recording, same size, different audio.

### Excluded correctly, no change needed

`.asd` files (Ableton's waveform analysis) are all over these folders. They're
small, regenerate automatically, and are already skipped by the audio
extension filter. Leave them alone.

### Why linking stays safe even here

Some `Imported` files are clearly your own recordings that were imported from
another project — the guitar takes above. Deleting those would be dangerous.
Linking them is not: nothing is removed, every path keeps resolving, every
session still opens. This is exactly why the tool links rather than deletes.

---

## 000. Scan depth, shortcuts and linked folders

### Depth: raise it, but fix the mechanism

Current ceiling is 15 levels. Nothing about the scan gets slower per level —
the constant exists only as a runaway guard. Raise to **64** as a backstop
that should never fire.

The real Windows limit arrives first anyway: **260 characters** for a full
path unless long path support is enabled. Forty levels at 20 characters a
folder is 800 characters — the OS returns `ENAMETOOLONG` long before any limit
in this code. When that happens the row should say so plainly rather than the
folder silently vanishing.

### The "ignore shortcuts" switch — with one correction

Requested: a settings toggle to ignore shortcuts, on by default. Yes, but the
naming needs to cover more than `.lnk`, because **`.lnk` files are not what
causes the problem.**

A `.lnk` is an ordinary file. `readdir` reports it as a file, never as a
folder, so the scanner already walks straight past it and it can't cause a
loop. Harmless today.

What *can* loop the scan is a **junction** or **symbolic link** — made with
`mklink /J` or `mklink /D`, and what OneDrive, Google Drive and some backup
tools create. Those appear as real folders. Node reports both as symbolic
links on Windows, so `entry.isSymbolicLink()` catches them.

So the switch should be:

> **Follow shortcuts and linked folders** — off by default
>
> When off: `.lnk` files are ignored, and any folder that is really a link to
> somewhere else is not opened. When on, linked folders are scanned like any
> other — which can list the same project twice if the link points somewhere
> already on your list.

Off by default gives you what you asked for, and covers the case that actually
matters rather than only the one with the familiar name.

### Cycle detection — still worth having

Even with links skipped, keep a set of resolved real paths already visited and
stop on a repeat. It costs almost nothing and means the depth number is never
load-bearing. With that in place, 64 is a formality.

---

## 00. THE MODEL IS WRONG — one row per session file, not per folder

Read the real drive. The core assumption this app was built on is wrong, and
it explains the sorting complaint, the missing projects, and the render
mismatch all at once.

### What I assumed

One folder = one project. Find the newest session file in it, use that for
name, date and BPM.

### What your drive actually looks like

```
Suraag/Olaala bgm idea 3 Project/
├── Yogi mom reunion 2.als              08-08-2026 05:08 PM
├── Yogi babu TEASER INTRO finale.als   08-08-2026 04:50 PM
├── Yogi mom reunion.als                13-07-2026 01:12 PM
├── Yogi babu intro opt 3.als           18-06-2026 04:25 PM
├── Yogi babu TEASER INTRO.als          11-06-2026 01:45 PM
├── Yogi babu intro opt 2 85bpm.als     08-06-2026 07:00 PM
├── Yogi babu intro opt 2.als           08-06-2026 05:04 PM
├── Yogi babu intro.als                 04-06-2026 09:40 PM
├── Backup/  Presets/  Samples/  Ableton Project Info/
```

**Eight distinct pieces of work in one folder.** Different songs, different
versions, different tempos — "opt 2 85bpm" says so in its own name.

The app shows this as **one row**, dated 08-08, named after the folder. The
other seven are invisible. Same again in `Bangalore entry Project`:
`Bangalore entry.als`, `Bangalore entry 1.als`, `Bangalore entry 2.als`.

That is the sorting complaint. Work from a given day isn't missing from the
scan — it's being hidden behind whichever sibling happens to be newest.

### The fix: the session file is the project

One row per `.als` / `.flp` / `.rpp` / `.cpr` / `.song` / `.logicx`, not one
per folder.

- **Name** = the session filename, not the folder name. "Yogi babu intro opt 2
  85bpm", not "Olaala bgm idea 3 Project".
- **Date** = that file's own mtime. Sorting then genuinely reflects what you
  worked on when.
- **BPM** = read from that file.
- **Notes** = already keyed per session file, so this lines up with the note
  design rather than fighting it.
- **Folder shown underneath** as the location breadcrumb, as now.

Backups still excluded — the `Backup` folder and the FL `(autosaved…)`
siblings never become rows.

**Consequence to expect:** your project count will go up substantially, maybe
several times over. That's correct — it's what's actually on the drive. Worth
adding a "group by folder" toggle so the list can collapse back down when you
want the folder-level view.

### Renders live somewhere else entirely — match by name

```
Suraag/
├── Renders/                      <- renders for everything below, one level up
│   ├── Bangalore entry.wav
│   ├── Bangalore entry 1.wav
│   ├── Bangalore entry 3_1.wav        <- versioned
│   ├── Bangalore entry 3_2.wav
│   ├── Adi - Kannamaniye.wav
│   └── YOGI BABU.wav
├── Bangalore Entry Bgm/
│   ├── Bangalore entry Project/
│   │   ├── Bangalore entry.als        <- matches Renders/Bangalore entry.wav
│   │   ├── Bangalore entry 1.als      <- matches Renders/Bangalore entry 1.wav
│   │   └── Bangalore entry 2.als
│   ├── Ai Stems/
│   └── Bounces/
```

The render is **not inside the project folder**. It's in a `Renders` folder a
level or two up, named after the session file. Looking only inside the project
folder — which is what the app does now — finds nothing, which is why Play is
dead on projects that plainly have renders.

**Matching rule:** for a session file, search for audio whose name matches the
session's name, in this order:

1. The project's own folder and anything under it
2. Sibling folders named `Renders`, `Bounces`, `Stems`, `Ai Stems`, `Mixdown`
3. The same-named folders at each ancestor level, up to the scan root

Match on the flattened name (letters and digits only, lowercased), so
`Bangalore entry 1.als` finds `Bangalore entry 1.wav`, and version suffixes
group as they already do — `Bangalore entry 3_1` and `3_2` are v1 and v2 of
the same render.

Loose renders also sit directly in `Suraag` itself (`Adi - Kannamaniye.mp3`,
`Bangalore entry 2.mp3`, `Yogi babu 7th reel ai.wav`), so the ancestor search
has to include the ancestor folder itself, not only its `Renders` subfolder.

**And `Renders` / `Bounces` must come off the audio-search skip list.** They're
currently skipped, which is right for finding projects and exactly wrong for
finding renders. Two different searches, two different rules — that's the
mistake underneath this whole section.

### On the project page

Clicking a session file shows every render found for it, grouped by where it
came from — "In this folder", "Renders", "Bounces", "Ai Stems" — with the
relative path under each so it's obvious. Version grouping stays.

---

## 0. CONFIRMED from reading the real drive (14 Aug)

Read `C:\Users\hpkal\Documents\Jump\2026\May 2026\Suraag` directly and
pulled one real `.flp` to test against. Two bugs are now proven rather than
suspected, and one earlier assumption was flat wrong.

### 0-A. The FL tempo parser is broken on current FL Studio — PROVEN

Test file: `SIDDI\Alignment project\Reel alignment ai voice\Reel alignment ai voice.flp`

The parser returns `No tempo event found`. The tempo **is** in the file —
event 156 at byte offset 128, value 140000, meaning **140 BPM**. A raw byte
scan finds it instantly.

The sequential event walk derails before reaching it. Tracing byte by byte:

```
  @  22 id=199  data  len=12        "26.1.3.5570"   version string
  @  36 id=159  dword 5570                          build number
  @  41 id=169  dword 15
  @  46 id= 28  byte  1
  @  48 id=172  dword 3221225729    <-- 0xC0000101, wrong
  @  53 id= 54  byte  70            <-- reading "FL Studio" as events
  @  55 id=  0  byte  76
  ...                                    lost from here on
```

Event 172 is being read as a 4-byte event and swallows the `0xC0` byte that
starts the next event. From there every offset is wrong, and the walk marches
through 59KB of misread garbage without ever landing on byte 128.

**Root cause: this is FL Studio version 26.1.3** (the version string is right
there in the file). The event-size rules I implemented — ids 0-63 one byte,
64-127 two, 128-191 four, 192+ variable — come from the classic FLP layout.
Something in that range changed in newer FL, and event 172 no longer follows
the old rule.

**Fix direction, and I'd argue for the pragmatic one.** Reverse-engineering
which ids changed size in FL 26 means guessing, and guessing wrong means
confidently wrong BPMs. Instead: try the sequential walk, and when it comes
back empty, fall back to a **bounded scan** of the first few KB looking for
event 156 followed by a value between 20000 and 400000. Project settings live
near the top of the file — the tempo was at byte 128 of 59261.

Tested on the real file: the bounded scan returns 140 BPM correctly. Bounded
matters — scanning the whole file finds event-66 lookalikes in pattern data at
offsets 52770 and beyond, which would be nonsense.

This explains every FL project showing `—` for BPM.

### 0-B. FL backups ARE in a Backup folder — my earlier claim was wrong

Earlier notes said FL keeps backups in a shared folder in FL's user data, so
FL projects could never have a health bar. That's wrong. From the real drive:

```
Reel alignment ai voice/
├── Reel alignment ai voice.flp
├── Backup/
│   ├── ...(autosaved on 10-08-2026 at 9h46).flp
│   ├── ...(autosaved on 10-08-2026 at 12h15).flp
│   ├── ...(autosaved on 10-08-2026 at 12h16).flp
│   ├── ...(autosaved on 10-08-2026 at 12h18).flp
│   ├── ...(autosaved on 10-08-2026 at 12h20).flp
│   ├── ...(autosaved on 10-08-2026 at 12h21).flp
│   └── ...(overwritten on 10-08-2026 at 12h59).flp
└── Samples/
```

Seven backups. The app shows **0 saves**.

FL uses a `Backup` subfolder exactly like Ableton — the autosave siblings I
built for in the last version are a *second* place it also puts them, not the
only place. `countFlBackups` has to count both: the `Backup` folder AND
`(autosaved…)` / `(overwritten…)` files sitting next to the project.

Good news: the filename filter already written is still correct and still
needed. It just wasn't the whole picture.

### 0-C. Structure confirmed — projects nest inside projects

```
Suraag/                                    <- has a loose .als, so it's a project
├── Notes plugin d#min chords.als
├── (25+ loose mp3, wav, mp4 files)
├── SIDDI/
│   └── Alignment project/
│       └── Reel alignment ai voice/       <- FL project, 3 levels down
├── Yogi babu voice try/                   <- project (.flp)
│   ├── Yogi babu voice try.flp
│   ├── Align yogi/                        <- ANOTHER project inside it
│   ├── Renders/
│   ├── Backup/
│   └── Samples/
└── ...40 more folders
```

Projects sit inside projects, at varying depths. The current scanner handles
this correctly since it stopped bailing out at the first session file.

Note `Yogi babu voice try` holds its renders in a `Renders` subfolder, and
`Renders` is on the default skip list. Correct for the project scan, and the
audio listing must NOT inherit that skip (see 0e).

### 0-D. Still unproven: the sorting complaint

The filesystem connector reports names and sizes but **not modification
times**, and copying a file to inspect it resets the timestamp. So I could not
verify the ordering from here.

The folder-mtime fallback (0a below) and the 12-subfolder cap (0b) remain the
prime suspects and should be fixed regardless — both are real bugs.

**What would settle it:** Explorer open on Suraag, sorted by Date Modified,
with the Date Modified column visible — next to what the app shows. That gives
the one thing I can't read remotely.

---

## 0-legacy. Original suspicions (still to fix)

## 0. TOP PRIORITY — sorting follows renders, not sessions

**Reported:** Nava Bharat Jodo is correctly at the top, but FLPs in Suraag
worked on yesterday are not appearing where they should. The ordering looks
like it's tracking rendered audio rather than the session files.

The intent has always been that a project's date comes from its newest real
session file — `.als`, `.flp`, `.rpp`, `.cpr`, `.song`, `.logicx` — and never
from audio. Something is defeating that. Four candidate causes, in order of
how likely I think they are. All need checking against the real drive rather
than reasoning about.

### 0a. The folder-mtime fallback — most likely

`inspectProject` falls back to the folder's own timestamp when it finds no
session file:

```js
if (!project.modified) {
  project.modified = (await fs.stat(dir)).mtimeMs;
}
```

A folder's timestamp changes when **anything** is written inside it —
including a render. So any project where the session isn't found gets dated by
its last bounce. That's exactly the reported symptom.

Worse, it fails silently: the row still shows a plausible date, so there's no
sign anything went wrong.

**Fix direction:** when a project has no readable session, say so in the row
rather than substituting a folder date. Sorting should never mix "when the
session was saved" with "when something happened in the folder" — they're
different measurements and one of them is answering a question nobody asked.

### 0b. The 12-subfolder cap — definite bug regardless

`surveyFolder` looks for sessions and counts audio one level down, but only in
the first twelve subfolders:

```js
for (const sub of subdirs.slice(0, 12)) { ... }
```

Suraag has around forty. Anything past the twelfth is invisible to both the
session search and the audio count. That cap was a guess at protecting scan
time and it's simply wrong at your folder sizes.

This also explains **Play buttons that are disabled when audio exists** —
`audioCount` comes from the same truncated walk.

### 0c. Claim and inspect disagreeing

`walk` decides a folder is a project based on session files sitting *directly*
in it. `inspectProject` then goes one level deeper if it finds none directly.
Those two rules can disagree, so a folder can be claimed by one rule and dated
by the other. They should be one rule, evaluated once.

### 0d. Zipped FL projects

You save most FL projects as zip. If a folder holds an old `.flp` and a recent
`.zip`, the project dates from the old `.flp` and looks stale.

Worth deciding: should a zip export count towards "when did I last touch
this"? My instinct is no — the zip is a shipped artefact, not work — but it
should at least be visible on the row, which the Packaged badge already does.

### What would settle this quickly

One folder, two views:

- Explorer showing a project folder that's sorting wrongly, with Date Modified
  visible on the files inside
- What the app shows for that same project

The Suraag bug was only findable because a screenshot showed the loose `.als`
sitting next to the folder list. Same again would take this from four theories
to one fix.

---

## 0e. Project page: find ALL audio, however deep

Clicking a project should list every `.wav` and `.mp3` belonging to it, wherever
it hides — renders in `Renders`, bounces in `Bounces`, stems three folders
down, exports next to the session.

Currently the audio search stops at two levels and skips only a fixed list of
folder names. That's the same mistake as the old depth setting: guessing at
your structure instead of just looking.

**Wanted behaviour:**

- No depth limit, same as the project scan
- Group results by the folder they were found in, so `Renders`, `Stems` and
  loose files are visually separated rather than merged into one long list
- Keep skipping `Samples`, `Backup` and `Freeze` — those hold source material
  and freeze files, not renders, and there can be thousands
- Version grouping stays: `Song_1.wav` and `Song_1.mp3` remain one entry
- Show the relative path under each file so it's obvious where it came from

Worth noting the cost honestly: a project with a big `Imported` folder could
hold thousands of audio files. Skipping `Samples` is what keeps this fast, and
that skip has to stay.

---

## A. Bugs found during testing

### A1. Play button appears even with no audio

The button is drawn unconditionally and only finds out there's nothing to play
once you click it.

The scanner is already inside every project folder reading its contents, so it
can count audio files while it's there. The button then arrives disabled. No
extra disk reads.

### A2. FL autosaves are being read as sessions — the important one

Explorer finds 5,221 `.flp` files under Jump. The browser reports 327 projects.
Those count different things (files vs folders holding a session), but the file
list shows what's really going on:

```
Align yogi (autosaved on 06-08-2026 at 17h06).flp     17:06
Align yogi.flp                                        17:04
Maniac remix (overwritten on 04-08-2026 at 13h41).flp
Daksh - toxic behaviour (autosaved at 12h50).flp
```

FL writes autosave and overwrite copies **in the same folder as the project**,
not in a `Backup` subfolder. The Backup skip never catches them.

And they're *newer* than the real session — 17h06 against 17h04. The scanner
takes the newest session file in a folder, so it has been reading **BPM and
modified dates off autosaves rather than your actual projects**.

Fix: filter filenames matching `(autosaved…)` and `(overwritten…)` out of
session detection.

Silver lining — this fixes something previously written off as impossible.
Earlier notes said FL projects would always show 0 backups because FL has no
`Backup` folder. Those autosave siblings **are** the FL backup count. Counting
them makes the health bar work for FL projects the same as for Ableton.

### A3. Zip files, and what a zip next to an FLP means

Most FL projects get saved as zip. Two rules:

- **Never read inside a zip.** Not a project file, don't open it, don't scan it.
- **But an `.flp` and a `.zip` sharing a similar name is a signal.** That means
  the project was exported as a zipped loop package — a finished, shipped
  state.

So the pair is worth surfacing rather than ignoring: a small "packaged" badge
on the row, and the zip's date as the export date. Match on the stem name
ignoring case, spaces and version suffixes, since the zip rarely matches
character-for-character.

---

## B. Project page (double-click a project)

Opens a full page for one project instead of the side panel. Sections:

### B1. Renders

List of every render found, versions grouped (see D2), each playable, each
analysable for key and tempo.

### B2. Notes, written as text files

**One text file per project file**, not one per note and not one per folder.

The filename carries the version and the time it was last saved, and gets
**renamed** on every update rather than a new file being created:

```
Nava bharat jodo — 2026-08-13 1420.txt          (first save)
Nava bharat jodo — 2026-08-13 1655.txt          (after editing)
```

A project with several session files gets several note files, each named after
its own version:

```
Suraag v2 — 2026-08-13 1420.txt
Suraag v3 — 2026-08-13 1655.txt
```

`notes.json` stays as the index the app reads; the txt files are the durable
copy you can read without this app.

**Interpretation to confirm:** "version" here means each `.als` / `.flp` in the
folder — so two session files means two notes. If you meant render versions
(`Song_1.wav`, `Song_2.wav`) instead, say so; it's a different key and worth
knowing before it's built.

**How the rename must work:** `fs.rename` on the existing file, then write the
new content. Never delete-and-recreate — a crash between the two loses the
note. Same pattern as the ID3 editor already uses.

**Two consequences worth knowing up front:**

1. **A renamed file breaks anything holding it open.** If the txt is open in
   Notepad when the name changes, saving from Notepad recreates the old
   filename and you end up with two. Worth debouncing the rename — update
   content immediately, rename only once typing has stopped for a few seconds.

2. **The watcher will see it.** Every rename looks like a file appearing and
   disappearing inside a project folder. `.txt` has to be excluded from the
   bounce watcher or every note edit fires a notification.

---

---

## C. Interface

### C1. Spotify-clean pass

Amber stays. The hardware styling goes.

That means, concretely: no glows, no inset recessed panels, fewer borders, more
whitespace, greys carrying the structure with amber only on the active thing.
Larger type hierarchy, rounded corners, quieter hover states.

It will feel calmer and noticeably less like a rack unit. Saying that plainly
now so it isn't a surprise — the current look is deliberate hardware pastiche
and this removes most of it.

### C2. Guard the Open button

Accidentally clicked three times so far, which is three unwanted DAW launches.

Detect a running DAW — `tasklist` on Windows, `ps` on macOS — and show a real
system dialog before launching anything. Not an occasional confirmation: if a
DAW is running, always confirm.

---

## D. Features already agreed, still pending

### D1. More DAW formats

| Format | DAW | Difficulty | Approach |
|---|---|---|---|
| `.rpp` | REAPER | Easy | Plain text. `TEMPO 128 4 4` near the top. |
| `.song` | Fender Studio Pro (was Studio One) | Medium | Likely a zip container with XML inside. Needs a zip reader. |
| `.cpr` | Cubase | Hard | Undocumented binary, changes between versions. Byte-pattern hunt, or ship without BPM. |
| `.logicx` | Logic Pro | Hard for BPM, easy for everything else | A **folder**, not a file. See D1a. |

**Rule for all of these:** a project that can't give up its BPM still gets
listed with everything else working — name, date, health bar, notes, renders,
playback, key detection from audio. A missing tempo shows as `—`. Never hide a
project just because one field is unavailable.

Backup counting is per-DAW, not one global rule:

| DAW | Where backups live |
|---|---|
| Ableton | `Backup/` inside the project — done |
| FL Studio | `(autosaved…)` siblings in the project folder — see A2 |
| REAPER | `.rpp-bak` next to the project file |
| Cubase | `.bak` in the project folder |
| Fender Studio Pro | To confirm from a real project folder |
| Logic Pro | `Project File Backups/` and `Alternatives/` inside the package |

### D1a. Logic `.logicx` — the structural catch

`.logicx` is **not a file**. It's a macOS package: a folder that Finder
displays as a single item. On Windows it's simply a folder with a dot in its
name, which is exactly how it'll appear on your machine when a collaborator
sends one.

That breaks two assumptions in the current scanner, and both have to change
before Logic support works at all:

1. **The extension check tests `entry.isFile()`.** A `.logicx` is a directory,
   so it would never be recognised as a session.
2. **The scanner descends into every folder.** Left alone it would walk *into*
   the package and treat its internals as projects — so one Logic project would
   appear as several fake ones.

So: a **directory** whose name ends in `.logicx` (or the older `.logic`) counts
as a session file, and is never descended into.

Inside the package, for reference:

```
Song.logicx/
├── Alternatives/000/ProjectData    ← the actual project, undocumented binary
├── Project File Backups/           ← the health bar count
├── Audio Files/
└── Bounces/                        ← renders live in here
```

**Tempo: probably not, at least at first.** `ProjectData` is undocumented
binary with no published spec, same situation as Cubase. Worth one attempt with
real files, but the honest expectation is `—` in the BPM column.

**Everything else works normally**, and this is the point — the key detector
reads audio, not project files, so a Logic project with a bounce still gets its
key and Camelot number. Notes, favourites, health bar, renders and playback all
work regardless of whether the tempo was readable.

**One thing to watch:** Logic keeps `Bounces/` *inside* the package. Since the
scanner won't descend into `.logicx`, the media lookup has to be told to look
in there specifically, or renders for Logic projects will appear to be missing.

Logic can also be saved as a plain folder rather than a package, in which case
the `.logicx` sits inside a normal folder. Both layouts need to work.

**Needed to start:** one real project file per DAW plus its actual BPM, so
parsers get verified rather than assumed. Two or three `.cpr` files at
different tempos would help find the byte pattern.

Naming caution: Studio One Pro became Fender Studio Pro on 13 Jan 2026.
"Fender Studio" is a *different*, free app. Don't conflate them.

### D2. Versioned renders

`Song_1.wav`, `Song_2.wav`, same version often as both wav and mp3.

- Highest version shown as a `v7` badge on the row
- wav and mp3 of the same version collapsed into one entry, not two
- The bounce watcher stops double-firing: same base name and version = one
  event, held a few seconds, fired once as "Song v8 rendered (wav + mp3)"

*Partly built already — `lib/media.js` does the grouping. The watcher still
fires per file.*

**Open question:** in `Song_2_final` or `Song_2b`, is the version always the
last number, or the first one after the base? A couple of real filenames
settles it.

### D3. Stems button

Per-project stems folder, remembered permanently. Implemented as a Stems page:
it lists and plays the audio inside DAW Buddy, with Open folder and Change
folder controls kept on that page.

Stems are sometimes rendered by part — instrumental, bass, vocals, drums,
synths — so the button can report what's in there rather than just opening it.

A new file appearing in a stems folder registers as a stem, not a bounce, so a
five-part export doesn't fire five alerts.

*Partly built — the folder can be set and opened. Part detection exists in
`lib/media.js` but isn't surfaced.*

---

## E. De-duplicator

Ableton's Collect All means the same sample exists in twenty project folders.
This finds that and reclaims the space.

### E1. What it is allowed to look at

Only `Samples/Imported/`. That's where Collect All puts copies of files that
came from outside — sample-pack material with an original elsewhere.

Never touched:

- `Samples/Processed/` — consolidated clips, freeze files, warped and reversed
  renders. Ableton generated these; **no copy exists anywhere else.**
- `Samples/Recorded/` — your own takes.
- Stems and bounce folders — excluded entirely.

That one rule does most of the work of keeping your own audio safe.

### E2. Finding duplicates

Group by size, then hash **only within groups that share a size**.

Size alone can't confirm a match. Sample packs are full of files sharing a size
for boring reasons — same length, same bitrate, batch-processed one-shots. Two
different snares, both 44.1k stereo, both exactly 0.5 seconds, are byte-for-byte
different with identical sizes.

Hashing all 5,000 files would be slow. Hashing the few hundred that share a
size with something else is fast, and it's the difference between a tool you can
trust and one that eventually eats a sample you needed.

### E3. What it does about them

**Same volume — hard links.** Twenty copies of one kick, all on JUMP. Replace
them with hard links: every path still resolves, every session still opens, the
disk stores one copy. Zero risk. This is where nearly all the reclaimable space
is.

**Cross-drive — report only, no delete button.** Hard links can't cross
volumes, so a project copy on JUMP can't link back to a pack master on the
other drive. The sample-pack drive is used as a *reference* — scanned to know
which files are library material rather than your own — and duplicates are
deduped against each other in place.

Cross-drive matches appear as a read-only figure ("400 files also exist in your
sample packs, 12 GB") with **no action attached**. Deleting a collected sample
means Ableton asks you to locate it on next open. Not worth it.

### E4. Interface

Scan → grouped list, sortable by size and by wasted space → pick which groups
to act on → link. Each group shows which projects reference the file, so it's
obvious what's affected before anything happens.

---

## F. Packaging (last)

The code is cross-platform; distribution isn't. Both machines currently need
Node and `npm start`.

`electron-builder` makes a real `.exe` and `.dmg` from the same source, but a
Mac app can only be built on a Mac — Apple's signing tools don't exist on
Windows. Unsigned apps also trigger SmartScreen and Gatekeeper warnings;
removing those means certificates (~$100/yr Apple, ~$200/yr Windows).

Fine to skip while it's you and your cousin.

---

## Suggested order

1. **A1, A2** — the two bugs distorting everything currently on screen
2. **A3** — zip handling and the packaged badge
3. **B** — project page with renders and note history
4. **C1, C2** — Spotify-clean pass and the Open guard
5. **D2, D3** — finish versioned renders and stems
6. **D1** — REAPER, then Fender Studio Pro, then Cubase
7. **E** — de-duplicator, since it's the one that touches files
8. **F** — packaging

## Waiting on

- Does "version" mean each session file in the folder, or render versions?
- Version parsing: `Song_2_final` — which number is the version?
- One project file per new DAW, with its real BPM
- A `.logicx` to inspect, if you can get one from a collaborator
- A listing of a real stems folder, so part names aren't guesses

---

## Already done (for reference)

- Unlimited-depth scanning, no depth setting
- Descends past folders that contain a session file (the Suraag bug)
- A container no longer borrows its tempo from a child project
- Multiple project folders, managed in Settings, with nesting guards
- Ableton `.als` and FL `.flp` tempo parsing
- Key and Camelot detection from audio, with a confidence figure
- Smooth waveform player with click-to-seek
- Bulk renamer with preview, collision detection and undo
- Standalone batch ID3 editor (read, replace or remove MP3 metadata)
- Per-project records: notes, stems path, key, favourite
- Cross-platform path handling, macOS permission messages
- Scroll containment fix
