'use strict';

/**
 * Writes a Standard MIDI File containing the notes of a scale, sustained
 * across four bars.
 *
 * Format 0, one track, 480 ticks per quarter note. Four bars of 4/4
 * is 16 beats = 7680 ticks. Every note starts at tick 0 and ends together.
 */

const TPQ = 480;

/** Variable-length quantity — MIDI's own 7-bits-per-byte length encoding. */
function vlq(value: number): number[] {
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
}

function be32(value: number): number[] {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function be16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

export interface MidiOptions {
  bars?: number;
  bpm?: number;
  velocity?: number;
}

export function scaleMidi(notes: number[], options: MidiOptions = {}): Uint8Array {
  const bars = options.bars || 4;
  const bpm = options.bpm || 120;
  const velocity = options.velocity || 80;
  const length = TPQ * 4 * bars;

  const events: number[] = [];

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
  sorted.forEach((note) => {
    events.push(...vlq(0), 0x90, note & 0x7f, velocity);
  });

  // All note-offs together at the end. The first carries the delta; the rest follow at zero.
  sorted.forEach((note, index) => {
    events.push(...vlq(index === 0 ? length : 0), 0x80, note & 0x7f, 0);
  });

  events.push(...vlq(0), 0xff, 0x2f, 0x00); // end of track

  const head = [
    0x4d, 0x54, 0x68, 0x64, // 'MThd'
    ...be32(6),
    ...be16(0), // format 0
    ...be16(1), // one track
    ...be16(TPQ)
  ];

  const track = [
    0x4d, 0x54, 0x72, 0x6b, // 'MTrk'
    ...be32(events.length),
    ...events
  ];

  return new Uint8Array([...head, ...track]);
}

/**
 * Scale degrees to MIDI notes in a chosen octave.
 * Octave 3 by default — low enough to read as a root, high enough not to turn into mud.
 */
export function notesFor(tonicPc: number, degrees: number[], octave = 3): number[] {
  const base = 12 * (octave + 1) + tonicPc;
  return degrees.map((d) => base + d);
}

export { TPQ };
