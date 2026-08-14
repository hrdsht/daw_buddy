'use strict';

/**
 * Notes are written as real text files next to the project, one per session
 * file, so the history is readable without this app.
 *
 *   Nava bharat jodo — 2026-08-13 1420.txt
 *   Suraag v2 — 2026-08-13 1655.txt
 *
 * The filename carries the time it was last saved, so it changes on every
 * update. Three things that has to get right:
 *
 * 1. RENAME, never delete-and-recreate. A crash between the two loses the
 *    note. fs.rename moves the file with its contents intact.
 *
 * 2. Debounce the rename. If the txt is open in Notepad while the name
 *    changes, saving from Notepad recreates the old filename and you end up
 *    with two. So content is written immediately, and the rename only happens
 *    once you've stopped typing.
 *
 * 3. The watcher has to ignore .txt, or every note edit looks like a file
 *    appearing in a project folder and fires a bounce alert.
 */

const fs = require('fs/promises');
const path = require('path');

const RENAME_IDLE_MS = 4000;

class NoteWriter {
  constructor() {
    this.timers = new Map();
  }

  /**
   * Writes the note and schedules the filename update.
   * Returns the path currently holding the note.
   */
  async save(sessionPath, text, existingFile) {
    const folder = path.dirname(sessionPath);
    const stem = baseName(sessionPath);

    // Empty note: remove the file entirely rather than leaving a blank one.
    if (!text || text.trim() === '') {
      if (existingFile) await remove(existingFile);
      this.cancel(sessionPath);
      return null;
    }

    let target = existingFile;

    if (target && (await exists(target))) {
      await fs.writeFile(target, text, 'utf8');
    } else {
      target = path.join(folder, fileNameFor(stem, new Date()));
      await fs.writeFile(target, text, 'utf8');
    }

    this.scheduleRename(sessionPath, target, stem, folder);
    return target;
  }

  /**
   * Once typing stops, move the file to a name carrying the current time.
   */
  scheduleRename(sessionPath, currentFile, stem, folder) {
    this.cancel(sessionPath);

    const timer = setTimeout(async () => {
      this.timers.delete(sessionPath);
      try {
        const desired = path.join(folder, fileNameFor(stem, new Date()));
        if (desired === currentFile) return;
        if (!(await exists(currentFile))) return;
        if (await exists(desired)) {
          // Another file already has that name — leave things alone rather
          // than overwriting something we didn't create.
          return;
        }
        await fs.rename(currentFile, desired);
        if (this.onRenamed) this.onRenamed(sessionPath, desired);
      } catch (err) {
        console.error('[notes] Could not rename note file:', err.message);
      }
    }, RENAME_IDLE_MS);

    this.timers.set(sessionPath, timer);
  }

  cancel(sessionPath) {
    const timer = this.timers.get(sessionPath);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(sessionPath);
    }
  }

  /** Finds an existing note file for a session, if the app lost track of it. */
  async find(sessionPath) {
    const folder = path.dirname(sessionPath);
    const stem = baseName(sessionPath);

    try {
      const entries = await fs.readdir(folder, { withFileTypes: true });
      const match = entries
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.toLowerCase().endsWith('.txt') &&
            entry.name.startsWith(`${stem} — `)
        )
        .map((entry) => path.join(folder, entry.name))
        .sort();
      return match.length > 0 ? match[match.length - 1] : null;
    } catch {
      return null;
    }
  }

  async read(file) {
    try {
      return await fs.readFile(file, 'utf8');
    } catch {
      return null;
    }
  }
}

function baseName(sessionPath) {
  return path.basename(sessionPath, path.extname(sessionPath));
}

function fileNameFor(stem, date) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `${sanitise(stem)} — ${stamp}.txt`;
}

// The em dash is fine on both platforms; these characters are not.
function sanitise(name) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim();
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function remove(file) {
  try {
    await fs.unlink(file);
  } catch {
    /* already gone */
  }
}

module.exports = { NoteWriter, fileNameFor };
