'use strict';

const assert = require('assert/strict');
const {
  calculateDelayMs,
  calculateHz,
  calculateSamples,
  calculateBpmFromTaps,
  formatMs,
  formatHz,
  getDelayDetails,
  getQuickDelayTable,
  TapTempoEngine,
  SUPPORTED_DENOMINATORS
} = require('../src/renderer/bpm-tool');

function testDelayCalculations() {
  // At 120 BPM:
  // Quarter note (1/4) = 60,000 / 120 = 500 ms
  const qtr = calculateDelayMs(120, 1, 4, 'straight');
  assert.equal(qtr, 500);

  // Whole note (1/1) = 2000 ms
  const whole = calculateDelayMs(120, 1, 1, 'straight');
  assert.equal(whole, 2000);

  // Half note (1/2) = 1000 ms
  const half = calculateDelayMs(120, 1, 2, 'straight');
  assert.equal(half, 1000);

  // Eighth note (1/8) = 250 ms
  const eighth = calculateDelayMs(120, 1, 8, 'straight');
  assert.equal(eighth, 250);

  // Sixteenth note (1/16) = 125 ms
  const sixteenth = calculateDelayMs(120, 1, 16, 'straight');
  assert.equal(sixteenth, 125);

  // 1/256 note = 500 / 64 = 7.8125 -> rounded to 7.813 ms
  const note256 = calculateDelayMs(120, 1, 256, 'straight');
  assert.ok(Math.abs(note256 - 7.813) < 0.01, `Expected ~7.813ms, got ${note256}`);

  // Test numerator variation: 3/4 note (dotted half equivalent, 3 beats)
  // 3 * 500 ms = 1500 ms
  const threeFourths = calculateDelayMs(120, 3, 4, 'straight');
  assert.equal(threeFourths, 1500);

  // Test 3/16 note (dotted 8th equivalent): 3 * 125 = 375 ms
  const threeSixteenth = calculateDelayMs(120, 3, 16, 'straight');
  assert.equal(threeSixteenth, 375);

  // Test Dotted modifier: 1/4 dotted = 500 * 1.5 = 750 ms
  const qtrDotted = calculateDelayMs(120, 1, 4, 'dotted');
  assert.equal(qtrDotted, 750);

  // Test Triplet modifier: 1/4 triplet = 500 * (2/3) = 333.333 ms
  const qtrTriplet = calculateDelayMs(120, 1, 4, 'triplet');
  assert.ok(Math.abs(qtrTriplet - 333.333) < 0.01);

  // Test different BPM (140 BPM)
  // Quarter note at 140 BPM = 60,000 / 140 = 428.571 ms
  const bpm140Quarter = calculateDelayMs(140, 1, 4, 'straight');
  assert.ok(Math.abs(bpm140Quarter - 428.571) < 0.01);
}

function testFrequencyAndSamples() {
  // 500 ms period -> 1000 / 500 = 2.0 Hz
  assert.equal(calculateHz(500), 2.0);

  // 250 ms period -> 4.0 Hz
  assert.equal(calculateHz(250), 4.0);

  // Samples at 44.1 kHz for 500 ms = 22050 samples
  assert.equal(calculateSamples(500, 44100), 22050);

  // Samples at 48.0 kHz for 500 ms = 24000 samples
  assert.equal(calculateSamples(500, 48000), 24000);

  // Samples at 96.0 kHz for 500 ms = 48000 samples
  assert.equal(calculateSamples(500, 96000), 48000);

  // Formatting helpers
  assert.equal(formatMs(500), '500.0 ms');
  assert.equal(formatMs(7.8125), '7.813 ms');
  assert.equal(formatHz(2), '2.00 Hz');
}

function testTapTempo() {
  // Steady 500ms intervals -> 120.0 BPM
  const baseTime = 10000;
  const taps = [baseTime, baseTime + 500, baseTime + 1000, baseTime + 1500, baseTime + 2000];
  const res = calculateBpmFromTaps(taps);
  assert.ok(res !== null);
  assert.equal(res.bpm, 120.0);
  assert.equal(res.confidence, 'high');
  assert.equal(res.count, 5);

  // TapTempoEngine with reset after long pause
  const engine = new TapTempoEngine();
  engine.tap(1000);
  engine.tap(1500); // 500ms -> 120 BPM
  const tap2 = engine.tap(2000);
  assert.ok(tap2 !== null);
  assert.equal(tap2.bpm, 120.0);

  // Pause for 3000 ms -> should reset sequence
  const afterPause = engine.tap(5000);
  assert.equal(afterPause, null); // 1 tap only, cannot calculate BPM yet
  assert.equal(engine.getTapCount(), 1);

  // Next tap after 500ms
  const resumeTap = engine.tap(5500);
  assert.ok(resumeTap !== null);
  assert.equal(resumeTap.bpm, 120.0);
}

function testQuickDelayTable() {
  const table = getQuickDelayTable(120);
  assert.equal(table.length, SUPPORTED_DENOMINATORS.length);

  const row14 = table.find(r => r.fractionLabel === '1/4');
  assert.ok(row14);
  assert.equal(row14.straightMs, 500);
  assert.equal(row14.dottedMs, 750);
  assert.ok(Math.abs(row14.tripletMs - 333.333) < 0.01);
  assert.equal(row14.hz, 2.0);

  const row256 = table.find(r => r.fractionLabel === '1/256');
  assert.ok(row256);
  assert.ok(Math.abs(row256.straightMs - 7.813) < 0.01);
}

function runAll() {
  testDelayCalculations();
  testFrequencyAndSamples();
  testTapTempo();
  testQuickDelayTable();
  console.log('✔ All BPM & Delay Calculator Engine tests passed!');
}

runAll();
