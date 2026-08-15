'use strict';

/**
 * One record per thing, stored in notes.json.
 *
 * Two kinds of key:
 *   a project FOLDER path — favourite, stems folder, detected key
 *   a SESSION FILE path   — the note for that particular version
 *
 * That's why a project with three .als files can carry three separate notes.
 *
 * Older versions stored a bare string per project instead of an object.
 * load() upgrades that in place — nobody loses a note to a version bump.
 */

const fs = require('fs/promises');
const path = require('path');

const EMPTY = {
  note: '',
  noteFile: null,
  stemsPath: null,
  key: null,
  camelot: null,
  keyConfidence: 0,
  keyAlternate: null,
  detectedBpm: null,
  analysedFrom: null,
  favourite: false,
  updatedAt: null
};

class ProjectStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = {};
    this.writeTimer = null;
  }

  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      let upgraded = false;

      for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'string') {
          this.data[key] = { ...EMPTY, note: value };
          upgraded = true;
        } else {
          this.data[key] = { ...EMPTY, ...value };
        }
      }

      if (upgraded) await this.flush();
    } catch {
      this.data = {};
    }
    return this.data;
  }

  all() {
    return this.data;
  }

  get(key) {
    return this.data[key] || { ...EMPTY };
  }

  set(key, patch) {
    const next = { ...EMPTY, ...(this.data[key] || {}), ...patch };
    next.updatedAt = new Date().toISOString();

    const isEmpty =
      !next.note && !next.stemsPath && !next.key && !next.favourite;

    if (isEmpty) delete this.data[key];
    else this.data[key] = next;

    this.scheduleWrite();
    return this.get(key);
  }

  // Writing on every keystroke would hammer the disk, so wait for a half
  // second of quiet.
  scheduleWrite() {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.flush(), 500);
  }

  async flush() {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = null;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(
        this.filePath,
        JSON.stringify(this.data, null, 2),
        'utf8'
      );
    } catch (err) {
      console.error('[notes] Could not save notes.json:', err.message);
    }
  }
}

module.exports = { ProjectStore, EMPTY };
