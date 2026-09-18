import test from 'node:test';
import assert from 'node:assert/strict';
import { scaleMidi } from '../src/renderer/midiwrite.ts';
import {
  transposeMidiBytes,
  remapMidiToScale,
  calculateShortestSemitoneShift,
  transposeChordName
} from '../src/renderer/miditranspose.ts';
import { getPitchDeltaSemitones } from '../src/renderer/audiotranspose.ts';

test('Key & Scale Matcher - MIDI Chromatic Transposition', () => {
  // Generate sample MIDI scale with notes [60, 62, 64] (C4, D4, E4)
  const origMidi = scaleMidi([60, 62, 64], { bpm: 120, bars: 1 });
  assert.ok(origMidi.length > 20, 'Original MIDI generated');

  // Transpose up 3 semitones (C4, D4, E4 -> D#4, F4, G4: 63, 65, 67)
  const transposedUp = transposeMidiBytes(origMidi, 3);
  assert.equal(transposedUp.length, origMidi.length, 'Length preserved');

  // Collect notes from transposed MIDI
  const notesFound = [];
  for (let i = 14; i < transposedUp.length - 2; i++) {
    // Look for Note-On events (status 0x90)
    if (transposedUp[i] === 0x90) {
      notesFound.push(transposedUp[i + 1]);
    }
  }

  assert.ok(notesFound.includes(63), 'Contains D#4 (63)');
  assert.ok(notesFound.includes(65), 'Contains F4 (65)');
  assert.ok(notesFound.includes(67), 'Contains G4 (67)');
  assert.ok(!notesFound.includes(60), 'Does not contain old note 60');

  // Transpose down 2 semitones
  const transposedDown = transposeMidiBytes(origMidi, -2);
  const notesDown = [];
  for (let i = 14; i < transposedDown.length - 2; i++) {
    if (transposedDown[i] === 0x90) {
      notesDown.push(transposedDown[i + 1]);
    }
  }
  assert.ok(notesDown.includes(58), 'Contains A#3 (58)');
  assert.ok(notesDown.includes(60), 'Contains C4 (60)');
  assert.ok(notesDown.includes(62), 'Contains D4 (62)');
});

test('Key & Scale Matcher - Modal Scale Remapping', () => {
  // A# minor scale root = 10 (A#), degrees = [0, 2, 3, 5, 7, 8, 10]
  // Target: G Major root = 7 (G), degrees = [0, 2, 4, 5, 7, 9, 11]
  // In A# minor, notes: A#4 (70), C#5 (73), F5 (77) -> A# minor triad
  const chordMidi = scaleMidi([70, 73, 77], { bpm: 120, bars: 1 });

  const remapped = remapMidiToScale(
    chordMidi,
    10, // A#
    [0, 2, 3, 5, 7, 8, 10], // Natural minor degrees
    7, // G
    [0, 2, 4, 5, 7, 9, 11] // Major degrees
  );

  assert.equal(remapped.length, chordMidi.length, 'Preserved MIDI structure');

  const remappedNotes = [];
  for (let i = 14; i < remapped.length - 2; i++) {
    if (remapped[i] === 0x90) {
      remappedNotes.push(remapped[i + 1]);
    }
  }

  // Root degree 0 (A# / 70) maps to root degree 0 (G / 67)
  assert.ok(remappedNotes.includes(67), 'Root A# maps to G');
  // Degree 3 (minor 3rd C# / 73) maps to degree 4 (major 3rd B / 71)
  assert.ok(remappedNotes.includes(71), 'Minor 3rd C# maps to Major 3rd B');
  // Degree 7 (5th F / 77) maps to degree 7 (5th D / 74)
  assert.ok(remappedNotes.includes(74), '5th F maps to 5th D');
});

test('Key & Scale Matcher - Chord Name Transposition', () => {
  assert.equal(transposeChordName('Am', 3), 'Cm');
  assert.equal(transposeChordName('A#min', -3), 'Gmin');
  assert.equal(transposeChordName('Gmaj7', 2), 'Amaj7');
  assert.equal(transposeChordName('F#', 1), 'G');
  assert.equal(transposeChordName('C', 0), 'C');
});

test('Key & Scale Matcher - Semitone & Pitch Delta Calculation', () => {
  // A# (10) to G (7)
  const shift = calculateShortestSemitoneShift(10, 7);
  assert.equal(shift, -3, 'A# to G is -3 semitones');

  // C (0) to G (7)
  const cToG = calculateShortestSemitoneShift(0, 7);
  assert.equal(cToG, -5, 'C to G shortest is -5 (down a 4th instead of up a 5th)');

  // G (7) to A (9)
  const gToA = getPitchDeltaSemitones(7, 9);
  assert.equal(gToA, 2, 'G to A is +2 semitones');
});
