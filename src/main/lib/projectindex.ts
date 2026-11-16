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

  /**
   * Saves the result of a full scan. A root that couldn't be read (unplugged
   * drive, missing folder) used to block the save entirely, so one offline
   * root froze the catalogue for every root. Now the roots that were read
   * are saved fresh and the unreadable ones keep their last known projects.
   * A truncated scan is still not saved — it's partial in unknown places.
   */
  async saveAfterScan(settings, entries, result: { errors?: { root: string }[]; truncated?: boolean } = {}) {
    if (!Array.isArray(entries) || result.truncated) return false;
    const failed = (result.errors || []).map((e) => e && e.root).filter(Boolean);
    if (!failed.length) return this.save(settings, entries);
    const previous = await this.load(settings);
    return this.save(settings, mergeUnreadableRoots(previous ? previous.entries : [], entries, failed));
  }
}

/** Fresh entries plus the previous entries that belong to roots that failed. */
function mergeUnreadableRoots(previous, fresh, failedRoots) {
  const failed = new Set(failedRoots.map(normalisePath));
  const seen = new Set(fresh.map((e) => normalisePath(e.sessionPath || e.path)));
  const kept = previous.filter(
    (e) => e && e.root && failed.has(normalisePath(e.root)) && !seen.has(normalisePath(e.sessionPath || e.path))
  );
  return [...fresh, ...kept];
}

module.exports = { ProjectIndex, INDEX_FORMAT, signatureFor, mergeUnreadableRoots };
