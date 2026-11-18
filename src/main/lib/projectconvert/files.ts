'use strict';

/**
 * Finding the audio a project points at.
 *
 * Projects store paths from the machine they were made on. Moved drives,
 * another OS, a collaborator's set — the stored path is often wrong while the
 * file is sitting right there in the project folder. So: try each stored path,
 * then fall back to a one-time index of the project folder by file name.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import nodePath from 'path';

const MAX_INDEXED = 20000;
const MAX_DEPTH = 6;

export class FileFinder {
  root: string;
  private index: Map<string, string> | null = null;

  constructor(root: string) {
    this.root = root;
  }

  async resolve(candidates: string[], fileName: string): Promise<string | null> {
    for (const raw of candidates) {
      if (!raw) continue;
      const normalised = normaliseSeparators(raw);
      const full = nodePath.isAbsolute(normalised) ? normalised : nodePath.join(this.root, normalised);
      if (await isFile(full)) return full;
    }
    if (!fileName) return null;
    const index = await this.buildIndex();
    return index.get(fileName.toLowerCase()) || null;
  }

  private async buildIndex(): Promise<Map<string, string>> {
    if (this.index) return this.index;
    const index = new Map<string, string>();
    let count = 0;
    const walk = async (dir: string, depth: number) => {
      if (depth > MAX_DEPTH || count > MAX_INDEXED) return;
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = nodePath.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (entry.isFile()) {
          count += 1;
          const key = entry.name.toLowerCase();
          if (!index.has(key)) index.set(key, full);
        }
      }
    };
    await walk(this.root, 0);
    this.index = index;
    return index;
  }
}

/** A Windows path read on macOS/Linux (or vice versa) still needs to be tried. */
function normaliseSeparators(p: string): string {
  if (nodePath.sep === '/') return p.replace(/\\/g, '/');
  return p.replace(/\//g, '\\');
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fsp.stat(p)).isFile();
  } catch {
    return false;
  }
}
