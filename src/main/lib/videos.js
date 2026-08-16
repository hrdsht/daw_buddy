'use strict';

const fs = require('fs/promises');
const path = require('path');

const VIDEO_EXTS = new Set([
  '.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm', '.wmv',
  '.mpeg', '.mpg', '.mts', '.m2ts'
]);

/** Videos directly beside the project's DAW file. */
async function listVideos(folder) {
  let contents;
  try {
    contents = await fs.readdir(folder, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of contents) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!VIDEO_EXTS.has(ext)) continue;

    const full = path.join(folder, entry.name);
    try {
      const stat = await fs.stat(full);
      files.push({
        path: full,
        name: entry.name,
        ext,
        size: stat.size,
        modified: stat.mtimeMs
      });
    } catch {
      /* file vanished during the scan */
    }
  }

  files.sort((a, b) => b.modified - a.modified);
  return files;
}

module.exports = { VIDEO_EXTS, listVideos };
