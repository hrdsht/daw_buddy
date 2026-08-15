'use strict';

/**
 * Moves your data across after the rename from Project Browser to DAW Buddy.
 *
 * Electron derives the app data folder from the "name" field in package.json:
 *
 *   before   C:\Users\you\AppData\Roaming\project-browser\
 *   after    C:\Users\you\AppData\Roaming\daw-buddy\
 *
 * Change the name and Electron starts looking in a folder that doesn't exist
 * yet. Nothing is lost — notes.json, settings.json and cache.json are all
 * still sitting in the old folder — but the app can't see any of it. Every
 * note, stems path and favourite appears to have vanished and your project
 * roots reset, so it looks exactly like a catastrophic failure.
 *
 * This runs once, on first launch after the rename, and copies them over.
 *
 * Deliberately COPIES rather than moves. If anything here goes wrong, the
 * originals are still in the old folder and can be recovered by hand. Disk
 * space isn't the constraint; your notes are.
 */

const fs = require('fs/promises');
const path = require('path');

const FILES = ['notes.json', 'settings.json', 'cache.json', 'rename-undo.json'];

const OLD_NAMES = ['project-browser', 'Project Browser'];

async function migrate(newDataDir) {
  const marker = path.join(newDataDir, '.migrated');

  // Already done. Never run twice — a second run could overwrite newer data
  // with the stale copy left behind in the old folder.
  try {
    await fs.access(marker);
    return { migrated: false, reason: 'already done' };
  } catch {
    /* not yet */
  }

  // Only migrate into a folder that has nothing in it. If DAW Buddy has
  // already been used, its own data wins.
  const existing = await listFiles(newDataDir);
  if (existing.some((name) => FILES.includes(name))) {
    await touch(marker);
    return { migrated: false, reason: 'new folder already has data' };
  }

  const parent = path.dirname(newDataDir);
  let source = null;

  for (const candidate of OLD_NAMES) {
    const dir = path.join(parent, candidate);
    const found = await listFiles(dir);
    if (found.some((name) => FILES.includes(name))) {
      source = dir;
      break;
    }
  }

  if (!source) {
    await touch(marker);
    return { migrated: false, reason: 'nothing to migrate' };
  }

  const copied = [];
  const failed = [];

  await fs.mkdir(newDataDir, { recursive: true });

  for (const name of FILES) {
    const from = path.join(source, name);
    const to = path.join(newDataDir, name);
    try {
      await fs.copyFile(from, to);
      copied.push(name);
    } catch (err) {
      if (err.code !== 'ENOENT') failed.push({ name, message: err.message });
    }
  }

  await touch(marker);

  console.log(
    `[migrate] Brought ${copied.length} file(s) over from ${source}: ${copied.join(', ')}`
  );
  if (failed.length > 0) {
    console.error('[migrate] Could not copy:', failed);
  }

  return { migrated: copied.length > 0, from: source, copied, failed };
}

async function listFiles(dir) {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

async function touch(file) {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, new Date().toISOString(), 'utf8');
  } catch {
    /* not fatal — worst case the check runs again and finds data present */
  }
}

module.exports = { migrate, FILES, OLD_NAMES };
