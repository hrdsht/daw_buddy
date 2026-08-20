'use strict';

/**
 * Finds projects.
 *
 * THE MODEL: one entry per SESSION FILE, not per folder.
 *
 * The old version assumed one folder = one project and took the newest
 * session in it. Real drives don't work that way:
 *
 *   Olaala bgm idea 3 Project/
 *   ├── Yogi mom reunion 2.als              08-08-2026
 *   ├── Yogi babu TEASER INTRO finale.als   08-08-2026
 *   ├── Yogi mom reunion.als                13-07-2026
 *   ├── Yogi babu intro opt 3.als           18-06-2026
 *   └── ...four more
 *
 * Eight separate pieces of work — different songs, different tempos, one of
 * them says "85bpm" in its own name. The old model showed one row and hid
 * seven. Now each file is its own entry, named and dated by itself.
 *
 * Logic is the exception: a .logicx is a folder that IS one project, so it's
 * claimed whole and never opened.
 */

const fs = require('fs/promises');
const path = require('path');

const daw = require('./daw');
const { RENDER_FOLDER_NAMES, AUDIO_EXTS } = require('./renders');
const { VIDEO_EXTS } = require('./videos');

const HEALTH_CEILING = 40;

// A backstop, not a policy. With link-skipping and cycle detection below,
// this should never be reached by a real tree.
const MAX_DEPTH = 64;
const SCAN_BUDGET = 200000;

// Folders that can never contain a project. Everything inside an Ableton
// project's Presets tree is device data — real example, five levels of it:
//   Oh andava Project/Presets/Audio Effects/Max Audio Effect/Imported/
const NEVER_PROJECTS = new Set([
  'backup',
  'samples',
  'presets',
  'ableton project info',
  'freeze',
  'node_modules',
  '.git'
]);

async function scanRoots(roots, options = {}) {
  const opts = normaliseOptions(options);
  const all = [];
  const errors = [];

  for (const root of roots) {
    try {
      await walk(root, root, 0, opts, all);
    } catch (err) {
      errors.push({ root, message: describeReadError(err) });
    }
  }

  const entries = await hydrate(all, opts);
  entries.sort(byNewest);

  return {
    entries,
    errors,
    truncated: opts.hitCeiling,
    foldersRead: SCAN_BUDGET - opts.budget
  };
}

async function scanFolder(dir, root, options = {}) {
  const opts = normaliseOptions(options);
  const errors = [];
  const found = [];

  try {
    await walk(dir, root, 0, opts, found);
  } catch (err) {
    errors.push({ root: dir, message: describeReadError(err) });
  }

  const entries = await hydrate(found, opts);
  entries.sort(byNewest);
  return { entries, errors, truncated: opts.hitCeiling };
}

function normaliseOptions(options) {
  return {
    ignore: new Set((options.ignore || []).map((n) => n.toLowerCase())),
    followLinks: Boolean(options.followLinks),
    cache: options.cache || null,
    budget: SCAN_BUDGET,
    hitCeiling: false,
    ceilingReason: null,
    visited: new Set(),
    // folder path -> flattened audio stems found there. Built during the
    // same walk, so knowing whether a project has audio costs no extra I/O.
    audioIndex: new Map()
  };
}

function byNewest(a, b) {
  const aTime = Math.max(a.modified || 0, a.renderModified || 0, a.lastActivity || 0);
  const bTime = Math.max(b.modified || 0, b.renderModified || 0, b.lastActivity || 0);
  return bTime - aTime;
}

/* ================================================================== */
/* Walking                                                            */
/* ================================================================== */

async function walk(dir, root, depth, options, out) {
  if (options.budget <= 0) {
    options.hitCeiling = true;
    options.ceilingReason = 'folder budget';
    return;
  }
  if (depth > MAX_DEPTH) {
    options.hitCeiling = true;
    options.ceilingReason = 'depth ceiling';
    return;
  }
  options.budget -= 1;

  // Cycle guard. Resolve to the real path and refuse to walk it twice, so a
  // junction pointing back at its own parent can't loop forever. Cheap, and
  // it means the depth number is never load-bearing.
  let real;
  try {
    real = await fs.realpath(dir);
  } catch {
    real = dir;
  }
  const key = process.platform === 'win32' ? real.toLowerCase() : real;
  if (options.visited.has(key)) return;
  options.visited.add(key);

  let contents;
  try {
    contents = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (depth === 0) throw err;
    return;
  }

  // Fender Studio Pro keeps timestamped .song autosaves in a History folder
  // beside the real project file. They are backups, not separate projects.
  // Scope this rule to folders that actually contain a main .song so a
  // producer's unrelated folder genuinely named "History" remains visible.
  const ownsStudioHistory = contents.some(
    (entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.song'
  );
  // Bitwig saves real .bwproject files in the project folder and automatic
  // copies below auto-backup/. Those copies belong to the health count; they
  // are not independent projects. Scope the skip to an actual Bitwig folder
  // so an unrelated directory named "auto-backup" is not hidden globally.
  const ownsBitwigBackups = contents.some(
    (entry) =>
      entry.isFile() &&
      path.extname(entry.name).toLowerCase() === '.bwproject'
  );
  // Pro Tools puts both backups and recorded source media beside the main
  // .ptx session. Neither tree contains independent DAW Buddy projects.
  const ownsProToolsSession = contents.some(
    (entry) =>
      entry.isFile() && path.extname(entry.name).toLowerCase() === '.ptx'
  );

  for (const entry of contents) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);

    /* ---- directories ---- */
    if (entry.isDirectory()) {
      // Logic's .logicx is a folder that is one project. Claim it, never
      // open it — walking inside turns one project into several fakes.
      if (daw.isSessionPackage(entry.name)) {
        out.push({ sessionPath: full, folder: dir, root, isPackage: true });
        continue;
      }

      const lower = entry.name.toLowerCase();
      if (lower === 'history' && ownsStudioHistory) continue;
      if (lower === 'auto-backup' && ownsBitwigBackups) continue;
      if (lower === 'session file backups' && ownsProToolsSession) continue;
      if (lower === 'audio files' && ownsProToolsSession) continue;
      if (NEVER_PROJECTS.has(lower)) continue;

      // Renders and Bounces are skipped for finding PROJECTS but their
      // contents still get indexed — that's how a row knows whether it has
      // audio without a second pass. Two searches, two rule sets.
      if (RENDER_FOLDER_NAMES.has(lower)) {
        await indexAudio(full, options);
        continue;
      }
      if (options.ignore.has(lower)) continue;

      await walk(full, root, depth + 1, options, out);
      continue;
    }

    /* ---- links ---- */
    // A .lnk is an ordinary file and readdir never reports it as a folder, so
    // it can't loop anything — but it's noise, and the setting says skip it.
    // What actually loops a scan is a junction or symlink, which appears as a
    // real directory. Node reports both as symbolic links on Windows.
    if (entry.isSymbolicLink()) {
      if (!options.followLinks) continue;
      try {
        const stat = await fs.stat(full);
        if (stat.isDirectory()) await walk(full, root, depth + 1, options, out);
      } catch {
        /* dangling link */
      }
      continue;
    }

    if (!entry.isFile()) continue;
    if (!options.followLinks && /\.lnk$/i.test(entry.name)) continue;

    // Loose audio sitting in this folder counts too.
    const fileExt = path.extname(entry.name).toLowerCase();
    if (AUDIO_EXTS.has(fileExt)) {
      try {
        const stat = await fs.stat(full);
        addAudio(options, dir, path.basename(entry.name, fileExt), stat.mtimeMs);
      } catch {
        addAudio(options, dir, path.basename(entry.name, fileExt), 0);
      }
      continue;
    }

    /* ---- session files: one entry each ---- */
    if (!daw.isSessionFile(entry.name)) continue;
    if (daw.isBackupFile(entry.name)) continue; // FL "(autosaved…)" siblings

    out.push({ sessionPath: full, folder: dir, root, isPackage: false });
  }
}

async function indexAudio(dir, options) {
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
      await indexAudio(full, options);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (AUDIO_EXTS.has(ext)) {
      try {
        const stat = await fs.stat(full);
        addAudio(options, dir, path.basename(entry.name, ext), stat.mtimeMs);
      } catch {
        addAudio(options, dir, path.basename(entry.name, ext), 0);
      }
    }
  }
}

function addAudio(options, dir, stem, mtime = 0) {
  const key = normalisePath(dir);
  if (!options.audioIndex.has(key)) options.audioIndex.set(key, []);
  options.audioIndex.get(key).push({
    stem: flatten(stem),
    mtime: Number(mtime) || 0
  });
}

/**
 * How many indexed audio files look like they belong to this session and the
 * newest render modification timestamp among them.
 */
function audioStatsFor(sessionName, projectFolder, root, options) {
  const wanted = flatten(sessionName);
  if (wanted.length < 3) return { count: 0, latestMtime: 0 };

  let count = 0;
  let latestMtime = 0;
  for (const [audioFolder, items] of options.audioIndex) {
    if (!audioFolderBelongsToProject(audioFolder, projectFolder, root)) continue;
    for (const item of items) {
      const itemStem = typeof item === 'object' && item ? item.stem : item;
      const itemMtime = typeof item === 'object' && item ? item.mtime : 0;
      if (itemStem === wanted || (typeof itemStem === 'string' && itemStem.startsWith(wanted))) {
        count += 1;
        if (itemMtime > latestMtime) latestMtime = itemMtime;
      }
    }
  }
  return { count, latestMtime };
}

function countAudioFor(sessionName, projectFolder, root, options) {
  return audioStatsFor(sessionName, projectFolder, root, options).count;
}

/**
 * Mirrors the useful part of renders.findRenders without touching the disk:
 * audio may be inside the project, loose in one of its ancestor folders, or
 * below a render-named folder directly attached to an ancestor. A matching
 * filename in an unrelated branch of the same drive must not light Play.
 */
function audioFolderBelongsToProject(audioFolder, projectFolder, root) {
  if (isInsideOrEqual(audioFolder, projectFolder)) return true;

  let current = normalisePath(projectFolder);
  const stop = normalisePath(root);

  for (let guard = 0; guard < MAX_DEPTH; guard += 1) {
    if (samePath(audioFolder, current)) return true;

    const rel = path.relative(current, audioFolder);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      const first = rel.split(path.sep)[0].toLowerCase();
      if (RENDER_FOLDER_NAMES.has(first)) return true;
    }

    if (samePath(current, stop)) break;
    const parent = path.dirname(current);
    if (parent === current || !isInsideOrEqual(parent, stop)) break;
    current = parent;
  }

  return false;
}


/* ================================================================== */
/* Building entries                                                   */
/* ================================================================== */

async function hydrate(found, options) {
  // Backup counts and zip listings are per folder, so work them out once per
  // folder rather than once per session file. A folder with eight sets would
  // otherwise read its Backup folder eight times.
  const folderInfo = new Map();

  const results = [];
  for (const item of found) {
    results.push(await buildEntry(item, options, folderInfo));
  }
  return results;
}

async function buildEntry({ sessionPath, folder, root, isPackage }, options, folderInfo) {
  const format = daw.formatFor(sessionPath);
  const name = path.basename(sessionPath, path.extname(sessionPath));

  const entry = {
    type: 'project',
    path: sessionPath, // the session file IS the identity now
    sessionPath,
    projectFile: sessionPath,
    folder,
    root,
    rootName: path.basename(root),
    name,
    location: relativeParent(folder, root),
    daw: format ? format.name : null,
    ext: path.extname(sessionPath).toLowerCase(),
    isPackage: Boolean(isPackage),
    bpm: null,
    bpmError: null,
    timeSignature: null as string | null,
    backupCount: 0,
    health: 0,
    packaged: false,
    packagedAt: null,
    modified: 0,
    renderModified: 0,
    lastActivity: 0,
    size: 0,
    audioCount: 0,
    videoCount: 0,
    fromCache: false
  };

  try {
    const stat = await fs.stat(sessionPath);
    entry.modified = stat.mtimeMs;
    entry.size = stat.size;
  } catch {
    entry.modified = 0;
  }

  /* ---- tempo & time signature, from cache when the file hasn't changed ---- */
  const version = daw.parserVersion(sessionPath);
  const cached =
    options.cache &&
    options.cache.get(sessionPath, entry.modified, entry.size, version);

  if (cached) {
    entry.bpm = cached.bpm;
    entry.timeSignature = cached.timeSignature || null;
    entry.bpmError = cached.bpmError || null;
    entry.fromCache = true;
  } else if (format) {
    const result = await format.readTempo(sessionPath);
    entry.bpm = result.bpm;
    entry.timeSignature = result.timeSignature || null;
    entry.bpmError = result.error || null;
    if (options.cache) {
      options.cache.set(sessionPath, entry.modified, entry.size, version, {
        bpm: entry.bpm,
        timeSignature: entry.timeSignature,
        bpmError: entry.bpmError
      });
    }
  }

  /* ---- per-folder facts ---- */
  const info = await folderFacts(folder, format, sessionPath, folderInfo, isPackage);
  entry.backupCount = info.backups;
  entry.health = Math.min(1, info.backups / HEALTH_CEILING);

  // An .flp with a .zip of a similar name means it was exported as a zipped
  // loop package. We never look inside the zip; only the pairing matters.
  const audioStats = audioStatsFor(name, folder, root, options);
  entry.audioCount = audioStats.count;
  entry.renderModified = audioStats.latestMtime || 0;
  entry.lastActivity = Math.max(entry.modified || 0, entry.renderModified || 0);
  entry.videoCount = info.videos;

  const zipMatch = matchingZip(name, info.zips);
  if (zipMatch) {
    entry.packaged = true;
    entry.packagedAt = zipMatch.modified;
  }

  return entry;
}

async function folderFacts(folder, format, sessionPath, cacheMap, isPackage) {
  // Most backup counts are shared by every session in a folder. REAPER's
  // count is session-name specific, while each Logic package owns its own
  // backup directory, so those two must not reuse a sibling's result.
  const sessionScoped = isPackage || (format && format.ext === '.rpp');
  const key = `${folder}::${format ? format.ext : '?'}::${
    sessionScoped ? sessionPath : 'folder'
  }`;
  if (cacheMap.has(key)) return cacheMap.get(key);

  const facts = { backups: 0, videos: 0, zips: [] };

  if (format) {
    try {
      facts.backups = await format.countBackups(
        isPackage ? sessionPath : folder,
        sessionPath
      );
    } catch {
      facts.backups = 0;
    }
  }

  try {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (VIDEO_EXTS.has(ext)) facts.videos += 1;
      if (ext !== '.zip') continue;
      try {
        const stat = await fs.stat(path.join(folder, entry.name));
        facts.zips.push({ name: entry.name, modified: stat.mtimeMs });
      } catch {
        facts.zips.push({ name: entry.name, modified: 0 });
      }
    }
  } catch {
    /* folder vanished */
  }

  cacheMap.set(key, facts);
  return facts;
}

/**
 * Names rarely match character for character — "Nava bharat jodo.flp" against
 * "Nava Bharat Jodo v2.zip" — so both are flattened to letters and digits.
 */
function matchingZip(sessionName, zips) {
  const stem = flatten(sessionName);
  if (stem.length < 4) return null;

  return (
    zips.find((zipFile) => {
      const zipStem = flatten(path.basename(zipFile.name, '.zip'));
      if (zipStem.length < 4) return false;
      return zipStem.startsWith(stem) || stem.startsWith(zipStem);
    }) || null
  );
}

function flatten(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalisePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' || process.platform === 'darwin'
    ? resolved.toLowerCase()
    : resolved;
}

function samePath(a, b) {
  return normalisePath(a) === normalisePath(b);
}

function isInsideOrEqual(child, parent) {
  if (samePath(child, parent)) return true;
  const rel = path.relative(normalisePath(parent), normalisePath(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function relativeParent(folder, root) {
  const rel = path.relative(root, folder);
  if (!rel || rel.startsWith('..')) return '';
  return rel.split(path.sep).join(' / ');
}

function describeReadError(err) {
  if (err.code === 'EACCES' || err.code === 'EPERM') {
    if (process.platform === 'darwin') {
      return 'macOS is blocking access. Open System Settings, then Privacy & Security, and give this app permission to the folder.';
    }
    return 'Permission denied. Check the folder is not read-only or in use.';
  }
  if (err.code === 'ENOENT') {
    return 'Folder not found. If it is on an external drive, plug it in and rescan.';
  }
  if (err.code === 'ENAMETOOLONG') {
    return 'That path is longer than Windows allows (260 characters) unless long path support is enabled.';
  }
  return err.message;
}

module.exports = { scanRoots, scanFolder, NEVER_PROJECTS };
