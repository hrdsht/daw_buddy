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
  assert.equal(result.tonic, 'A');
  assert.ok(result.scale, 'scale should be detected');
  assert.ok(result.bpm >= 115 && result.bpm <= 125, `unexpected BPM: ${result.bpm}`);
}

function ragaPerformanceIdentifiesTonicAndModalScale() {
  const sampleRate = 44100;
  const seconds = 8;
  const n = sampleRate * seconds;
  const samples = new Float32Array(n);
  const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const tonicMidi = 58; // A#3
  const lowSaFreq = midiFreq(tonicMidi - 24); // A#1
  const kharjaFreq = midiFreq(tonicMidi - 12); // A#2
  const paFreq = midiFreq(tonicMidi + 7 - 12); // F2

  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate;
    samples[i] =
      0.45 * Math.sin(2 * Math.PI * lowSaFreq * t) +
      0.40 * Math.sin(2 * Math.PI * kharjaFreq * t) +
      0.35 * Math.sin(2 * Math.PI * paFreq * t);
  }

  const bhairavDegrees = [0, 1, 4, 5, 7, 8, 11];
  for (let noteIdx = 0; noteIdx < 16; noteIdx += 1) {
    const deg = bhairavDegrees[noteIdx % bhairavDegrees.length];
    const freq = midiFreq(tonicMidi + deg);
    const start = Math.floor(noteIdx * 0.4 * sampleRate);
    const end = Math.min(n, Math.floor((noteIdx + 1) * 0.4 * sampleRate));
    for (let i = start; i < end; i += 1) {
      const t = (i - start) / sampleRate;
      samples[i] += 0.35 * Math.sin(2 * Math.PI * freq * t);
    }
  }

  const result = DSP.analyse(samples, sampleRate);
  assert.equal(result.tonic, 'A#');
  assert.equal(result.scale, 'bhairav');
  assert.equal(result.modal, true);
  assert.equal(result.key, null);
  assert.equal(result.camelot, null);
}

function detunedIndianClassicalAudioIdentifiesTuningAndTonic() {
  const sampleRate = 44100;
  const seconds = 8;
  const n = sampleRate * seconds;
  const samples = new Float32Array(n);
  const a4 = 431;
  const midiFreq = (m) => a4 * Math.pow(2, (m - 69) / 12);
  const tonicMidi = 58; // A#3
  const lowSaFreq = midiFreq(tonicMidi - 24); // A#1
  const kharjaFreq = midiFreq(tonicMidi - 12); // A#2
  const paFreq = midiFreq(tonicMidi + 7 - 12); // F2

  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate;
    samples[i] =
      0.45 * Math.sin(2 * Math.PI * lowSaFreq * t) +
      0.40 * Math.sin(2 * Math.PI * kharjaFreq * t) +
      0.35 * Math.sin(2 * Math.PI * paFreq * t);
  }

  const bhairavDegrees = [0, 1, 4, 5, 7, 8, 11];
  for (let noteIdx = 0; noteIdx < 16; noteIdx += 1) {
    const deg = bhairavDegrees[noteIdx % bhairavDegrees.length];
    const freq = midiFreq(tonicMidi + deg);
    const start = Math.floor(noteIdx * 0.4 * sampleRate);
    const end = Math.min(n, Math.floor((noteIdx + 1) * 0.4 * sampleRate));
    for (let i = start; i < end; i += 1) {
      const t = (i - start) / sampleRate;
      samples[i] += 0.35 * Math.sin(2 * Math.PI * freq * t);
    }
  }

  const result = DSP.analyse(samples, sampleRate);
  assert.equal(result.tonic, 'A#');
  assert.equal(result.scale, 'bhairav');
  assert.equal(result.modal, true);
  assert.equal(result.tuningA4, 431);
}

automaticPlayAnalysisReturnsTempoAndKey();
console.log('ok - automaticPlayAnalysisReturnsTempoAndKey');
ragaPerformanceIdentifiesTonicAndModalScale();
console.log('ok - ragaPerformanceIdentifiesTonicAndModalScale');
detunedIndianClassicalAudioIdentifiesTuningAndTonic();
console.log('ok - detunedIndianClassicalAudioIdentifiesTuningAndTonic');


