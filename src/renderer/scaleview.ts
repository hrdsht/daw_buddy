'use strict';

/**
 * Scale keyboard and Camelot wheel for the project page.
 *
 * Two things for two audiences, side by side in the space to the right of a
 * project's name:
 *
 *   keyboard   which notes are in the scale, for anyone who doesn't read
 *              "A# bhairav" and immediately know what to play
 *   wheel      where the track sits harmonically, for mixing into the next
 *              one
 */

export interface KeyboardKey {
  pc: number;
  octave: number;
  type: 'white' | 'black';
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  state?: 'tonic' | 'scale' | 'out';
  degree?: number | null;
}

export interface KeyboardLayout {
  keys: KeyboardKey[];
  width: number;
  height: number;
}

export interface WheelSegment {
  code: string;
  position: number;
  ring: 'A' | 'B';
  key: string;
  mode: 'min' | 'maj';
  startAngle: number;
  endAngle: number;
  innerRadius: number;
  outerRadius: number;
  labelRadius: number;
  labelAngle: number;
}

export interface WheelLayout {
  segments: WheelSegment[];
  radius: number;
}

export interface Compatibility {
  current: string;
  relative: string;
  up: string;
  down: string;
  all: string[];
}

const WHITE = [0, 2, 4, 5, 7, 9, 11];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Key positions for a two-octave keyboard starting at C.
 *
 * Black keys sit between whites at fixed offsets rather than on a grid — a
 * piano is not evenly spaced, and drawing it evenly is the thing that makes
 * a keyboard widget look wrong without anyone being able to say why.
 */
export function layout(octaves = 2, whiteWidth = 22, whiteHeight = 96): KeyboardLayout {
  const keys: KeyboardKey[] = [];
  let x = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    for (const pc of WHITE) {
      keys.push({
        pc,
        octave,
        type: 'white',
        x,
        y: 0,
        width: whiteWidth,
        height: whiteHeight,
        name: NOTE_NAMES[pc]
      });
      x += whiteWidth;
    }
  }

  const blackWidth = Math.round(whiteWidth * 0.62);
  const blackHeight = Math.round(whiteHeight * 0.62);

  // Offsets in white-key units from the start of the octave.
  const blacks = [
    { pc: 1, after: 0 },
    { pc: 3, after: 1 },
    { pc: 6, after: 3 },
    { pc: 8, after: 4 },
    { pc: 10, after: 5 }
  ];

  for (let octave = 0; octave < octaves; octave += 1) {
    const originX = octave * 7 * whiteWidth;
    for (const black of blacks) {
      keys.push({
        pc: black.pc,
        octave,
        type: 'black',
        x: originX + (black.after + 1) * whiteWidth - blackWidth / 2,
        y: 0,
        width: blackWidth,
        height: blackHeight,
        name: NOTE_NAMES[black.pc]
      });
    }
  }

  return {
    keys,
    width: octaves * 7 * whiteWidth,
    height: whiteHeight
  };
}

/* ================================================================== */
/* Guitar Fretboard Layout & Highlighting                             */
/* ================================================================== */

export interface FretNote {
  stringIndex: number; // 0 = High E (E4), 5 = Low E (E2)
  stringName: string;
  fret: number; // 0 = open string, 1 to 12
  pc: number;
  octave: number;
  name: string;
  x: number;
  y: number;
  state?: 'tonic' | 'scale' | 'out';
  degree?: number | null;
}

export interface FretboardLayout {
  strings: { index: number; name: string; openPc: number; openOctave: number; y: number; gauge: number }[];
  frets: { fret: number; x: number; width: number }[];
  inlays: { fret: number; x: number; y: number; double?: boolean }[];
  notes: FretNote[];
  width: number;
  height: number;
}

export const GUITAR_STRINGS = [
  { index: 0, name: 'E4', openPc: 4, openOctave: 4, gauge: 1.0 },
  { index: 1, name: 'B3', openPc: 11, openOctave: 3, gauge: 1.3 },
  { index: 2, name: 'G3', openPc: 7, openOctave: 3, gauge: 1.7 },
  { index: 3, name: 'D3', openPc: 2, openOctave: 3, gauge: 2.1 },
  { index: 4, name: 'A2', openPc: 9, openOctave: 2, gauge: 2.5 },
  { index: 5, name: 'E2', openPc: 4, openOctave: 2, gauge: 3.0 }
];

export function fretboardLayout(fretCount = 12, totalWidth = 580, totalHeight = 110): FretboardLayout {
  const nutX = 36;
  const playableWidth = totalWidth - nutX - 16;
  const fretWidth = playableWidth / fretCount;

  const stringPaddingTop = 14;
  const stringSpacing = (totalHeight - stringPaddingTop * 2) / (GUITAR_STRINGS.length - 1);

  const strings = GUITAR_STRINGS.map((s, idx) => ({
    ...s,
    y: Math.round(stringPaddingTop + idx * stringSpacing)
  }));

  const frets: { fret: number; x: number; width: number }[] = [];
  for (let f = 1; f <= fretCount; f++) {
    frets.push({
      fret: f,
      x: Math.round(nutX + f * fretWidth),
      width: Math.round(fretWidth)
    });
  }

  // Inlay markers: single dots at 3, 5, 7, 9; double dots at 12
  const inlays: { fret: number; x: number; y: number; double?: boolean }[] = [];
  [3, 5, 7, 9].forEach((f) => {
    const centerFretX = nutX + (f - 0.5) * fretWidth;
    inlays.push({ fret: f, x: Math.round(centerFretX), y: Math.round(totalHeight / 2) });
  });
  // 12th fret double dots
  const fret12X = nutX + 11.5 * fretWidth;
  inlays.push(
    { fret: 12, x: Math.round(fret12X), y: Math.round(totalHeight / 2 - 16), double: true },
    { fret: 12, x: Math.round(fret12X), y: Math.round(totalHeight / 2 + 16), double: true }
  );

  const notes: FretNote[] = [];
  strings.forEach((str) => {
    for (let f = 0; f <= fretCount; f++) {
      const semitone = str.openPc + f;
      const pc = semitone % 12;
      const octave = str.openOctave + Math.floor((str.openPc + f) / 12);
      const noteX = f === 0 ? 16 : Math.round(nutX + (f - 0.5) * fretWidth);
      notes.push({
        stringIndex: str.index,
        stringName: str.name,
        fret: f,
        pc,
        octave,
        name: NOTE_NAMES[pc],
        x: noteX,
        y: str.y
      });
    }
  });

  return {
    strings,
    frets,
    inlays,
    notes,
    width: totalWidth,
    height: totalHeight
  };
}

export function highlightFretboard(notes: FretNote[], tonicPc: number, degrees: number[]): FretNote[] {
  const inScale = new Set(degrees.map((d) => (tonicPc + d) % 12));

  return notes.map((note) => ({
    ...note,
    state:
      note.pc === tonicPc ? 'tonic' : inScale.has(note.pc) ? 'scale' : 'out',
    degree: inScale.has(note.pc) ? degreeOf(note.pc, tonicPc, degrees) : null
  }));
}

/**
 * Marks each key as tonic, in-scale or outside.
 */
export function highlight(keys: KeyboardKey[], tonicPc: number, degrees: number[]): KeyboardKey[] {
  const inScale = new Set(degrees.map((d) => (tonicPc + d) % 12));

  return keys.map((key) => ({
    ...key,
    state:
      key.pc === tonicPc ? 'tonic' : inScale.has(key.pc) ? 'scale' : 'out',
    degree: inScale.has(key.pc) ? degreeOf(key.pc, tonicPc, degrees) : null
  }));
}

/** Which scale degree a pitch class is — 1 for the tonic, 5 for the fifth. */
export function degreeOf(pc: number, tonicPc: number, degrees: number[]): number | null {
  const interval = ((pc - tonicPc) % 12 + 12) % 12;
  const index = degrees.indexOf(interval);
  return index === -1 ? null : index + 1;
}

export const DEGREE_NAMES: Record<number, string> = {
  0: 'Root',
  1: '♭2',
  2: '2',
  3: '♭3',
  4: '3',
  5: '4',
  6: '♭5 / #4',
  7: '5',
  8: '♭6',
  9: '6',
  10: '♭7',
  11: '7'
};

export const SARGAM_NAMES: Record<number, string> = {
  0: 'Sa',
  1: 're (komal)',
  2: 'Re (shuddh)',
  3: 'ga (komal)',
  4: 'Ga (shuddh)',
  5: 'ma (shuddh)',
  6: 'Ma (tivra)',
  7: 'Pa',
  8: 'dha (komal)',
  9: 'Dha (shuddh)',
  10: 'ni (komal)',
  11: 'Ni (shuddh)'
};

/* ================================================================== */
/* Camelot wheel                                                      */
/* ================================================================== */

export const CAMELOT_KEYS: Record<string, string> = {
  '1A': 'G#', '1B': 'B', '2A': 'D#', '2B': 'F#', '3A': 'A#', '3B': 'C#',
  '4A': 'F', '4B': 'G#', '5A': 'C', '5B': 'D#', '6A': 'G', '6B': 'A#',
  '7A': 'D', '7B': 'F', '8A': 'A', '8B': 'C', '9A': 'E', '9B': 'G',
  '10A': 'B', '10B': 'D', '11A': 'F#', '11B': 'A', '12A': 'C#', '12B': 'E'
};

export function wheelLayout(radius = 78): WheelLayout {
  const segments: WheelSegment[] = [];

  for (let position = 1; position <= 12; position += 1) {
    // Position 1 at the top, clockwise.
    const centreAngle = ((position - 1) / 12) * Math.PI * 2 - Math.PI / 2;
    const spread = (Math.PI * 2) / 12;

    for (const ring of ['A', 'B'] as const) {
      const inner = ring === 'A' ? radius * 0.42 : radius * 0.72;
      const outer = ring === 'A' ? radius * 0.70 : radius;

      segments.push({
        code: `${position}${ring}`,
        position,
        ring,
        key: CAMELOT_KEYS[`${position}${ring}`],
        mode: ring === 'A' ? 'min' : 'maj',
        startAngle: centreAngle - spread / 2,
        endAngle: centreAngle + spread / 2,
        innerRadius: inner,
        outerRadius: outer,
        labelRadius: (inner + outer) / 2,
        labelAngle: centreAngle
      });
    }
  }

  return { segments, radius };
}

export function compatible(code: string): Compatibility | null {
  const match = String(code).match(/^(\d+)([AB])$/);
  if (!match) return null;

  const position = Number(match[1]);
  const ring = match[2];
  const step = (n: number) => ((n - 1 + 12) % 12) + 1;

  return {
    current: code,
    relative: `${position}${ring === 'A' ? 'B' : 'A'}`,
    up: `${step(position + 1)}${ring}`,
    down: `${step(position - 1)}${ring}`,
    all: [
      `${position}${ring === 'A' ? 'B' : 'A'}`,
      `${step(position + 1)}${ring}`,
      `${step(position - 1)}${ring}`
    ]
  };
}

export function codeFor(tonic: string, mode: string): string | null {
  if (!tonic || !mode) return null;
  const ring = mode === 'maj' ? 'B' : 'A';
  const found = Object.entries(CAMELOT_KEYS).find(
    ([code, note]) => note === tonic && code.endsWith(ring)
  );
  return found ? found[0] : null;
}

/* ================================================================== */
/* Guitar Tablature Generation                                        */
/* ================================================================== */

export interface GuitarTabNote {
  stringIndex: number; // 0 = High E (e), 1 = B, 2 = G, 3 = D, 4 = A, 5 = Low E (E)
  stringName: string;
  fret: number;
  pc: number;
  octave: number;
  name: string;
  degree?: number | null;
}

export interface GuitarTabResult {
  title: string;
  lines: { label: string; text: string }[];
  rawText: string;
  notes: GuitarTabNote[];
}

export const GUITAR_STRING_LABELS = ['e', 'B', 'G', 'D', 'A', 'E'];

/**
 * Generates an ascending & descending guitar scale run tab in root position / Box 1.
 */
export function generateGuitarScaleTab(tonicPc: number, degrees: number[]): GuitarTabResult {
  const inScale = new Set(degrees.map((d) => (tonicPc + d) % 12));

  // Find standard box starting fret from the root on Low E or A string
  const rootOnLowE = ((tonicPc - 4) % 12 + 12) % 12; // E string open is E (4)
  const rootOnA = ((tonicPc - 9) % 12 + 12) % 12;    // A string open is A (9)

  let boxStart = 0;
  if (rootOnLowE <= 8) {
    boxStart = Math.max(0, rootOnLowE <= 2 ? 0 : rootOnLowE - 1);
  } else if (rootOnA <= 7) {
    boxStart = Math.max(0, rootOnA - 1);
  } else {
    boxStart = Math.max(0, rootOnLowE - 1);
  }
  const boxEnd = Math.min(12, boxStart + 4);

  // Collect playable notes string by string from Low E (5) to High E (0)
  const ascendingNotes: GuitarTabNote[] = [];
  const stringOrder = [5, 4, 3, 2, 1, 0];

  stringOrder.forEach((strIdx) => {
    const strDef = GUITAR_STRINGS[strIdx];
    for (let f = boxStart; f <= boxEnd; f++) {
      const pc = (strDef.openPc + f) % 12;
      if (inScale.has(pc)) {
        const octave = strDef.openOctave + Math.floor((strDef.openPc + f) / 12);
        ascendingNotes.push({
          stringIndex: strIdx,
          stringName: strDef.name,
          fret: f,
          pc,
          octave,
          name: NOTE_NAMES[pc],
          degree: degreeOf(pc, tonicPc, degrees)
        });
      }
    }
  });

  // Descending notes (reverse of ascending excluding the peak note)
  const descendingNotes = [...ascendingNotes].reverse().slice(1);
  const allNotes = [...ascendingNotes, ...descendingNotes];

  // Format into 6 TAB lines
  const stringBuffers: string[][] = [[], [], [], [], [], []];
  allNotes.forEach((n) => {
    const fretStr = String(n.fret);
    const padLen = Math.max(2, fretStr.length + 1);
    for (let s = 0; s < 6; s++) {
      if (s === n.stringIndex) {
        stringBuffers[s].push(fretStr.padEnd(padLen, '-'));
      } else {
        stringBuffers[s].push('-'.repeat(padLen));
      }
    }
  });

  const lines = [0, 1, 2, 3, 4, 5].map((strIdx) => {
    const label = GUITAR_STRING_LABELS[strIdx];
    const text = `${label}|--${stringBuffers[strIdx].join('-')}--|`;
    return { label, text };
  });

  const rawText = lines.map((l) => l.text).join('\n');
  return {
    title: `${NOTE_NAMES[tonicPc]} Scale Box Run (Frets ${boxStart}–${boxEnd})`,
    lines,
    rawText,
    notes: allNotes
  };
}

/**
 * Computes a standard 6-string guitar chord voicing for any root and quality.
 */
export function generateGuitarChordVoicing(rootPc: number, quality: string): { frets: number[]; tabStr: string; chordName: string } {
  const rootName = NOTE_NAMES[rootPc];
  const isMinor = quality.includes('min') || (quality.includes('m') && !quality.includes('maj'));
  const isDim = quality.includes('dim') || quality.includes('°');

  // Find root on 6th string (Low E) and 5th string (A)
  const r6 = ((rootPc - 4) % 12 + 12) % 12; // Low E
  const r5 = ((rootPc - 9) % 12 + 12) % 12; // A string

  let frets: number[] = [-1, -1, -1, -1, -1, -1]; // [High E (0), B (1), G (2), D (3), A (4), Low E (5)]

  if (r5 <= 7) {
    // 5th string A-shape barre/open chord
    if (isMinor) {
      frets = [r5, r5 + 1, r5 + 2, r5 + 2, r5, -1];
    } else if (isDim) {
      frets = [-1, r5 + 1, r5 + 2, r5 + 1, r5, -1];
    } else {
      frets = [r5, r5 + 2, r5 + 2, r5 + 2, r5, -1];
    }
  } else {
    // 6th string E-shape barre/open chord
    if (isMinor) {
      frets = [r6, r6, r6, r6 + 2, r6 + 2, r6];
    } else if (isDim) {
      frets = [-1, r6 - 1, r6 - 1, r6, -1, r6];
    } else {
      frets = [r6, r6, r6 + 1, r6 + 2, r6 + 2, r6];
    }
  }

  // Adjust standard open chord shapes if root is E, A, C, D, G
  if (rootPc === 4 && !isMinor) frets = [0, 0, 1, 2, 2, 0]; // E maj
  if (rootPc === 4 && isMinor) frets = [0, 0, 0, 2, 2, 0]; // E min
  if (rootPc === 9 && !isMinor) frets = [0, 2, 2, 2, 0, -1]; // A maj
  if (rootPc === 9 && isMinor) frets = [0, 1, 2, 2, 0, -1]; // A min
  if (rootPc === 0 && !isMinor) frets = [0, 1, 0, 2, 3, -1]; // C maj
  if (rootPc === 2 && !isMinor) frets = [2, 3, 2, 0, -1, -1]; // D maj
  if (rootPc === 2 && isMinor) frets = [1, 3, 2, 0, -1, -1]; // D min
  if (rootPc === 7 && !isMinor) frets = [3, 0, 0, 0, 2, 3]; // G maj

  const suffix = isDim ? '°' : isMinor ? 'm' : '';
  const chordName = `${rootName}${suffix}`;
  const tabStr = [5, 4, 3, 2, 1, 0].map((s) => (frets[s] === -1 ? 'x' : String(frets[s]))).join('-');

  return { frets, tabStr, chordName };
}

/**
 * Generates 6-line Guitar Tablature for a chord progression.
 */
export function generateProgressionGuitarTab(
  chords: Array<{ rootPc: number; quality: string; chordName: string; roman?: string }>
): GuitarTabResult {
  const voicings = chords.map((c) => generateGuitarChordVoicing(c.rootPc, c.quality));
  const lines: { label: string; text: string }[] = [];
  const stringOrder = [0, 1, 2, 3, 4, 5]; // High E (0) to Low E (5)

  stringOrder.forEach((strIdx) => {
    const label = GUITAR_STRING_LABELS[strIdx];
    const segs = voicings.map((v) => {
      const f = v.frets[strIdx];
      const str = f === -1 ? 'x' : String(f);
      return str.padEnd(4, '-');
    });
    lines.push({
      label,
      text: `${label}|--${segs.join('---')}---|`
    });
  });

  const chordLabelsRow = '   ' + voicings.map((v, i) => {
    const label = (chords[i].roman ? `${chords[i].roman} (${v.chordName})` : v.chordName);
    return label.padEnd(7, ' ');
  }).join(' ');

  const rawText = lines.map((l) => l.text).join('\n') + '\n' + chordLabelsRow;
  return {
    title: 'Guitar Progression Tablature',
    lines,
    rawText,
    notes: []
  };
}

/**
 * Generates a melodic lead guitar riff/lick in the given scale.
 */
export function generateGuitarLickTab(tonicPc: number, degrees: number[]): GuitarTabResult {
  const inScale = new Set(degrees.map((d) => (tonicPc + d) % 12));
  const rootOnLowE = ((tonicPc - 4) % 12 + 12) % 12;
  const boxStart = Math.max(0, rootOnLowE <= 2 ? 0 : rootOnLowE - 1);

  // Create an 8-note melodic riff pattern (Root -> 3rd/4th -> 5th -> 7th -> Octave -> 5th -> 2nd -> Root)
  const lickDegrees = [
    0,
    degrees[Math.min(2, degrees.length - 1)] || 4,
    degrees[Math.min(3, degrees.length - 1)] || 5,
    degrees[Math.min(4, degrees.length - 1)] || 7,
    12,
    degrees[Math.min(4, degrees.length - 1)] || 7,
    degrees[1] || 2,
    0
  ];
  const lickNotes: GuitarTabNote[] = [];

  lickDegrees.forEach((deg) => {
    const notePc = (tonicPc + deg) % 12;
    let bestStr = 2; // G string default
    let bestFret = 0;
    let found = false;

    for (const strIdx of [3, 2, 1, 0, 4, 5]) {
      const strDef = GUITAR_STRINGS[strIdx];
      for (let f = boxStart; f <= boxStart + 5; f++) {
        if ((strDef.openPc + f) % 12 === notePc) {
          bestStr = strIdx;
          bestFret = f;
          found = true;
          break;
        }
      }
      if (found) break;
    }

    const strDef = GUITAR_STRINGS[bestStr];
    lickNotes.push({
      stringIndex: bestStr,
      stringName: strDef.name,
      fret: bestFret,
      pc: notePc,
      octave: strDef.openOctave + Math.floor((strDef.openPc + bestFret) / 12),
      name: NOTE_NAMES[notePc],
      degree: degreeOf(notePc, tonicPc, degrees)
    });
  });

  const stringBuffers: string[][] = [[], [], [], [], [], []];
  lickNotes.forEach((n) => {
    const fretStr = String(n.fret);
    const padLen = Math.max(3, fretStr.length + 2);
    for (let s = 0; s < 6; s++) {
      if (s === n.stringIndex) {
        stringBuffers[s].push(fretStr.padEnd(padLen, '-'));
      } else {
        stringBuffers[s].push('-'.repeat(padLen));
      }
    }
  });

  const lines = [0, 1, 2, 3, 4, 5].map((strIdx) => {
    const label = GUITAR_STRING_LABELS[strIdx];
    return {
      label,
      text: `${label}|--${stringBuffers[strIdx].join('-')}--|`
    };
  });

  return {
    title: `${NOTE_NAMES[tonicPc]} Lead Riff & Motif Tab`,
    lines,
    rawText: lines.map((l) => l.text).join('\n'),
    notes: lickNotes
  };
}

