'use strict';

/**
 * Quality checks over a folder of WAVs. Reads only — nothing here writes.
 *
 * Two checks:
 *
 *   TOO QUIET     files whose peak sits well below full scale. Usually a
 *                 render made with the master fader down, or a sample that
 *                 will disappear in a mix.
 *
 *   OFF GRID      loops whose length isn't a whole number of beats. Drop one
 *                 of these in a DAW and it drifts, or clicks at the loop
 *                 point. The maths is simple; the hard part is knowing the
 *                 intended tempo, see below.
 */

const fs = require('fs/promises');
const path = require('path');

const { measure } = require('./silence');

const DEFAULTS = {
  quietPeakDb: -12, // peak below this is flagged
  gridTolerance: 0.02, // 2% of a beat
  minBeats: 1
};

/**
 * Tempo from the filename.
 *
 * Loop packs almost always carry it — "KSHMR Afro House Loop - Full - 124BPM
 * - Lifter.wav". That's the only reliable source available here: the key and
 * tempo detector lives in the browser and works on decoded audio, and this
 * runs in Node on raw files.
 *
 * If a name has no tempo, the file is reported as "unknown tempo" rather than
 * guessed at. A wrong tempo would produce confident nonsense.
 */
function bpmFromName(name) {
  const patterns = [
    /(\d{2,3}(?:\.\d+)?)\s*bpm/i, // 124BPM, 124 bpm, 124.5bpm
    /bpm[\s_-]*(\d{2,3}(?:\.\d+)?)/i, // BPM124, bpm_124
    /[_\-\s](\d{2,3})(?:[_\-\s]|$)/ // a bare number in the name, last resort
  ];

  for (let i = 0; i < patterns.length; i += 1) {
    const match = name.match(patterns[i]);
    if (!match) continue;
    const bpm = parseFloat(match[1]);
    // A bare number is only believable inside a musical range; "Loop 08"
    // shouldn't be read as 8 BPM.
    if (bpm >= 40 && bpm <= 300) {
      return { bpm, confident: i < 2 };
    }
  }
  return null;
}

/**
 * How far a loop is from landing on a whole beat.
 *
 * duration × bpm / 60 = beats. If that's 15.97 instead of 16, the loop is
 * short by 3% of a beat and will drift. Returned as a fraction of one beat,
 * so the number means the same thing at any tempo.
 */
function gridError(durationSeconds, bpm) {
  const beats = (durationSeconds * bpm) / 60;
  const nearest = Math.round(beats);
  if (nearest < 1) return null;
  return { beats, nearest, error: Math.abs(beats - nearest) };
}

async function listWavs(dir, depth = 0, out = []) {
  if (depth > 6) return out;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await listWavs(full, depth + 1, out);
      continue;
    }
    if (path.extname(entry.name).toLowerCase() === '.wav') out.push(full);
  }
  return out;
}

/**
 * Runs both checks over a folder. onProgress(done, total) if supplied.
 */
async function scanFolder(dir, options = {}, onProgress) {
  const opts = { ...DEFAULTS, ...options };
  const files = await listWavs(dir);

  const results = [];

  for (let i = 0; i < files.length; i += 1) {
    const filePath = files[i];
    const stats = await measure(filePath);

    if (onProgress && (i % 5 === 0 || i === files.length - 1)) {
      onProgress(i + 1, files.length);
    }

    if (stats.error) {
      results.push({ path: filePath, name: path.basename(filePath), error: stats.error });
      continue;
    }

    const name = path.basename(filePath);
    const issues = [];

    if (!Number.isFinite(stats.peakDb)) {
      issues.push({ kind: 'silent', detail: 'No audio at all' });
    } else if (stats.peakDb < opts.quietPeakDb) {
      issues.push({
        kind: 'quiet',
        detail: `Peaks at ${stats.peakDb.toFixed(1)} dB`
      });
    }

    const tempo = bpmFromName(name);
    let grid = null;

    if (tempo) {
      grid = gridError(stats.duration, tempo.bpm);
      if (grid && grid.nearest >= opts.minBeats && grid.error > opts.gridTolerance) {
        issues.push({
          kind: 'offgrid',
          detail:
            `${grid.beats.toFixed(2)} beats at ${tempo.bpm} BPM — ` +
            `${(grid.error * 100).toFixed(0)}% of a beat off ${grid.nearest}`
        });
      }
    }

    results.push({
      path: filePath,
      name,
      duration: stats.duration,
      peakDb: stats.peakDb,
      rmsDb: stats.rmsDb,
      sampleRate: stats.sampleRate,
      channels: stats.channels,
      bits: stats.bits,
      bpm: tempo ? tempo.bpm : null,
      bpmConfident: tempo ? tempo.confident : false,
      beats: grid ? grid.beats : null,
      issues
    });
  }

  return {
    folder: dir,
    scanned: results.length,
    withIssues: results.filter((r) => r.issues && r.issues.length > 0).length,
    unreadable: results.filter((r) => r.error).length,
    results
  };
}

module.exports = { scanFolder, bpmFromName, gridError, listWavs, DEFAULTS };
