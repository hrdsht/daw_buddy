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
