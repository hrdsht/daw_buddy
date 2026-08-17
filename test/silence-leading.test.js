'use strict';

const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const silence = require('../src/main/lib/silence');

function paddedWav(sampleRate = 1000) {
  const leading = 500;
  const audio = 1000;
  const trailing = 500;
  const frames = leading + audio + trailing;
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
  for (let i = 0; i < audio; i += 1) {
    const sample = Math.sin((2 * Math.PI * 50 * i) / sampleRate) * 0.5;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + (leading + i) * 2);
  }
  return buffer;
}

async function beginningAndEndSilenceArePreviewedAndCopiedSafely() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'daw-buddy-leading-'));
  try {
    const source = path.join(temp, 'padded.wav');
    const output = path.join(temp, 'output');
    await fs.writeFile(source, paddedWav());
    const original = await fs.readFile(source);
    const options = {
      detection: 'Peak',
      thresholdDb: -40,
      where: 'Both',
      headMs: 10,
      tailMs: 10,
      sourceRoot: temp
    };

    const preview = await silence.analyse(source, options);
    assert.ok(preview.leadingRemovable > 0.48 && preview.leadingRemovable < 0.51);
    assert.ok(preview.trailingRemovable > 0.48 && preview.trailingRemovable < 0.51);

    const result = await silence.removeSilence(source, output, options);
    assert.equal(result.success, true);
    assert.equal(result.modified, true);
    assert.ok(result.leadingSecondsRemoved > 0.48);
    assert.ok(result.trailingSecondsRemoved > 0.48);
    const measured = await silence.measure(result.output);
    assert.ok(measured.duration > 1.01 && measured.duration < 1.03);
    assert.deepEqual(await fs.readFile(source), original, 'source WAV must remain unchanged');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function beginningOnlyLeavesTheEndingAlone() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'daw-buddy-leading-only-'));
  try {
    const source = path.join(temp, 'padded.wav');
    await fs.writeFile(source, paddedWav());
    const preview = await silence.analyse(source, {
      detection: 'Peak',
      thresholdDb: -40,
      where: 'Start',
      headMs: 10,
      tailMs: 10
    });
    assert.ok(preview.leadingRemovable > 0.48);
    assert.equal(preview.trailingRemovable, 0);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function run() {
  await beginningAndEndSilenceArePreviewedAndCopiedSafely();
  console.log('ok - beginningAndEndSilenceArePreviewedAndCopiedSafely');
  await beginningOnlyLeavesTheEndingAlone();
  console.log('ok - beginningOnlyLeavesTheEndingAlone');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
