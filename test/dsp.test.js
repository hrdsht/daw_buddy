'use strict';

const assert = require('assert/strict');
const { DSP } = require('../src/renderer/dsp');

function automaticPlayAnalysisReturnsTempoAndKey() {
  const sampleRate = 11025;
  const seconds = 20;
  const samples = new Float32Array(sampleRate * seconds);

  // A-minor chord with a short pulse every half-second (120 BPM).
  for (let i = 0; i < samples.length; i += 1) {
    const time = i / sampleRate;
    samples[i] =
      0.15 * Math.sin(2 * Math.PI * 220 * time) +
      0.12 * Math.sin(2 * Math.PI * 261.63 * time) +
      0.1 * Math.sin(2 * Math.PI * 329.63 * time);
    const beatSample = i % (sampleRate / 2);
    if (beatSample < 180) samples[i] += (1 - beatSample / 180) * 0.8;
  }

  const result = DSP.analyse(samples, sampleRate);
  assert.equal(result.key, 'A min');
  assert.equal(result.camelot, '8A');
  assert.ok(result.bpm >= 115 && result.bpm <= 125, `unexpected BPM: ${result.bpm}`);
}

automaticPlayAnalysisReturnsTempoAndKey();
console.log('ok - automaticPlayAnalysisReturnsTempoAndKey');
