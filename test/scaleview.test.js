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

testKeyboardLayoutAndHighlight();
console.log('ok - testKeyboardLayoutAndHighlight');
testCamelotWheelLayoutAndCompatibility();
console.log('ok - testCamelotWheelLayoutAndCompatibility');
