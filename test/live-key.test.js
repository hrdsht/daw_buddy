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
  LIVE_CANDIDATE_COUNT,
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
  assert.equal(result.candidates[0].key, 'A min', 'most probable candidate matches the key');
  assert.ok(result.candidates[0].probability > 0.5);
  assert.ok(result.candidates[1].probability > 0.01, 'contenders stay visible');
  const all = DSP.keyCandidates(new Float64Array([1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1]));
  assert.equal(all.length, 24);
  assert.ok(Math.abs(all.reduce((a, c) => a + c.probability, 0) - 1) < 1e-9);
}

function testCandidateBarsFollowSettledKey() {
  const tracker = new LiveReadingTracker(6);
  const spread = [
    { key: 'A min', camelot: '8A', probability: 0.55 },
    { key: 'C maj', camelot: '8B', probability: 0.25 },
    { key: 'E min', camelot: '9A', probability: 0.1 },
    { key: 'D min', camelot: '7A', probability: 0.06 },
    { key: 'A maj', camelot: '11B', probability: 0.025 },
    { key: 'F maj', camelot: '7B', probability: 0.01 },
    { key: 'G maj', camelot: '9B', probability: 0.005 }
  ];
  let r;
  for (let i = 0; i < 3; i += 1) r = tracker.push({ ...reading('A min', '8A', 0.8, 124), candidates: spread });
  assert.equal(r.candidates.length, LIVE_CANDIDATE_COUNT);
  assert.equal(r.candidates[0].key, r.key, 'tallest bar is the settled key');
  for (let i = 1; i < r.candidates.length; i += 1) {
    assert.ok(r.candidates[i - 1].probability >= r.candidates[i].probability, 'bars are sorted');
  }
  const sum = r.candidates.reduce((a, c) => a + c.probability, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.equal(r.candidates[1].key, 'C maj', 'relative major is the runner-up');

  // Without spectral spread (older worker), bars fall back to the vote share.
  const plain = new LiveReadingTracker(6);
  r = plain.push(reading('G maj', '9B', 0.8, 120));
  assert.equal(r.candidates[0].key, 'G maj');
  assert.equal(r.candidates[0].probability, 1);
}

testDownsample();
testRollingBufferKeepsNewestInOrder();
testKeyHelpers();
testTrackerLocksAndResistsOutliers();
testAnalyseLiveOnRollingWindow();
testCandidateBarsFollowSettledKey();
console.log('live-key tests passed');
