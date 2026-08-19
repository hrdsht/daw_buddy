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

testMidiGeneration();
console.log('ok - testMidiGeneration');
