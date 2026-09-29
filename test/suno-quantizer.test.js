import assert from 'assert/strict';
import {
  classifyStemRole,
  detectOnsets,
  estimateAnchorBpm,
  buildMasterDriftMap,
  interpolateSourceTime,
  timeStretchWSOLA,
  generateWarpSummary
} from '../src/renderer/suno-quantizer.ts';

function testStemClassification() {
  assert.equal(classifyStemRole('drums.wav'), 'drums');
  assert.equal(classifyStemRole('suno_project_kick_snare.wav'), 'drums');
  assert.equal(classifyStemRole('Percussion_Track_1.mp3'), 'drums');
  assert.equal(classifyStemRole('stem_bass.wav'), 'bass');
  assert.equal(classifyStemRole('808_sub_bass.wav'), 'bass');
  assert.equal(classifyStemRole('lead_vocals.wav'), 'vocals');
  assert.equal(classifyStemRole('Acapella_Harmonies.mp3'), 'vocals');
  assert.equal(classifyStemRole('electric_guitar.wav'), 'instruments');
  assert.equal(classifyStemRole('synth_pad.wav'), 'instruments');
  assert.equal(classifyStemRole('other.wav'), 'instruments');
  assert.equal(classifyStemRole('ambience_fx.wav'), 'other');
}

function testOnsetDetectionAndAnchorBpm() {
  const sampleRate = 22050;
  const durationSec = 10;
  const numSamples = sampleRate * durationSec;
  const buffer = new Float32Array(numSamples);

  // Generate a synthetic kick/snare pulse every 0.5s (120 BPM)
  const intervalSamples = Math.round(sampleRate * 0.5);
  for (let t = 0; t < numSamples; t += intervalSamples) {
    // Sharp kick attack lasting ~30ms
    const pulseLen = Math.round(sampleRate * 0.03);
    for (let k = 0; k < pulseLen && t + k < numSamples; k++) {
      const decay = 1.0 - k / pulseLen;
      buffer[t + k] += Math.sin(2 * Math.PI * 65 * (k / sampleRate)) * decay * 0.9;
    }
  }

  const onsets = detectOnsets(buffer, sampleRate, 256, 50);
  assert.ok(onsets.length >= 18, `Expected at least 18 onsets, found ${onsets.length}`);

  // Check that onsets occur near 0.0s, 0.5s, 1.0s, etc.
  for (let i = 0; i < Math.min(5, onsets.length); i++) {
    const expected = i * 0.5;
    assert.ok(
      Math.abs(onsets[i] - expected) < 0.04,
      `Onset ${i} (${onsets[i]}s) should be near ${expected}s`
    );
  }

  // Anchor BPM estimation
  const est = estimateAnchorBpm(onsets, sampleRate, 10);
  assert.equal(est.roundedBpm, 120);
  assert.ok(Math.abs(est.detectedBpm - 120) < 1.0);
  assert.ok(est.confidence > 0.5, `Confidence ${est.confidence} should be > 0.5`);
}

function testDriftMapGeneration() {
  // Simulate synthetic onsets that start at 120 BPM (interval 0.5s)
  // and drift gradually by +30ms over 16 bars
  const onsets = [];
  const baseInterval = 0.5; // 120 BPM
  let curTime = 0.1; // downbeat offset

  for (let b = 0; b < 64; b++) {
    onsets.push(curTime);
    // Add cumulative drift +0.6ms per beat (~40ms total)
    const driftStep = 0.0006;
    curTime += baseInterval + driftStep;
  }

  const targetBpm = 120;
  const downbeatSec = 0.1;
  const totalDuration = onsets[onsets.length - 1] + 0.4;

  const result = buildMasterDriftMap(onsets, targetBpm, downbeatSec, totalDuration);

  assert.ok(result.markers.length >= 16, `Markers should be created per bar, got ${result.markers.length}`);
  assert.ok(result.maxDriftMs > 20, `Max drift ${result.maxDriftMs} should reflect cumulative drift`);
  assert.ok(result.avgDriftMs > 10, 'Average drift should be non-zero');
  assert.equal(result.barCount, 16);

  // Verify interpolateSourceTime
  const t0 = interpolateSourceTime(0, result.markers);
  assert.equal(t0, 0);

  const midTarget = downbeatSec + 10 * 0.5; // beat 10
  const midSource = interpolateSourceTime(midTarget, result.markers);
  assert.ok(midSource >= midTarget, 'Drifting audio source time should be >= target time');
}

function testWSOLATimeStretchAndPhaseInversion() {
  const sampleRate = 22050;
  const durationSec = 2.0;
  const numSamples = Math.round(sampleRate * durationSec);

  // Create test tone (440 Hz sine)
  const chan0 = new Float32Array(numSamples);
  const chan1 = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const s = 0.5 * Math.sin(2 * Math.PI * 440 * (i / sampleRate));
    chan0[i] = s;
    chan1[i] = -s; // Inverted phase!
  }

  // Create warp markers to stretch audio by ~10% (target 2.2s)
  const markers = [
    { sourceSec: 0, targetSec: 0 },
    { sourceSec: 1.0, targetSec: 1.1 },
    { sourceSec: 2.0, targetSec: 2.2 }
  ];

  const { outputChannels, grainOffsets } = timeStretchWSOLA(
    [chan0, chan1],
    sampleRate,
    markers,
    { winSize: 512, hopSize: 256, searchWindow: 64 }
  );

  assert.equal(outputChannels.length, 2);
  const targetSamples = Math.round(2.2 * sampleRate);
  assert.equal(outputChannels[0].length, targetSamples);

  // Inverted phase test: chan0 + chan1 MUST cancel out to zero!
  let maxResidual = 0;
  for (let i = 0; i < targetSamples; i++) {
    const sum = outputChannels[0][i] + outputChannels[1][i];
    const absSum = Math.abs(sum);
    if (absSum > maxResidual) maxResidual = absSum;
  }

  assert.ok(
    maxResidual < 1e-5,
    `Multi-channel phase cancellation failed: max residual ${maxResidual}`
  );

  // Test multi-stem phase coherence with precomputed grains
  const chanStem2 = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    chanStem2[i] = -chan0[i];
  }

  const stem2Res = timeStretchWSOLA(
    [chanStem2],
    sampleRate,
    markers,
    { winSize: 512, hopSize: 256, searchWindow: 64, precomputedGrains: grainOffsets }
  );

  let stemResidual = 0;
  for (let i = 0; i < targetSamples; i++) {
    const sum = outputChannels[0][i] + stem2Res.outputChannels[0][i];
    if (Math.abs(sum) > stemResidual) stemResidual = Math.abs(sum);
  }

  assert.ok(
    stemResidual < 1e-5,
    `Cross-stem phase lock failed: residual ${stemResidual}`
  );

  // Summary generation test
  const summary = generateWarpSummary(markers, 120);
  assert.ok(summary.includes('Target BPM: 120'));
  assert.ok(summary.includes('Marker Count: 3'));
}

function test110BpmEstimation() {
  const sampleRate = 22050;
  const beatSec = 60 / 110; // ~0.54545s
  const onsets = [];
  // 16 bars of 110 BPM groove with syncopated 8th note kicks and snares
  for (let bar = 0; bar < 16; bar++) {
    const barStart = bar * 4 * beatSec;
    onsets.push(barStart); // beat 1
    onsets.push(barStart + beatSec); // beat 2
    onsets.push(barStart + 1.5 * beatSec); // beat 2.5 (syncopated 8th note)
    onsets.push(barStart + 3 * beatSec); // beat 4
  }

  const est = estimateAnchorBpm(onsets, sampleRate, 32);
  assert.equal(
    est.roundedBpm,
    110,
    `Expected 110 BPM, but got ${est.roundedBpm} BPM (detected ${est.detectedBpm})`
  );
}

function runAll() {
  testStemClassification();
  testOnsetDetectionAndAnchorBpm();
  test110BpmEstimation();
  testDriftMapGeneration();
  testWSOLATimeStretchAndPhaseInversion();
  console.log('✔ All Suno Stem Quantizer DSP and TSM tests passed!');
}

runAll();
