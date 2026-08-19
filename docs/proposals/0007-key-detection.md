# 0007 — Key detection rework

**Status:** proposal, prototype built and measured
**Date:** 2026-08-18
**Prompted by:** a song in A# reported as F# min during a demo

---

## The report

A raga-based track in A# was reported as **F# min**. Those two share only
three of seven notes — it isn't a near miss. The drone played F#, which
happens to be in the scale, and that is the only reason it didn't sound wrong
in the room.

## Reproduced

Synthesised a raga performance — tanpura drone on the tonic and fifth, melody
wandering the scale — and ran the current detector at three tonic registers:

| Tonic | Current detector says | Truth |
|---|---|---|
| A#1 (58 Hz) | **C maj** | A# |
| A#2 (117 Hz) | **F maj** | A# |
| A#3 (233 Hz) | A# maj | A# |

**F is the fifth of A#.** The detector reported the fifth as the tonic, which
is the same family of error as reporting F# for A#. And it only gets the
answer right when the tonic sits above roughly 200 Hz.

## Why — two faults, both real

### 1. The FFT cannot resolve a semitone in the bass

The current chroma takes a 4096-point FFT and rounds each bin to the nearest
semitone. At 44.1 kHz that is **10.77 Hz per bin**. A semitone at A#2 is
**6.9 Hz wide**.

| Note | Hz | Semitone width | Bins per semitone |
|---|---|---|---|
| A#1 | 58.3 | 3.5 Hz | **0.32** |
| A#2 | 116.5 | 6.9 Hz | **0.64** |
| A#3 | 233.1 | 13.9 Hz | 1.29 |
| A#4 | 466.2 | 27.7 Hz | 2.57 |

Below about 250 Hz one bin spans more than a semitone, so a bass note smears
across three pitch classes:

```
bin 10   107.7 Hz  →  A
bin 11   118.4 Hz  →  A#     ← the actual note
bin 12   129.2 Hz  →  C
```

The tonic is usually the lowest strong note in the mix. **The single most
important pitch was the worst measured.**

### 2. Harmonics vote for the wrong key

A note at A# also puts energy on F (its fifth) and D (its third). Correlating
raw chroma against key profiles lets a strong bass note vote for keys a fifth
or third away from the truth — which is precisely the F-for-A# result above.

### 3. And a wrong premise, which is not a bug

Raga-based music is not in a Western major or minor key. Forcing 24 profiles
onto it returns whichever of 24 wrong answers fits least badly. There is no
threshold that fixes this, because the question being asked is wrong.

---

## The rework

Built and measured in `key2.js`.

### Find the tonic first, treat mode as a separate question

The tonic is what the drone plays, what a collaborator asks for, and what
mixing in key depends on. **A correct tonic with an unknown mode is useful. A
confident wrong key is not.**

Tonic is found from three pieces of evidence:

- **presence** — share of total energy on that pitch class
- **stability** — how consistently it is among the strongest across frames.
  A drone or a repeatedly-returned-to root scores high; a passing note does
  not
- **fifth support** — whether the pitch class a fifth above is also strong,
  which is the most reliable signal of a tonal centre and is exactly what a
  tanpura provides

This works on raga material, where the drone states the tonic continuously,
and on Western material, where the root is the most returned-to note. Neither
case needs the mode to be known first.

### Constant-Q chroma instead of rounded FFT bins

Rather than taking bins and rounding, sum the energy in the band that actually
is each semitone. Combined with a 16384-point FFT (2.69 Hz per bin), a
semitone stays resolvable down to about 60 Hz.

### Suppress harmonics before matching

Subtract a conservative fraction of what each pitch class contributes to its
fifth, third and seventh. Enough to stop harmonics voting; not enough to erase
a note genuinely present.

### Recognise scales beyond major and minor

Sixteen shapes, including modal and the common thaat shapes — bhairav,
bhairavi, todi, yaman, charukesi — plus pentatonic and blues.

**This is not raga identification.** A raga needs phrasing, ornamentation and
ascent/descent asymmetry, none of which is in a pitch histogram. It reports
which set of notes is in use. Bhairavi and Phrygian are the same note set, and
the tool will say so rather than pretending to distinguish them.

### Report only what is known

```
tonic:      always, with its own confidence
scale:      the note set, with its own confidence
key:        only when the scale is recognisably major or minor
camelot:    only then too
```

A raga on A# gets `tonic: A#`, `scale: bhairav`, and **no Camelot number** —
Camelot describes the Western circle of fifths, and saying "6B" about Bhairav
would be inventing information. The drone can still play A#, which is what
matters in the room.

---

## Measured

Same synthesised raga, old method against new:

| Tonic register | Old | New (16384) |
|---|---|---|
| A#1, 58 Hz | C maj ✗ | **A#** ✓ (low confidence, correctly) |
| A#2, 117 Hz | F maj ✗ | **A#** ✓ bhairav |
| A#3, 233 Hz | A# maj ✓ | **A#** ✓ bhairav |

Across eight scale types including ragas, modes and pentatonics, tonic
accuracy went from **6/8 to 8/8**. The two the old method missed were a fifth
error on C major and a third error on G# yaman — the same failure family as
the demo.

**Both changes are needed.** At 4096 even the new chroma fails on a 58 Hz
tonic; at 16384 it succeeds. The FFT size is not a tuning parameter here, it
is the fault.

---

## Cost

FFT 16384 against 4096 is four times the work per frame, but with the same hop
that is roughly twice the total. Analysis already runs in a worker and
already caches results by path and mtime, so it is paid once per file.

Bump the parser version so cached keys are recomputed — every stored key from
the old detector is suspect, and without a version bump they would persist and
look like the fix having failed.

---

## Still to verify

**This was measured on synthesised material.** It reproduces the reported
failure class and fixes it, but a real recording has percussion, reverb,
detuning and mastering that no synthetic test includes.

**The demo track is the test that matters.** A handful of real files with
known tonics — ideally including that A# raga — would confirm this properly or
show what is still missing. Everything above is evidence, not proof.

---

## Files

- `key2.js` — the rework: constant-Q chroma, harmonic suppression, tonic-first
  analysis, sixteen scales, Camelot only where it applies
- `keycmp.js` — old against new across eight scale types
- `realaudio.js` — synthesised raga at three registers, both FFT sizes

---

## Addition — scale keyboard and Camelot wheel

The project page has unused space to the right of the title. Two things belong
there, for two different people.

Both are driven by the detector's output, so they show the **scale**, not just
the key. That matters now: the rework knows the difference between A# minor
and A# bhairav, and a keyboard that only understood major and minor would
throw that away.

```
┌──────────────────────────────┬───────────────────────────┐
│  ABLETON                     │   ┌─────────────────────┐ │
│  Guruji_Full                 │   │  ▓ █▓ ▓ █ █▓ ▓ █ ▓  │ │
│  Tonic A#  ·  bhairav        │   │  keys highlighted   │ │
│                              │   └─────────────────────┘ │
│  [ Open ] [ Show ] [ ♡ ]     │   [ ⤓ Drag MIDI to DAW ]  │
│                              │                           │
│                              │        ╭───────╮          │
│                              │      ╭─┤ 3A ●  ├─╮        │
│                              │      ╰─┤       ├─╯        │
│                              │        ╰───────╯          │
└──────────────────────────────┴───────────────────────────┘
```

### Keyboard

Two octaves, correctly proportioned — black keys sit between whites at real
piano offsets rather than on an even grid. Drawing it evenly is the thing that
makes a keyboard widget look wrong without anyone being able to say why.

Three states, not two:

| State | Meaning |
|---|---|
| **tonic** | the root — what the drone plays, and the note a beginner most needs to find |
| **scale** | in the scale |
| **out** | not in it |

The tonic is separated from the rest deliberately. "Which notes can I play" and
"which note is home" are different questions and the second one is harder to
work out from a highlighted set.

Hovering a key shows its scale degree — root, ♭2, 3, 4, 5, ♭6, 7 — so someone
who doesn't read `bhairav` can still see the shape.

Verified for A# bhairav: highlights **A# B D D# F F# A**, tonic on A#.

### Drag MIDI to DAW

A button under the keyboard producing a Standard MIDI File: every note of the
scale, sustained together from bar 1 to the end of bar 4.

Written by hand in `midiwrite.js` — an SMF is small and stable, and this app
has stayed dependency-light on purpose. Format 0, one track, 480 ticks per
quarter, tempo taken from the project. Verified: 7 notes, 7,680 ticks, exactly
four bars of 4/4, valid header.

Drag straight onto a DAW track. For a beginner that turns "the song is in A#
bhairav" into notes on a timeline without needing to know what bhairav is.

**One decision needed:** Electron can drag a real file out to another
application via `webContents.startDrag`, which is what makes this feel right
rather than requiring a save dialog. The file is written to a temp path first.
Worth confirming it works on Windows into Ableton before committing to the
interaction — dragging out of Electron behaves differently per platform.

### Camelot wheel

Twelve positions, two rings, position 1 at the top and running clockwise, in
the app's own colours rather than the usual rainbow. The current track's
segment is lit.

Compatible segments are marked, and marked **distinctly** rather than lumped
together as "compatible", because they don't sound alike:

| Move | From 3A | What it does |
|---|---|---|
| **relative** | 3B | same notes, major against minor — seamless |
| **+1** | 4A | up a fifth — lifts the energy |
| **−1** | 2A | down a fifth — drops it |

Verified: A# minor resolves to **3A**, with 3B, 4A and 2A as its neighbours.

**Modal tracks light nothing.** A raga on A# has no Camelot position, and the
wheel shows the tonic with a note that this scale sits outside the Western
circle of fifths. Inventing a position would be the same error as printing a
Camelot number for bhairav.

### Files

- `midiwrite.js` — Standard MIDI File writer, tested
- `scaleview.js` — keyboard layout and highlighting, Camelot geometry and
  compatibility, tested
