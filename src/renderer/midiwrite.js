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

/**
 * Writes a rhythmic Standard MIDI File containing a single-note metronome / timing click track.
 */
function rhythmGuideMidi(bpm = 120, timeSignature = '4/4', options = {}) {
  const bars = options.bars || 8;
  const accentNote = options.accentNote !== undefined ? options.accentNote : 72;
  const clickNote = options.clickNote !== undefined ? options.clickNote : 60;

  const parts = String(timeSignature || '4/4').split('/');
  const num = parseInt(parts[0], 10) || 4;
  const den = parseInt(parts[1], 10) || 4;
  const denLog2 = Math.round(Math.log2(den)) || 2;

  const beatTicks = Math.round((480 * 4) / den);
  const clickDuration = Math.max(20, Math.min(Math.round(beatTicks * 0.45), 180));
  const gapDuration = beatTicks - clickDuration;

  const events = [];
  const usPerQuarter = Math.round(60000000 / bpm);
  events.push(
    ...vlq(0), 0xff, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff
  );

  events.push(...vlq(0), 0xff, 0x58, 0x04, num & 0xff, denLog2 & 0xff, 24, 8);

  const totalBeats = num * bars;
  let prevGap = 0;

  for (let b = 0; b < totalBeats; b++) {
    const beatInBar = b % num;
    const isDownbeat = beatInBar === 0;
    const isSubAccent = (num === 4 && beatInBar === 2) || (num === 6 && beatInBar === 3) || (num === 7 && (beatInBar === 3 || beatInBar === 5));

    const note = isDownbeat ? accentNote : clickNote;
    const velocity = isDownbeat ? 127 : (isSubAccent ? 100 : 80);

    const onDelta = b === 0 ? 0 : prevGap;
    events.push(...vlq(onDelta), 0x90, note & 0x7f, velocity);
    events.push(...vlq(clickDuration), 0x80, note & 0x7f, 0);

    prevGap = gapDuration;
  }

  events.push(...vlq(prevGap), 0xff, 0x2f, 0x00);

  const head = [
    ...Buffer.from(HEADER, 'ascii'),
    ...be32(6),
    ...be16(0),
    ...be16(1),
    ...be16(TPQ)
  ];

  const track = [
    ...Buffer.from(TRACK, 'ascii'),
    ...be32(events.length),
    ...events
  ];

  return Buffer.from([...head, ...track]);
}

function ragaMidi(tonicPc, aarohanaDegrees, avarohanaDegrees, options = {}) {
  const bpm = options.bpm || 120;
  const velocity = options.velocity || 85;
  const octave = 4;
  const base = 12 * (octave + 1) + tonicPc;
  const noteDuration = Math.round(TPQ);
  const events = [];

  const usPerQuarter = Math.round(60000000 / bpm);
  events.push(
    ...vlq(0), 0xff, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff
  );
  events.push(...vlq(0), 0xff, 0x58, 0x04, 4, 2, 24, 8);

  const fullSequenceDegrees = [...aarohanaDegrees, ...avarohanaDegrees];
  const midiNotes = fullSequenceDegrees.map((d) => Math.max(0, Math.min(127, base + d)));

  midiNotes.forEach((note) => {
    events.push(...vlq(0), 0x90, note & 0x7f, velocity);
    events.push(...vlq(noteDuration), 0x80, note & 0x7f, 0);
  });

  events.push(...vlq(0), 0xff, 0x2f, 0x00);

  const head = [
    ...Buffer.from(HEADER, 'ascii'),
    ...be32(6),
    ...be16(0),
    ...be16(1),
    ...be16(TPQ)
  ];

  const track = [
    ...Buffer.from(TRACK, 'ascii'),
    ...be32(events.length),
    ...events
  ];

  return Buffer.from([...head, ...track]);
}

function progressionMidi(chords, options = {}) {
  const bpm = options.bpm || 120;
  const velocity = options.velocity || 85;
  const events = [];

  const usPerQuarter = Math.round(60000000 / bpm);
  events.push(
    ...vlq(0), 0xff, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff
  );
  events.push(...vlq(0), 0xff, 0x58, 0x04, 4, 2, 24, 8);

  const secondsPerBeat = 60 / bpm;

  for (let i = 0; i < chords.length; i++) {
    const c = chords[i];
    if (!c.midiNotes || c.midiNotes.length === 0) continue;
    const notes = [...c.midiNotes].sort((a, b) => a - b);
    let beats = c.durationBeats || 4;
    if (c.durationSec && c.durationSec > 0) {
      beats = Math.max(1, Math.round((c.durationSec / secondsPerBeat) * 2) / 2);
    }
    const chordTicks = Math.round(beats * TPQ);

    notes.forEach((note, idx) => {
      events.push(...vlq(idx === 0 ? 0 : 0), 0x90, note & 0x7f, velocity);
    });

    notes.forEach((note, idx) => {
      events.push(...vlq(idx === 0 ? chordTicks : 0), 0x80, note & 0x7f, 0);
    });
  }

  events.push(...vlq(0), 0xff, 0x2f, 0x00);

  const head = [
    ...Buffer.from(HEADER, 'ascii'),
    ...be32(6),
    ...be16(0),
    ...be16(1),
    ...be16(TPQ)
  ];

  const track = [
    ...Buffer.from(TRACK, 'ascii'),
    ...be32(events.length),
    ...events
  ];

  return Buffer.from([...head, ...track]);
}

module.exports = { scaleMidi, progressionMidi, notesFor, ragaMidi, rhythmGuideMidi, TPQ };


