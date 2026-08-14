'use strict';

/**
 * Remembers what was parsed out of each session file, so opening the app
 * doesn't mean re-reading everything.
 *
 * What's actually slow is not walking the tree — readdir and stat are cheap.
 * It's opening and gunzipping every .als to find the tempo, roughly 50-100ms
 * per set. Three hundred projects is half a minute of pure decompression, and
 * almost none of those files changed since last time.
 *
 * (Aside, since it comes up: this is why we can't do what Everything does.
 * Everything reads the NTFS Master File Table directly instead of walking
 * folders — but it never opens a file, so it knows names, sizes and dates and
 * could never tell you a BPM. The index isn't the win here. Not re-parsing
 * unchanged files is.)
 *
 * A cached entry is trusted only when ALL of these still match:
 *
 *   mtime    the file hasn't been saved since
 *   size     mtime alone misses two writes in the same second
 *   version  the parser that produced it hasn't changed
 *
 * That last one is not optional. When the FL parser was fixed, every cached
 * FL tempo became wrong. Without a version stamp the cache would serve those
 * wrong numbers forever and it would look like the fix had failed.
 */

const fs = require('fs/promises');
const path = require('path');

const CACHE_FORMAT = 3;

class ParseCache {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = {};
    this.dirty = false;
    this.hits = 0;
    this.misses = 0;
  }

  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      // A change to the cache's own shape throws the lot away rather than
      // trying to migrate. It's a cache; rebuilding costs one slow scan.
      if (raw.format === CACHE_FORMAT && raw.entries) {
        this.data = raw.entries;
      }
    } catch {
      this.data = {};
    }
    return this;
  }

  get(filePath, mtime, size, version) {
    const hit = this.data[filePath];
    if (!hit) {
      this.misses += 1;
      return null;
    }
    if (
      hit.mtime !== mtime ||
      hit.size !== size ||
      hit.version !== version
    ) {
      this.misses += 1;
      return null;
    }
    hit.seen = Date.now();
    this.hits += 1;
    return hit.value;
  }

  set(filePath, mtime, size, version, value) {
    this.data[filePath] = { mtime, size, version, value, seen: Date.now() };
    this.dirty = true;
  }

  /** Forget files that no longer exist, so the cache can't grow forever. */
  prune(livePaths) {
    const live = new Set(livePaths);
    let removed = 0;
    for (const key of Object.keys(this.data)) {
      if (!live.has(key)) {
        delete this.data[key];
        removed += 1;
      }
    }
    if (removed > 0) this.dirty = true;
    return removed;
  }

  /**
   * Written to a temp file and renamed. Rename is atomic, so a crash halfway
   * through leaves the old cache intact rather than a truncated one — the
   * same reason the note writer and the ID3 stripper do it this way.
   */
  async save() {
    if (!this.dirty) return;
    const temp = `${this.filePath}.tmp`;

    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(
        temp,
        JSON.stringify({ format: CACHE_FORMAT, entries: this.data }),
        'utf8'
      );
      await fs.rename(temp, this.filePath);
      this.dirty = false;
    } catch (err) {
      console.error('[cache] Could not save:', err.message);
      try {
        await fs.unlink(temp);
      } catch {
        /* temp never created */
      }
    }
  }

  stats() {
    return {
      entries: Object.keys(this.data).length,
      hits: this.hits,
      misses: this.misses
    };
  }

  resetCounters() {
    this.hits = 0;
    this.misses = 0;
  }
}

module.exports = { ParseCache, CACHE_FORMAT };
