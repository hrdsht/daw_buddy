'use strict';

/**
 * A complete last-known-good project catalogue.
 *
 * ParseCache avoids reopening unchanged DAW files, but the scanner still has
 * to walk every folder to discover what exists. This second cache lets the
 * renderer show yesterday's complete catalogue immediately while that walk
 * verifies changes in the background.
 */

const fs = require('fs/promises');
const path = require('path');

const INDEX_FORMAT = 1;

function normalisePath(value) {
  const resolved = path.resolve(String(value || ''));
  return process.platform === 'win32' || process.platform === 'darwin'
    ? resolved.toLowerCase()
    : resolved;
}

function signatureFor(settings) {
  const roots = Array.isArray(settings && settings.roots)
    ? settings.roots.map(normalisePath).sort()
    : [];
  const ignore = Array.isArray(settings && settings.ignore)
    ? settings.ignore.map((value) => String(value).toLowerCase()).sort()
    : [];

  return JSON.stringify({
    roots,
    ignore,
    followLinks: Boolean(settings && settings.followLinks)
  });
}

class ProjectIndex {
  filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(settings) {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (
        raw.format !== INDEX_FORMAT ||
        raw.signature !== signatureFor(settings) ||
        !Array.isArray(raw.entries)
      ) {
        return null;
      }

      return {
        entries: raw.entries,
        savedAt: Number(raw.savedAt) || 0
      };
    } catch {
      return null;
    }
  }

  async save(settings, entries) {
    if (!Array.isArray(entries)) return false;
    const temp = `${this.filePath}.tmp`;

    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(
        temp,
        JSON.stringify({
          format: INDEX_FORMAT,
          signature: signatureFor(settings),
          savedAt: Date.now(),
          entries
        }),
        'utf8'
      );
      await fs.rename(temp, this.filePath);
      return true;
    } catch (error) {
      console.error('[project-index] Could not save:', error.message);
      try {
        await fs.unlink(temp);
      } catch {
        /* temp never existed */
      }
      return false;
    }
  }
}

module.exports = { ProjectIndex, INDEX_FORMAT, signatureFor };
