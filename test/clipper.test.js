'use strict';

const assert = require('assert/strict');
const {
  makeClipCurve,
  normalizeClipperSettings,
  DEFAULT_CLIPPER_SETTINGS
} = require('../src/renderer/clipper');

function testClipperSettings() {
  const norm = normalizeClipperSettings({});
  assert.equal(norm.curve, 'tanh');
  assert.equal(norm.gainDb, 4.0);
  assert.equal(norm.ceilingDb, 0.0);

  const custom = normalizeClipperSettings({
    curve: 'quintic',
    gainDb: 12.5,
    ceilingDb: -1.5
  });
  assert.equal(custom.curve, 'quintic');
  assert.equal(custom.gainDb, 12.5);
  assert.equal(custom.ceilingDb, -1.5);

  const clamped = normalizeClipperSettings({
    curve: 'invalid',
    gainDb: 99,
    ceilingDb: -20
  });
  assert.equal(clamped.curve, 'tanh');
  assert.equal(clamped.gainDb, 18);
  assert.equal(clamped.ceilingDb, -6);
}

function testClipperTransferCurves() {
  const curves = ['hard', 'tanh', 'cubic', 'atan', 'quintic'];

  for (const curve of curves) {
    const table = makeClipCurve(curve, 6.0, -0.5, 1024);
    assert.equal(table.length, 1024);

    // Center point (x = 0) must be 0
    const midIndex = Math.floor(table.length / 2);
    assert.ok(Math.abs(table[midIndex]) < 0.01, `${curve} center point should be near 0`);

    // Output ceiling check
    const ceilingLinear = Math.pow(10, -0.5 / 20);
    for (let i = 0; i < table.length; i++) {
      assert.ok(
        table[i] <= ceilingLinear + 0.001 && table[i] >= -ceilingLinear - 0.001,
        `${curve} at index ${i} exceeded ceiling`
      );
    }

    // Monotonicity check (transfer function must be non-decreasing)
    for (let i = 1; i < table.length; i++) {
      assert.ok(
        table[i] >= table[i - 1] - 0.0001,
        `${curve} transfer curve is monotonic`
      );
    }
  }
}

testClipperSettings();
testClipperTransferCurves();
console.log('ok - testClipperDSPAndSettings');
