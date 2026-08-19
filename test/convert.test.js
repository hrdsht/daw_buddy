'use strict';

/**
 * Format conversion and splitting.
 *
 * The important cases are the ones where a limit binds unexpectedly, and the
 * ones where the audio gives the splitter nothing to work with.
 */

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const convert = require('../src/main/lib/convert');
const encoders = require('../src/main/lib/encoders');

function writeWav(target, { seconds = 10, sampleRate = 44100, gaps = false }) {
  const frames = Math.round(sampleRate * seconds);
  const data = Buffer.alloc(frames * 2);

  if (gaps) {
    let t = 0;
    while (t < frames) {
      const speak = Math.floor(sampleRate * 8);
      const gap = Math.floor(sampleRate * 1.5);
      for (let i = 0; i < speak && t + i < frames; i += 1) {
        data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 200 * (t + i)) / sampleRate) * 0.5 * 32767), (t + i) * 2);
      }
      t += speak + gap;
    }
  } else {
    for (let i = 0; i < frames; i += 1) {
      data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 200 * i) / sampleRate) * 0.5 * 32767), i * 2);
    }
  }

  const fmt = Buffer.alloc(24);
  fmt.write('fmt ', 0, 'ascii');
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(sampleRate, 12);
  fmt.writeUInt32LE(sampleRate * 2, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);

  const dh = Buffer.alloc(8);
  dh.write('data', 0, 'ascii');
  dh.writeUInt32LE(data.length, 4);

  const body = Buffer.concat([fmt, dh, data]);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(4 + body.length, 4);
  riff.write('WAVE', 8, 'ascii');

  fs.writeFileSync(target, Buffer.concat([riff, body]));
  return target;
}

test('size limit binds before the time limit at high WAV settings', () => {
  const wav = { ...convert.DEFAULTS, format: 'wav', sampleRate: 48000, bitDepth: 24, channels: 2 };
  const limit = convert.maxPartSeconds(wav);
  assert.equal(limit.boundBy, 'size');
  assert.ok(limit.seconds < 200, `expected under 200s, got ${limit.seconds}`);
});

test('time binds first for MP3 at every offered bitrate', () => {
  for (const bitrate of convert.MP3_BITRATES) {
    const limit = convert.maxPartSeconds({ ...convert.DEFAULTS, format: 'mp3', bitrate });
    assert.equal(limit.boundBy, 'time', `${bitrate} kbps should be bound by time`);
  }
});

test('padding is subtracted from the budget, not added after it', () => {
  const withPad = convert.maxPartSeconds({ ...convert.DEFAULTS, format: 'mp3', bitrate: 192, padSeconds: 1.5 });
  const without = convert.maxPartSeconds({ ...convert.DEFAULTS, format: 'mp3', bitrate: 192, padSeconds: 0 });
  assert.ok(withPad.seconds < without.seconds);
  assert.ok(Math.abs((without.seconds - withPad.seconds) - 3) < 0.01);
});

test('a file inside the limits is not split', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawbuddy-'));
  const file = writeWav(path.join(dir, 'short.wav'), { seconds: 30 });
  const plan = await convert.planJob([file], { format: 'mp3', bitrate: 192 });
  assert.equal(plan.parts.length, 1);
  assert.equal(plan.parts[0].label, null);
});

test('splits land in silence when the audio has gaps', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawbuddy-'));
  const file = writeWav(path.join(dir, 'speech.wav'), { seconds: 700, gaps: true });
  const plan = await convert.planJob([file], { format: 'mp3', bitrate: 192 });

  assert.ok(plan.parts.length > 1);
  const cut = plan.parts.slice(0, -1);
  assert.ok(cut.every((p) => p.splitAtSilence === true), 'every split should land in a gap');
});

test('continuous audio still splits, and says it had to cut hard', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawbuddy-'));
  const file = writeWav(path.join(dir, 'solid.wav'), { seconds: 400 });
  const plan = await convert.planJob([file], { format: 'mp3', bitrate: 192 });

  assert.ok(plan.parts.length > 1);
  assert.equal(plan.parts[0].splitAtSilence, false);
  assert.match(plan.parts[0].note, /zero crossing/);
});

test('no part exceeds either limit', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawbuddy-'));
  const file = writeWav(path.join(dir, 'long.wav'), { seconds: 700, gaps: true });

  for (const options of [
    { format: 'mp3', bitrate: 320 },
    { format: 'wav', sampleRate: 48000, bitDepth: 24, channels: 2 },
    { format: 'wav', sampleRate: 44100, bitDepth: 16, channels: 1 }
  ]) {
    const plan = await convert.planJob([file], options);
    for (const part of plan.parts) {
      assert.ok(part.bytes <= 50 * 1024 * 1024, `${JSON.stringify(options)} part over 50MB`);
      assert.ok(part.paddedDuration <= 300, `${JSON.stringify(options)} part over 5 minutes`);
    }
  }
});

test('rendered output is padded with real silence at both ends', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawbuddy-'));
  const file = writeWav(path.join(dir, 'speech.wav'), { seconds: 60, gaps: true });
  const out = path.join(dir, 'out');

  const result = await convert.renderJob([file], out, {
    format: 'wav', sampleRate: 44100, bitDepth: 16, channels: 1, padSeconds: 1
  });

  assert.ok(result.ok);
  const written = result.results[0];
  assert.ok(written.success);

  const buf = fs.readFileSync(written.output);
  const dataOffset = 44;
  // One second of silence at 44.1k is 44100 zero samples.
  assert.equal(buf.readInt16LE(dataOffset), 0);
  assert.equal(buf.readInt16LE(dataOffset + 40000), 0);
  assert.equal(buf.readInt16LE(buf.length - 2), 0);
});

test('estimate is within 2% of the file actually written', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawbuddy-'));
  const file = writeWav(path.join(dir, 'speech.wav'), { seconds: 120, gaps: true });
  const out = path.join(dir, 'out');

  const result = await convert.renderJob([file], out, {
    format: 'wav', sampleRate: 44100, bitDepth: 16, channels: 1
  });

  for (const written of result.results) {
    const drift = Math.abs(written.bytes - written.estimatedBytes) / written.estimatedBytes;
    assert.ok(drift < 0.02, `estimate was ${(drift * 100).toFixed(1)}% out`);
  }
});

test('resampling without ffmpeg is refused rather than done badly', async () => {
  const resolved = await encoders.resolve({ encoderPreference: 'lame' });
  if (resolved.active === 'ffmpeg') return; // ffmpeg present, nothing to prove

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawbuddy-'));
  const file = writeWav(path.join(dir, 'a.wav'), { seconds: 5, sampleRate: 44100 });

  const result = await convert.renderJob([file], path.join(dir, 'out'), {
    format: 'wav', sampleRate: 48000,
    encoderSettings: { encoderPreference: 'lame' }
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /ffmpeg/);
});

test('mismatched sample rates are flagged, not silently joined', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dawbuddy-'));
  const a = writeWav(path.join(dir, 'a.wav'), { seconds: 5, sampleRate: 44100 });
  const b = writeWav(path.join(dir, 'b.wav'), { seconds: 5, sampleRate: 48000 });

  const plan = await convert.planJob([a, b], { format: 'mp3' });
  assert.ok(plan.warnings.some((w) => w.kind === 'mixedRates'));
});

test('an encoder fallback is reported, never silent', async () => {
  encoders.forget();
  const resolved = await encoders.resolve({ encoderPreference: 'lame' });
  if (!resolved.lameAvailable) {
    assert.equal(resolved.fellBack, true);
    assert.ok(resolved.fellBackReason);
  } else {
    assert.equal(resolved.active, 'lame');
  }
});
