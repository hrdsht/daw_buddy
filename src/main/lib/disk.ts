'use strict';

const fs = require('fs/promises');
const path = require('path');

/**
 * Read-only disk usage scan for known DAW project folders.
 *
 * Junctions/symlinks are never followed, which prevents cloud links and
 * circular directory structures from escaping the selected project tree.
 * A hard file budget and cancellation callback keep a very large drive from
 * monopolising the main process indefinitely.
 */
async function scanFolders(folders: string[], options: any = {}, onProgress: any = () => {}) {
  const maxFiles = Math.max(1, Number(options.maxFiles) || 250000);
  const shouldCancel = options.shouldCancel || (() => false);
  const unique = [...new Set((folders || []).map((folder) => path.resolve(folder)))];
  const projects = [];
  const imported = new Map();
  let filesScanned = 0;
  let errors = 0;
  let cancelled = false;
  let truncated = false;

  for (let folderIndex = 0; folderIndex < unique.length; folderIndex += 1) {
    if (shouldCancel()) {
      cancelled = true;
      break;
    }
    if (filesScanned >= maxFiles) {
      truncated = true;
      break;
    }

    const folder = unique[folderIndex];
    const result = await walk(folder);
    projects.push({
      folder,
      name: path.basename(folder),
      bytes: result.bytes,
      files: result.files,
      errors: result.errors
    });
    errors += result.errors;
    onProgress({
      foldersDone: folderIndex + 1,
      totalFolders: unique.length,
      filesScanned,
      maxFiles
    });

    if (cancelled || truncated) break;
  }

  return {
    projects: projects.sort((a, b) => b.bytes - a.bytes),
    imported: [...imported.values()].sort((a, b) => b.bytes - a.bytes),
    foldersScanned: projects.length,
    totalFolders: unique.length,
    filesScanned,
    errors,
    cancelled,
    truncated
  };

  async function walk(root) {
    const stack = [{ folder: root, importedRoot: null }];
    let bytes = 0;
    let files = 0;
    let folderErrors = 0;

    while (stack.length > 0) {
      if (shouldCancel()) {
        cancelled = true;
        break;
      }
      if (filesScanned >= maxFiles) {
        truncated = true;
        break;
      }

      const current = stack.pop();
      let children;
      try {
        children = await fs.readdir(current.folder, { withFileTypes: true });
      } catch {
        folderErrors += 1;
        continue;
      }

      for (const child of children) {
        if (shouldCancel()) {
          cancelled = true;
          break;
        }
        if (filesScanned >= maxFiles) {
          truncated = true;
          break;
        }

        const full = path.join(current.folder, child.name);
        if (child.isSymbolicLink()) continue;
        if (child.isDirectory()) {
          const isImported =
            child.name.toLowerCase() === 'imported' &&
            path.basename(current.folder).toLowerCase() === 'samples';
          const importedRoot = isImported ? full : current.importedRoot;
          if (isImported && !imported.has(full)) {
            imported.set(full, { folder: full, name: path.basename(root), bytes: 0, files: 0 });
          }
          stack.push({ folder: full, importedRoot });
          continue;
        }
        if (!child.isFile()) continue;

        try {
          const stat = await fs.stat(full);
          bytes += stat.size;
          files += 1;
          filesScanned += 1;
          if (current.importedRoot) {
            const bucket = imported.get(current.importedRoot);
            bucket.bytes += stat.size;
            bucket.files += 1;
          }
          if (filesScanned % 500 === 0) {
            onProgress({
              foldersDone: projects.length,
              totalFolders: unique.length,
              filesScanned,
              maxFiles
            });
          }
        } catch {
          folderErrors += 1;
        }
      }
    }

    return { bytes, files, errors: folderErrors };
  }
}

module.exports = { scanFolders };
