'use strict';

/**
 * Silence removal.
 *
 * CORE RULES:
 * 1. Never in place. Always writes to the output folder.
 * 2. Defaults: RMS detection, -72 dB, End-only, 10ms tail.
 * 3. Bails on compressed WAVs or layouts it doesn't fully understand.
 *
 * Rule 3 is the important one. Skipping a file is a minor annoyance; writing
 * a corrupted one over a master is not.
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = {
  detection: 'RMS', // 'Peak' or 'RMS'
  thresholdDb: -72,
  where: 'End', // 'Start', 'End' or 'Both'
  headMs: 10,
  tailMs: 10,
  windowMs: 50 // RMS averaging window
};

// PCM integer and IEEE float. Anything else is compressed.
const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;

function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

/**
 * Walks the RIFF chunk list and returns what we need, or an error.
 *
 * Two things here that a naive parser gets wrong:
 *
 * - Chunks are word aligned. An odd-sized chunk is followed by a pad byte
 *   that isn't counted in its size. Miss it and every offset afterwards is
 *   wrong, which showed up as "missing format or data chunks" on a perfectly
 *   valid file.
 *
 * - `data` is not always at offset 36. Plenty of DAWs write a LIST/INFO
 *   chunk first. Assuming a 44-byte header and writing the size at offset 40
 *   scribbles over that chunk and produces a file most players reject.
 */
function parseWav(buf) {
  if (
    buf.length < 44 ||
    buf.toString('ascii', 0, 4) !== 'RIFF' ||
    buf.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    return { error: 'Not a valid uncompressed WAV file' };
  }

  let pos = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataSize = 0;
  const leading = []; // chunks before `data`, kept for the rebuilt header

  while (pos + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', pos, pos + 4);
    const chunkSize = buf.readUInt32LE(pos + 4);

    if (chunkId !== 'data' && dataOffset === -1) {
      leading.push({ id: chunkId, at: pos, size: chunkSize });
    }

    if (chunkId === 'fmt ') {
      if (pos + 8 + 16 > buf.length) return { error: 'Truncated fmt chunk' };

      const audioFormat = buf.readUInt16LE(pos + 8);
      const numChannels = buf.readUInt16LE(pos + 10);
      const sampleRate = buf.readUInt32LE(pos + 12);
      const bitsPerSample = buf.readUInt16LE(pos + 22);

      if (audioFormat !== FORMAT_PCM && audioFormat !== FORMAT_FLOAT) {
        return { error: 'Unsupported format: audio is compressed' };
      }
      if (![16, 24, 32].includes(bitsPerSample)) {
        return { error: `Unsupported bit depth: ${bitsPerSample}-bit` };
      }
      if (numChannels < 1 || numChannels > 8) {
        return { error: `Unexpected channel count: ${numChannels}` };
      }
      // 32-bit comes in both flavours and they are read completely
      // differently. Never infer this from the bit depth alone.
      if (bitsPerSample === 32 && audioFormat === FORMAT_PCM) {
        fmt = { audioFormat, numChannels, sampleRate, bitsPerSample, int32: true };
      } else {
        fmt = { audioFormat, numChannels, sampleRate, bitsPerSample, int32: false };
      }
    } else if (chunkId === 'data') {
      dataOffset = pos + 8;
      dataSize = chunkSize;
    }

    pos = nextChunk(buf, pos, chunkSize);
  }

  if (!fmt || dataOffset === -1) return { error: 'Missing format or data chunks' };

  // A truncated file can declare more data than it holds.
  const available = buf.length - dataOffset;
  if (dataSize > available) dataSize = available;
  if (dataSize <= 0) return { error: 'Data chunk is empty' };

  return { fmt, dataOffset, dataSize, leading };
}

/**
 * Advance to the next chunk.
 *
 * Odd-sized chunks are followed by a pad byte that isn't counted in the size.
 * But some writers omit it, and a file that's slightly out of spec is still a
 * file you'd want processed. So: assume the pad, and if what lands there
 * doesn't look like a chunk id while the unpadded position does, take the
 * unpadded one.
 *
 * Guessing is normally the thing to avoid — but the worst case here is
 * failing to find the data chunk, which bails safely. Nothing gets written
 * from a bad guess.
 */
function nextChunk(buf, pos, chunkSize) {
  const padded = pos + 8 + chunkSize + (chunkSize % 2);
  if (chunkSize % 2 === 0) return padded;

  const unpadded = pos + 8 + chunkSize;
  if (looksLikeChunkId(buf, padded)) return padded;
  if (looksLikeChunkId(buf, unpadded)) return unpadded;
  return padded;
}

// Chunk ids are four printable ASCII characters.
function looksLikeChunkId(buf, at) {
  if (at + 4 > buf.length) return false;
  for (let i = at; i < at + 4; i += 1) {
    if (buf[i] < 0x20 || buf[i] > 0x7e) return false;
  }
  return true;
}

/** One sample as a 0..1 magnitude, whatever the bit depth. */
function readMagnitude(buf, offset, fmt) {
  if (fmt.bitsPerSample === 16) {
    return Math.abs(buf.readInt16LE(offset)) / 32768;
  }
  if (fmt.bitsPerSample === 24) {
    let value = buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16);
    if (value & 0x800000) value -= 0x1000000; // sign extend
    return Math.abs(value) / 8388608;
  }
  if (fmt.int32) {
    return Math.abs(buf.readInt32LE(offset)) / 2147483648;
  }
  return Math.abs(buf.readFloatLE(offset));
}

/**
 * Last frame carrying audio, scanning backwards. Returns -1 when nothing in
 * the file clears the threshold.
 */
function findLastAudioFrame(buf, fmt, dataOffset, totalFrames, opts) {
  const threshold = dbToLinear(opts.thresholdDb);
  const bytesPerSample = fmt.bitsPerSample / 8;
  const blockAlign = fmt.numChannels * bytesPerSample;
  const windowFrames = Math.max(1, Math.floor(fmt.sampleRate * (opts.windowMs / 1000)));

  let sumSquares = 0;
  let windowCount = 0;

  for (let frame = totalFrames - 1; frame >= 0; frame -= 1) {
    let peak = 0;

    for (let channel = 0; channel < fmt.numChannels; channel += 1) {
      const offset = dataOffset + frame * blockAlign + channel * bytesPerSample;
      if (offset + bytesPerSample > buf.length) continue;
      const magnitude = readMagnitude(buf, offset, fmt);
      if (magnitude > peak) peak = magnitude;
    }

    if (opts.detection === 'Peak') {
      // A single sample above the floor counts. Simple, and easily fooled by
      // one stray click — which is why RMS is the default.
      if (peak > threshold) return frame;
    } else {
      sumSquares += peak * peak;
      windowCount += 1;

      if (windowCount >= windowFrames) {
        const rms = Math.sqrt(sumSquares / windowFrames);
        if (rms > threshold) {
          // The window ends here, walking backwards, so the audio runs to
          // its far edge.
          return Math.min(totalFrames - 1, frame + windowFrames);
        }
        sumSquares = 0;
        windowCount = 0;
      }
    }
  }

  // Whatever's left in a partial window at the start of the file.
  if (opts.detection !== 'Peak' && windowCount > 0) {
    const rms = Math.sqrt(sumSquares / windowCount);
    if (rms > threshold) return Math.min(totalFrames - 1, windowCount);
  }

  return -1;
}

/** First frame carrying audio, using the same Peak/RMS rules as the end scan. */
function findFirstAudioFrame(buf, fmt, dataOffset, totalFrames, opts) {
  const threshold = dbToLinear(opts.thresholdDb);
  const bytesPerSample = fmt.bitsPerSample / 8;
  const blockAlign = fmt.numChannels * bytesPerSample;
  const windowFrames = Math.max(1, Math.floor(fmt.sampleRate * (opts.windowMs / 1000)));
  let sumSquares = 0;
  let windowCount = 0;

  for (let frame = 0; frame < totalFrames; frame += 1) {
    let peak = 0;
    for (let channel = 0; channel < fmt.numChannels; channel += 1) {
      const offset = dataOffset + frame * blockAlign + channel * bytesPerSample;
      if (offset + bytesPerSample > buf.length) continue;
      const magnitude = readMagnitude(buf, offset, fmt);
      if (magnitude > peak) peak = magnitude;
    }

    if (opts.detection === 'Peak') {
      if (peak > threshold) return frame;
    } else {
      sumSquares += peak * peak;
      windowCount += 1;
      if (windowCount >= windowFrames) {
        const rms = Math.sqrt(sumSquares / windowFrames);
        if (rms > threshold) return Math.max(0, frame - windowFrames + 1);
        sumSquares = 0;
        windowCount = 0;
      }
    }
  }

  if (opts.detection !== 'Peak' && windowCount > 0) {
    const rms = Math.sqrt(sumSquares / windowCount);
    if (rms > threshold) return Math.max(0, totalFrames - windowCount);
  }
  return -1;
}

/**
 * Rebuilds everything before the audio: the RIFF header, every chunk the
 * source had before `data` — LIST, cue points, whatever the DAW wrote — then
 * the data chunk header.
 *
 * Rebuilt rather than copied verbatim for a reason. A source with an odd
 * chunk and no pad byte is out of spec; copying it forward propagates the
 * fault into a file we wrote and vouched for. Reconstructing puts the pad
 * byte where it belongs, so the output is correct even when the input wasn't.
 */
function buildHeader(buf, leading, newDataSize) {
  const parts = [];

  for (const chunk of leading) {
    const end = Math.min(chunk.at + 8 + chunk.size, buf.length);
    parts.push(Buffer.from(buf.subarray(chunk.at, end)));
    if (chunk.size % 2 === 1) parts.push(Buffer.alloc(1)); // pad to even
  }

  const dataHeader = Buffer.alloc(8);
  dataHeader.write('data', 0, 'ascii');
  dataHeader.writeUInt32LE(newDataSize, 4);
  parts.push(dataHeader);

  const body = Buffer.concat(parts);

  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(4 + body.length + newDataSize, 4);
  riff.write('WAVE', 8, 'ascii');

  return Buffer.concat([riff, body]);
}

/**
 * Work out what WOULD be trimmed, without writing anything.
 *
 * The UI runs this first so you can see the numbers before committing. Same
 * code path as the real thing — if the preview says 2.1 seconds, processing
 * removes 2.1 seconds, because it's literally the same measurement.
 */
async function analyse(inputPath, options = {}) {
  const opts = { ...DEFAULTS, ...options };

  let buf;
  try {
    buf = await fs.readFile(inputPath);
  } catch (err) {
    return { path: inputPath, error: `Could not read file: ${err.message}` };
  }

  const parsed = parseWav(buf);
  if (parsed.error) return { path: inputPath, error: parsed.error };

  const { fmt, dataOffset, dataSize } = parsed;
  const blockAlign = fmt.numChannels * (fmt.bitsPerSample / 8);
  const totalFrames = Math.floor(dataSize / blockAlign);
  const scanStart = opts.where === 'Start' || opts.where === 'Both';
  const scanEnd = opts.where === 'End' || opts.where === 'Both';
  const firstAudioFrame = scanStart
    ? findFirstAudioFrame(buf, fmt, dataOffset, totalFrames, opts)
    : 0;
  const lastAudioFrame = scanEnd
    ? findLastAudioFrame(buf, fmt, dataOffset, totalFrames, opts)
    : totalFrames - 1;

  const duration = totalFrames / fmt.sampleRate;

  if (firstAudioFrame < 0 || lastAudioFrame < 0 || firstAudioFrame > lastAudioFrame) {
    return {
      path: inputPath,
      name: path.basename(inputPath),
      duration,
      removable: 0,
      skip: true,
      reason: 'No audio above the threshold'
    };
  }

  const headFrames = Math.floor(fmt.sampleRate * (opts.headMs / 1000));
  const tailFrames = Math.floor(fmt.sampleRate * (opts.tailMs / 1000));
  const startFrame = scanStart ? Math.max(0, firstAudioFrame - headFrames) : 0;
  const endFrame = scanEnd
    ? Math.min(totalFrames, lastAudioFrame + 1 + tailFrames)
    : totalFrames;
  const leadingFrames = startFrame;
  const trailingFrames = Math.max(0, totalFrames - endFrame);
  const removableFrames = leadingFrames + trailingFrames;

  return {
    path: inputPath,
    name: path.basename(inputPath),
    duration,
    removable: removableFrames / fmt.sampleRate,
    leadingRemovable: leadingFrames / fmt.sampleRate,
    trailingRemovable: trailingFrames / fmt.sampleRate,
    removableBytes: removableFrames * blockAlign,
    sampleRate: fmt.sampleRate,
    channels: fmt.numChannels,
    bits: fmt.bitsPerSample,
    skip: removableFrames === 0,
    reason: removableFrames === 0 ? 'No removable silence in the selected area' : null
  };
}

async function removeSilence(inputPath, outputRoot, options: Record<string, any> = {}) {
  const opts: Record<string, any> = { ...DEFAULTS, ...options };

  let buf;
  try {
    buf = await fs.readFile(inputPath);
  } catch (err) {
    return { success: false, path: inputPath, error: `Could not read file: ${err.message}` };
  }

  const parsed = parseWav(buf);
  if (parsed.error) {
    return { success: false, path: inputPath, error: parsed.error };
  }

  const { fmt, dataOffset, dataSize, leading } = parsed;
  const blockAlign = fmt.numChannels * (fmt.bitsPerSample / 8);
  const totalFrames = Math.floor(dataSize / blockAlign);

  const scanStart = opts.where === 'Start' || opts.where === 'Both';
  const scanEnd = opts.where === 'End' || opts.where === 'Both';
  const firstAudioFrame = scanStart
    ? findFirstAudioFrame(buf, fmt, dataOffset, totalFrames, opts)
    : 0;
  const lastAudioFrame = scanEnd
    ? findLastAudioFrame(buf, fmt, dataOffset, totalFrames, opts)
    : totalFrames - 1;

  // Nothing cleared the threshold. Could be a genuinely silent file, could be
  // detection failing on something unusual. Either way, refuse — cutting to a
  // 10ms stub would destroy a file we didn't understand.
  if (firstAudioFrame < 0 || lastAudioFrame < 0 || firstAudioFrame > lastAudioFrame) {
    return {
      success: true,
      path: inputPath,
      modified: false,
      message: 'No audio above the threshold — left alone'
    };
  }

  const headFrames = Math.floor(fmt.sampleRate * (opts.headMs / 1000));
  const tailFrames = Math.floor(fmt.sampleRate * (opts.tailMs / 1000));
  const startFrame = scanStart ? Math.max(0, firstAudioFrame - headFrames) : 0;
  const endFrame = scanEnd
    ? Math.min(totalFrames, lastAudioFrame + 1 + tailFrames)
    : totalFrames;
  const leadingFrames = startFrame;
  const trailingFrames = Math.max(0, totalFrames - endFrame);
  const newDataSize = Math.max(0, endFrame - startFrame) * blockAlign;

  if (newDataSize >= dataSize || newDataSize <= 0) {
    return { success: true, path: inputPath, modified: false, message: 'No removable silence found' };
  }

  const header = buildHeader(buf, leading, newDataSize);

  const audioStart = dataOffset + startFrame * blockAlign;
  const audio = buf.subarray(audioStart, audioStart + newDataSize);
  const outBuf = Buffer.concat([header, audio]);

  const fileName = path.basename(inputPath);
  const sourceRoot = opts.sourceRoot ? path.resolve(opts.sourceRoot) : path.dirname(inputPath);
  const relativeFolder = path.relative(sourceRoot, path.dirname(inputPath));
  const safeRelative =
    !relativeFolder.startsWith('..') && !path.isAbsolute(relativeFolder)
      ? relativeFolder
      : '';
  const rootLabel = sanitiseFolder(path.basename(sourceRoot)) || 'Audio';
  const rootKey = crypto
    .createHash('sha1')
    .update(normaliseForKey(sourceRoot))
    .digest('hex')
    .slice(0, 8);
  const outDir = path.join(outputRoot, `${rootLabel}-${rootKey}`, safeRelative);

  try {
    await fs.mkdir(outDir, { recursive: true });

    // Temp file then rename, so an interrupted write can't leave a half
    // file sitting there looking finished.
    const target = path.join(outDir, fileName);
    const temp = `${target}.tmp-${Date.now()}`;
    await fs.writeFile(temp, outBuf);
    await fs.rename(temp, target);

    return {
      success: true,
      path: inputPath,
      name: path.basename(inputPath),
      output: target,
      modified: true,
      reclaimedBytes: dataSize - newDataSize,
      secondsRemoved: (dataSize - newDataSize) / blockAlign / fmt.sampleRate,
      leadingSecondsRemoved: leadingFrames / fmt.sampleRate,
      trailingSecondsRemoved: trailingFrames / fmt.sampleRate
    };
  } catch (err) {
    return { success: false, path: inputPath, error: `Failed to write output: ${err.message}` };
  }
}

function sanitiseFolder(name) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim();
}

function normaliseForKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' || process.platform === 'darwin'
    ? resolved.toLowerCase()
    : resolved;
}

/**
 * Peak and RMS for a whole file, plus its shape. Shared by the quality
 * scanners so "too quiet" and "trailing silence" measure the same way — a
 * file the trimmer thinks is silent shouldn't read as loud somewhere else.
 */
async function measure(inputPath) {
  let buf;
  try {
    buf = await fs.readFile(inputPath);
  } catch (err) {
    return { path: inputPath, error: `Could not read file: ${err.message}` };
  }

  const parsed = parseWav(buf);
  if (parsed.error) return { path: inputPath, error: parsed.error };

  const { fmt, dataOffset, dataSize } = parsed;
  const bytesPerSample = fmt.bitsPerSample / 8;
  const blockAlign = fmt.numChannels * bytesPerSample;
  const totalFrames = Math.floor(dataSize / blockAlign);

  let peak = 0;
  let sumSquares = 0;
  let counted = 0;

  // Every frame on short files, sampled on long ones — measuring a 10 minute
  // stem to four decimal places is not worth the wait.
  const step = totalFrames > 4000000 ? 4 : 1;

  for (let frame = 0; frame < totalFrames; frame += step) {
    for (let channel = 0; channel < fmt.numChannels; channel += 1) {
      const offset = dataOffset + frame * blockAlign + channel * bytesPerSample;
      if (offset + bytesPerSample > buf.length) continue;
      const magnitude = readMagnitude(buf, offset, fmt);
      if (magnitude > peak) peak = magnitude;
      sumSquares += magnitude * magnitude;
      counted += 1;
    }
  }

  const rms = counted > 0 ? Math.sqrt(sumSquares / counted) : 0;
  const toDb = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

  return {
    path: inputPath,
    name: path.basename(inputPath),
    duration: totalFrames / fmt.sampleRate,
    frames: totalFrames,
    sampleRate: fmt.sampleRate,
    channels: fmt.numChannels,
    bits: fmt.bitsPerSample,
    peak,
    rms,
    peakDb: toDb(peak),
    rmsDb: toDb(rms)
  };
}

module.exports = {
  removeSilence,
  analyse,
  measure,
  parseWav,
  buildHeader,
  readMagnitude,
  dbToLinear,
  DEFAULTS
};
