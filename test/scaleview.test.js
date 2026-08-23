'use strict';

const assert = require('assert/strict');
const scaleview = require('../src/renderer/scaleview');

function testKeyboardLayoutAndHighlight() {
  const kb = scaleview.layout(2, 22, 96);
  assert.equal(kb.keys.length, 24); // 7 white + 5 black per octave * 2 = 24
  assert.equal(kb.width, 14 * 22);

  // Test A# Bhairav: tonic A# (pc 10), degrees: [0, 1, 4, 5, 7, 8, 11]
  // Bhairav notes on A#: A# (10), B (11), D (2), D# (3), F (5), F# (6), A (9)
  const bhairavDegrees = [0, 1, 4, 5, 7, 8, 11];
  const highlighted = scaleview.highlight(kb.keys, 10, bhairavDegrees);

  const tonicKeys = highlighted.filter((k) => k.state === 'tonic');
  assert.equal(tonicKeys.length, 2); // Two octaves -> two A# tonic keys
  tonicKeys.forEach((k) => {
    assert.equal(k.name, 'A#');
    assert.equal(k.degree, 1);
  });

  const scaleKeys = highlighted.filter((k) => k.state === 'scale');
  assert.equal(scaleKeys.length, 12); // 6 other scale notes * 2 octaves = 12

  const outKeys = highlighted.filter((k) => k.state === 'out');
  assert.equal(outKeys.length, 10); // 5 out notes * 2 octaves = 10
}

function testCamelotWheelLayoutAndCompatibility() {
  const wheel = scaleview.wheelLayout(78);
  assert.equal(wheel.segments.length, 24); // 12 positions * 2 rings

  // Test A# minor -> 3A
  const code = scaleview.codeFor('A#', 'min');
  assert.equal(code, '3A');

  const comp = scaleview.compatible('3A');
  assert.equal(comp.current, '3A');
  assert.equal(comp.relative, '3B'); // C# major
  assert.equal(comp.up, '4A'); // F minor
  assert.equal(comp.down, '2A'); // D# minor
  assert.deepEqual(comp.all, ['3B', '4A', '2A']);

  // Test wrapping at 1A -> 12A / 2A
  const comp1A = scaleview.compatible('1A');
  assert.equal(comp1A.relative, '1B');
  assert.equal(comp1A.up, '2A');
  assert.equal(comp1A.down, '12A');
}

function testFretboardLayoutAndHighlight() {
  const fb = scaleview.fretboardLayout(12, 580, 110);
  assert.equal(fb.strings.length, 6);
  assert.equal(fb.frets.length, 12);
  assert.equal(fb.notes.length, 6 * 13); // 6 strings * (12 frets + 1 open string) = 78 notes

  // Test C Major (Tonic C = 0, degrees = [0, 2, 4, 5, 7, 9, 11])
  const majorDegrees = [0, 2, 4, 5, 7, 9, 11];
  const highlighted = scaleview.highlightFretboard(fb.notes, 0, majorDegrees);

  const tonicNotes = highlighted.filter((n) => n.state === 'tonic');
  assert.ok(tonicNotes.length >= 6); // At least 6 C notes across standard fretboard
  tonicNotes.forEach((n) => {
    assert.equal(n.name, 'C');
    assert.equal(n.degree, 1);
  });

  const scaleNotes = highlighted.filter((n) => n.state === 'scale');
  assert.ok(scaleNotes.length > 30);

  const outNotes = highlighted.filter((n) => n.state === 'out');
  assert.ok(outNotes.length > 0);
}

testKeyboardLayoutAndHighlight();
console.log('ok - testKeyboardLayoutAndHighlight');
testCamelotWheelLayoutAndCompatibility();
console.log('ok - testCamelotWheelLayoutAndCompatibility');
testFretboardLayoutAndHighlight();
console.log('ok - testFretboardLayoutAndHighlight');
