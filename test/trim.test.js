'use strict';

const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const trim = require('../src/main/lib/trim');
const silence = require('../src/main/lib/silence');

// A 16-bit mono WAV, `seconds` long, silent until `markerAt` seconds and then a
// constant marker value to the end. Trimming across that boundary lets us prove
// the cut landed on the exact frame, not just that a file appeared.
function markedWav(sampleRate, seconds, markerAt, marker = 12000) {
  const frames = Math.round(sampleRate * seconds);
  const markerFrame = Math.round(sampleRate * markerAt);
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 2, 40);
  for (let i = markerFrame; i < frames; i += 1) {
    buffer.writeInt16LE(marker, 44 + i * 2);
  }
  return buffer;
}

function sampleAt(buf, dataOffset, frame) {
  return buf.readInt16LE(dataOffset + frame * 2);
}

async function trimsToTheExactFrameAndStaysValidWav() {
  const sr = 8000;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'daw-buddy-trim-'));
  try {
    const source = path.join(temp, 'tone.wav');
    const output = path.join(temp, 'out');
    // 4s file, marker tone begins at exactly 2.0s.
    await fs.writeFile(source, markedWav(sr, 4, 2.0));
    const original = await fs.readFile(source);

    // Keep [1.0s, 3.0s] -> a 2.0s clip whose marker now begins at 1.0s in.
    const result = await trim.trimWav(source, 1.0, 3.0, output, { sourceRoot: temp, stamp: 1 });
    assert.equal(result.success, true, result.error);
    assert.equal(result.keptFrames, 2.0 * sr, 'kept exactly 2.0s of frames');
    assert.ok(Math.abs(result.keptSeconds - 2.0) < 1e-9);

    // Re-parse the output: it must be a valid WAV whose data size matches.
    const outBuf = await fs.readFile(result.output);
    const parsed = silence.parseWav(outBuf);
    assert.equal(parsed.error, undefined, 'output must re-parse as a valid WAV');
    assert.equal(parsed.fmt.sampleRate, sr);
    assert.equal(parsed.dataSize, 2.0 * sr * 2, 'data chunk is exactly 2.0s of 16-bit mono');

    // Content check: silence before 1.0s-into-the-clip, marker from there on.
    const markerFrame = 1.0 * sr; // 2.0s marker - 1.0s trim start
    assert.equal(sampleAt(outBuf, parsed.dataOffset, markerFrame - 1), 0, 'frame just before the marker is silent');
    assert.equal(sampleAt(outBuf, parsed.dataOffset, markerFrame), 12000, 'marker begins on the expected frame');
    assert.equal(sampleAt(outBuf, parsed.dataOffset, markerFrame + 100), 12000, 'marker continues after the cut');

    // The source is only ever read.
    assert.deepEqual(await fs.readFile(source), original, 'source WAV must be untouched');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function clampsRegionAndRejectsEmptyOrCompressed() {
  const sr = 8000;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'daw-buddy-trim-clamp-'));
  try {
    const source = path.join(temp, 'tone.wav');
    const output = path.join(temp, 'out');
    await fs.writeFile(source, markedWav(sr, 2, 0));

    // regionFrames clamps a right edge past EOF back to the true frame count.
    const parsed = silence.parseWav(await fs.readFile(source));
    const total = parsed.dataSize / 2;
    const region = trim.regionFrames(parsed.fmt, total, 0.5, 99);
    assert.equal(region.endFrame, total, 'end clamps to end-of-file, not a runaway value');
    assert.equal(region.startFrame, 0.5 * sr);

    // A degenerate region (start >= end) is refused, not written as an empty file.
    const empty = await trim.trimWav(source, 1.0, 1.0, output, { sourceRoot: temp, stamp: 1 });
    assert.equal(empty.success, false);
    assert.match(empty.error, /empty/i);

    // A non-WAV source is refused with a clear error, never silently mangled.
    const mp3 = path.join(temp, 'fake.mp3');
    await fs.writeFile(mp3, Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00]));
    const bad = await trim.trimWav(mp3, 0, 1, output, { sourceRoot: temp, stamp: 1 });
    assert.equal(bad.success, false);
    assert.ok(bad.error);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function run() {
  await trimsToTheExactFrameAndStaysValidWav();
  console.log('ok - trimsToTheExactFrameAndStaysValidWav');
  await clampsRegionAndRejectsEmptyOrCompressed();
  console.log('ok - clampsRegionAndRejectsEmptyOrCompressed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
