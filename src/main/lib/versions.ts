'use strict';

/**
 * Collapses session files that are versions of one piece of work.
 *
 *   Nava bharat jodo 4                  ┐
 *   Nava bharat jodo 3                  │
 *   Nava bharat jodo 3 bounced_3        │  seven rows for
 *   Nava bharat jodo 3 bounced_2        ├─ one piece of work
 *   Nava bharat jodo 3 bounced          │
 *   Nava bharat jodo 2                  │
 *   Nava bharat jodo                    ┘
 *
 * THE SAFEGUARD THAT MAKES THIS SAFE:
 *
 * A name is only shortened when the result matches a sibling in the same
 * folder. Stripping blindly would turn a project genuinely called "Studio 54"
 * into "Studio", and a one-off named "Take 2" into "Take". Grouping happens
 * only where there is evidence for it — a file with no siblings always keeps
 * its full name.
 *
 * Same folder only, deliberately. "Adi - Kannamaniye" and "Adi - Kanmaniye"
 * live in different folders under different DAWs; one is a typo of the other.
 * Matching across folders would merge those, and worse things besides. Folder
 * boundaries carry real intent.
 *
 * This is a DISPLAY concern. Records stay keyed on the session file path, so
 * every version keeps its own note, its own key and its own renders.
 */

// Words that mark a state rather than a different piece of work.
const STATE_WORDS = [
  'bounced',
  'bounce',
  'final',
  'finale',
  'master',
  'mastered',
  'mixdown',
  'mixed',
  'mix',
  'export',
  'exported',
  'rough',
  'edit',
  'wip',
  'copy',
  'new',
  'old',
  'backup',
  'temp'
];

const TRAILING_NUMBER = /[ _.\-]*v?\d+$/i;

/**
 * Peel one layer off the end of a name. Returns null when there's nothing
 * left to remove.
 */
function peel(name) {
  const trimmed = name.trim();

  // A trailing number or version marker: "3", "_2", "v4"
  const numbered = trimmed.replace(TRAILING_NUMBER, '').trim();
  if (numbered !== trimmed && numbered.length > 0) return numbered;

  // A trailing state word
  const lower = trimmed.toLowerCase();
  for (const word of STATE_WORDS) {
    const pattern = new RegExp(`[ _.\\-]+${word}$`, 'i');
    if (pattern.test(lower)) {
      const stripped = trimmed.replace(pattern, '').trim();
      if (stripped.length > 0) return stripped;
    }
  }

  return null;
}

/** Every progressively shorter form of a name, longest first. */
function stems(name) {
  const out = [name.trim()];
  let current = name.trim();

  for (let i = 0; i < 8; i += 1) {
    const next = peel(current);
    if (!next || next === current) break;
    out.push(next);
    current = next;
  }
  return out;
}

function flatten(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Groups entries that share a folder and reduce to a common stem.
 *
 * Returns display rows: a lone entry stays a plain row, a group becomes one
 * row carrying its members.
 */
function effectiveModified(entry) {
  return Math.max(entry.modified || 0, entry.renderModified || 0, entry.lastActivity || 0);
}

function groupVersions(entries) {
  const byFolder = new Map();

  for (const entry of entries) {
    const key = (entry.folder || '').toLowerCase();
    if (!byFolder.has(key)) byFolder.set(key, []);
    byFolder.get(key).push(entry);
  }

  const rows = [];

  for (const group of byFolder.values()) {
    if (group.length === 1) {
      rows.push(asRow(group[0]));
      continue;
    }

    // Every name each file could reduce to, and how many files in this
    // folder can reach each one.
    const reach = new Map();

    for (const entry of group) {
      for (const stem of stems(entry.name)) {
        const flat = flatten(stem);
        if (flat.length < 3) continue;
        if (!reach.has(flat)) reach.set(flat, { label: stem, members: new Set() });
        reach.get(flat).members.add(entry);
        // Keep the shortest spelling seen for this stem as the label.
        if (stem.length < reach.get(flat).label.length) reach.get(flat).label = stem;
      }
    }

    // Prefer stems covering the most files; break ties on the longer, more
    // specific name so "Nava bharat jodo" wins over "Nava".
    const candidates = [...reach.entries()]
      .filter(([, info]) => info.members.size > 1)
      .sort((a, b) => {
        if (b[1].members.size !== a[1].members.size) {
          return b[1].members.size - a[1].members.size;
        }
        return b[0].length - a[0].length;
      });

    const claimed = new Set();

    for (const [, info] of candidates) {
      const members = [...info.members].filter((entry) => !claimed.has(entry));
      if (members.length < 2) continue;

      members.forEach((entry) => claimed.add(entry));
      members.sort((a, b) => effectiveModified(b) - effectiveModified(a));
      rows.push(asGroup(info.label, members));
    }

    group.filter((entry) => !claimed.has(entry)).forEach((entry) => rows.push(asRow(entry)));
  }

  rows.sort((a, b) => effectiveModified(b) - effectiveModified(a));
  return rows;
}

function asRow(entry) {
  return {
    ...entry,
    isGroup: false,
    versions: [entry],
    versionCount: 1
  };
}

/**
 * The group row borrows the newest member's numbers — that's the version you
 * last worked on, so it's the one the date and tempo should describe.
 */
function asGroup(label, members) {
  const newest = members[0];

  return {
    ...newest,
    name: label,
    isGroup: true,
    versions: members,
    versionCount: members.length,
    modified: Math.max(...members.map((entry) => entry.modified || 0)),
    renderModified: Math.max(...members.map((entry) => entry.renderModified || 0)),
    lastActivity: Math.max(...members.map(effectiveModified)),
    // Any version having audio is enough to light the Play button.
    audioCount: members.reduce((sum, entry) => sum + (entry.audioCount || 0), 0),
    backupCount: Math.max(...members.map((entry) => entry.backupCount || 0)),
    health: Math.max(...members.map((entry) => entry.health || 0))
  };
}

module.exports = { groupVersions, stems, peel, STATE_WORDS };
