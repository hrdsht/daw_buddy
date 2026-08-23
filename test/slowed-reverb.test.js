'use strict';

const assert = require('assert/strict');
const fs = require('fs');

// Ensure lame.min.js is populated into globalThis for Node test environment
try {
  const minPath = require.resolve('lamejs/lame.min.js');
  const src = fs.readFileSync(minPath, 'utf8');
  const fn = new Function('window', src + '; return window.lamejs || (typeof lamejs !== "undefined" ? lamejs : null);');
  globalThis.lamejs = fn(globalThis) || globalThis.lamejs;
} catch {}

const {
  percentToSemitones,
  semitonesToPercent,
  getPlaybackRate,
  getEqualPowerGains,
  createFreeverbIR,
  encodeWavBuffer,
  encodeMp3Buffer,
  DEFAULT_SLOWED_REVERB_OPTIONS
} = require('../src/renderer/slowed-reverb');

function testSpeedPitchConversions() {
  // 100% speed == 0 semitones
  assert.equal(Math.round(percentToSemitones(100)), 0);
  assert.equal(Math.round(semitonesToPercent(0)), 100);

  // 50% speed == -12 semitones (one octave down)
  assert.equal(Math.round(percentToSemitones(50)), -12);
  assert.equal(Math.round(semitonesToPercent(-12)), 50);

  // Default: ~87% is ~ -2 semitones
  const st = percentToSemitones(87);
  assert.ok(Math.abs(st - (-2.41)) < 0.1);
  const pct = semitonesToPercent(-2);
  assert.ok(Math.abs(pct - 89.08) < 0.1);

  // Playback rate
  assert.equal(getPlaybackRate(false, 85), 0.85);
  assert.ok(Math.abs(getPlaybackRate(true, -2) - 0.890898) < 0.001);
}

function testEqualPowerGains() {
  const g0 = getEqualPowerGains(0);
  assert.equal(g0.dry, 1);
  assert.equal(g0.wet, 0);

  const g100 = getEqualPowerGains(100);
  assert.ok(Math.abs(g100.dry) < 0.00001);
  assert.equal(g100.wet, 1);

  const g50 = getEqualPowerGains(50);
  assert.ok(Math.abs(g50.dry - Math.SQRT1_2) < 0.00001);
  assert.ok(Math.abs(g50.wet - Math.SQRT1_2) < 0.00001);

  // Energy conservation: dry^2 + wet^2 == 1
  for (let m = 0; m <= 100; m += 10) {
    const g = getEqualPowerGains(m);
    const sumSq = g.dry * g.dry + g.wet * g.wet;
    assert.ok(Math.abs(sumSq - 1.0) < 0.00001);
  }
}

function testFreeverbIRSynthesis() {
  const ir441 = createFreeverbIR(44100, 2.0, 0.8, 0.5);
  assert.equal(ir441.sampleRate, 44100);
  assert.equal(ir441.numberOfChannels, 2);
  assert.equal(ir441.length, 44100 * 2);

  const ch0 = ir441.getChannelData(0);
  const ch1 = ir441.getChannelData(1);
  assert.equal(ch0.length, 88200);
  let maxCh0 = 0;
  for (let i = 0; i < ch0.length; i++) {
    if (Math.abs(ch0[i]) > maxCh0) maxCh0 = Math.abs(ch0[i]);
  }
  assert.ok(maxCh0 > 0.01, 'Freeverb IR should synthesize reverberant reflection energy');

  const ir48 = createFreeverbIR(48000, 1.0, 0.8, 0.5);
  assert.equal(ir48.sampleRate, 48000);
  assert.equal(ir48.length, 48000);
}

function createMockAudioBuffer(sampleRate, channels, numSamples) {
  const data = [];
  for (let c = 0; c < channels; c++) {
    const arr = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      arr[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }
    data.push(arr);
  }

  return {
    sampleRate,
    numberOfChannels: channels,
    length: numSamples,
    duration: numSamples / sampleRate,
    getChannelData(c) {
      return data[c];
    }
  };
}

function testWavEncoders() {
  const sampleRate = 44100;
  const numSamples = 4410; // 0.1s
  const mockBuf = createMockAudioBuffer(sampleRate, 2, numSamples);

  // 16-bit PCM WAV
  const wav16 = encodeWavBuffer(mockBuf, 16);
  assert.ok(wav16 instanceof Uint8Array);
  const expectedSize16 = 44 + numSamples * 2 * 2;
  assert.equal(wav16.length, expectedSize16);

  const view16 = new DataView(wav16.buffer, wav16.byteOffset, wav16.byteLength);
  assert.equal(String.fromCharCode(wav16[0], wav16[1], wav16[2], wav16[3]), 'RIFF');
  assert.equal(String.fromCharCode(wav16[8], wav16[9], wav16[10], wav16[11]), 'WAVE');
  assert.equal(view16.getUint16(20, true), 1); // PCM format 1
  assert.equal(view16.getUint16(22, true), 2); // 2 channels
  assert.equal(view16.getUint32(24, true), 44100);
  assert.equal(view16.getUint16(34, true), 16); // 16 bits

  // 24-bit PCM WAV
  const wav24 = encodeWavBuffer(mockBuf, 24);
  const expectedSize24 = 44 + numSamples * 2 * 3;
  assert.equal(wav24.length, expectedSize24);
  const view24 = new DataView(wav24.buffer, wav24.byteOffset, wav24.byteLength);
  assert.equal(view24.getUint16(20, true), 1); // PCM format 1
  assert.equal(view24.getUint16(34, true), 24); // 24 bits

  // 32-bit Float WAV
  const wav32 = encodeWavBuffer(mockBuf, 32);
  const expectedSize32 = 44 + numSamples * 2 * 4;
  assert.equal(wav32.length, expectedSize32);
  const view32 = new DataView(wav32.buffer, wav32.byteOffset, wav32.byteLength);
  assert.equal(view32.getUint16(20, true), 3); // IEEE Float format 3
  assert.equal(view32.getUint16(34, true), 32); // 32 bits
}

async function testMp3Encoder() {
  const sampleRate = 44100;
  const numSamples = 44100; // 1s
  const mockBuf = createMockAudioBuffer(sampleRate, 2, numSamples);

  // 192 kbps MP3
  const mp3_192 = await encodeMp3Buffer(mockBuf, 192);
  assert.ok(mp3_192 instanceof Uint8Array);
  assert.ok(mp3_192.length > 5000); // 1s at 192kbps is ~24KB

  // 320 kbps MP3
  const mp3_320 = await encodeMp3Buffer(mockBuf, 320);
  assert.ok(mp3_320 instanceof Uint8Array);
  assert.ok(mp3_320.length > mp3_192.length * 0.9); // higher bitrate produces larger or similar frames
}

async function runAllTests() {
  testSpeedPitchConversions();
  console.log('ok - testSpeedPitchConversions');

  testEqualPowerGains();
  console.log('ok - testEqualPowerGains');

  testFreeverbIRSynthesis();
  console.log('ok - testFreeverbIRSynthesis');

  testWavEncoders();
  console.log('ok - testWavEncoders');

  await testMp3Encoder();
  console.log('ok - testMp3Encoder');

  console.log('All slowed-reverb tests passed successfully!');
}

runAllTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
