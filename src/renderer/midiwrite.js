'use strict';

/**
 * Writes a Standard MIDI File containing the notes of a scale, sustained
 * across four bars.
 *
 * Hand-written rather than pulled from a package — an SMF is a small, stable
 * format and the app has stayed dependency-light on purpose.
 *
 * Layout: format 0, one track, 480 ticks per quarter note. Four bars of 4/4
 * is 16 beats, so 7680 ticks. Every note starts at tick 0 and ends together.
 */

const HEADER = 'MThd';
const TRACK = 'MTrk';
const TPQ = 480;

/** Variable-length quantity — MIDI's own 7-bits-per-byte length encoding. */
function vlq(value) {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
}

function be32(value) {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function be16(value) {
  return [(value >> 8) & 0xff, value & 0xff];
}

/**
 * @param notes    MIDI note numbers, sounded together
 * @param options  bars, bpm, velocity
 */
function scaleMidi(notes, options = {}) {
  const bars = options.bars || 4;
  const bpm = options.bpm || 120;
  const velocity = options.velocity || 80;
  const length = TPQ * 4 * bars;

  const events = [];

  // Tempo — microseconds per quarter note.
  const usPerQuarter = Math.round(60000000 / bpm);
  events.push(
    ...vlq(0), 0xff, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff
  );

  // 4/4, 24 clocks per metronome tick, 8 32nds per quarter.
  events.push(...vlq(0), 0xff, 0x58, 0x04, 4, 2, 24, 8);

  const sorted = [...notes].sort((a, b) => a - b);

  // All note-ons at tick 0.
  sorted.forEach((note, index) => {
    events.push(...vlq(0), 0x90, note & 0x7f, velocity);
  });

  // All note-offs together at the end. The first carries the delta; the rest
  // follow at zero.
  sorted.forEach((note, index) => {
    events.push(...vlq(index === 0 ? length : 0), 0x80, note & 0x7f, 0);
  });

  events.push(...vlq(0), 0xff, 0x2f, 0x00); // end of track

  const head = [
    ...Buffer.from(HEADER, 'ascii'),
    ...be32(6),
    ...be16(0), // format 0
    ...be16(1), // one track
    ...be16(TPQ)
  ];

  const track = [
    ...Buffer.from(TRACK, 'ascii'),
    ...be32(events.length),
    ...events
  ];

  return Buffer.from([...head, ...track]);
}

/**
 * Scale degrees to MIDI notes in a chosen octave.
 *
 * Octave 3 by default — low enough to read as a root, high enough not to
 * turn into mud when every note sounds at once.
 */
function notesFor(tonicPc, degrees, octave = 3) {
  const base = 12 * (octave + 1) + tonicPc;
  return degrees.map((d) => base + d);
}

module.exports = { scaleMidi, notesFor, TPQ };
