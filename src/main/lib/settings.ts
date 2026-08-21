'use strict';

/**
 * Everything the app remembers between launches lives here, in settings.json.
 *
 * Version 0.1 stored a single "rootPath". Version 0.2 stores a "roots" array.
 * load() quietly upgrades the old shape so you don't lose your folder when
 * you update the app.
 */

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  roots: [],
  alwaysOnTop: false,

  // How the project list is ordered, remembered between sessions.
  // `by` is one of: modified, name, bpm, key, saves, audio, favourite, notes.
  listSort: { by: 'modified', dir: -1 },

  // A Discord/Slack/Zapier webhook URL. When set, a new bounce POSTs a
  // notification to it. Empty means no webhook — nothing leaves the machine.
  webhookUrl: '',
  // Ask the disk repeatedly instead of waiting to be told. Slower and more
  // CPU, but network shares and some external drives never send the events
  // the fast method relies on.
  pollWatching: false,

  // A .lnk is an ordinary file and can't loop a scan — readdir never reports
  // it as a folder. What CAN loop a scan is a junction or symlink, which
  // appears as a real directory and might point at its own parent. Off by
  // default covers both.
  followLinks: false,

  // Where processed audio is written. Created on first run inside the first
  // project root, and added to the skip list so the app never scans its own
  // output back in as renders.
  outputFolder: null,
  // Crash logging & diagnostics preference
  enableCrashLogs: true,
  // Graphics & Animation Scale (Android-style snappy animation speed)
  reducedAnimation: false,
  animationScale: 1.0,
  // Regional and World Scales preferences
  region: 'indian',
  scaleTraditions: ['all'],
  regionSetupComplete: false,
  // Folder names that are never a project, and are never descended into.
  ignore: [
    'Backup',
    'Samples',
    'Bounces',
    'Renders',
    'Freeze',
    'Recorded',
    'Ableton Project Info',
    'node_modules'
  ]
};

class Settings {
  filePath: string;
  data: ReturnType<typeof freshDefaults> & Record<string, any>;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = freshDefaults();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.data = { ...freshDefaults(), ...raw };

      // Upgrade from the old single-folder format.
      if (raw.rootPath) {
        if (!this.data.roots.includes(raw.rootPath)) {
          this.data.roots.unshift(raw.rootPath);
        }
        delete this.data.rootPath;
        this.save();
      }
    } catch {
      this.data = freshDefaults();
    }

    if (!Array.isArray(this.data.roots)) this.data.roots = [];
    if (!Array.isArray(this.data.ignore)) this.data.ignore = [...DEFAULTS.ignore];
    // Older versions had a manual depth setting. It's gone — the scan now
    // goes as deep as it needs to. Drop the leftover key rather than
    // carrying a dead field around forever.
    delete this.data.searchDepth;

    // Drop folders that have been deleted or unplugged since last launch.
    this.data.roots = this.data.roots.filter((root) => fs.existsSync(root));

    return this.get();
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(
        this.filePath,
        JSON.stringify(this.data, null, 2),
        'utf8'
      );
    } catch (err) {
      console.error('[settings] Could not save:', err.message);
    }
  }

  get() {
    return JSON.parse(JSON.stringify(this.data));
  }

  update(patch) {
    this.data = { ...this.data, ...patch };
    this.save();
    return this.get();
  }

  /**
   * Returns { added, reason } so the window can explain itself rather than
   * silently doing nothing.
   */
  addRoot(candidate) {
    const target = path.resolve(candidate);

    if (this.data.roots.some((root) => samePath(root, target))) {
      return { added: false, reason: 'That folder is already on the list.' };
    }

    const parent = this.data.roots.find((root) => isInside(target, root));
    if (parent) {
      return {
        added: false,
        reason: `Already covered by ${path.basename(parent)}. Adding it again would list every project twice.`
      };
    }

    // If the new folder sits above folders already on the list, the old ones
    // become redundant. Fold them in rather than scanning the same files twice.
    const swallowed = this.data.roots.filter((root) => isInside(root, target));
    this.data.roots = this.data.roots.filter((root) => !isInside(root, target));
    this.data.roots.push(target);
    this.save();

    return {
      added: true,
      reason: swallowed.length
        ? `Added. ${swallowed.length} folder(s) below it were merged in.`
        : null
    };
  }

  removeRoot(target) {
    this.data.roots = this.data.roots.filter((root) => !samePath(root, target));
    this.save();
    return this.get();
  }
}

function freshDefaults() {
  return {
    ...DEFAULTS,
    roots: [...DEFAULTS.roots],
    ignore: [...DEFAULTS.ignore]
  };
}

/**
 * Windows and macOS both treat "C:\Projects" and "c:\projects" as the same
 * folder; Linux does not. So we only lowercase paths before comparing them
 * on the platforms where that is actually true.
 */
const CASE_INSENSITIVE =
  process.platform === 'win32' || process.platform === 'darwin';

function samePath(a, b) {
  return normalise(a) === normalise(b);
}

function normalise(p) {
  const resolved = path.resolve(p);
  return CASE_INSENSITIVE ? resolved.toLowerCase() : resolved;
}

function isInside(child, parent) {
  const rel = path.relative(normalise(parent), normalise(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

module.exports = { Settings, DEFAULTS, isInside, samePath };
