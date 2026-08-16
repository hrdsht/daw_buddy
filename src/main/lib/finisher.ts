'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const silence = require('./silence');

const MAX_BOOST_DB = 24;

function musicalDuration(bpm, bars, beatsPerBar = 4) {
  const tempo = Number(bpm);
  const barCount = Number(bars);
  const beats = Number(beatsPerBar);
  if (!(tempo > 0) || !(barCount > 0) || !(beats > 0)) return null;
  return (60 / tempo) * barCount * beats;
}

async function analyse(inputPath, options: Record<string, any> = {}) {
  const measured = await silence.measure(inputPath);
  if (measured.error) return measured;

  const targetDuration = options.trimToBars
    ? musicalDuration(options.bpm, options.bars, options.beatsPerBar)
    : null;
  const targetPeakDb = Number.isFinite(Number(options.targetPeakDb))
    ? Number(options.targetPeakDb)
    : -1;
  const wantedGainDb =
    options.normalize && Number.isFinite(measured.peakDb)
      ? targetPeakDb - measured.peakDb
      : 0;
  const gainDb = Math.min(MAX_BOOST_DB, wantedGainDb);
  const trimSeconds = targetDuration && measured.duration > targetDuration
    ? measured.duration - targetDuration
    : 0;

  return {
    ...measured,
    targetDuration,
    trimSeconds,
    gainDb,
    gainLimited: wantedGainDb > MAX_BOOST_DB,
    tooShort: Boolean(targetDuration && measured.duration < targetDuration),
    changing: trimSeconds > 0.001 || Math.abs(gainDb) > 0.05
  };
}

async function processFile(inputPath, outputRoot, options: Record<string, any> = {}) {
  let source;
  try {
    source = await fs.readFile(inputPath);
  } catch (error) {
    return { success: false, path: inputPath, error: `Could not read file: ${error.message}` };
  }

  const parsed = silence.parseWav(source);
  if (parsed.error) return { success: false, path: inputPath, error: parsed.error };
  const preview = await analyse(inputPath, options);
  if (preview.error) return { success: false, path: inputPath, error: preview.error };

  const { fmt, dataOffset, dataSize, leading } = parsed;
  const bytesPerSample = fmt.bitsPerSample / 8;
  const blockAlign = fmt.numChannels * bytesPerSample;
  const totalFrames = Math.floor(dataSize / blockAlign);
  const targetFrames = preview.targetDuration
    ? Math.max(1, Math.round(preview.targetDuration * fmt.sampleRate))
    : totalFrames;
  const outputFrames = options.trimToBars ? Math.min(totalFrames, targetFrames) : totalFrames;
  const outputDataSize = outputFrames * blockAlign;
  const gain = options.normalize ? Math.pow(10, preview.gainDb / 20) : 1;

  if (outputDataSize >= dataSize && Math.abs(gain - 1) < 0.0001) {
    return {
      success: true,
      path: inputPath,
      modified: false,
      message: preview.tooShort ? 'Shorter than the requested musical length — left alone' : 'Already at the requested level and length'
    };
  }

  const audio = Buffer.from(source.subarray(dataOffset, dataOffset + outputDataSize));
  if (Math.abs(gain - 1) >= 0.0001) applyGain(audio, fmt, gain);
  const header = silence.buildHeader(source, leading, outputDataSize);
  const output = Buffer.concat([header, audio]);
  const target = await outputPath(inputPath, outputRoot, options.sourceRoot);

  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.tmp-${Date.now()}`;
    await fs.writeFile(temp, output);
    await fs.rename(temp, target);
    return {
      success: true,
      path: inputPath,
      output: target,
      modified: true,
      duration: outputFrames / fmt.sampleRate,
      secondsRemoved: (totalFrames - outputFrames) / fmt.sampleRate,
      gainDb: preview.gainDb,
      gainLimited: preview.gainLimited
    };
  } catch (error) {
    return { success: false, path: inputPath, error: `Failed to write output: ${error.message}` };
  }
}

function applyGain(audio, fmt, gain) {
  const bytes = fmt.bitsPerSample / 8;
  for (let offset = 0; offset + bytes <= audio.length; offset += bytes) {
    const value = readSample(audio, offset, fmt) * gain;
    writeSample(audio, offset, fmt, Math.max(-1, Math.min(1, value)));
  }
}

function readSample(buf, offset, fmt) {
  if (fmt.bitsPerSample === 16) return buf.readInt16LE(offset) / 32768;
  if (fmt.bitsPerSample === 24) {
    let value = buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16);
    if (value & 0x800000) value -= 0x1000000;
    return value / 8388608;
  }
  if (fmt.int32) return buf.readInt32LE(offset) / 2147483648;
  return buf.readFloatLE(offset);
}

function writeSample(buf, offset, fmt, value) {
  if (fmt.bitsPerSample === 16) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32768))), offset);
    return;
  }
  if (fmt.bitsPerSample === 24) {
    let integer = Math.max(-8388608, Math.min(8388607, Math.round(value * 8388608)));
    if (integer < 0) integer += 0x1000000;
    buf[offset] = integer & 0xff;
    buf[offset + 1] = (integer >> 8) & 0xff;
    buf[offset + 2] = (integer >> 16) & 0xff;
    return;
  }
  if (fmt.int32) {
    buf.writeInt32LE(Math.max(-2147483648, Math.min(2147483647, Math.round(value * 2147483648))), offset);
    return;
  }
  buf.writeFloatLE(value, offset);
}

async function outputPath(inputPath, outputRoot, sourceRoot) {
  const root = path.resolve(sourceRoot || path.dirname(inputPath));
  const relative = path.relative(root, path.dirname(inputPath));
  const safeRelative = !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : '';
  const label = path.basename(root).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || 'Audio';
  const key = crypto.createHash('sha1').update(normalise(root)).digest('hex').slice(0, 8);
  const extension = path.extname(inputPath);
  const base = path.basename(inputPath, extension);
  return path.join(outputRoot, 'Finished', `${label}-${key}`, safeRelative, `${base} - finished${extension}`);
}

function normalise(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' || process.platform === 'darwin'
    ? resolved.toLowerCase()
    : resolved;
}

module.exports = { analyse, processFile, musicalDuration, MAX_BOOST_DB };
