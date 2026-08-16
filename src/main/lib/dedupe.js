'use strict';

/**
 * Finds sample-pack files that Ableton's Collect All copied into many project
 * folders, and reclaims the space without touching a single session.
 *
 * ------------------------------------------------------------------
 * WHAT IT IS ALLOWED TO LOOK AT
 *
 * Only Samples/Imported. Collect All sorts your material for us:
 *
 *   Samples/Imported/    copies of files that came from outside — pack
 *                        material, with an original elsewhere. Fair game.
 *   Samples/Processed/   consolidated clips, freeze files, warped and
 *                        reversed renders. Ableton MADE these. No copy
 *                        exists anywhere else. Never touched.
 *   Samples/Recorded/    your own takes. Never touched.
 *
 * Stems, bounces and renders are outside Samples entirely and never seen.
 * This restriction is structural — the tool cannot reach audio that only
 * exists once, so no confirmation dialog is load-bearing.
 * ------------------------------------------------------------------
 *
 * WHAT IT DOES ABOUT THEM
 *
 * Hard links, not deletion. A hard link is a second name for the same bytes
 * on disk. Both paths keep working, every session still opens, and the drive
 * stores one copy instead of twenty. Nothing can break, because from the
 * file system's point of view nothing was removed.
 *
 * Hard links cannot cross drives, so duplicates split across volumes are
 * reported as a number and given no button. Deleting a collected sample
 * means Ableton asks you to locate it on next open — not worth it.
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const AUDIO = new Set(['.wav', '.aiff', '.aif', '.flac', '.mp3', '.ogg']);

// Max for Live devices get copied into every project that uses one. Only a
// few hundred KB each, but perfectly safe to link and there can be many.
const DEVICES = new Set(['.amxd']);
const DEDUPE_EXTENSIONS = new Set([...AUDIO, ...DEVICES]);

// Below this, deduplicating is not worth the risk or the time.
const MIN_SIZE = 8 * 1024;

// Was 8000, which this drive blew through silently — the scan died partway
// and reported a partial result as if it were complete. Raised a long way,
// and hitting it is now reported rather than swallowed.
const MAX_FOLDERS = 250000;

/**
 * Which folders hold copies rather than originals.
 *
 * Matched on the RELATIVE PATH SHAPE, not the folder name. Both of these end
 * in a folder called "Imported":
 *
 *   Samples/Imported/                                  sample-pack copies
 *   Presets/Audio Effects/Max Audio Effect/Imported/   Max devices
 *
 * Matching on the bare name would conflate them. A false match in a tool
 * that modifies files is a worse mistake than one in a scanner.
 *
 * Splice is included because Splice downloads are pack material by
 * definition — the clearest possible candidate, and the old version walked
 * straight past because it only knew the name "Imported".
 */
const COPY_LOCATIONS = [
  { parent: 'samples', child: 'imported', kind: 'sample' },
  { parent: 'samples', child: 'splice', kind: 'sample' },
  { parent: 'max audio effect', child: 'imported', kind: 'device' },
  { parent: 'max instrument', child: 'imported', kind: 'device' },
  { parent: 'max midi effect', child: 'imported', kind: 'device' }
];

// Never touched: Ableton made these, or you recorded them, and no copy
// exists anywhere else.
const NEVER = new Set(['processed', 'recorded']);

/* ================================================================== */
/* 1. Find the Imported folders                                       */
/* ================================================================== */

async function findImportedFolders(roots) {
  const found = [];
  const budget = { left: MAX_FOLDERS, exhausted: false };

  for (const root of roots) {
    await walk(root, 0, found, budget);
  }
  return { folders: found, truncated: budget.exhausted };
}

async function walk(dir, depth, found, budget) {
  if (budget.left <= 0) {
    budget.exhausted = true;
    return;
  }
  if (depth > 24) return;
  budget.left -= 1;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const here = path.basename(dir).toLowerCase();

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const name = entry.name.toLowerCase();
    const full = path.join(dir, entry.name);

    // Never descend into these, whatever they contain.
    if (NEVER.has(name)) continue;

    const location = COPY_LOCATIONS.find(
      (spot) => spot.parent === here && spot.child === name
    );

    if (location) {
      found.push({ dir: full, kind: location.kind });
      continue; // it's a leaf as far as we're concerned
    }

    await walk(full, depth + 1, found, budget);
  }
}

async function collectFiles(folders) {
  const files = [];

  for (const folder of folders) {
    await collectFrom(folder.dir, files, 0, folder.kind);
  }
  return files;
}

async function collectFrom(dir, out, depth, kind) {
  if (depth > 6) return;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (NEVER.has(entry.name.toLowerCase())) continue;
      await collectFrom(full, out, depth + 1, kind);
      continue;
    }
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    if (!DEDUPE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

    try {
      const stat = await fs.stat(full);
      if (stat.size < MIN_SIZE) continue;
      out.push({
        path: full,
        name: entry.name,
        kind,
        size: stat.size,
        inode: stat.ino,
        links: stat.nlink,
        // stat.dev identifies the actual mounted filesystem. path.parse().root
        // reports "/" for every macOS volume, which incorrectly treated
        // external drives as link-compatible with the system disk.
        volume: String(stat.dev)
      });
    } catch {
      /* vanished */
    }
  }
}

/* ================================================================== */
/* 3. Hash only what could possibly match                             */
/* ================================================================== */

/**
 * Size groups first, hashes second.
 *
 * Size alone cannot confirm a match. Sample packs are full of files sharing a
 * size for boring reasons — same length, same bitrate, batch-processed one
 * shots. Two different snares, both 44.1k stereo, both exactly 0.5 seconds,
 * are byte-for-byte different with identical sizes.
 *
 * But hashing all five thousand files would be slow. Hashing only the few
 * hundred that share a size with something else is fast, and it's the
 * difference between a tool you can trust and one that eventually eats a
 * sample you needed.
 */
async function findDuplicates(roots, onProgress) {
  const { folders, truncated } = await findImportedFolders(roots);
  if (folders.length === 0) {
    return { groups: [], scanned: 0, folders: 0, truncated };
  }

  const files = await collectFiles(folders);

  const bySize = new Map();
  for (const file of files) {
    if (!bySize.has(file.size)) bySize.set(file.size, []);
    bySize.get(file.size).push(file);
  }

  const candidates = [...bySize.values()].filter((group) => group.length > 1);
  const total = candidates.reduce((sum, group) => sum + group.length, 0);
  let done = 0;

  const byHash = new Map();

  for (const group of candidates) {
    for (const file of group) {
      const hash = await hashFile(file.path);
      done += 1;
      if (onProgress && done % 25 === 0) onProgress(done, total);
      if (!hash) continue;

      if (!byHash.has(hash)) byHash.set(hash, []);
      byHash.get(hash).push(file);
    }
  }

  const groups = [];

  for (const [hash, matches] of byHash) {
    if (matches.length < 2) continue;

    // Files already sharing an inode are the same bytes on disk — either
    // already linked by a previous run, or the same file reached two ways.
    const distinct = new Map();
    for (const file of matches) {
      const key = `${file.volume}:${file.inode}`;
      if (!distinct.has(key)) distinct.set(key, file);
    }
    if (distinct.size < 2) continue;

    const unique = [...distinct.values()];
    const volumes = new Set(unique.map((f) => f.volume));

    groups.push({
      hash,
      kind: unique[0].kind || 'sample',
      size: unique[0].size,
      count: unique.length,
      wasted: unique[0].size * (unique.length - 1),
      crossVolume: volumes.size > 1,
      files: unique.map((f) => ({
        path: f.path,
        name: f.name,
        volume: f.volume,
        project: projectNameFor(f.path)
      }))
    });
  }

  groups.sort((a, b) => b.wasted - a.wasted);

  return {
    groups,
    scanned: files.length,
    folders: folders.length,
    hashed: done,
    truncated,
    sampleFolders: folders.filter((f) => f.kind === 'sample').length,
    deviceFolders: folders.filter((f) => f.kind === 'device').length
  };
}

function hashFile(filePath) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    const stream = require('fs').createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', () => resolve(null));
  });
}

/* ================================================================== */
/* 4. Link them                                                       */
/* ================================================================== */

/**
 * Replaces duplicates with hard links to one master copy.
 *
 * The order matters. We link the master to a temporary name first, then
 * rename that over the duplicate. Rename replaces atomically — there is no
 * instant where the duplicate's path has no file behind it. Unlinking first
 * and linking second would leave exactly that gap, and a crash inside it
 * would cost you a sample.
 */
async function linkGroup(group) {
  const sameVolume = group.files.filter(
    (file) => file.volume === group.files[0].volume
  );
  if (sameVolume.length < 2) {
    return { linked: 0, reclaimed: 0, skipped: group.files.length };
  }

  const master = sameVolume[0];
  let linked = 0;
  let reclaimed = 0;
  const failures = [];

  for (const file of sameVolume.slice(1)) {
    const temp = `${file.path}.link-${Date.now()}`;
    try {
      // The user may leave the result screen open while a DAW changes one of
      // these files. Confirm equality again immediately before replacement;
      // the scan-time hash is not permission to discard newer bytes.
      const [masterHash, fileHash, masterStat, fileStat] = await Promise.all([
        hashFile(master.path),
        hashFile(file.path),
        fs.stat(master.path),
        fs.stat(file.path)
      ]);
      if (!masterHash || masterHash !== fileHash) {
        throw new Error('File changed after the duplicate scan; scan again');
      }
      if (String(masterStat.dev) !== String(fileStat.dev)) {
        throw new Error('Files are no longer on the same volume');
      }

      await fs.link(master.path, temp);
      await fs.rename(temp, file.path);
      linked += 1;
      reclaimed += fileStat.size;
    } catch (err) {
      try {
        await fs.unlink(temp);
      } catch {
        /* temp never created */
      }
      failures.push({ path: file.path, message: err.message });
    }
  }

  return {
    linked,
    reclaimed,
    skipped: group.files.length - sameVolume.length,
    failures
  };
}

async function linkGroups(groups) {
  let linked = 0;
  let reclaimed = 0;
  const failures = [];

  for (const group of groups) {
    if (group.crossVolume && new Set(group.files.map((f) => f.volume)).size > 1) {
      // Mixed volumes: link what shares a drive, leave the rest.
    }
    const result = await linkGroup(group);
    linked += result.linked;
    reclaimed += result.reclaimed;
    failures.push(...(result.failures || []));
  }

  return { linked, reclaimed, failures };
}

/* ================================================================== */
/* Helpers                                                            */
/* ================================================================== */

// "…/Deep Cut/Samples/Imported/kick.wav" -> "Deep Cut"
function projectNameFor(filePath) {
  const parts = path.resolve(filePath).split(path.sep);
  const index = parts.findIndex((part) => part.toLowerCase() === 'samples');
  return index > 0 ? parts[index - 1] : path.basename(path.dirname(filePath));
}

module.exports = { findDuplicates, linkGroups, findImportedFolders, COPY_LOCATIONS };
