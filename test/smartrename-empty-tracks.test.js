'use strict';

const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const silence = require('../src/main/lib/silence');

function createSilentWav(frames = 2000, sampleRate = 44100) {
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // Mono PCM
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 2, 40);
  // All sample bytes remain zero (pure digital silence)
  return buffer;
}

function createActiveWav(frames = 2000, sampleRate = 44100) {
  const buffer = createSilentWav(frames, sampleRate);
  for (let i = 0; i < frames; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.7;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  return buffer;
}

function createHeaderOnlyWav(sampleRate = 44100) {
  const buffer = Buffer.alloc(44);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36, 4);
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
  buffer.writeUInt32LE(0, 40);
  return buffer;
}

// Logic mirror of detectEmptyTrack
async function detectEmptyTrack(filePath) {
  try {
    const stat = await fs.stat(filePath);
    const sizeBytes = stat.size || 0;
    if (sizeBytes === 0) {
      return { isEmpty: true, emptyReason: '0-byte empty file', sizeBytes: 0, peakDb: -Infinity };
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.wav') {
      if (sizeBytes <= 44) {
        return { isEmpty: true, emptyReason: 'Empty WAV header (no data)', sizeBytes, peakDb: -Infinity };
      }
      const stats = await silence.measure(filePath);
      if (stats.error) {
        if (stats.error.toLowerCase().includes('empty') || stats.error.toLowerCase().includes('missing')) {
          return { isEmpty: true, emptyReason: stats.error, sizeBytes, peakDb: -Infinity };
        }
        return { isEmpty: false, sizeBytes };
      }
      if (stats.peak === 0 || !Number.isFinite(stats.peakDb) || stats.peakDb <= -90) {
        return {
          isEmpty: true,
          emptyReason: stats.peak === 0 ? 'Digital silence (0.0 peak)' : `Silent track (${stats.peakDb.toFixed(1)} dB peak)`,
          sizeBytes,
          peakDb: stats.peakDb
        };
      }
      return { isEmpty: false, sizeBytes, peakDb: stats.peakDb };
    }

    return { isEmpty: false, sizeBytes };
  } catch {
    return { isEmpty: false, sizeBytes: 0 };
  }
}

async function testEmptyTrackDetection() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'daw-buddy-empty-track-test-'));

  try {
    // 1. Pure digital silence WAV (e.g. empty DAW mixer channel bounce)
    const silentWavPath = path.join(temp, 'Track_14_Empty_Insert.wav');
    await fs.writeFile(silentWavPath, createSilentWav(5000, 44100));
    const silentRes = await detectEmptyTrack(silentWavPath);
    assert.equal(silentRes.isEmpty, true, 'Silent WAV must be flagged as isEmpty: true');
    assert.equal(silentRes.peakDb, -Infinity, 'Silent WAV peakDb must be -Infinity');
    assert.ok(silentRes.sizeBytes > 44, 'Silent WAV still takes space on disk');

    // 2. 0-byte file
    const zeroBytePath = path.join(temp, 'Corrupted_0_Byte.wav');
    await fs.writeFile(zeroBytePath, Buffer.alloc(0));
    const zeroRes = await detectEmptyTrack(zeroBytePath);
    assert.equal(zeroRes.isEmpty, true, '0-byte file must be flagged as isEmpty: true');
    assert.equal(zeroRes.sizeBytes, 0, '0-byte size must be 0');

    // 3. Header-only WAV (0 data bytes)
    const headerOnlyPath = path.join(temp, 'Header_Only_No_Data.wav');
    await fs.writeFile(headerOnlyPath, createHeaderOnlyWav(44100));
    const headerRes = await detectEmptyTrack(headerOnlyPath);
    assert.equal(headerRes.isEmpty, true, 'Header-only WAV must be flagged as isEmpty: true');

    // 4. Active Audio WAV (Sine wave / Kick / Vocal stem)
    const activeWavPath = path.join(temp, 'Kick_Stem_Active.wav');
    await fs.writeFile(activeWavPath, createActiveWav(5000, 44100));
    const activeRes = await detectEmptyTrack(activeWavPath);
    assert.equal(activeRes.isEmpty, false, 'Active audio WAV must NOT be flagged as empty');
    assert.ok(activeRes.peakDb > -10, 'Active audio peakDb must be well above -90dB');

    console.log('ok - testEmptyTrackDetection passed');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

testEmptyTrackDetection().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
