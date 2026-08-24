'use strict';

/**
 * Concatenate WAVs, split them into parts that fit a service limit, and
 * render to WAV or MP3.
 *
 * Built for ElevenLabs voice cloning, which accepts a file up to 5 minutes
 * OR 50 MB, whichever comes first.
 *
 * THE THING THAT SURPRISES PEOPLE: at higher settings the size limit binds
 * long before the time limit does.
 *
 *   48kHz 24-bit stereo WAV   5 min ≈ 86 MB   → real limit is about 2:54
 *   44.1kHz 24-bit stereo     5 min ≈ 79 MB   → about 3:10
 *   44.1kHz 16-bit mono       5 min ≈ 26 MB   → 5:00, time binds first
 *   192 kbps MP3              5 min ≈ 7.2 MB  → 5:00, nowhere near
 *
 * So the splitter never targets five minutes. It works out both limits from
 * the chosen output format, takes whichever is smaller, and looks for silence
 * before THAT.
 *
 * Every part is trimmed to the silence threshold and then given an exact pad
 * of digital silence at each end. Preserving whatever silence happened to be
 * in the source would be approximate and would fail entirely where a split
 * lands mid-phrase; generating it is deterministic and costs nothing. The pad
 * counts against the budget, or a job would clear the limit in the preview
 * and blow it after padding.
 */

const fs = require('fs/promises');
const path = require('path');

const silence = require('./silence');
const encoders = require('./encoders');

const DEFAULTS = {
  format: 'mp3',
  bitrate: 192, // kbps
  sampleRate: null, // null = keep the source rate
  bitDepth: 24, // WAV only
  channels: null, // null = keep the source channel count

  enableSplit: true,
  maxSeconds: 300, // 5 minutes
  maxBytes: 50 * 1024 * 1024, // 50 MB

  padSeconds: 1.5, // digital silence written at both ends of every part
  padBothEnds: true,

  trimSilence: true,
  thresholdDb: -50,
  // How far back to hunt for a gap before giving up and cutting hard.
  searchBackSeconds: 45,
  // A gap must be at least this long to be worth splitting in.
  minGapSeconds: 0.3
};

const MP3_BITRATES = [128, 160, 192, 224, 256, 320];
const WAV_RATES = [44100, 48000];
const WAV_DEPTHS = [16, 24, 32];

/* ================================================================== */
/* Size arithmetic                                                     */
/* ================================================================== */

/** Bytes per second of output at the chosen format. Exact, not estimated. */
function bytesPerSecond(options) {
  if (options.format === 'mp3') {
    // Constant bitrate: kbps × 1000 / 8. Frame headers add a fraction of a
    // percent, which is well inside the margin we leave below.
    return (options.bitrate * 1000) / 8;
  }
  return options.sampleRate * options.channels * (options.bitDepth / 8);
}

/**
 * The longest a part can be, honouring both limits, with the pad subtracted
 * because padding is part of the output.
 */
function maxPartSeconds(options) {
  const perSecond = bytesPerSecond(options);
  if (options.enableSplit === false) {
    return {
      seconds: Infinity,
      boundBy: 'none',
      byteLimitSeconds: Infinity,
      perSecond
    };
  }
  // 2% headroom for the WAV header, MP3 frame overhead and rounding.
  const byteLimitSeconds = (options.maxBytes * 0.98) / perSecond;
  const padTotal = options.padSeconds * (options.padBothEnds ? 2 : 1);

  const limit = Math.min(options.maxSeconds, byteLimitSeconds) - padTotal;
  return {
    seconds: Math.max(1, limit),
    boundBy: byteLimitSeconds < options.maxSeconds ? 'size' : 'time',
    byteLimitSeconds,
    perSecond
  };
}

function estimateBytes(seconds, options) {
  const audio = seconds * bytesPerSecond(options);
  const header = options.format === 'wav' ? 44 : 128; // ID3/frame overhead
  return Math.round(audio + header);
}

/* ================================================================== */
/* Reading                                                             */
/* ================================================================== */

/**
 * Reads a WAV into normalised mono/stereo Float32, one array per channel.
 * Non-WAV input needs ffmpeg and is handled by the caller.
 */
async function readWav(filePath) {
  const buf = await fs.readFile(filePath);
  const parsed = silence.parseWav(buf);
  if (parsed.error) return { error: parsed.error, path: filePath };

  const { fmt, dataOffset, dataSize } = parsed;
  const bytesPerSample = fmt.bitsPerSample / 8;
  const blockAlign = fmt.numChannels * bytesPerSample;
  const frames = Math.floor(dataSize / blockAlign);

  const channels = [];
  for (let c = 0; c < fmt.numChannels; c += 1) channels.push(new Float32Array(frames));

  for (let frame = 0; frame < frames; frame += 1) {
    for (let c = 0; c < fmt.numChannels; c += 1) {
      const offset = dataOffset + frame * blockAlign + c * bytesPerSample;
      channels[c][frame] = readSample(buf, offset, fmt);
    }
  }

  return {
    path: filePath,
    name: path.basename(filePath),
    channels,
    frames,
    sampleRate: fmt.sampleRate,
    channelCount: fmt.numChannels,
    bitsPerSample: fmt.bitsPerSample,
    duration: frames / fmt.sampleRate
  };
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

/* ================================================================== */
/* Planning                                                            */
/* ================================================================== */

/**
 * Works out where the splits land, without touching a byte of output.
 *
 * Returns per-part durations and exact size estimates so the UI can show
 * what will happen before anything is written — and so the estimate and the
 * result come from the same arithmetic.
 */
async function planJob(files, requested: Record<string, any> = {}) {
  const options = { ...DEFAULTS, ...requested };
  const sources = [];
  const errors = [];

  for (const file of files) {
    const read = await readWav(file);
    if (read.error) errors.push(read);
    else sources.push(read);
  }

  if (sources.length === 0) {
    return { ok: false, errors, parts: [], message: 'No readable WAV files' };
  }

  // Mismatched sources are a refusal, not a silent guess. Joining a 48k file
  // onto a 44.1k one without resampling shifts its pitch.
  const rates = [...new Set(sources.map((s) => s.sampleRate))];
  const counts = [...new Set(sources.map((s) => s.channelCount))];

  const sourceRate = rates[0];
  const sourceChannels = counts[0];

  if (options.sampleRate === null) options.sampleRate = sourceRate;
  if (options.channels === null) options.channels = sourceChannels;

  const warnings = [];
  if (rates.length > 1) {
    warnings.push({
      kind: 'mixedRates',
      detail: `Sources use different sample rates (${rates.join(', ')} Hz). Convert them first, or enable ffmpeg.`
    });
  }
  if (counts.length > 1) {
    warnings.push({
      kind: 'mixedChannels',
      detail: `Sources use different channel counts (${counts.join(', ')}).`
    });
  }
  if (options.sampleRate !== sourceRate) {
    warnings.push({
      kind: 'resampleNeeded',
      detail: `Output is ${options.sampleRate} Hz but the source is ${sourceRate} Hz. Sample rate conversion needs ffmpeg.`
    });
  }

  const totalFrames = sources.reduce((sum, s) => sum + s.frames, 0);
  const totalDuration = totalFrames / sourceRate;

  const limit = maxPartSeconds(options);
  const cuts = findCuts(sources, sourceRate, limit.seconds, options);

  const parts = cuts.map((cut, index) => {
    const padded = cut.duration + options.padSeconds * (options.padBothEnds ? 2 : 1);
    return {
      index: index + 1,
      label: cuts.length > 1 ? `pt ${index + 1}` : null,
      startSeconds: cut.start / sourceRate,
      endSeconds: cut.end / sourceRate,
      duration: cut.duration,
      paddedDuration: padded,
      bytes: estimateBytes(padded, options),
      splitAtSilence: cut.atSilence,
      note: cut.atSilence === false ? 'No gap found — cut at a zero crossing' : null
    };
  });

  return {
    ok: true,
    errors,
    warnings,
    sources: sources.map((s) => ({
      name: s.name,
      duration: s.duration,
      sampleRate: s.sampleRate,
      channels: s.channelCount,
      bits: s.bitsPerSample
    })),
    totalDuration,
    sourceRate,
    sourceChannels,
    options,
    limit: {
      boundBy: limit.boundBy,
      seconds: limit.seconds,
      maxSeconds: options.maxSeconds,
      maxBytes: options.maxBytes,
      byteLimitSeconds: limit.byteLimitSeconds
    },
    parts,
    totalBytes: parts.reduce((sum, p) => sum + p.bytes, 0)
  };
}

/**
 * Where to cut.
 *
 * Walks forward in steps of the maximum part length. At each boundary it
 * searches BACKWARDS for a gap — quiet material lying below the threshold for
 * at least minGapSeconds — and cuts in the middle of it. That way the split
 * lands in a pause rather than mid-word, and both sides get clean edges.
 *
 * Failing to find one within searchBackSeconds is reported rather than
 * hidden: it cuts at the nearest zero crossing and flags the part.
 */
function findCuts(sources, sampleRate, maxSeconds, options) {
  const mono = concatMono(sources);
  const total = mono.length;
  if (options.enableSplit === false || !Number.isFinite(maxSeconds)) {
    return [{ start: 0, end: total, duration: total / sampleRate, atSilence: null }];
  }
  const maxFrames = Math.floor(maxSeconds * sampleRate);

  if (total <= maxFrames) {
    return [{ start: 0, end: total, duration: total / sampleRate, atSilence: null }];
  }

  const threshold = Math.pow(10, options.thresholdDb / 20);
  const minGap = Math.floor(options.minGapSeconds * sampleRate);
  const searchBack = Math.floor(options.searchBackSeconds * sampleRate);

  const cuts = [];
  let start = 0;

  while (start < total) {
    const ideal = Math.min(start + maxFrames, total);
    if (ideal >= total) {
      cuts.push({ start, end: total, duration: (total - start) / sampleRate, atSilence: null });
      break;
    }

    const found = findGapBefore(mono, ideal, searchBack, threshold, minGap, start);
    const cut = found !== null ? found : nearestZeroCrossing(mono, ideal);

    cuts.push({
      start,
      end: cut,
      duration: (cut - start) / sampleRate,
      atSilence: found !== null
    });
    start = cut;
  }

  return cuts;
}

/** Sum all channels to mono for detection only — never for output. */
function concatMono(sources) {
  const total = sources.reduce((sum, s) => sum + s.frames, 0);
  const mono = new Float32Array(total);
  let offset = 0;

  for (const source of sources) {
    for (let frame = 0; frame < source.frames; frame += 1) {
      let sum = 0;
      for (let c = 0; c < source.channelCount; c += 1) sum += source.channels[c][frame];
      mono[offset + frame] = sum / source.channelCount;
    }
    offset += source.frames;
  }
  return mono;
}

/**
 * Scans backwards from `from` for a run of frames below the threshold,
 * returning the middle of the gap. Middle rather than either edge, so both
 * the part that ends and the part that begins get some quiet either side
 * even before padding is added.
 */
function findGapBefore(mono, from, searchBack, threshold, minGap, notBefore) {
  const floor = Math.max(notBefore + minGap, from - searchBack);
  let runEnd = -1;

  for (let i = from; i >= floor; i -= 1) {
    const quiet = Math.abs(mono[i]) < threshold;

    if (quiet) {
      if (runEnd === -1) runEnd = i;
      if (runEnd - i >= minGap) return Math.floor((runEnd + i) / 2);
    } else {
      runEnd = -1;
    }
  }
  return null;
}

/**
 * Cutting mid-waveform leaves a step, which clicks. The nearest sign change
 * is the closest thing to a free cut.
 */
function nearestZeroCrossing(mono, near, window = 2000) {
  for (let offset = 0; offset < window; offset += 1) {
    const back = near - offset;
    if (back > 1 && Math.sign(mono[back]) !== Math.sign(mono[back - 1])) return back;
    const forward = near + offset;
    if (forward < mono.length - 1 && Math.sign(mono[forward]) !== Math.sign(mono[forward + 1])) {
      return forward;
    }
  }
  return near;
}

/* ================================================================== */
/* Rendering                                                           */
/* ================================================================== */

async function renderJob(files, outputRoot, requested: Record<string, any> = {}, onProgress) {
  const plan = await planJob(files, requested);
  if (!plan.ok) return { ok: false, ...plan };

  const options = plan.options;
  const resolved = await encoders.resolve(requested.encoderSettings || {});
  const caps = encoders.capabilities(resolved);

  if (options.format === 'mp3' && !caps.mp3) {
    return { ok: false, message: 'No MP3 encoder available. Install lamejs or ffmpeg.' };
  }
  if (options.sampleRate !== plan.sourceRate && !caps.resample) {
    return {
      ok: false,
      message: `Cannot convert ${plan.sourceRate} Hz to ${options.sampleRate} Hz without ffmpeg. Choose ${plan.sourceRate} Hz, or enable ffmpeg in Settings.`
    };
  }

  const sources = [];
  for (const file of files) {
    const read = await readWav(file);
    if (!read.error) sources.push(read);
  }

  const joined = concatChannels(sources, plan.sourceChannels);
  const baseName = path.basename(files[0], path.extname(files[0]));
  const targetDir = path.join(outputRoot, 'Converted');
  await fs.mkdir(targetDir, { recursive: true });

  const results = [];

  for (let i = 0; i < plan.parts.length; i += 1) {
    const part = plan.parts[i];
    const startFrame = Math.round(part.startSeconds * plan.sourceRate);
    const endFrame = Math.round(part.endSeconds * plan.sourceRate);

    const slice = sliceChannels(joined, startFrame, endFrame);
    const trimmed = options.trimSilence
      ? trimEnds(slice, Math.pow(10, options.thresholdDb / 20))
      : slice;
    const padded = padChannels(
      trimmed,
      Math.round(options.padSeconds * plan.sourceRate),
      options.padBothEnds
    );

    const suffix = part.label ? ` ${part.label}` : '';
    const extension = options.format === 'mp3' ? '.mp3' : '.wav';
    const target = path.join(targetDir, `${baseName}${suffix}${extension}`);

    try {
      const written =
        options.format === 'mp3'
          ? await writeMp3(padded, target, options, plan, resolved)
          : await writeWav(padded, target, options, plan);

      results.push({
        success: true,
        output: target,
        name: path.basename(target),
        duration: padded[0].length / plan.sourceRate,
        bytes: written,
        estimatedBytes: part.bytes,
        splitAtSilence: part.splitAtSilence
      });
    } catch (error) {
      results.push({ success: false, output: target, error: error.message });
    }

    if (onProgress) onProgress(i + 1, plan.parts.length);
  }

  return { ok: true, plan, results, outputRoot: targetDir, encoder: resolved.active };
}

function concatChannels(sources, channelCount) {
  const total = sources.reduce((sum, s) => sum + s.frames, 0);
  const out = [];
  for (let c = 0; c < channelCount; c += 1) out.push(new Float32Array(total));

  let offset = 0;
  for (const source of sources) {
    for (let c = 0; c < channelCount; c += 1) {
      // A mono source joined into a stereo job feeds both sides.
      const from = source.channels[Math.min(c, source.channelCount - 1)];
      out[c].set(from, offset);
    }
    offset += source.frames;
  }
  return out;
}

function sliceChannels(channels, start, end) {
  return channels.map((data) => data.subarray(start, end));
}

function trimEnds(channels, threshold) {
  const length = channels[0].length;
  let first = 0;
  let last = length - 1;

  const loud = (frame) => channels.some((data) => Math.abs(data[frame]) >= threshold);

  while (first < length && !loud(first)) first += 1;
  while (last > first && !loud(last)) last -= 1;

  if (first >= last) return channels.map((data) => data.subarray(0, 0));
  return channels.map((data) => data.subarray(first, last + 1));
}

/** Exact digital silence, generated rather than borrowed from the source. */
function padChannels(channels, padFrames, bothEnds) {
  if (padFrames <= 0) return channels;
  const lead = padFrames;
  const tail = bothEnds ? padFrames : 0;

  return channels.map((data) => {
    const out = new Float32Array(lead + data.length + tail);
    out.set(data, lead);
    return out;
  });
}

/* ---------------------------- writers ---------------------------- */

async function writeWav(channels, target, options, plan) {
  const frames = channels[0].length;
  const channelCount = channels.length;
  const bytesPerSample = options.bitDepth / 8;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = frames * blockAlign;
  const isFloat = options.bitDepth === 32;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(isFloat ? 3 : 1, 20); // 3 = IEEE float
  header.writeUInt16LE(channelCount, 22);
  header.writeUInt32LE(plan.sourceRate, 24);
  header.writeUInt32LE(plan.sourceRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(options.bitDepth, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);

  const audio = Buffer.alloc(dataSize);
  for (let frame = 0; frame < frames; frame += 1) {
    for (let c = 0; c < channelCount; c += 1) {
      const offset = frame * blockAlign + c * bytesPerSample;
      writeSample(audio, offset, channels[c][frame], options.bitDepth, isFloat);
    }
  }

  const temp = `${target}.tmp-${Date.now()}`;
  await fs.writeFile(temp, Buffer.concat([header, audio]));
  await fs.rename(temp, target);
  return header.length + audio.length;
}

function writeSample(buf, offset, value, bitDepth, isFloat) {
  if (isFloat) {
    // Float WAV legitimately carries values beyond ±1; don't clamp it.
    buf.writeFloatLE(value, offset);
    return;
  }
  const clamped = Math.max(-1, Math.min(1, value));
  if (bitDepth === 16) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(clamped * 32768))), offset);
    return;
  }
  let integer = Math.max(-8388608, Math.min(8388607, Math.round(clamped * 8388608)));
  if (integer < 0) integer += 0x1000000;
  buf[offset] = integer & 0xff;
  buf[offset + 1] = (integer >> 8) & 0xff;
  buf[offset + 2] = (integer >> 16) & 0xff;
}

async function writeMp3(channels, target, options, plan, resolved) {
  if (resolved.active === 'ffmpeg') {
    // Hand ffmpeg a temporary WAV rather than piping — simpler to reason
    // about, and these files are minutes long, not hours.
    const temp = `${target}.src-${Date.now()}.wav`;
    await writeWav(channels, temp, { ...options, bitDepth: 24 }, plan);
    try {
      const args = ['-i', temp, '-codec:a', 'libmp3lame', '-b:a', `${options.bitrate}k`];
      if (options.sampleRate !== plan.sourceRate) args.push('-ar', String(options.sampleRate));
      args.push(target);
      await encoders.runFfmpeg(resolved.ffmpegPath, args);
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
    const stat = await fs.stat(target);
    return stat.size;
  }

  const frames = channels[0].length;
  const channelCount = channels.length;
  const interleaved = new Int16Array(frames * channelCount);

  for (let frame = 0; frame < frames; frame += 1) {
    for (let c = 0; c < channelCount; c += 1) {
      const value = Math.max(-1, Math.min(1, channels[c][frame]));
      interleaved[frame * channelCount + c] = Math.round(value * 32767);
    }
  }

  const mp3 = encoders.encodeMp3WithLame(interleaved, {
    sampleRate: plan.sourceRate,
    channels: channelCount,
    bitrate: options.bitrate
  });

  const temp = `${target}.tmp-${Date.now()}`;
  await fs.writeFile(temp, mp3);
  await fs.rename(temp, target);
  return mp3.length;
}

module.exports = {
  planJob,
  renderJob,
  bytesPerSecond,
  maxPartSeconds,
  estimateBytes,
  readWav,
  findCuts,
  DEFAULTS,
  MP3_BITRATES,
  WAV_RATES,
  WAV_DEPTHS
};
