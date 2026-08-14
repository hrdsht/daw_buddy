'use strict';

/**
 * Bulk renaming, built around one rule: nothing is renamed until you've seen
 * exactly what will happen.
 *
 * plan()  works out every old → new pair and flags problems. Touches nothing.
 * apply() carries out a plan and writes an undo log.
 * undo()  puts the last operation back.
 *
 * Collisions are the thing that eats files: if two different sources end up
 * with the same new name, the second overwrites the first and the original is
 * gone. plan() finds those before anything is written.
 */

const fs = require('fs/promises');
const path = require('path');

const OPERATIONS = [
  'removeAndAdd',
  'removeText',
  'replaceText',
  'addPrefix',
  'addSuffix',
  'removeProjectName',
  'numberSequence'
];

async function listFiles(dir, extensions) {
  const wanted = new Set(
    (extensions || []).map((e) => e.toLowerCase().replace(/^\.?/, '.'))
  );

  let contents;
  try {
    contents = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Cannot read that folder: ${err.message}`);
  }

  const files = [];
  for (const entry of contents) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (wanted.size > 0 && !wanted.has(ext)) continue;
    files.push({ name: entry.name, path: path.join(dir, entry.name) });
  }

  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return files;
}

/**
 * options: { operation, find, replace, text, projectName, startAt, padTo,
 *            includeExtension }
 */
function plan(files, options) {
  const seen = new Map();
  const rows = files.map((file, index) => {
    const ext = path.extname(file.name);
    const stem = options.includeExtension
      ? file.name
      : file.name.slice(0, file.name.length - ext.length);

    let next = transform(stem, options, index);
    next = sanitise(next);

    const newName = options.includeExtension ? next : `${next}${ext}`;
    const row = {
      path: file.path,
      from: file.name,
      to: newName,
      changed: newName !== file.name,
      problem: null
    };

    if (newName.trim() === '' || newName === ext) {
      row.problem = 'Would leave an empty name';
    }

    const key = newName.toLowerCase();
    if (seen.has(key)) {
      row.problem = `Same new name as "${seen.get(key)}"`;
    } else {
      seen.set(key, file.name);
    }

    return row;
  });

  return {
    rows,
    changing: rows.filter((r) => r.changed && !r.problem).length,
    problems: rows.filter((r) => r.problem).length
  };
}

function transform(stem, options, index) {
  switch (options.operation) {
    /**
     * The main one: strip a string out, and put a string on the front or the
     * back. Prefix and suffix are an either-or — never both at once.
     *
     * Added text is literal, no separator inserted. Prefix "MIX" on
     * "Vocals_01" gives "MIXVocals_01". Want the underscore, type "MIX_".
     * Predictable beats clever.
     */
    case 'removeAndAdd': {
      let out = options.remove ? splitJoin(stem, options.remove, '') : stem;
      out = out.trim();
      const add = options.add || '';
      if (!add) return out;
      return options.position === 'suffix' ? `${out}${add}` : `${add}${out}`;
    }

    case 'removeText':
      return options.find ? splitJoin(stem, options.find, '') : stem;

    case 'replaceText':
      return options.find
        ? splitJoin(stem, options.find, options.replace || '')
        : stem;

    case 'addPrefix':
      return `${options.text || ''}${stem}`;

    case 'addSuffix':
      return `${stem}${options.text || ''}`;

    // "Suraag_Lead Synth_03" → "Lead Synth_03". Removes the project name and
    // whatever separator follows it, wherever in the name it appears.
    case 'removeProjectName': {
      const name = options.projectName || '';
      if (!name) return stem;
      let out = splitJoin(stem, name, '');
      out = out.replace(/^[\s_\-–—]+/, '').replace(/[\s_\-–—]+$/, '');
      return out.replace(/[\s_-]{2,}/g, '_');
    }

    case 'numberSequence': {
      const start = Number(options.startAt) || 1;
      const pad = Number(options.padTo) || 2;
      const n = String(start + index).padStart(pad, '0');
      return `${stem}_${n}`;
    }

    default:
      return stem;
  }
}

// Plain text search, not a regex — a project called "Track (Final)" would
// otherwise be interpreted as a pattern and match nothing.
function splitJoin(haystack, needle, replacement) {
  if (!needle) return haystack;
  return haystack.split(needle).join(replacement);
}

// Characters Windows refuses in filenames. macOS is more relaxed, but a name
// that works on one machine and not the other is worse than a strict rule.
function sanitise(name) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim();
}

async function apply(planned, undoLogPath) {
  const doing = planned.rows.filter((r) => r.changed && !r.problem);
  const done = [];
  const failed = [];

  for (const row of doing) {
    const target = path.join(path.dirname(row.path), row.to);
    try {
      // Refuse to clobber a file that already exists and isn't ours.
      try {
        await fs.access(target);
        failed.push({ ...row, message: 'A file with that name already exists' });
        continue;
      } catch {
        /* good — nothing there */
      }

      await fs.rename(row.path, target);
      done.push({ from: row.path, to: target });
    } catch (err) {
      failed.push({ ...row, message: err.message });
    }
  }

  if (done.length > 0 && undoLogPath) {
    await fs.writeFile(
      undoLogPath,
      JSON.stringify({ at: new Date().toISOString(), moves: done }, null, 2),
      'utf8'
    );
  }

  return { renamed: done.length, failed };
}

async function undo(undoLogPath) {
  let log;
  try {
    log = JSON.parse(await fs.readFile(undoLogPath, 'utf8'));
  } catch {
    return { reverted: 0, failed: [], message: 'Nothing to undo' };
  }

  const failed = [];
  let reverted = 0;

  for (const move of log.moves.slice().reverse()) {
    try {
      await fs.rename(move.to, move.from);
      reverted += 1;
    } catch (err) {
      failed.push({ from: move.to, to: move.from, message: err.message });
    }
  }

  await fs.writeFile(undoLogPath, JSON.stringify({ moves: [] }, null, 2), 'utf8');
  return { reverted, failed };
}

module.exports = { listFiles, plan, apply, undo, OPERATIONS };
