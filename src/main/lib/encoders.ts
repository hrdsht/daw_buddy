'use strict';

/**
 * Which encoder to use, and how to reach it.
 *
 * Two backends:
 *
 *   lame     lamejs, a pure JavaScript LAME port. A few hundred KB, ships
 *            with the app, no binary. Slower — seconds for a five minute
 *            voice file, which is fine for this job.
 *
 *   ffmpeg   a real binary, roughly 80 MB. Faster, and the only one of the
 *            two that can resample or read non-WAV input. Optional: the user
 *            downloads it, and once present it becomes the default.
 *
 * The rule the user asked for: lame unless ffmpeg is available, then ffmpeg.
 * Preference can still be forced either way in settings.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');

const BINARY = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

let cached: Record<string, any> | null = null;

/**
 * Look for ffmpeg in three places, in order:
 *   1. an explicit path in settings — the user pointed at it
 *   2. the ffmpeg-static package, if it was installed
 *   3. the system PATH
 */
async function findFfmpeg(configuredPath) {
  if (configuredPath) {
    if (await isExecutable(configuredPath)) {
      return { path: configuredPath, source: 'configured' };
    }
    // Configured but missing is worth saying out loud rather than silently
    // falling back — the user set it for a reason.
    return { path: null, source: 'configured', error: 'Configured ffmpeg path not found' };
  }

  try {
    // Optional dependency. Absent is the normal case, not an error.
    const staticPath = require('ffmpeg-static');
    if (staticPath && (await isExecutable(staticPath))) {
      return { path: staticPath, source: 'bundled' };
    }
  } catch {
    /* ffmpeg-static not installed */
  }

  const onPath = await probePath();
  if (onPath) return { path: BINARY, source: 'system' };

  return { path: null, source: null };
}

function probePath() {
  return new Promise((resolve) => {
    execFile(BINARY, ['-version'], { timeout: 4000 }, (error) => resolve(!error));
  });
}

async function isExecutable(candidate) {
  try {
    await fsp.access(candidate, fs.constants.X_OK);
    return true;
  } catch {
    try {
      // On Windows the execute bit is meaningless; existing is enough.
      await fsp.access(candidate);
      return process.platform === 'win32';
    } catch {
      return false;
    }
  }
}

/**
 * Resolves the active encoder. Cached, because probing the PATH spawns a
 * process and this gets asked on every format change in the UI.
 */
async function resolve(settings: Record<string, any> = {}) {
  if (cached && cached.forPath === settings.ffmpegPath && cached.forPreference === settings.encoderPreference) {
    return cached;
  }

  const ffmpeg = await findFfmpeg(settings.ffmpegPath);
  const preference = settings.encoderPreference || 'auto';

  let active = 'lame';
  if (preference === 'ffmpeg' && ffmpeg.path) active = 'ffmpeg';
  else if (preference === 'lame') active = 'lame';
  else if (ffmpeg.path) active = 'ffmpeg'; // auto: ffmpeg wins when present

  cached = {
    active,
    ffmpegPath: ffmpeg.path,
    ffmpegSource: ffmpeg.source,
    ffmpegError: ffmpeg.error || null,
    ffmpegAvailable: Boolean(ffmpeg.path),
    lameAvailable: hasLame(),
    forPath: settings.ffmpegPath,
    forPreference: settings.encoderPreference
  };

  /**
   * Falling back is fine; doing it silently is not. If the user asked for
   * lame and lamejs isn't installed, the app should say which encoder it
   * actually used rather than letting them think their choice took effect.
   */
  if (cached.active === 'lame' && !cached.lameAvailable) {
    cached.active = ffmpeg.path ? 'ffmpeg' : 'none';
    cached.fellBack = true;
    cached.fellBackReason = ffmpeg.path
      ? 'lamejs is not installed — using ffmpeg instead'
      : 'No MP3 encoder available. Install lamejs, or download ffmpeg in Settings.';
  } else if (preference === 'ffmpeg' && !ffmpeg.path) {
    cached.fellBack = true;
    cached.fellBackReason = 'ffmpeg is not available — using the built-in encoder instead';
  } else {
    cached.fellBack = false;
    cached.fellBackReason = null;
  }

  return cached;
}

function hasLame() {
  try {
    require.resolve('lamejs');
    return true;
  } catch {
    return false;
  }
}

function forget() {
  cached = null;
}

/**
 * What each backend can actually do. The UI reads this to grey out options
 * rather than letting the user choose something that will fail later.
 */
function capabilities(resolved) {
  const ffmpeg = resolved.active === 'ffmpeg';
  return {
    mp3: resolved.active !== 'none',
    wav: true, // no encoder needed
    /**
     * Sample rate conversion is the honest limit. Doing 44.1 ↔ 48 properly
     * needs a windowed-sinc filter; doing it naively aliases audibly, which
     * is exactly the artefact you don't want baked into voice cloning
     * material. So without ffmpeg the target rate must match the source.
     */
    resample: ffmpeg,
    /** Reading anything that isn't a WAV needs a decoder. */
    nonWavInput: ffmpeg
  };
}

function runFfmpeg(ffmpegPath, args, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath,
      ['-hide_banner', '-loglevel', 'error', '-y', ...args],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr ? String(stderr).trim() : error.message));
          return;
        }
        resolve(String(stderr || '').trim());
      }
    );
  });
}

/**
 * MP3 via lamejs, from interleaved 16-bit samples.
 *
 * lamejs wants separate channel buffers of Int16, which is why the
 * de-interleave happens here rather than in the caller.
 */
function encodeMp3WithLame(samples, { sampleRate, channels, bitrate }) {
  const lamejs = require('lamejs');
  const encoder = new lamejs.Mp3Encoder(channels, sampleRate, bitrate);
  const blockSize = 1152; // one MP3 frame
  const chunks = [];

  const left = new Int16Array(blockSize);
  const right = channels > 1 ? new Int16Array(blockSize) : null;

  for (let offset = 0; offset < samples.length; offset += blockSize * channels) {
    let count = 0;

    for (let i = 0; i < blockSize; i += 1) {
      const index = offset + i * channels;
      if (index >= samples.length) break;
      left[i] = samples[index];
      if (right) right[i] = samples[index + 1] || 0;
      count += 1;
    }

    const encoded = right
      ? encoder.encodeBuffer(left.subarray(0, count), right.subarray(0, count))
      : encoder.encodeBuffer(left.subarray(0, count));

    if (encoded.length > 0) chunks.push(Buffer.from(encoded));
  }

  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(Buffer.from(tail));

  return Buffer.concat(chunks);
}

module.exports = {
  resolve,
  forget,
  capabilities,
  runFfmpeg,
  encodeMp3WithLame,
  findFfmpeg
};
