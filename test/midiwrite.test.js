'use strict';

const assert = require('assert/strict');
const midiwrite = require('../src/renderer/midiwrite');

function testMidiGeneration() {
  // A# Bhairav in octave 3
  const notes = midiwrite.notesFor(10, [0, 1, 4, 5, 7, 8, 11], 3);
  assert.deepEqual(notes, [58, 59, 62, 63, 65, 66, 69]);

  const bytes = midiwrite.scaleMidi(notes, { bpm: 120, bars: 4 });
  assert.ok(bytes instanceof Uint8Array);

  // Check header
  assert.equal(bytes[0], 0x4d); // M
  assert.equal(bytes[1], 0x54); // T
  assert.equal(bytes[2], 0x68); // h
  assert.equal(bytes[3], 0x64); // d

  // Format 0 (single track)
  assert.equal(bytes[9], 0);

  // 1 track
  assert.equal(bytes[11], 1);

  // TPQ 480 (0x01E0)
  assert.equal(bytes[12], 1);
  assert.equal(bytes[13], 0xe0);

  // Track header
  assert.equal(bytes[14], 0x4d); // M
  assert.equal(bytes[15], 0x54); // T
  assert.equal(bytes[16], 0x72); // r
  assert.equal(bytes[17], 0x6b); // k

  // Check length is reasonable and ends with End of Track (FF 2F 00)
  assert.ok(bytes.length > 50);
  assert.equal(bytes[bytes.length - 3], 0xff);
  assert.equal(bytes[bytes.length - 2], 0x2f);
  assert.equal(bytes[bytes.length - 1], 0x00);
}

function testRagaMidiGeneration() {
  // Bhairav Aarohana: [0, 1, 4, 5, 7, 8, 11, 12], Avarohana: [12, 11, 8, 7, 5, 4, 1, 0] in C (tonicPc 0)
  const aaroh = [0, 1, 4, 5, 7, 8, 11, 12];
  const avaroh = [12, 11, 8, 7, 5, 4, 1, 0];
  const bytes = midiwrite.ragaMidi(0, aaroh, avaroh, { bpm: 120 });
  assert.ok(bytes instanceof Uint8Array);

  // Check MIDI header 'MThd'
  assert.equal(bytes[0], 0x4d);
  assert.equal(bytes[1], 0x54);
  assert.equal(bytes[2], 0x68);
  assert.equal(bytes[3], 0x64);

  // Track header 'MTrk'
  assert.equal(bytes[14], 0x4d);
  assert.equal(bytes[15], 0x54);
  assert.equal(bytes[16], 0x72);
  assert.equal(bytes[17], 0x6b);

  // Verify end of track bytes (FF 2F 00)
  assert.ok(bytes.length > 80);
  assert.equal(bytes[bytes.length - 3], 0xff);
  assert.equal(bytes[bytes.length - 2], 0x2f);
  assert.equal(bytes[bytes.length - 1], 0x00);
}

function testRhythmGuideMidiGeneration() {
  const bytes = midiwrite.rhythmGuideMidi(128, '7/8', { bars: 4 });
  assert.ok(bytes instanceof Uint8Array || Buffer.isBuffer(bytes));

  // Check MIDI header 'MThd'
  assert.equal(bytes[0], 0x4d);
  assert.equal(bytes[1], 0x54);
  assert.equal(bytes[2], 0x68);
  assert.equal(bytes[3], 0x64);

  // Track header 'MTrk'
  assert.equal(bytes[14], 0x4d);
  assert.equal(bytes[15], 0x54);
  assert.equal(bytes[16], 0x72);
  assert.equal(bytes[17], 0x6b);

  // End of track marker
  assert.equal(bytes[bytes.length - 3], 0xff);
  assert.equal(bytes[bytes.length - 2], 0x2f);
  assert.equal(bytes[bytes.length - 1], 0x00);
}

function testProgressionMidiGeneration() {
  const chords = [
    { midiNotes: [60, 64, 67], durationSec: 2.0 }, // C Maj
    { midiNotes: [67, 71, 74], durationSec: 2.0 }, // G Maj
    { midiNotes: [69, 72, 76], durationSec: 2.0 }, // A Min
    { midiNotes: [65, 69, 72], durationSec: 2.0 }  // F Maj
  ];
  const bytes = midiwrite.progressionMidi(chords, { bpm: 120 });
  assert.ok(bytes instanceof Uint8Array || Buffer.isBuffer(bytes));

  // Check MIDI header 'MThd'
  assert.equal(bytes[0], 0x4d);
  assert.equal(bytes[1], 0x54);
  assert.equal(bytes[2], 0x68);
  assert.equal(bytes[3], 0x64);

  // Track header 'MTrk'
  assert.equal(bytes[14], 0x4d);
  assert.equal(bytes[15], 0x54);
  assert.equal(bytes[16], 0x72);
  assert.equal(bytes[17], 0x6b);

  // End of track marker
  assert.equal(bytes[bytes.length - 3], 0xff);
  assert.equal(bytes[bytes.length - 2], 0x2f);
  assert.equal(bytes[bytes.length - 1], 0x00);
}

testMidiGeneration();
testRagaMidiGeneration();
testRhythmGuideMidiGeneration();
testProgressionMidiGeneration();
console.log('ok - testMidiGeneration');
