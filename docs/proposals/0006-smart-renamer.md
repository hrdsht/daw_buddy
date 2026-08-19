# 0006 — Smart Renamer

**Status:** design
**Date:** 2026-08-17
**Depends on:** `renamer.ts`, `dsp.ts`, `silence.ts`, `convert.ts`

---

## Summary

Rename cryptic stem exports into template-ready names — `Track_12_Render.wav`
becomes `drums_kick_1.wav` — so a folder of stems can be dragged into a mix
template without sorting by hand.

Two paths: filename parsing, which is fast and does most of the work, and
audio analysis for the files where the name says nothing.

**Non-destructive.** No audio is processed. Renaming only, through the
existing plan / apply / undo machinery.

---

## The dictionary does the work

Exports are almost always named something. `kshmr_percussion_oneshot_tabla`,
`insert 6_duff_4-4`, `BD_hard_02` — the instrument is right there. **A
filename is evidence; a spectrum is only an inference.** So the dictionary
leads and audio analysis is the fallback for names that genuinely say nothing.

`instruments.js` is that dictionary: **12 categories, 163 subtypes**, one
file, designed to be edited. Winds is included as requested — recorder, flute,
bansuri, shehnai, duduk, ney, bagpipe and the rest.

| Category | Subtypes | Notes |
|---|---|---|
| drums | 15 | kit pieces |
| percs | 49 | South Asian, Latin, Middle Eastern, West African, East Asian, studio |
| bass | 8 | sub, plucky, reese, growl, acid, upright, electric, synth |
| keys | 7 | |
| synth | 6 | lead, pad, pluck, arp, chord, bell |
| mallets | 8 | |
| guitar | 16 | includes sitar, sarod, veena, oud |
| strings | 12 | |
| brass | 6 | |
| **winds** | **17** | flute, bansuri, shehnai, duduk, recorder, ney, whistle… |
| vox | 7 | |
| fx | 12 | |

### Four matching rules, each earned

**Whole tokens only.** Substring matching finds "bass" inside "bassoon" and
"kick" inside "kickstart". This codebase has already been bitten by that once,
when a Linux kernel thread called `oom_reaper` was detected as REAPER running.

**Two-word phrases first.** `bass drum room mic` resolves to `drums_kick`,
not to a bass. Without this the kick routes to the wrong bus.

**Instruments outrank articulations.** Found while testing:
`bassoon_legato_C3` was resolving to `strings_legato` — "legato" is a specific
subtype and sits later in the name, so it won both tie-breaks and beat the
actual instrument. Articulations describe *how* something is played, not
*what* it is, so they are ranked below instrument names. They still resolve a
name on their own, and when both are present the articulation is carried
alongside: `vln_ens_stacc` → `strings_violin` with `[+staccato]` noted.

**Later tokens win, all else equal.** Names run broad to narrow, so
`kshmr_percussion_oneshot_tabla` gives `percs_tabla`, not `percs`.

### Measured against realistic names

```
kshmr_percussion_oneshot_tabla.wav  → percs_tabla        0.95  "tabla"
insert 6_duff_4-4.wav               → percs_duff         0.95  "duff"
BD_hard_02.wav                      → drums_kick         0.95  "bd"
bass drum room mic.wav              → drums_kick         0.95  "bass drum"
BassGuitar_DI_take3.wav             → bass_electric      0.95  "bass guitar"
RecorderTake_final.wav              → winds_recorder     0.95  "recorder"
shehnai wedding.wav                 → winds_shehnai      0.95  "shehnai"
vln_ens_stacc.wav                   → strings_violin     0.95  [+staccato]
808_sub_long.wav                    → bass_sub           0.95  "sub"
BGV_stack_high.wav                  → vox_backing        0.95  "bgv"

Track_12_Render.wav                 → unresolved, falls through to audio
Serum_Init_04.wav                   → unresolved, falls through to audio
kickstart_intro.wav                 → unresolved (correctly not a kick)
```

## Audio is the fallback, and it stays coarse

For names that resolve to nothing, analysis assigns a **category only**. No
guessed subtypes.

Measured on synthetic sources, these splits are reliable:

| | Centroid | <150 Hz | Crest | T60 |
|---|---|---|---|---|
| kick | 45 | 99% | 18 dB | 795 ms |
| snare | 10611 | 1% | 23 dB | 616 ms |
| hihat | 11077 | 1% | 27 dB | 138 ms |
| sub bass | 45 | 100% | 5 dB | 1194 ms |
| plucky bass | 105 | 81% | 23 dB | 316 ms |
| pad | 294 | 0% | 7 dB | 2000 ms |

Drums against bass against tonal against noise separates by orders of
magnitude. Snare against hihat comes from decay, not frequency. The three bass
types separate cleanly.

**If it sounds like struck percussion, it ships as `percs` with no subtype.**
Tabla against mridangam against dholak is not separable this way — all are
fast attack, harmonic, low-mid weighted — and a confident wrong answer routes
a file to the wrong bus where nobody notices until the mix sounds off. The
name is where subtypes come from.

Same for piano against rhodes, cello against viola, trumpet against trombone:
category from audio, subtype from the name or from you.

## Architecture

```
files in
   │
   ├─► PHASE 1  token match            instant, no audio read
   │      hit  → category + subtype, confidence 0.9+
   │      miss → phase 2
   │
   ├─► PHASE 2  audio analysis          worker thread
   │      read PCM, gate at −60 dB
   │      slice onsets → per-hit features → median
   │      classify → category + confidence
   │
   ├─► PHASE 3  index and resolve
   │      sequential numbering per category
   │      collision detection
   │
   └─► PHASE 4  plan → review → apply
          renamer.plan() / renamer.apply() / renamer.undo()
```

**Analysis runs in the existing renderer worker** (`analysis-worker.ts`),
which already has the FFT and already keeps this kind of work off the main
thread. Renaming stays in main, behind `guardApproved()`.

**Renaming goes through `renamer.ts`. No second rename path.** That module
already has collision detection and an undo log; duplicating it would mean two
places to fix when something goes wrong.

---

## Phase 1 — token matching

A dictionary from token to `{ category, subtype, confidence }`. Matched
case-insensitively against the filename split on separators.

```
kick, kik, bd, bassdrum        → drums / kick
snr, snare, sd, rim            → drums / snare
hh, hat, hihat, closed, open   → drums / hihat
tabla, mridangam, dhol, duff   → percs / <as named>
sub, 808                       → bass / sub
reese                          → bass / reese
rhodes, wurli, epiano          → keys / rhodes
riser, uplifter, woosh, impact → fx / <as named>
```

**Strip before matching:** DAW render artifacts (`_render`, `_bounce`,
`_export`, `_final`, `_v2`, dates, trailing numbers), and vendor clutter
(`Serum_`, `Kontakt_`, `_Init`).

**Negative rules matter as much as positive ones.** "bass" inside
"bassoon" is not a bass. "kick" inside "kickstart" is not a kick. Match on
whole tokens, not substrings — this codebase has already been bitten once by
substring matching, when `oom_reaper` was detected as REAPER running.

Expect this phase to resolve most real exports. Stems are usually named
something, even if badly.

---

## Phase 2 — audio analysis

### Stems are performances, not one-shots

The proposal's thresholds describe single hits — "active duration < 400 ms per
note". A stem is four minutes of a kick playing. Measuring the whole file
gives an active duration of four minutes and tells you nothing.

**So: detect onsets, slice hits, take the median across them.** `dsp.ts`
already has spectral-flux onset detection for tempo; the same envelope drives
this. Median rather than mean, so one anomalous hit doesn't drag the answer.

Cap at 24 hits. A four-minute stem doesn't need every kick measured.

### Features per hit

Centroid, energy ratio below 150 Hz and 120 Hz, crest factor, ZCR, T60,
active duration. All in the table above, all cheap.

### Classification, and confidence

A decision tree over the reliable splits, each node returning a margin — how
far the value sits from the boundary. Confidence is the smallest margin along
the path.

```
> 90% energy below 120 Hz, sustained        → bass / sub
> 75% below 150 Hz, crest > 18, active < 250 → bass / plucky
> 60% below 150 Hz, mid content present      → bass / reese
centroid < 200, T60 < 900, transient         → drums / kick
centroid > 8000, T60 < 250                   → drums / hihat
centroid > 8000, T60 250–800                 → drums / snare
centroid 200–2000, sustained, low crest      → keys or strings  (category only)
broadband, no pitch, long                    → fx
```

**Three confidence bands, and this is the important part:**

| Confidence | Behaviour |
|---|---|
| **≥ 0.8** | Renamed automatically |
| **0.5 – 0.8** | Suggested, but the row is flagged and needs a click |
| **< 0.5** | Left alone. Original name kept, marked "couldn't tell" |

Never guess silently. A file the tool can't classify keeps its name, which is
exactly the behaviour the rest of this codebase already follows for formats it
doesn't understand.

---

## Learning from corrections

This is what makes the tool good over time, and it costs almost nothing.

When the user overrides a classification, store the token that was in the
filename against the category they chose:

```json
{ "grv": { "category": "percs", "subtype": "duff", "source": "user", "count": 3 } }
```

Next time a file containing `grv` appears, phase 1 resolves it instantly at
high confidence. Their vocabulary — session shorthand, regional instrument
names, whatever a collaborator calls things — becomes the dictionary.

A user-taught token beats every threshold in this document. Ten corrections
will outperform any amount of extra DSP.

---

## Naming and indexing

`<category>_<subtype>_<n>.<ext>`, index per category-subtype pair, ordered by
original filename so numbering is stable across runs.

```
drums_kick_1.wav   drums_kick_2.wav
percs_tabla_1.wav
bass_sub_1.wav
```

Zero-padding and separator follow the existing template settings in
`renamer.ts`. Single-instance groups can drop the index — a setting, not a
guess.

---

## UI — two panes, linked

```
┌─────────────────────────────┬──────────┬─────────────────────────────┐
│  ORIGINAL                   │          │  SUGGESTED                  │
│                             │          │                             │
│    Track_12_Render.wav   ◀  │          │  ▶ drums_kick_1.wav      ◀  │
│    Serum_Init_04.wav        │ ANALYSE  │  ⚠ synth_1.wav              │
│    audio 07.wav             │    →     │  ✎ (unresolved)             │
│  ────────────────────────   │          │  ────────────────────────   │
│    tabla_oneshot.wav    ░░  │          │  percs_tabla_1.wav      ░░  │
│    BD_hard_02.wav       ░░  │          │  drums_kick_2.wav       ░░  │
│                             │          │                             │
│                             │          │      [ Cancel ] [ Commit ]  │
└─────────────────────────────┴──────────┴─────────────────────────────┘
```

**Left pane — originals.** Before analysis, in folder order.

`◀` marks the selected pair — highlighted in both panes at once.

**Analyse button** in the middle. Nothing happens until it's pressed.

**Right pane — suggestions**, populated after analysis. Double-click any row
to edit the name directly.

### After analysis, the left pane re-sorts

**Unresolved names rise to the top. Confidently matched ones sink to the
bottom and grey out.** The files needing attention are the ones you haven't
already handled, so they should not be below 280 correct rows.

Three bands, visually distinct:

| Band | Left pane | Right pane |
|---|---|---|
| Unresolved | full contrast, top | empty, editable |
| Low confidence (<0.8) or contested | full contrast, warning mark | suggestion with ⚠ |
| Matched | greyed, bottom | suggestion, plain |

### The panes are linked

Clicking a row in either pane **scrolls the other to the same file and
highlights it**. Same for playback — hitting play on the left highlights the
suggested name on the right.

With 300 stems the two lists diverge fast once the left is re-sorted, and
without linking you'd be hunting for which suggestion belongs to which
original. Row index is not identity here; the file path is.

### Also

- Category override dropdown on each right-pane row, populated from
  `matcher.categories()`
- An override writes a token to the user dictionary — see Learning
- Selecting a row shows why: which token matched, or which audio features
  fired

### Selecting a row — highlight, arm, analyse

Clicking a row in **either** pane does three things:

1. **Highlights the matching row in the other pane**, and scrolls it into
   view. Click `Kshmr_vol3_kick.wav` on the left and `drums_kick_1.wav`
   highlights on the right; click the suggestion and the original highlights.
2. **Loads the file into the transport** at the bottom — armed, not playing.
3. **Moves that file to the front of the analysis queue**, if it hasn't been
   measured yet.

**Selection is not playback.** Clicking a row while you work through a list
shouldn't fire audio at you. Playing is the transport's play button, bottom
right, where it already is for the rest of the app.

Pairing is by **file path, not row index.** Once the left pane re-sorts,
row 3 on the left is not row 3 on the right — index matching would silently
highlight the wrong pair, which is worse than not highlighting at all.

### Analysis is queued, and selection jumps the queue

Name matching is instant and runs on every file the moment Analyse is pressed.
Audio analysis only runs for files the name couldn't resolve, and it runs
**one at a time in the background**.

Selecting an unmeasured file moves it to the front. In practice a single file
measures in well under a second, so the answer arrives about as fast as you
can look at it — while the rest keep processing behind.

**Rows populate as each finishes, never in one batch at the end.** With 300
stems you can be reading row one while row 200 is still being measured.

### Playback and analysis must not fight

They both want audio, and if they share one `AudioContext` they interfere —
starting playback can interrupt a decode, and a decode can stall playback.

**They don't share one.** Analysis decodes into an `OfflineAudioContext`,
which renders as fast as the CPU allows and produces no sound at all. Playback
keeps the real `AudioContext` to itself. Two separate paths, no contention,
and analysis carries on regardless of what is playing.

One refinement worth building: if a file being played is also mid-analysis,
reuse the buffer the analyser already decoded rather than reading and decoding
the same bytes twice.

### Commit and Cancel — bottom right

Both live under the suggestions pane, because that's where the outcome is.
Putting them in the middle beside Analyse would blur *show me what you'd do*
with *do it*.

**Commit** states what it will do rather than saying "Apply":

```
Rename 47 files · 6 left unresolved
```

Unresolved rows are excluded from the count — they keep their names, and a
count that included them would overstate the change.

Disabled when there is nothing to commit: before Analyse has run, and after a
run where nothing would change. A button that does nothing shouldn't look
pressable.

**Cancel** discards the suggestions and returns the left pane to folder
order. It touches no files — nothing has been written at that point, so there
is nothing to roll back.

**After a commit, Cancel is replaced by Undo**, in the same position. The
moment you want it is ten seconds after committing, when you spot something
wrong — that is not a moment to go hunting through a menu.

---

## Custom naming schemes — editable by the user

Everyone's vocabulary is different. A session shorthand, a regional instrument
name, a collaborator's habit — none of that can be shipped, and all of it is
worth capturing.

**Never by editing `instruments.js`.** That file ships with the app, so an
update would overwrite it and take every custom entry along. Personal entries
live in their own file and are merged over the top at load, so shipped entries
improve with updates and custom ones survive them.

Implemented and tested in `userdict.js`.

### Where it lives in the UI

A **Naming schemes** panel — in Settings, with a shortcut from the Smart
Renamer since that's where you notice something is missing.

```
┌──────────────────────────┬────────────────────────────────────┐
│  CATEGORIES              │  NAMES IN  percs / duff            │
│                          │                                    │
│  drums          15  ⌄    │  duff        daf        dafli      │
│  percs          49  ⌃    │  def         grv ●                 │
│    ├ tabla       6       │                                    │
│    ├ duff        5 ●     │  [ add a name…            ] [ + ]  │
│    └ …                   │                                    │
│  winds          17  ⌄    │  ● added by you — click to remove  │
│  turntable       3  ●    │                                    │
│                          │                                    │
│  [ + new category ]      │  [ Export ]  [ Import ]            │
└──────────────────────────┴────────────────────────────────────┘
```

Two boxes, as asked: categories on the left, the names in the selected one on
the right. New categories from the button underneath — `turntable` above is a
user-made one.

Custom entries are marked. Shipped ones can be **switched off** rather than
deleted, which matters more than it sounds: `bell` resolves to a cowbell here,
which is wrong if your library calls tubular bells "bell". Being able to
disable one entry beats arguing about the default.

### Validation, and why each rule exists

A bad token doesn't fail loudly — it quietly mismatches a hundred files. So
they're checked on entry, with a reason rather than a shrug:

```
"a"                        refused — single letters match nearly everything
"mix"                      refused — appears in too many filenames to mean anything
"42"                       refused — numbers alone are version markers
"my favourite kick sound"  refused — one or two words only
"grv"                      accepted
"bell"                     accepted — already used by percs_cowbell, yours will win
```

A clash is allowed. Someone who types a token in means it more than a default
does — they're just told what they're overriding, rather than finding out
three folders later.

### Learning, without asking

When a classification is overridden in the staging table, the unmatched tokens
from that filename become candidates for meaning what was chosen. Counted
rather than trusted: **one correction could be a typo, three is a habit.** At
three, the token is added automatically.

```
correction 1: counted, not yet trusted
correction 2: counted, not yet trusted
correction 3: PROMOTED → thanjavur
```

This is what makes the tool good over time, and it costs nothing to build once
the override control exists. Ten corrections will outperform any threshold in
this document.

### Sharing

**Export** writes a file containing **tokens and categories only** — no
filenames, no paths, nothing about the machine. Someone sending one in should
be able to open it, read the whole thing, and see that it says nothing about
them beyond what they call a duff. Verified in testing: the export contains no
path fragment or filename.

**Import** brings in someone else's, running every token through the same
validation.

That gives the loop asked for: users who add entries can send the file, and
whatever turns up repeatedly gets folded into `instruments.js` for everyone.

**Deliberately manual.** Nothing is collected or transmitted automatically —
that would be telemetry, and this app has never phoned home. A user pressing
Export and choosing to send it is consent; a background upload is not.

---

## Undo that survives

`renamer.ts` already has an undo log, but it lives in the app data folder,
holds only the most recent operation, and belongs to one machine. That covers
the ten-seconds-later case and nothing beyond it.

**Every commit writes a manifest into the folder it changed:**

```
Stems/
├── drums_kick_1.wav
├── percs_tabla_1.wav
└── .dawbuddy-rename-2026-08-18-1430.json
```

It survives closing the app, doing three other jobs, moving the drive to
another machine, or reinstalling. People notice mistakes a week later.

**Paths are stored relative to the folder, never absolute.** The same drive is
`E:\` on Windows, `/media/...` on Linux and `/Volumes/...` on macOS — absolute
paths would make a manifest useless anywhere but the machine that wrote it.
Same reasoning as proposal 0005.

Size and mtime are recorded per file, so undo can tell whether something has
been edited since.

### The Undo flow

1. **Undo button** asks for a folder
2. It reads the manifests there and offers them newest first, with date and
   file count
3. **A preview appears before anything moves** — every file, before and after,
   each row checked against what is actually on disk now
4. Rows can be unticked. Partial undo is normal, not exceptional
5. Confirm, and only then does anything move

### Five states, each said differently

| State | Meaning | Revertable |
|---|---|---|
| **ok** | Safe to put back | yes, ticked |
| **modified** | Still there, but edited since the rename | yes, unticked by default |
| **missing** | No longer in this folder | no |
| **occupied** | Something else now has the old name | no |
| **chained** | A later rename touched this file — undo that one first | no |

`modified` is the one that matters. Putting a name back is harmless; doing it
to a file that has since been re-rendered is a different thing, so it is
offered but not assumed.

**Chained is checked before missing**, deliberately. A file renamed twice is
also "missing" under its intermediate name, and reporting that would send
someone hunting for a lost file rather than telling them to undo the later
rename first. Found while testing — the first version reported exactly that
unhelpful thing.

### Tested against every failure mode

```
drums_kick_1.wav   → Track_12_Render.wav      OCCUPIED  already exists
percs_tabla_1.wav  → kshmr_oneshot_tabla.wav  MODIFIED  changed since rename
bass_sub_1.wav     → 808_long.wav             MISSING   no longer in this folder
```

Also verified: a chained rename undoes correctly in reverse order
(`c.wav` → `b.wav` → `a.wav`) and is refused in the wrong order; undoing twice
is refused; and names are re-checked immediately before moving, since a
preview may be minutes old.

**Manifests are marked, not deleted**, after being reverted. A record of what
happened stays true once it has been reversed, and partial undos record which
entries were put back.

Implemented and tested in `renamelog.js`.

## Folder routing — separate, and opt-in

Grouping renamed stems into `/Drums`, `/Keys` and so on **moves files**, which
is a different risk class from renaming them.

- Off by default
- Its own confirmation
- Recorded in the same undo log, so one action reverses both
- Refuse when a target subfolder already contains files with the same names

---

## Reuse

| Need | Existing |
|---|---|
| Read WAV to PCM | `convert.readWav()` |
| FFT | `dsp.ts` |
| Onset detection | spectral flux in `dsp.ts` |
| Silence gating | `silence.measure()` |
| Plan / apply / undo | `renamer.ts` |
| Off main thread | `analysis-worker.ts` |
| Path validation | `guardApproved()` |

Genuinely new: the token dictionary, the per-hit feature extractor, the
decision tree, the learning store, and the staging UI.

---

## Build order

1. **Dictionary + two-pane UI + apply through `renamer.ts`.** Useful on its
   own, no DSP at all. `instruments.js` and `matcher.js` are written and
   tested — this step is the UI and the wiring.
2. **Learning store.** Cheap once the UI has an override control, and it
   compounds from day one.
3. **Phase 2, reliable splits only** — drums, the three bass types,
   sustained vs transient, fx.
4. **Folder routing**, once renaming has been trusted for a while.
5. **Tabla baya pitch bend**, as the one fine-grained discriminator worth
   attempting.

---

## Stated limits

- Fine instrument distinctions within a family are not detectable this way,
  and the tool should say "percs, unsure which" rather than pick one
- Layered stems — a bus with kick and bass together — will classify as
  whichever dominates. Detecting "this is a mix, not a stem" is worth flagging
  as unclassifiable rather than guessing
- Heavily processed sources drift from every threshold here; the confidence
  score should reflect that, and the fallback is the filename
- Thresholds were validated against synthetic sources. They need re-checking
  against a real stem folder before the auto-apply band is trusted
