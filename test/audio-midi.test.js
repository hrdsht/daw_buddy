'use strict';

const assert = require('assert/strict');
const {
  resample,
  mixToMono,
  cleanNotes,
  quantizeNotes,
  amplitudeToVelocity,
  bendToMidiValue,
  summariseNotes,
  midiNoteName,
  notesToMidi
} = require('../src/renderer/audio-midi');

/** Minimal SMF reader: tempo, track name and channel events with absolute ticks. */
function readMidi(bytes) {
  const u = Array.from(bytes);
  const str = (o, n) => String.fromCharCode(...u.slice(o, o + n));
  const be = (o, n) => u.slice(o, o + n).reduce((a, b) => a * 256 + b, 0);
  assert.equal(str(0, 4), 'MThd');
  const tpq = be(12, 2);
  assert.equal(str(14, 4), 'MTrk');
  const end = 22 + be(18, 4);
  assert.equal(end, u.length, 'track length matches file');
  let i = 22;
  let tick = 0;
  const out = { tpq, tempo: null, name: null, events: [] };
  const vlq = () => {
    let v = 0;
    for (;;) {
      const b = u[i++];
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
  };
  while (i < end) {
    tick += vlq();
    const status = u[i++];
    if (status === 0xff) {
      const type = u[i++];
      const len = vlq();
      if (type === 0x51) out.tempo = be(i, 3);
      if (type === 0x03) out.name = str(i, len);
      i += len;
    } else {
      const kind = status & 0xf0;
      out.events.push({ tick, kind, a: u[i], b: u[i + 1] });
      i += 2;
    }
  }
  return out;
}

function testResample() {
  const sr = 44100;
  const tone = new Float32Array(sr);
  for (let k = 0; k < tone.length; k += 1) tone[k] = Math.sin((2 * Math.PI * 440 * k) / sr);
  const out = resample(tone, sr, 22050);
  assert.equal(out.length, 22050);
  let crossings = 0;
  for (let k = 1; k < out.length; k += 1) if (out[k - 1] < 0 && out[k] >= 0) crossings += 1;
  assert.ok(Math.abs(crossings - 440) <= 2, `440 Hz survives resampling (got ${crossings})`);
  assert.deepEqual(Array.from(mixToMono([Float32Array.from([1, 0]), Float32Array.from([0, 1])])), [0.5, 0.5]);
}

function testCleanAndSummary() {
  const notes = [
    { pitchMidi: 64, startTimeSeconds: 1, durationSeconds: 0.5, amplitude: 0.5 },
    { pitchMidi: 20, startTimeSeconds: 0, durationSeconds: 0.5, amplitude: 0.5 },
    { pitchMidi: 60, startTimeSeconds: 0, durationSeconds: 0.02, amplitude: 0.5 },
    { pitchMidi: 67, startTimeSeconds: 1.2, durationSeconds: 0.5, amplitude: 0.5 }
  ];
  const cleaned = cleanNotes(notes, { minMidi: 21, maxMidi: 108, minDurationSeconds: 0.05 });
  assert.deepEqual(cleaned.map((n) => n.pitchMidi), [64, 67]);
  const summary = summariseNotes(cleaned);
  assert.equal(summary.count, 2);
  assert.equal(summary.polyphony, 2);
  assert.equal(midiNoteName(summary.lowest), 'E4');
  assert.equal(midiNoteName(60), 'C4');
}

function testQuantize() {
  // 120 BPM, 1/16 grid = 0.125 s.
  const notes = [
    { pitchMidi: 60, startTimeSeconds: 0.13, durationSeconds: 0.24, amplitude: 0.5 },
    { pitchMidi: 62, startTimeSeconds: 0.49, durationSeconds: 0.01, amplitude: 0.5 }
  ];
  const hard = quantizeNotes(notes, { bpm: 120, stepsPerBeat: 4 });
  assert.ok(Math.abs(hard[0].startTimeSeconds - 0.125) < 1e-9);
  assert.ok(Math.abs(hard[0].durationSeconds - 0.25) < 1e-9);
  assert.ok(Math.abs(hard[1].startTimeSeconds - 0.5) < 1e-9);
  assert.ok(Math.abs(hard[1].durationSeconds - 0.125) < 1e-9, 'tiny notes grow to one step');

  const half = quantizeNotes(notes, { bpm: 120, stepsPerBeat: 4, strength: 0.5 });
  assert.ok(Math.abs(half[0].startTimeSeconds - 0.1275) < 1e-9, 'half strength moves halfway');

  // Two same-pitch fragments that land on top of each other merge.
  const merged = quantizeNotes(
    [
      { pitchMidi: 60, startTimeSeconds: 0.0, durationSeconds: 0.45, amplitude: 0.4 },
      { pitchMidi: 60, startTimeSeconds: 0.26, durationSeconds: 0.3, amplitude: 0.9 }
    ],
    { bpm: 120, stepsPerBeat: 4 }
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].amplitude, 0.9);
  assert.ok(Math.abs(merged[0].durationSeconds - 0.5) < 1e-9, "merged note spans both");
  // Notes that merely touch after snapping are a real repeat and stay separate.
  const repeat = quantizeNotes(
    [
      { pitchMidi: 60, startTimeSeconds: 0.0, durationSeconds: 0.3, amplitude: 0.4 },
      { pitchMidi: 60, startTimeSeconds: 0.24, durationSeconds: 0.3, amplitude: 0.9 }
    ],
    { bpm: 120, stepsPerBeat: 4 }
  );
  assert.equal(repeat.length, 2);
}

function testVelocityAndBends() {
  assert.equal(amplitudeToVelocity(0), 20);
  assert.equal(amplitudeToVelocity(1), 127);
  assert.equal(amplitudeToVelocity(5), 127);
  assert.equal(bendToMidiValue(0), 8192, 'no bend is centre');
  assert.equal(bendToMidiValue(3), 12288, 'one semitone up is half of a ±2 range');
  assert.equal(bendToMidiValue(-6), 0, 'two semitones down is the floor');
  assert.equal(bendToMidiValue(30), 16383, 'clamped');
}

function testMidiFile() {
  const notes = [
    { pitchMidi: 60, startTimeSeconds: 0, durationSeconds: 0.5, amplitude: 1 },
    { pitchMidi: 60, startTimeSeconds: 0.5, durationSeconds: 0.5, amplitude: 0.25 },
    { pitchMidi: 64, startTimeSeconds: 0.25, durationSeconds: 1, amplitude: 0.5 }
  ];
  const midi = readMidi(notesToMidi(notes, { bpm: 120, trackName: 'Lead' }));
  assert.equal(midi.tpq, 480);
  assert.equal(midi.tempo, 500000, '120 BPM');
  assert.equal(midi.name, 'Lead');
  const ons = midi.events.filter((e) => e.kind === 0x90);
  const offs = midi.events.filter((e) => e.kind === 0x80);
  assert.equal(ons.length, 3);
  assert.equal(offs.length, 3);
  // At 120 BPM, 0.5 s = one beat = 480 ticks.
  assert.deepEqual(ons.map((e) => [e.tick, e.a]), [[0, 60], [240, 64], [480, 60]]);
  assert.equal(ons[0].b, 127);
  // Repeated C4: its note-off at tick 480 must come before the new note-on.
  const at480 = midi.events.filter((e) => e.tick === 480);
  assert.deepEqual(at480.map((e) => e.kind), [0x80, 0x90]);

  const bent = readMidi(
    notesToMidi([{ pitchMidi: 60, startTimeSeconds: 0, durationSeconds: 1, amplitude: 0.5, pitchBends: [0, 3, 3, 0] }], {
      bpm: 120,
      pitchBends: true
    })
  );
  const bends = bent.events.filter((e) => e.kind === 0xe0).map((e) => e.a + (e.b << 7));
  assert.deepEqual(bends, [8192, 12288, 8192, 8192], 'repeats skipped, re-centred at note-off');
  const noBends = readMidi(
    notesToMidi([{ pitchMidi: 60, startTimeSeconds: 0, durationSeconds: 1, amplitude: 0.5, pitchBends: [3] }], { bpm: 120 })
  );
  assert.equal(noBends.events.filter((e) => e.kind === 0xe0).length, 0, 'bends are opt-in');
}

testResample();
testCleanAndSummary();
testQuantize();
testVelocityAndBends();
testMidiFile();
console.log('audio-midi tests passed');
