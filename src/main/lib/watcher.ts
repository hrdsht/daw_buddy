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

const WATCHED = new Set(['.wav', '.mp3', '.aiff', '.flac']);
const SKIP_FOLDERS = /[\\/](samples|recorded|freeze|backup)[\\/]/i;

// How long to hold a new render before reporting it, so its other formats
// can arrive and join the same event.
const GROUP_MS = 6000;

let watcher = null;
let pending = new Map();

function startWatching(roots, onBounce, options: Record<string, any> = {}) {
  stopWatching();

  if (!roots || roots.length === 0) {
    console.log('[watcher] No folders on the list — nothing to watch.');
    return;
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
    usePolling: Boolean(options.pollWatching),
    interval: 1500,
    binaryInterval: 2000,

    awaitWriteFinish: {
      stabilityThreshold: 3000,
      pollInterval: 200
    }
  });

  watcher.on('add', (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!WATCHED.has(ext)) return;
    if (SKIP_FOLDERS.test(filePath)) return;

    hold(filePath, ext, onBounce);
  });

  watcher.on('error', (err) => console.error('[watcher] error:', err.message));

  console.log(
    `[watcher] Watching ${roots.length} folder(s) for new bounces` +
      `${options.pollWatching ? ' (polling mode)' : ''}:`
  );
  roots.forEach((root) => console.log(`           ${root}`));
}

function hold(filePath, ext, onBounce) {
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
    onBounce(record);
  }, GROUP_MS);

  pending.set(key, record);
}

function stopWatching() {
  pending.forEach((record) => clearTimeout(record.timer));
  pending = new Map();

  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

module.exports = { startWatching, stopWatching };
