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
 *
 * Both are driven by the detector's output, so they show the SCALE rather
 * than just the key — the rework in 0007 knows the difference between A#
 * minor and A# bhairav, and a keyboard that only understood major and minor
 * would throw that away.
 */

/* ================================================================== */
/* Keyboard                                                           */
/* ================================================================== */

const WHITE = [0, 2, 4, 5, 7, 9, 11];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Key positions for a two-octave keyboard starting at C.
 *
 * Black keys sit between whites at fixed offsets rather than on a grid — a
 * piano is not evenly spaced, and drawing it evenly is the thing that makes
 * a keyboard widget look wrong without anyone being able to say why.
 */
function layout(octaves = 2, whiteWidth = 22, whiteHeight = 96) {
  const keys = [];
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
 *
 * The tonic is distinguished from the rest of the scale deliberately — it is
 * the note the drone plays and the one a beginner most needs to find.
 */
function highlight(keys, tonicPc, degrees) {
  const inScale = new Set(degrees.map((d) => (tonicPc + d) % 12));

  return keys.map((key) => ({
    ...key,
    state:
      key.pc === tonicPc ? 'tonic' : inScale.has(key.pc) ? 'scale' : 'out',
    degree: inScale.has(key.pc) ? degreeOf(key.pc, tonicPc, degrees) : null
  }));
}

/** Which scale degree a pitch class is — 1 for the tonic, 5 for the fifth. */
function degreeOf(pc, tonicPc, degrees) {
  const interval = ((pc - tonicPc) % 12 + 12) % 12;
  const index = degrees.indexOf(interval);
  return index === -1 ? null : index + 1;
}

/* ================================================================== */
/* Camelot wheel                                                      */
/* ================================================================== */

/**
 * The wheel, as coordinates rather than an image.
 *
 * Twelve positions around a circle, each holding an inner (A, minor) and
 * outer (B, major) segment. Position 1 sits at the top and they run
 * clockwise, as every DJ tool draws it.
 */
const CAMELOT_KEYS = {
  '1A': 'G#', '1B': 'B', '2A': 'D#', '2B': 'F#', '3A': 'A#', '3B': 'C#',
  '4A': 'F', '4B': 'G#', '5A': 'C', '5B': 'D#', '6A': 'G', '6B': 'A#',
  '7A': 'D', '7B': 'F', '8A': 'A', '8B': 'C', '9A': 'E', '9B': 'G',
  '10A': 'B', '10B': 'D', '11A': 'F#', '11B': 'A', '12A': 'C#', '12B': 'E'
};

function wheelLayout(radius = 78) {
  const segments = [];

  for (let position = 1; position <= 12; position += 1) {
    // Position 1 at the top, clockwise.
    const centreAngle = ((position - 1) / 12) * Math.PI * 2 - Math.PI / 2;
    const spread = (Math.PI * 2) / 12;

    for (const ring of ['A', 'B']) {
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

/**
 * What mixes with what.
 *
 * The standard rules: same number switches major and minor (relative), ±1
 * around the wheel is a fifth away, and same letter is the parallel.
 *
 * These are marked distinctly rather than lumped as "compatible", because
 * they don't sound the same — a relative switch is seamless, a ±1 move
 * changes the energy.
 */
function compatible(code) {
  const match = String(code).match(/^(\d+)([AB])$/);
  if (!match) return null;

  const position = Number(match[1]);
  const ring = match[2];
  const step = (n) => ((n - 1 + 12) % 12) + 1;

  return {
    current: code,
    relative: `${position}${ring === 'A' ? 'B' : 'A'}`,
    up: `${step(position + 1)}${ring}`,
    down: `${step(position - 1)}${ring}`,
    // Same position, both rings, plus a neighbour either side.
    all: [
      `${position}${ring === 'A' ? 'B' : 'A'}`,
      `${step(position + 1)}${ring}`,
      `${step(position - 1)}${ring}`
    ]
  };
}

/** Camelot code from a tonic and mode, or null when neither applies. */
function codeFor(tonic, mode) {
  if (!tonic || !mode) return null;
  const ring = mode === 'maj' ? 'B' : 'A';
  const found = Object.entries(CAMELOT_KEYS).find(
    ([code, note]) => note === tonic && code.endsWith(ring)
  );
  return found ? found[0] : null;
}

/* ================================================================== */

module.exports = {
  layout,
  highlight,
  degreeOf,
  wheelLayout,
  compatible,
  codeFor,
  CAMELOT_KEYS,
  NOTE_NAMES
};
