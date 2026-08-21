'use strict';

/**
 * Finds the audio that belongs to a session file.
 *
 * The renders are not inside the project folder. Real layout:
 *
 *   Suraag/
 *   ├── Renders/                          <- renders for everything below
 *   │   ├── Bangalore entry.wav
 *   │   ├── Bangalore entry 1.wav
 *   │   ├── Bangalore entry 3_1.wav
 *   │   └── Bangalore entry 3_2.wav
 *   ├── Adi - Kannamaniye.mp3             <- and loose in the folder itself
 *   └── Bangalore Entry Bgm/
 *       ├── Bangalore entry Project/
 *       │   ├── Bangalore entry.als       <- the session
 *       │   └── Bangalore entry 1.als
 *       ├── Ai Stems/
 *       └── Bounces/
 *
 * So "Bangalore entry.als" and "Bangalore entry.wav" are two levels apart and
 * sideways. Looking only inside the project folder — which is what the old
 * version did — finds nothing, which is why Play was dead on projects that
 * plainly had renders.
 *
 * IMPORTANT: Renders and Bounces are on the skip list for finding PROJECTS
 * and must not be skipped when finding AUDIO. Two searches, two rule sets.
 * Conflating them caused a whole class of bugs.
 */

const fs = require('fs/promises');
const path = require('path');
const { stems: versionStems } = require('./versions');

const AUDIO = new Set(['.wav', '.mp3', '.aiff', '.aif', '.flac', '.ogg']);

// Folders worth looking in for renders, at the project's level and at each
// ancestor up to the root.
const RENDER_FOLDERS = new Set([
  'renders',
  'render',
  'rendered',
  'bounces',
  'bounce',
  'bounced files',
  'stems',
  'ai stems',
  'stem',
  'mixdown',
  'mixdowns',
  'mixes',
  'exports',
  'export',
  'masters',
  'master',
  'audio',
  'outs',
  'out',
  'multitrack',
  'multitracks',
  'tracks'
]);

function isRenderFolderName(name) {
  if (!name || typeof name !== 'string') return false;
  const lower = name.toLowerCase().trim();
  if (RENDER_FOLDERS.has(lower)) return true;
  // Match compound folder names like "DTS Stems", "KAKA Outs", "Vocal Stems", "Final Mixdowns", "Track Bounces", "Multitracks", "Outs"
  return /\b(stems?|bounces?|mixdowns?|exports?|masters?|mix(?:es)?|outs?|multitracks?)\b/i.test(lower);
}

// Never worth walking for renders: source material, freeze files, device data.
const SKIP = new Set([
  'samples',
  'backup',
  'freeze',
  'presets',
  'ableton project info',
  'processed',
  'recorded',
  'audio files'
]);

const VERSION = /^(.*?)[ _.-]?(?:v?(\d+)|\((\d+)\))$/i;

const STEM_WORDS = [
  'instrumental', 'vocals', 'vocal', 'bass', 'drums', 'drum', 'synths',
  'synth', 'fx', 'perc', 'percussion', 'keys', 'lead', 'pads', 'brass',
  'guitar', 'other', 'master'
];

/**
 * Everything belonging to one session file.
 *
 * @param sessionPath  full path to the .als / .flp / …
 * @param root         the configured root, so the ancestor search stops there
 * @param extraFolders e.g. a stems folder the user pinned to this project
 */
function sharesTitleWord(nameA, nameB) {
  const cleanA = flatten(nameA);
  const cleanB = flatten(nameB);
  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB || cleanA.startsWith(cleanB) || cleanB.startsWith(cleanA)) return true;

  const wordsA = String(nameA).toLowerCase().split(/[^a-z0-9]+/i).filter((w) => w.length >= 3);
  const wordsB = String(nameB).toLowerCase().split(/[^a-z0-9]+/i).filter((w) => w.length >= 3);
  if (wordsA.length === 0 || wordsB.length === 0) return false;
  return wordsA[0] === wordsB[0];
}

async function findRenders(sessionPath, root, extraFolders = [], siblings = []) {
  const stem = path.basename(sessionPath, path.extname(sessionPath));
  const family = projectFamily(stem, siblings);
  const wanted = flatten(family.name);
  const projectFolder = path.dirname(sessionPath);

  const places = await collectPlaces(projectFolder, root, extraFolders);
  const files = [];
  const seen = new Set();

  for (const place of places) {
    await gather(place.dir, place.label, place.deep, files, seen, 0);
  }

  // Competing session names, longest first. "Bangalore entry 1.wav" should
  // belong to "Bangalore entry 1.als", not to "Bangalore entry.als" — the
  // more specific name wins.
  const rivals = family.grouped ? [] : siblings
    .map(flatten)
    .filter((r) => r.length > wanted.length && r.startsWith(wanted))
    .sort((a, b) => b.length - a.length);

  const mine = files.filter((file) => {
    const flat = flatten(file.stem);

    // Exact name, or the same name once a version suffix is removed:
    // "Song_2.wav" belongs to "Song.als" when there's no "Song_2.als".
    const base = flatten(parseVersion(file.stem).base);
    const matches =
      flat === wanted ||
      base === wanted ||
      flat.startsWith(wanted) ||
      wanted.startsWith(flat) ||
      sharesTitleWord(family.name, file.stem);

    // Audio files sitting directly inside this project's dedicated folder (only when no other projects share this directory)
    const isDirectlyInFolder = samePath(path.dirname(file.path), projectFolder);
    const isDedicatedFolder = !siblings || siblings.length === 0;
    const isInsideDedicatedProject = isDirectlyInFolder && isDedicatedFolder;

    if (!matches && !isInsideDedicatedProject) return false;

    // Hand it over if a sibling session claims it more specifically.
    return !rivals.some((rival) => flat === rival || flat.startsWith(rival));
  });

  return {
    renders: groupRenders(mine),
    considered: files.length,
    places: places.map((p) => p.dir)
  };
}

/**
 * Find the shared name of numbered/state versions in the same project folder.
 * For example, all of "Song 4", "Song 3 bounced" and "Song 2" reduce to
 * "Song". We only shorten when another project file proves the relationship,
 * so a lone project genuinely named "Studio 54" keeps its complete name.
 */
function projectFamily(current, siblings) {
  const names = [current, ...siblings];
  const candidates = versionStems(current).map((name) => ({ name, flat: flatten(name) }));
  const scored = candidates
    .map((candidate) => ({
      ...candidate,
      count: names.filter((name) =>
        versionStems(name).some((part) => flatten(part) === candidate.flat)
      ).length
    }))
    .filter((candidate) => candidate.flat.length >= 3 && candidate.count > 1)
    .sort((a, b) => b.count - a.count || b.flat.length - a.flat.length);

  return scored.length
    ? { name: scored[0].name, grouped: true }
    : { name: current, grouped: false };
}

/**
 * Where to look, nearest first:
 *   1. the project's own folder, walked fully
 *   2. render-named folders beside it
 *   3. the same at each ancestor, plus the ancestor folder itself — loose
 *      renders sit directly in Suraag as well as in Suraag/Renders
 *
 * Folder names are matched by READING each directory rather than by joining
 * a guessed name. Joining "renders" onto a path finds "Renders" on Windows
 * and misses it on a case-sensitive filesystem — and it would never find
 * "Ai Stems" at all. Reading and comparing lowercased names is correct
 * everywhere and picks up whatever the folder is actually called.
 */
async function collectPlaces(projectFolder, root, extraFolders) {
  const places = [{ dir: projectFolder, label: 'This folder', deep: true }];

  for (const extra of extraFolders) {
    if (extra) places.push({ dir: extra, label: 'Stems folder', deep: true });
  }

  let current = projectFolder;
  let guard = 0;

  while (guard < 16) {
    guard += 1;

    for (const found of await renderFoldersIn(current)) {
      places.push({ dir: found.dir, label: found.name, deep: true });
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    if (root && !isInsideOrEqual(parent, root)) break;

    // The ancestor folder itself, shallow — loose renders live directly in
    // Suraag, but we don't want to walk every sibling project looking.
    places.push({ dir: parent, label: path.basename(parent), deep: false });

    current = parent;

    if (root && samePath(current, root)) {
      for (const found of await renderFoldersIn(current)) {
        places.push({ dir: found.dir, label: found.name, deep: true });
      }
      break;
    }
  }

  const unique = [];
  const seen = new Set();
  for (const place of places) {
    const key = place.dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(place);
  }
  return unique;
}

/** Subfolders of `dir` whose name looks like a render destination. */
async function renderFoldersIn(dir) {
  let contents;
  try {
    contents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return contents
    .filter(
      (entry) =>
        entry.isDirectory() && RENDER_FOLDERS.has(entry.name.toLowerCase())
    )
    .map((entry) => ({ dir: path.join(dir, entry.name), name: entry.name }));
}

async function gather(dir, label, deep, out, seen, depth) {
  if (depth > (deep ? 4 : 0)) return;

  let contents;
  try {
    contents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of contents) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!deep) continue;
      if (SKIP.has(entry.name.toLowerCase())) continue;
      await gather(full, label, deep, out, seen, depth + 1);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!AUDIO.has(ext)) continue;

    const key = full.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    try {
      const stat = await fs.stat(full);
      out.push({
        path: full,
        name: entry.name,
        stem: path.basename(entry.name, ext),
        ext,
        size: stat.size,
        modified: stat.mtimeMs,
        where: label,
        folder: path.basename(path.dirname(full))
      });
    } catch {
      /* vanished */
    }
  }
}

/**
 * One render = one base name plus version. The wav and the mp3 of the same
 * version are one entry, not two — which is also what stops the bounce
 * watcher firing twice per render.
 */
function groupRenders(files) {
  const groups = new Map();

  for (const file of files) {
    const { base, version } = parseVersion(file.stem);
    const key = `${base.toLowerCase()}::${version ?? 'none'}`;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        base,
        version,
        label: version !== null ? `${base} v${version}` : base,
        part: detectPart(base),
        where: file.where,
        formats: [],
        files: [],
        modified: 0,
        size: 0,
        primary: null
      });
    }

    const group = groups.get(key);
    group.files.push(file);
    const format = file.ext.replace('.', '');
    if (!group.formats.includes(format)) group.formats.push(format);
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
 * "Bangalore entry 3_2" -> base "Bangalore entry 3", version 2.
 * "Song_2_final" keeps its whole name and counts as unversioned, rather than
 * guessing that the 2 in the middle means something.
 */
function parseVersion(stem) {
  const match = stem.match(VERSION);
  if (!match) return { base: stem, version: null };
  const v = match[2] || match[3];
  return {
    base: match[1].replace(/[ _.-]+$/, ''),
    version: v !== undefined ? Number(v) : null
  };
}

function detectPart(stem) {
  const lower = stem.toLowerCase();
  return (
    STEM_WORDS.find((word) =>
      new RegExp(`(^|[ _.\\-])${word}([ _.\\-]|$)`).test(lower)
    ) || null
  );
}

/** Every audio file under a folder, for the "show me everything" view. */
async function listAllAudio(dir, maxDepth = 6) {
  const out = [];
  await gatherAll(dir, out, 0, maxDepth);
  out.sort((a, b) => b.modified - a.modified);
  return out;
}

async function gatherAll(dir, out, depth, maxDepth) {
  if (depth > maxDepth || out.length > 5000) return;

  let contents;
  try {
    contents = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of contents) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP.has(entry.name.toLowerCase())) continue;
      await gatherAll(full, out, depth + 1, maxDepth);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (!AUDIO.has(ext)) continue;

    try {
      const stat = await fs.stat(full);
      out.push({
        path: full,
        name: entry.name,
        stem: path.basename(entry.name, ext),
        ext,
        size: stat.size,
        modified: stat.mtimeMs,
        where: path.basename(path.dirname(full)),
        folder: path.basename(path.dirname(full))
      });
    } catch {
      /* vanished */
    }
  }
}

/* ---------------------------- helpers ---------------------------- */

function flatten(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function titleCase(name) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function samePath(a, b) {
  return normalise(a) === normalise(b);
}

function normalise(p) {
  const resolved = path.resolve(p);
  return process.platform === 'win32' || process.platform === 'darwin'
    ? resolved.toLowerCase()
    : resolved;
}

function isInsideOrEqual(child, parent) {
  if (samePath(child, parent)) return true;
  const rel = path.relative(normalise(parent), normalise(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

module.exports = {
  RENDER_FOLDER_NAMES: RENDER_FOLDERS,
  AUDIO_EXTS: AUDIO,
  isRenderFolderName,
  findRenders,
  listAllAudio,
  groupRenders,
  parseVersion,
  detectPart,
  projectFamily,
  AUDIO
};
