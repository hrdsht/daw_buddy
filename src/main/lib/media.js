'use strict';

/**
 * Finds the audio inside a project and makes sense of the names.
 *
 * Renders are saved as "Song_1.wav", "Song_2.wav", and often the same version
 * exists as both wav and mp3. Treating those as two unrelated files is what
 * made the bounce watcher fire twice per render. Here they're one entry with
 * two formats.
 */

const fs = require('fs/promises');
const path = require('path');

const AUDIO = new Set(['.wav', '.mp3', '.aiff', '.aif', '.flac']);

const STEM_WORDS = [
  'instrumental',
  'vocals',
  'vocal',
  'bass',
  'drums',
  'drum',
  'synths',
  'synth',
  'fx',
  'perc',
  'percussion',
  'keys',
  'lead',
  'pads',
  'brass',
  'guitar',
  'other'
];

const VERSION = /^(.*?)[ _.-]v?(\d+)$/i;

const SKIP_FOLDERS = new Set(['backup', 'samples', 'freeze', 'ableton project info']);

async function listAudio(dir, depth = 0, out = []) {
  if (depth > 2) return out;

  // Logic keeps its Bounces inside the .logicx package, and the scanner
  // never descends into one — so look in there deliberately.
  if (/\.logicx?$/i.test(dir) && depth === 0) {
    await listAudio(path.join(dir, 'Bounces'), 1, out);
    await listAudio(path.join(dir, 'Audio Files'), 2, out);
    return out;
  }

  let contents;
  try {
    contents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of contents) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_FOLDERS.has(entry.name.toLowerCase())) continue;
      await listAudio(full, depth + 1, out);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!AUDIO.has(ext)) continue;

    try {
      const stat = await fs.stat(full);
      out.push({
        path: full,
        name: entry.name,
        ext,
        size: stat.size,
        modified: stat.mtimeMs,
        folder: path.basename(path.dirname(full))
      });
    } catch {
      /* vanished mid-scan */
    }
  }

  return out;
}

/**
 * Groups files into renders. One render = one base name plus version number,
 * carrying however many formats exist for it.
 */
function groupRenders(files) {
  const groups = new Map();

  for (const file of files) {
    const { base, version } = parseVersion(
      file.name.slice(0, file.name.length - file.ext.length)
    );
    const key = `${base.toLowerCase()}::${version ?? 'none'}`;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        base,
        version,
        label: version !== null ? `${base} v${version}` : base,
        part: detectPart(base),
        formats: [],
        modified: 0,
        size: 0,
        primary: null
      });
    }

    const group = groups.get(key);
    if (!group.formats.includes(file.ext.replace('.', ''))) {
      group.formats.push(file.ext.replace('.', ''));
    }
    if (file.modified > group.modified) group.modified = file.modified;

    // Prefer the wav for playback and analysis; it's the master.
    if (!group.primary || (file.ext === '.wav' && group.primary.ext !== '.wav')) {
      group.primary = file;
      group.size = file.size;
    }
  }

  const renders = [...groups.values()];
  renders.sort((a, b) => {
    if (b.modified !== a.modified) return b.modified - a.modified;
    return (b.version || 0) - (a.version || 0);
  });
  return renders;
}

/**
 * "Song_7" -> base "Song", version 7.
 * The version is taken as the trailing number, so "Song_2_final" keeps its
 * whole name and is treated as unversioned rather than guessing.
 */
function parseVersion(stem) {
  const match = stem.match(VERSION);
  if (!match) return { base: stem, version: null };
  return { base: match[1], version: Number(match[2]) };
}

// "Suraag_Lead Synth" -> "lead". Used to label stems.
function detectPart(stem) {
  const lower = stem.toLowerCase();
  const found = STEM_WORDS.find((word) =>
    new RegExp(`(^|[ _.\\-])${word}([ _.\\-]|$)`).test(lower)
  );
  return found || null;
}

async function readFile(filePath) {
  return fs.readFile(filePath);
}

module.exports = { listAudio, groupRenders, parseVersion, detectPart, readFile, AUDIO };
