'use strict';

/**
 * Watches your project folders for new renders.
 *
 * Two settings do the heavy lifting:
 *
 * awaitWriteFinish — a bounce appears on disk the moment your DAW starts
 * writing it and keeps growing. Without this you'd get an alert for a 44 byte
 * file. chokidar waits until the size stops changing for 3 seconds.
 *
 * Grouping — the mp3 lands seconds after the wav. Same base name and version
 * means one render, not two. New files are held briefly, then reported once
 * as "Song v8 rendered (wav + mp3)".
 *
 * Note text files are ignored outright: their names change every time you
 * edit a note, and every rename would otherwise look like a new file.
 */

const path = require('path');
const chokidar = require('chokidar');

const { parseVersion } = require('./media');
const daw = require('./daw');
const { AUDIO_EXTS } = require('./renders');

const WATCHED_AUDIO = new Set(AUDIO_EXTS ? [...AUDIO_EXTS] : ['.wav', '.mp3', '.aiff', '.aif', '.flac', '.ogg']);
const SKIP_FOLDERS = /[\\/](samples|recorded|freeze|backup|presets|node_modules|\.git)[\\/]/i;

// How long to hold a new render before reporting it, so its other formats
// can arrive and join the same event.
const GROUP_MS = 3000;

let watcher = null;
let pending = new Map();
let projectDebounceTimer: NodeJS.Timeout | null = null;
let changedProjects = new Set<string>();

function startWatching(
  roots: string[],
  onBounce: (bounce: Record<string, any>) => void,
  onProjectChange?: (changedPaths: string[]) => void,
  options: Record<string, any> = {}
) {
  stopWatching();

  if (!roots || roots.length === 0) {
    console.log('[watcher] No folders on the list — nothing to watch.');
    return;
  }

  // Support optional 3rd argument being options if onProjectChange is omitted
  let projectCallback = onProjectChange;
  let opts = options;
  if (typeof onProjectChange === 'object' && onProjectChange !== null) {
    opts = onProjectChange;
    projectCallback = undefined;
  }

  watcher = chokidar.watch(roots, {
    ignoreInitial: true,
    depth: 6,
    ignored: (candidate) => {
      if (/(^|[\\/])\.[^\\/]/.test(candidate)) return true; // dotfiles
      if (/\.txt$/i.test(candidate)) return true; // note files rename constantly
      return false;
    },

    // Normally the OS tells us when a file appears — ReadDirectoryChangesW on
    // Windows, FSEvents on macOS. Network shares send neither, so polling asks
    // the disk over and over instead. Correct everywhere, just heavier.
    usePolling: Boolean(opts.pollWatching),
    interval: 1500,
    binaryInterval: 2000,

    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 200
    }
  });

  const handleFile = (filePath: string) => {
    if (SKIP_FOLDERS.test(filePath)) return;
    const ext = path.extname(filePath).toLowerCase();

    // 1. Audio Render / Bounce detection
    if (WATCHED_AUDIO.has(ext)) {
      hold(filePath, ext, onBounce);
      return;
    }

    // 2. DAW Project File / Package save detection
    if (daw.isSessionFile(filePath) || daw.isSessionPackage(filePath)) {
      if (daw.isBackupFile(filePath)) return;
      holdProject(filePath, projectCallback);
    }
  };

  watcher.on('add', handleFile);
  watcher.on('change', handleFile);

  watcher.on('error', (err) => console.error('[watcher] error:', err.message));

  console.log(
    `[watcher] Watching ${roots.length} folder(s) for new bounces and project saves` +
      `${opts.pollWatching ? ' (polling mode)' : ''}:`
  );
  roots.forEach((root) => console.log(`           ${root}`));
}

function hold(filePath: string, ext: string, onBounce: (bounce: Record<string, any>) => void) {
  const folder = path.dirname(filePath);
  const stem = path.basename(filePath, ext);
  const { base, version } = parseVersion(stem);
  const key = `${folder}::${base.toLowerCase()}::${version ?? 'none'}`;

  const existing = pending.get(key);

  if (existing) {
    if (!existing.formats.includes(ext.replace('.', ''))) {
      existing.formats.push(ext.replace('.', ''));
    }
    return; // the timer from the first file still runs
  }

  const record: Record<string, any> = {
    file: filePath,
    folder,
    base,
    version,
    name: path.basename(filePath),
    label: version !== null ? `${base} v${version}` : base,
    project: path.basename(folder),
    formats: [ext.replace('.', '')],
    detectedAt: new Date().toISOString()
  };

  record.timer = setTimeout(() => {
    pending.delete(key);
    delete record.timer;
    if (typeof onBounce === 'function') {
      onBounce(record);
    }
  }, GROUP_MS);

  pending.set(key, record);
}

function holdProject(filePath: string, onProjectChange?: (changedPaths: string[]) => void) {
  changedProjects.add(filePath);
  if (projectDebounceTimer) clearTimeout(projectDebounceTimer);

  projectDebounceTimer = setTimeout(() => {
    const list = [...changedProjects];
    changedProjects.clear();
    projectDebounceTimer = null;
    if (typeof onProjectChange === 'function') {
      onProjectChange(list);
    }
  }, 1000);
}

function stopWatching() {
  pending.forEach((record) => clearTimeout(record.timer));
  pending = new Map();

  if (projectDebounceTimer) {
    clearTimeout(projectDebounceTimer);
    projectDebounceTimer = null;
  }
  changedProjects.clear();

  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

module.exports = { startWatching, stopWatching };
