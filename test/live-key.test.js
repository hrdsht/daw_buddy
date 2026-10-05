'use strict';

const assert = require('assert/strict');
const { DSP } = require('../src/renderer/dsp');
const {
  downsample,
  RollingBuffer,
  relativeKey,
  confidenceTone,
  formatReading,
  foldTempo,
  LiveReadingTracker,
  LIVE_SAMPLE_RATE,
  LIVE_WINDOW_SECONDS
} = require('../src/renderer/live-key');

function testDownsample() {
  const input = new Float32Array(48000).fill(0.5);
  const out = downsample(input, 48000, 12000);
  assert.equal(out.length, 12000);
  assert.ok(Math.abs(out[100] - 0.5) < 1e-6);
  assert.equal(downsample(input, 11025, 11025).length, 48000);
}

function testRollingBufferKeepsNewestInOrder() {
  const ring = new RollingBuffer(5);
  ring.push(Float32Array.from([1, 2, 3]));
  assert.deepEqual(Array.from(ring.snapshot()), [1, 2, 3]);
  ring.push(Float32Array.from([4, 5, 6, 7]));
  assert.equal(ring.length, 5);
  assert.deepEqual(Array.from(ring.snapshot()), [3, 4, 5, 6, 7]);
  ring.clear();
  assert.equal(ring.length, 0);
}

function testKeyHelpers() {
  assert.equal(relativeKey('A min'), 'C maj');
  assert.equal(relativeKey('C maj'), 'A min');
  assert.equal(relativeKey('F# min'), 'A maj');
  assert.equal(relativeKey(null), null);
  assert.equal(confidenceTone(0.2), 'red');
  assert.equal(confidenceTone(0.5), 'amber');
  assert.equal(confidenceTone(0.9), 'green');
  assert.equal(formatReading({ key: 'A min', camelot: '8A', bpm: 123.6 }), 'A min · 8A · 124 BPM');
  assert.equal(formatReading({ key: 'A min', camelot: '8A', bpm: null }), 'A min · 8A');
  assert.equal(Math.round(foldTempo(62, 124)), 124);
  assert.equal(Math.round(foldTempo(248, 124)), 124);
}

function reading(key, camelot, conf, bpm) {
  return { key, camelot, keyConfidence: conf, bpm, bpmConfidence: 0.5, tuningCents: 0, rms: 0.1 };
}

function testTrackerLocksAndResistsOutliers() {
  const tracker = new LiveReadingTracker(6);
  let r = tracker.push(reading('A min', '8A', 0.8, 124));
  assert.equal(r.state, 'listening');
  tracker.push(reading('A min', '8A', 0.8, 62));
  r = tracker.push(reading('A min', '8A', 0.8, 124));
  assert.equal(r.state, 'locked');
  assert.equal(r.key, 'A min');
  assert.equal(r.relative, 'C maj');
  assert.equal(Math.round(r.bpm), 124, 'half-time reading folds into the dominant octave');

  // One borrowed-chord window must not flip the locked key.
  r = tracker.push(reading('C maj', '8B', 0.6, 124));
  assert.equal(r.key, 'A min');

  // Silence neither feeds the vote nor clears it.
  r = tracker.push({ ...reading('D min', '7A', 0.9, 90), rms: 0 });
  assert.equal(r.state, 'silent');
  assert.equal(r.key, 'A min');
}

function testAnalyseLiveOnRollingWindow() {
  const sampleRate = LIVE_SAMPLE_RATE;
  const samples = new Float32Array(sampleRate * LIVE_WINDOW_SECONDS);
  for (let i = 0; i < samples.length; i += 1) {
    const t = i / sampleRate;
    samples[i] =
      0.15 * Math.sin(2 * Math.PI * 220 * t) +
      0.12 * Math.sin(2 * Math.PI * 261.63 * t) +
      0.1 * Math.sin(2 * Math.PI * 329.63 * t);
    const beat = i % (sampleRate / 2);
    if (beat < 180) samples[i] += (1 - beat / 180) * 0.8;
  }
  const result = DSP.analyseLive(samples, sampleRate);
  assert.equal(result.key, 'A min');
  assert.equal(result.camelot, '8A');
  assert.ok(result.bpm >= 115 && result.bpm <= 125, `unexpected BPM: ${result.bpm}`);
  assert.ok(result.rms > 0.01);
  assert.equal('chordProgression' in result, false, 'live pass skips chord work');
}

testDownsample();
testRollingBufferKeepsNewestInOrder();
testKeyHelpers();
testTrackerLocksAndResistsOutliers();
testAnalyseLiveOnRollingWindow();
console.log('live-key tests passed');
