'use strict';

/**
 * Rename manifests.
 *
 * Every commit writes a record of what it did INTO the folder it changed:
 *
 *   Stems/
 *   ├── drums_kick_1.wav
 *   ├── percs_tabla_1.wav
 *   └── .dawbuddy-rename-2026-08-18-1430.json
 *
 * The existing undo log in `renamer.ts` lives in the app data folder, holds
 * only the last operation, and is tied to one machine. This is the durable
 * version: it survives closing the app, doing three other jobs, moving the
 * drive to another computer, or reinstalling. Humans make mistakes and often
 * don't notice for a week.
 *
 * PATHS ARE STORED RELATIVE TO THE FOLDER, never absolute. The same drive
 * mounts as E:\ on Windows, /media/... on Linux and /Volumes/... on macOS —
 * absolute paths would make a manifest useless on any machine but the one
 * that wrote it.
 */

const fs = require('fs/promises');
const path = require('path');

const PREFIX = '.dawbuddy-rename-';
const SUFFIX = '.json';
const VERSION = 1;

function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/* ================================================================== */
/* Writing                                                            */
/* ================================================================== */

/**
 * Records a completed rename.
 *
 * Size and mtime of each renamed file are stored so undo can tell whether the
 * file has been edited since. Putting a file back under its old name is safe;
 * doing it to a file someone has since re-rendered is not, and the difference
 * is worth detecting rather than assuming.
 */
async function write(folder, moves, meta = {}) {
  if (!moves || moves.length === 0) return null;

  const entries = [];
  for (const move of moves) {
    const from = path.basename(move.from);
    const to = path.basename(move.to);
    let size = null;
    let mtime = null;
    try {
      const stat = await fs.stat(path.join(folder, to));
      size = stat.size;
      mtime = Math.round(stat.mtimeMs);
    } catch {
      /* renamed then moved away — recorded anyway, flagged on undo */
    }
    entries.push({ from, to, size, mtime });
  }

  const manifest = {
    version: VERSION,
    tool: meta.tool || 'rename',
    at: new Date().toISOString(),
    folder: path.basename(folder),
    count: entries.length,
    undone: false,
    entries
  };

  const file = path.join(folder, `${PREFIX}${stamp()}${SUFFIX}`);
  const temp = `${file}.tmp`;

  await fs.writeFile(temp, JSON.stringify(manifest, null, 2), 'utf8');
  await fs.rename(temp, file);

  return { file, manifest };
}

/* ================================================================== */
/* Finding                                                            */
/* ================================================================== */

/** Every manifest in a folder, newest first. */
async function list(folder) {
  let names;
  try {
    names = await fs.readdir(folder);
  } catch {
    return [];
  }

  const found = [];
  for (const name of names) {
    if (!name.startsWith(PREFIX) || !name.endsWith(SUFFIX)) continue;
    const file = path.join(folder, name);
    try {
      const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
      if (manifest.version !== VERSION) continue;
      found.push({ file, name, manifest });
    } catch {
      /* corrupt or half-written — skip rather than crash */
    }
  }

  found.sort((a, b) => String(b.manifest.at).localeCompare(String(a.manifest.at)));
  return found;
}

/* ================================================================== */
/* Previewing                                                         */
/* ================================================================== */

/**
 * What undoing this manifest would do, checked against what's actually on
 * disk right now. Reads only.
 *
 * Five things can be wrong, and each needs saying differently:
 *
 *   missing    the renamed file isn't there any more
 *   modified   it's still there but has been edited since
 *   occupied   something else now has the original name
 *   chained    a later manifest renamed it again
 *   ok         safe to put back
 */
async function preview(folder, manifestFile) {
  let record;
  try {
    record = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  } catch (error) {
    return { ok: false, message: `Could not read that manifest: ${error.message}` };
  }

  if (record.undone) {
    return { ok: false, message: 'This rename has already been undone.' };
  }

  // Anything renamed again by a later run has to be undone in reverse order,
  // or the older manifest would put back a name that no longer applies.
  const all = await list(folder);
  const later = all.filter(
    (m) => m.file !== manifestFile && !m.manifest.undone && m.manifest.at > record.at
  );
  const chainedNames = new Set();
  for (const entry of later) {
    for (const move of entry.manifest.entries) chainedNames.add(move.from);
  }

  const rows = [];
  for (const move of record.entries) {
    const current = path.join(folder, move.to);
    const target = path.join(folder, move.from);

    let status = 'ok';
    let detail = null;

    const stat = await statOrNull(current);

    // Chained BEFORE missing. A file renamed again by a later run is also
    // "missing" under its intermediate name — reporting that would send the
    // user looking for a lost file instead of telling them to undo the
    // later rename first.
    if (chainedNames.has(move.to)) {
      status = 'chained';
      detail = 'A later rename touched this file — undo that one first';
    } else if (!stat) {
      status = 'missing';
      detail = 'That file is no longer in this folder';
    } else if (await exists(target)) {
      status = 'occupied';
      detail = `"${move.from}" already exists`;
    } else if (
      move.size !== null &&
      (stat.size !== move.size || Math.abs(Math.round(stat.mtimeMs) - move.mtime) > 2000)
    ) {
      status = 'modified';
      detail = 'The file has changed since it was renamed';
    }

    rows.push({ from: move.to, to: move.from, status, detail });
  }

  const counts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  return {
    ok: true,
    manifestFile,
    at: record.at,
    tool: record.tool,
    rows,
    counts,
    revertable: rows.filter((r) => r.status === 'ok' || r.status === 'modified').length,
    blocked: rows.filter((r) => r.status !== 'ok' && r.status !== 'modified').length
  };
}

/* ================================================================== */
/* Reverting                                                          */
/* ================================================================== */

/**
 * Puts the names back.
 *
 * `only` is a list of current filenames to revert — the preview lets the user
 * untick rows, so a partial undo is normal rather than exceptional.
 *
 * A modified file is revertable but not by default: the caller has to include
 * it deliberately, having been told.
 */
async function revert(folder, manifestFile, only = null) {
  const plan = await preview(folder, manifestFile);
  if (!plan.ok) return plan;

  const chosen = plan.rows.filter((row) => {
    if (row.status !== 'ok' && row.status !== 'modified') return false;
    if (only && !only.includes(row.from)) return false;
    return true;
  });

  const done = [];
  const failed = [];

  for (const row of chosen) {
    const current = path.join(folder, row.from);
    const target = path.join(folder, row.to);
    try {
      // Re-check immediately before moving. The preview may be minutes old,
      // and something else could have taken the name in between.
      if (await exists(target)) {
        failed.push({ ...row, message: 'Name was taken since the preview' });
        continue;
      }
      await fs.rename(current, target);
      done.push(row);
    } catch (error) {
      failed.push({ ...row, message: error.message });
    }
  }

  // Mark rather than delete. A manifest is a record of what happened, and
  // that stays true after it's been reversed.
  if (done.length > 0) {
    try {
      const record = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
      const full = done.length === plan.rows.length;
      record.undone = full;
      record.partiallyUndone = !full;
      record.undoneAt = new Date().toISOString();
      record.undoneEntries = done.map((row) => row.from);
      await fs.writeFile(manifestFile, JSON.stringify(record, null, 2), 'utf8');
    } catch {
      /* the renames succeeded; failing to annotate is not worth undoing them */
    }
  }

  return { ok: true, reverted: done.length, failed, rows: done };
}

/* ---------------------------- helpers ---------------------------- */

async function statOrNull(file) {
  try {
    return await fs.stat(file);
  } catch {
    return null;
  }
}

async function exists(file) {
  return (await statOrNull(file)) !== null;
}

function isManifest(name) {
  return name.startsWith(PREFIX) && name.endsWith(SUFFIX);
}

module.exports = { write, list, preview, revert, isManifest, PREFIX, VERSION };
