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
 * Writes a melodic Standard MIDI File containing the sequential Aarohana (Ascending)
 * followed by Avarohana (Descending) of an Indian Raga.
 */
export function ragaMidi(
  tonicPc: number,
  aarohanaDegrees: number[],
  avarohanaDegrees: number[],
  options: MidiOptions = {}
): Uint8Array {
  const bpm = options.bpm || 120;
  const velocity = options.velocity || 85;
  const octave = 4; // C4 base octave
  const base = 12 * (octave + 1) + tonicPc;

  const noteDuration = Math.round(TPQ); // 1 quarter note per swara
  const events: number[] = [];

  // Tempo — microseconds per quarter note.
  const usPerQuarter = Math.round(60000000 / bpm);
  events.push(
    ...vlq(0), 0xff, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff
  );

  // 4/4 time signature
  events.push(...vlq(0), 0xff, 0x58, 0x04, 4, 2, 24, 8);

  const fullSequenceDegrees = [...aarohanaDegrees, ...avarohanaDegrees];
  const midiNotes = fullSequenceDegrees.map((d) => Math.max(0, Math.min(127, base + d)));

  midiNotes.forEach((note) => {
    // Note ON at current timestamp
    events.push(...vlq(0), 0x90, note & 0x7f, velocity);
    // Note OFF after noteDuration ticks
    events.push(...vlq(noteDuration), 0x80, note & 0x7f, 0);
  });

  events.push(...vlq(0), 0xff, 0x2f, 0x00); // End of track

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
 * Writes a rhythmic Standard MIDI File containing a single-note metronome / timing click track
 * synced to the exact BPM and Time Signature across 8 bars.
 * Producers can drag this into their DAW to visually align audio samples, vocal chops, and groove transients.
 */
export function rhythmGuideMidi(
  bpm = 120,
  timeSignature = '4/4',
  options: { bars?: number; accentNote?: number; clickNote?: number } = {}
): Uint8Array {
  const bars = options.bars || 8;
  const accentNote = options.accentNote !== undefined ? options.accentNote : 72; // C5 accented click
  const clickNote = options.clickNote !== undefined ? options.clickNote : 60;   // C4 regular beat click

  // Parse time signature (e.g. "4/4", "3/4", "6/8", "7/8", "5/4", "12/8")
  const parts = String(timeSignature || '4/4').split('/');
  const num = parseInt(parts[0], 10) || 4;
  const den = parseInt(parts[1], 10) || 4;

  // MIDI time signature denominator is specified as log2(den): 2=quarter, 3=eighth, 1=half
  const denLog2 = Math.round(Math.log2(den)) || 2;

  // Calculate ticks per beat
  // TPQ is 480 ticks per quarter note
  const beatTicks = Math.round((480 * 4) / den);
  const clickDuration = Math.max(20, Math.min(Math.round(beatTicks * 0.45), 180));
  const gapDuration = beatTicks - clickDuration;

  const events: number[] = [];

  // Tempo — microseconds per quarter note.
  const usPerQuarter = Math.round(60000000 / bpm);
  events.push(
    ...vlq(0), 0xff, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff
  );

  // Time signature meta event: num, denLog2, 24 MIDI clocks per metronome tick, 8 32nd notes per quarter
  events.push(...vlq(0), 0xff, 0x58, 0x04, num & 0xff, denLog2 & 0xff, 24, 8);

  const totalBeats = num * bars;
  let prevGap = 0;

  for (let b = 0; b < totalBeats; b++) {
    const beatInBar = b % num;
    const isDownbeat = beatInBar === 0;
    
    // Sub-accent beats for compound or odd meters
    let isSubAccent = false;
    if (num === 4 && beatInBar === 2) isSubAccent = true;
    else if (num === 6 && beatInBar === 3) isSubAccent = true;
    else if (num === 7 && (beatInBar === 3 || beatInBar === 5)) isSubAccent = true;
    else if (num === 5 && beatInBar === 3) isSubAccent = true;
    else if (num === 12 && (beatInBar === 3 || beatInBar === 6 || beatInBar === 9)) isSubAccent = true;

    const note = isDownbeat ? accentNote : clickNote;
    const velocity = isDownbeat ? 127 : (isSubAccent ? 100 : 80);

    // Delta before Note ON
    const onDelta = b === 0 ? 0 : prevGap;
    events.push(...vlq(onDelta), 0x90, note & 0x7f, velocity);

    // Delta before Note OFF (note duration)
    events.push(...vlq(clickDuration), 0x80, note & 0x7f, 0);

    prevGap = gapDuration;
  }

  // End of track after final note gap
  events.push(...vlq(prevGap), 0xff, 0x2f, 0x00);

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

