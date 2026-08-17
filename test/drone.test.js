'use strict';

const assert = require('assert/strict');
const { rootNoteOf, droneNoteFor } = require('../src/renderer/drone');

function playingProjectWinsOverStaleSelection() {
  const records = {
    playing: { key: 'G# min' },
    stale: { key: 'A# min' }
  };
  assert.equal(droneNoteFor(records, 'playing', null, 'stale'), 'G#');
}

function flatKeysArePlayableByTheSynth() {
  assert.equal(rootNoteOf({ key: 'Bb major' }), 'A#');
  assert.equal(rootNoteOf({ key: 'E♭ min' }), 'D#');
}

playingProjectWinsOverStaleSelection();
console.log('ok - playingProjectWinsOverStaleSelection');
flatKeysArePlayableByTheSynth();
console.log('ok - flatKeysArePlayableByTheSynth');
