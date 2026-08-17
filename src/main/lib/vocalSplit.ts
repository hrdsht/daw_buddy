'use strict';

/**
 * Vocal timeline round trip — Phase 1, split.
 *
 * Splits one WAV into active vocal blocks separated by silence, so the
 * blocks can be sent through an external speech-to-speech service and later
 * rebuilt onto the original timeline (see vocalRebuild.ts). Every position
 * is stored in sample frames, not milliseconds — frames are exact, ms are
 * not once you round-trip them.
 *
 * CORE RULES, same as silence.ts:
 * 1. Never touches the source file. Always writes to a new sibling folder.
 * 2. Bails on compressed WAVs or layouts it doesn't fully understand.
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const silenceLib = require('./silence');
const { parseWav, readMagnitude, dbToLinear } = silenceLib;
const { writeWav } = require('./vocalWav');
const vocalManifest = require('./vocalManifest');

const DEFAULTS = {
  detection: 'RMS', // 'Peak' or 'RMS'
  thresholdDb: -72,
  minSilenceMs: 400, // shorter gaps are treated as part of the phrase either side
  padMs: 50, // keep-padding around each block, taken from the silence it borders
  windowMs: 50
};

/**
 * Classifies a single window of frames as carrying audio or not, using the
 * same Peak/RMS rules as silence.ts's boundary scan — but here every window
 * across the whole file gets a verdict, not just the first/last one.
 */
function windowIsActive(buf, fmt, dataOffset, blockAlign, bytesPerSample, start, end, opts) {
  const threshold = dbToLinear(opts.thresholdDb);

  if (opts.detection === 'Peak') {
    for (let frame = start; frame < end; frame += 1) {
      for (let channel = 0; channel < fmt.numChannels; channel += 1) {
        const offset = dataOffset + frame * blockAlign + channel * bytesPerSample;
        if (offset + bytesPerSample > buf.length) continue;
        if (readMagnitude(buf, offset, fmt) > threshold) return true;
      }
    }
    return false;
  }

  let sumSquares = 0;
  let count = 0;
  for (let frame = start; frame < end; frame += 1) {
    let peak = 0;
    for (let channel = 0; channel < fmt.numChannels; channel += 1) {
      const offset = dataOffset + frame * blockAlign + channel * bytesPerSample;
      if (offset + bytesPerSample > buf.length) continue;
      const magnitude = readMagnitude(buf, offset, fmt);
      if (magnitude > peak) peak = magnitude;
    }
    sumSquares += peak * peak;
    count += 1;
  }
  const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
  return rms > threshold;
}

/** Walks the whole file in windows and collapses same-verdict windows into runs. */
function classifyRuns(buf, fmt, dataOffset, totalFrames, opts) {
  const bytesPerSample = fmt.bitsPerSample / 8;
  const blockAlign = fmt.numChannels * bytesPerSample;
  const windowFrames = Math.max(1, Math.floor(fmt.sampleRate * (opts.windowMs / 1000)));

  const runs = [];
  let frame = 0;
  while (frame < totalFrames) {
    const windowEnd = Math.min(totalFrames, frame + windowFrames);
    const active = windowIsActive(
      buf, fmt, dataOffset, blockAlign, bytesPerSample, frame, windowEnd, opts
    );
    const type = active ? 'active' : 'silence';

    const last = runs[runs.length - 1];
    if (last && last.type === type) {
      last.endFrame = windowEnd;
    } else {
      runs.push({ type, startFrame: frame, endFrame: windowEnd });
    }
    frame = windowEnd;
  }

  return runs;
}

/** Two runs of the same type sharing a boundary become one run. */
function coalesceAdjacent(runs) {
  const out = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (last && last.type === run.type && last.endFrame === run.startFrame) {
      last.endFrame = run.endFrame;
    } else {
      out.push({ ...run });
    }
  }
  return out;
}

/**
 * A silent run shorter than minSilenceFrames isn't a real gap — a breath
 * between two halves of one line shouldn't fragment it into two blocks. Its
 * frames get folded into the block(s) either side instead of dropped.
 */
function mergeShortSilences(runs, minSilenceFrames) {
  const result = [];
  for (const run of runs) {
    if (
      run.type === 'silence' &&
      run.endFrame - run.startFrame < minSilenceFrames &&
      result.length > 0
    ) {
      result[result.length - 1].endFrame = run.endFrame;
      continue;
    }
    result.push({ ...run });
  }

  // A short silence at the very start has nothing before it to absorb into —
  // fold it forward into the first block instead.
  if (
    result.length > 1 &&
    result[0].type === 'silence' &&
    result[0].endFrame - result[0].startFrame < minSilenceFrames
  ) {
    result[1].startFrame = result[0].startFrame;
    result.shift();
  }

  return coalesceAdjacent(result);
}

/**
 * Grows each block outward into the silence that borders it, up to padFrames
 * a side. A gap shorter than 2*padFrames is split rather than let both
 * neighbours claim more of it than exists — that's the "clamped so
 * expansions can never overlap" rule from the proposal.
 */
function applyPadding(runs, padFrames, totalFrames) {
  if (padFrames <= 0) return runs;
  const out = runs.map((run) => ({ ...run }));

  for (let i = 0; i < out.length; i += 1) {
    if (out[i].type !== 'silence') continue;

    const length = out[i].endFrame - out[i].startFrame;
    const hasLeft = i > 0;
    const hasRight = i < out.length - 1;

    if (hasLeft && hasRight) {
      const eachSide = Math.min(padFrames, Math.floor(length / 2));
      out[i - 1].endFrame += eachSide;
      out[i + 1].startFrame -= eachSide;
      out[i].startFrame += eachSide;
      out[i].endFrame -= eachSide;
    } else if (hasRight) {
      const take = Math.min(padFrames, length);
      out[i + 1].startFrame -= take;
      out[i].endFrame -= take;
    } else if (hasLeft) {
      const take = Math.min(padFrames, length);
      out[i - 1].endFrame += take;
      out[i].startFrame += take;
    }
  }

  return out.filter((run) => run.endFrame > run.startFrame);
}

/**
 * The full pipeline: window classification, short-gap merging, padding.
 * Returns an ordered list covering [0, totalFrames) with no gaps —
 * alternating 'block' and 'silence' segments, including leading/trailing
 * silence as ordinary segments rather than special-cased fields.
 */
function classifySegments(buf, fmt, dataOffset, totalFrames, options: Record<string, any> = {}) {
  const opts: Record<string, any> = { ...DEFAULTS, ...options };
  const minSilenceFrames = Math.floor(fmt.sampleRate * (opts.minSilenceMs / 1000));
  const padFrames = Math.floor(fmt.sampleRate * (opts.padMs / 1000));

  if (totalFrames <= 0) return [];

  const raw = classifyRuns(buf, fmt, dataOffset, totalFrames, opts);
  const merged = mergeShortSilences(raw, minSilenceFrames);
  const padded = applyPadding(merged, padFrames, totalFrames);

  let blockNumber = 0;
  return padded.map((run) => {
    if (run.type === 'active') {
      blockNumber += 1;
      return {
        type: 'block',
        id: String(blockNumber).padStart(4, '0'),
        startFrame: run.startFrame,
        endFrame: run.endFrame
      };
    }
    return { type: 'silence', startFrame: run.startFrame, endFrame: run.endFrame };
  });
}

function withSeconds(segment, sampleRate) {
  return {
    ...segment,
    startSec: segment.startFrame / sampleRate,
    endSec: segment.endFrame / sampleRate,
    durationSec: (segment.endFrame - segment.startFrame) / sampleRate
  };
}

/**
 * Dry run — read, parse, classify, report. Writes nothing. Shares
 * classifySegments with the real run, so the preview is exactly what
 * splitting would produce.
 */
async function analyseSplit(inputPath, options: Record<string, any> = {}) {
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

  const segments = classifySegments(buf, fmt, dataOffset, totalFrames, options).map((segment) =>
    withSeconds(segment, fmt.sampleRate)
  );
  const blockCount = segments.filter((segment) => segment.type === 'block').length;

  return {
    path: inputPath,
    name: path.basename(inputPath),
    sampleRate: fmt.sampleRate,
    channels: fmt.numChannels,
    bits: fmt.bitsPerSample,
    totalFrames,
    duration: totalFrames / fmt.sampleRate,
    segments,
    blockCount,
    skip: blockCount === 0,
    reason: blockCount === 0 ? 'No audio above the threshold — nothing to split' : null
  };
}

/** The real run — writes numbered block files and a manifest beside the source. */
async function splitVocal(inputPath, options: Record<string, any> = {}) {
  let buf;
  try {
    buf = await fs.readFile(inputPath);
  } catch (err) {
    return { success: false, path: inputPath, error: `Could not read file: ${err.message}` };
  }

  const parsed = parseWav(buf);
  if (parsed.error) return { success: false, path: inputPath, error: parsed.error };

  const { fmt, dataOffset, dataSize } = parsed;
  const blockAlign = fmt.numChannels * (fmt.bitsPerSample / 8);
  const totalFrames = Math.floor(dataSize / blockAlign);

  const segments = classifySegments(buf, fmt, dataOffset, totalFrames, options);
  const blockSegments = segments.filter((segment) => segment.type === 'block');

  if (blockSegments.length === 0) {
    return {
      success: true,
      path: inputPath,
      modified: false,
      message: 'No audio above the threshold — nothing written'
    };
  }

  const ext = path.extname(inputPath);
  const baseName = path.basename(inputPath, ext);
  const outDir = path.join(path.dirname(inputPath), `${baseName} (Vocal Split)`);
  await fs.mkdir(outDir, { recursive: true });

  const wavFmt = {
    audioFormat: fmt.audioFormat,
    numChannels: fmt.numChannels,
    sampleRate: fmt.sampleRate,
    bitsPerSample: fmt.bitsPerSample
  };

  const manifestSegments = [];
  for (const segment of segments) {
    if (segment.type !== 'block') {
      manifestSegments.push({ ...segment });
      continue;
    }

    const audioStart = dataOffset + segment.startFrame * blockAlign;
    const audioEnd = dataOffset + segment.endFrame * blockAlign;
    const pcm = buf.subarray(audioStart, audioEnd);
    const wavBuffer = writeWav(wavFmt, pcm);
    const fileName = `${segment.id}.wav`;
    const target = path.join(outDir, fileName);
    const temp = `${target}.tmp-${Date.now()}`;
    await fs.writeFile(temp, wavBuffer);
    await fs.rename(temp, target);

    manifestSegments.push({
      ...segment,
      file: fileName,
      hash: crypto.createHash('sha256').update(wavBuffer).digest('hex')
    });
  }

  const manifestPath = path.join(outDir, 'manifest.json');
  const usedOptions = { ...DEFAULTS, ...options };
  await vocalManifest.writeManifest(manifestPath, {
    createdAt: new Date().toISOString(),
    source: {
      filename: path.basename(inputPath),
      audioFormat: fmt.audioFormat,
      sampleRate: fmt.sampleRate,
      channels: fmt.numChannels,
      bitsPerSample: fmt.bitsPerSample,
      totalFrames,
      hash: crypto.createHash('sha256').update(buf).digest('hex')
    },
    options: usedOptions,
    segments: manifestSegments
  });

  return {
    success: true,
    path: inputPath,
    modified: true,
    outputFolder: outDir,
    manifestPath,
    blockCount: blockSegments.length,
    segments: manifestSegments.map((segment) => withSeconds(segment, fmt.sampleRate))
  };
}

module.exports = { analyseSplit, splitVocal, classifySegments, DEFAULTS };
