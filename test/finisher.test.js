'use strict';

const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const finisher = require('../src/main/lib/finisher');
const silence = require('../src/main/lib/silence');

function sineWav(seconds, sampleRate = 1000, amplitude = 0.25) {
  const frames = Math.round(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i += 1) {
    const sample = Math.sin((2 * Math.PI * 50 * i) / sampleRate) * amplitude;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  return buffer;
}

async function normalizeAndFitCreatesASafeCopy() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'daw-buddy-finish-'));
  try {
    const source = path.join(temp, 'loop.wav');
    const output = path.join(temp, 'output');
    await fs.writeFile(source, sineWav(4));
    const original = await fs.readFile(source);
    const options = {
      normalize: true,
      trimToBars: true,
      targetPeakDb: -6,
      bpm: 120,
      bars: 1,
      beatsPerBar: 4,
      sourceRoot: temp
    };

    const preview = await finisher.analyse(source, options);
    assert.ok(preview.trimSeconds > 1.99 && preview.trimSeconds < 2.01);
    assert.ok(preview.gainDb > 5.9 && preview.gainDb < 6.2);

    const result = await finisher.processFile(source, output, options);
    assert.equal(result.success, true);
    assert.equal(result.modified, true);
    const measured = await silence.measure(result.output);
    assert.ok(measured.duration > 1.99 && measured.duration < 2.01);
    assert.ok(measured.peakDb > -6.1 && measured.peakDb < -5.9);
    assert.deepEqual(await fs.readFile(source), original, 'source WAV must remain unchanged');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function shortAudioIsNeverPadded() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'daw-buddy-finish-short-'));
  try {
    const source = path.join(temp, 'short.wav');
    await fs.writeFile(source, sineWav(1));
    const preview = await finisher.analyse(source, {
      normalize: false,
      trimToBars: true,
      bpm: 120,
      bars: 1,
      beatsPerBar: 4
    });
    assert.equal(preview.tooShort, true);
    assert.equal(preview.trimSeconds, 0);
    assert.equal(preview.changing, false);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function run() {
  await normalizeAndFitCreatesASafeCopy();
  console.log('ok - normalizeAndFitCreatesASafeCopy');
  await shortAudioIsNeverPadded();
  console.log('ok - shortAudioIsNeverPadded');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
