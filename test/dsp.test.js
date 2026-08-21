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

function meterAndTalaDetectionTests() {
  assert.ok(DSP.TALA_MAP['7/8'], 'TALA_MAP should contain 7/8');
  assert.equal(DSP.TALA_MAP['7/8'].name, 'Rupak / Mishra Chapu');
  assert.equal(DSP.TALA_MAP['7/8'].matras, 7);

  assert.ok(DSP.TALA_MAP['6/8'], 'TALA_MAP should contain 6/8');
  assert.ok(DSP.TALA_MAP['5/8'], 'TALA_MAP should contain 5/8');
  assert.ok(DSP.TALA_MAP['4/4'], 'TALA_MAP should contain 4/4');

  // Synthetic envelope with strong 7-pulse periodicity (Rupak 7/8 cycle)
  const beatLag = 20;
  const env = new Float32Array(500);
  for (let i = 0; i < env.length; i += Math.round(beatLag * 3.5)) {
    env[i] = 1.0;
  }
  const meter = DSP.detectMeter(env, beatLag, 0.01);
  assert.equal(meter.timeSignature, '7/8');
  assert.equal(meter.tala.name, 'Rupak / Mishra Chapu');
}

function ragaSuggestedTimeSignatureTests() {
  const bhairavi = DSP.RAGA_DEFINITIONS.find((r) => r.name === 'Bhairavi');
  assert.ok(bhairavi, 'Bhairavi should exist in RAGA_DEFINITIONS');
  assert.equal(bhairavi.suggestedTimeSig, '6/8');
  assert.ok(bhairavi.suggestedTaal.includes('Dadra'));

  const bhimpalasi = DSP.RAGA_DEFINITIONS.find((r) => r.name === 'Bhimpalasi');
  assert.ok(bhimpalasi, 'Bhimpalasi should exist in RAGA_DEFINITIONS');
  assert.equal(bhimpalasi.suggestedTimeSig, '5/4');
  assert.ok(bhimpalasi.suggestedTaal.includes('Jhaptal'));

  const hansadhwani = DSP.RAGA_DEFINITIONS.find((r) => r.name === 'Hansadhwani');
  assert.ok(hansadhwani, 'Hansadhwani should exist in RAGA_DEFINITIONS');
  assert.equal(hansadhwani.suggestedTimeSig, '7/8');
  assert.ok(hansadhwani.suggestedTaal.includes('Rupak'));

  // Test findMatchingRagas propagation
  const chroma = new Float64Array(12);
  bhairavi.degrees.forEach((d) => { chroma[d] = 1.0; });
  const matches = DSP.findMatchingRagas(chroma, 0, 5);
  const matchedBhairavi = matches.find((m) => m.name === 'Bhairavi');
  assert.ok(matchedBhairavi, 'findMatchingRagas should return Bhairavi');
  assert.equal(matchedBhairavi.suggestedTimeSig, '6/8');
}

function genreDatabaseTests() {
  assert.ok(DSP.GENRE_DATABASE && DSP.GENRE_DATABASE.length >= 40, 'GENRE_DATABASE should have rich genre coverage');
  
  const botanica = DSP.GENRE_DATABASE.find((g) => g.id === 'botanica');
  assert.ok(botanica, 'Botanica should exist');
  assert.equal(botanica.category, 'Botanica & Organic');

  const bollyDance = DSP.GENRE_DATABASE.find((g) => g.id === 'bollywood-dance');
  assert.ok(bollyDance, 'Bollywood Dance should exist');
  assert.equal(bollyDance.category, 'Bollywood & Indian');

  const bollyTrap = DSP.GENRE_DATABASE.find((g) => g.id === 'bolly-trap');
  assert.ok(bollyTrap, 'Bolly-Trap should exist');
  assert.equal(bollyTrap.category, 'Bollywood & Indian');

  const punjabiPop = DSP.GENRE_DATABASE.find((g) => g.id === 'punjabi-pop');
  assert.ok(punjabiPop, 'Punjabi Pop should exist');

  const kuthu = DSP.GENRE_DATABASE.find((g) => g.id === 'south-kuthu');
  assert.ok(kuthu, 'South Indian Kuthu should exist');

  const afroHouse = DSP.GENRE_DATABASE.find((g) => g.id === 'afro-house');
  assert.ok(afroHouse, 'Afro House should exist');
  assert.equal(afroHouse.category, 'Afro & Latin');

  const riddim = DSP.GENRE_DATABASE.find((g) => g.id === 'riddim');
  assert.ok(riddim, 'Riddim should exist');
  assert.equal(riddim.category, 'Dubstep & Bass');

  const colourBass = DSP.GENRE_DATABASE.find((g) => g.id === 'colour-bass');
  assert.ok(colourBass, 'Colour Bass should exist');
  assert.equal(colourBass.category, 'Dubstep & Bass');

  const liquidDnb = DSP.GENRE_DATABASE.find((g) => g.id === 'liquid-dnb');
  assert.ok(liquidDnb, 'Liquid DnB should exist');
  assert.equal(liquidDnb.category, 'Drum & Bass');

  const reggaeton = DSP.GENRE_DATABASE.find((g) => g.id === 'reggaeton');
  assert.ok(reggaeton, 'Reggaeton should exist');

  const phonk = DSP.GENRE_DATABASE.find((g) => g.id === 'phonk');
  assert.ok(phonk, 'Phonk should exist');
}

function scaleChangeDetectorIdentifiesModulation() {
  const sampleRate = 11025;
  const seconds = 24;
  const samples = new Float32Array(sampleRate * seconds);

  // First half (0..12s): C Major chord with bass root (C3 130.81Hz, C4 261.63Hz, E4 329.63Hz, G4 392Hz)
  const half = Math.floor(samples.length / 2);
  for (let i = 0; i < half; i += 1) {
    const t = i / sampleRate;
    samples[i] =
      0.50 * Math.sin(2 * Math.PI * 130.81 * t) +
      0.35 * Math.sin(2 * Math.PI * 261.63 * t) +
      0.30 * Math.sin(2 * Math.PI * 329.63 * t) +
      0.25 * Math.sin(2 * Math.PI * 392.00 * t);
  }

  // Second half (12..24s): D Major chord with bass root (D3 146.83Hz, D4 293.66Hz, F#4 369.99Hz, A4 440Hz) (+2 st gear-shift lift)
  for (let i = half; i < samples.length; i += 1) {
    const t = i / sampleRate;
    samples[i] =
      0.50 * Math.sin(2 * Math.PI * 146.83 * t) +
      0.35 * Math.sin(2 * Math.PI * 293.66 * t) +
      0.30 * Math.sin(2 * Math.PI * 369.99 * t) +
      0.25 * Math.sin(2 * Math.PI * 440.00 * t);
  }

  const report = DSP.detectScaleModulations(samples, sampleRate, { windowSec: 6, hopSec: 3 });
  assert.ok(report, 'Report should be returned');
  assert.equal(report.hasModulation, true, 'Should detect key modulation');
  assert.ok(report.segments.length >= 2, 'Should have at least 2 segments');
  assert.ok(report.uniqueKeys.includes('C maj'), 'Unique keys should include C maj');
  assert.ok(report.uniqueKeys.includes('D maj'), 'Unique keys should include D maj');

  // Verify transition from segment 0 to 1
  const seg1 = report.segments[report.segments.length - 1];
  assert.ok(seg1.transitionFromPrev, 'Transition info should be recorded');
  assert.equal(seg1.transitionFromPrev.semitoneDelta, 2, 'Should detect +2 st shift');
}

automaticPlayAnalysisReturnsTempoAndKey();
console.log('ok - automaticPlayAnalysisReturnsTempoAndKey');
ragaPerformanceIdentifiesTonicAndModalScale();
console.log('ok - ragaPerformanceIdentifiesTonicAndModalScale');
detunedIndianClassicalAudioIdentifiesTuningAndTonic();
console.log('ok - detunedIndianClassicalAudioIdentifiesTuningAndTonic');
meterAndTalaDetectionTests();
console.log('ok - meterAndTalaDetectionTests');
ragaSuggestedTimeSignatureTests();
console.log('ok - ragaSuggestedTimeSignatureTests');
genreDatabaseTests();
console.log('ok - genreDatabaseTests');
scaleChangeDetectorIdentifiesModulation();
console.log('ok - scaleChangeDetectorIdentifiesModulation');





