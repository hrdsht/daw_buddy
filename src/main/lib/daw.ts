'use strict';

/**
 * One place that knows about DAW file formats. Everything else — the scanner,
 * the UI — asks this module rather than checking extensions itself.
 *
 * Each format declares:
 *   ext          the file extension
 *   name         what to show the user
 *   isPackage    true when the "file" is actually a folder (Logic)
 *   readTempo    async (path) -> { bpm, error }
 *   isBackup     (filename, siblings) -> true if this is a backup, not a session
 *   countBackups async (projectPath, sessionPath) -> number
 */

const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gunzip = promisify(zlib.gunzip);
const zip = require('./zipreader');

/* ================================================================== */
/* Ableton — .als, gzipped XML                                        */
/* ================================================================== */

async function readAbletonTempo(filePath) {
  let xml;
  try {
    const raw = await fs.readFile(filePath);
    // Gzip always starts 0x1f 0x8b. A few sets are plain XML.
    xml =
      raw[0] === 0x1f && raw[1] === 0x8b
        ? (await gunzip(raw)).toString('utf8')
        : raw.toString('utf8');
  } catch (err) {
    return { bpm: null, error: `Could not read set: ${err.message}` };
  }

  const modern = xml.match(/<Tempo>[\s\S]{0,400}?<Manual Value="([\d.]+)"/);
  if (modern) return { bpm: round2(parseFloat(modern[1])) };

  const legacy = xml.match(/<CurrentTempo[^>]*Value="([\d.]+)"/);
  if (legacy) return { bpm: round2(parseFloat(legacy[1])) };

  return { bpm: null, error: 'No tempo tag found' };
}

async function countAbletonBackups(projectPath) {
  return countFilesIn(path.join(projectPath, 'Backup'));
}

/* ================================================================== */
/* FL Studio — .flp, binary event stream                              */
/* ================================================================== */

const EVT_TEMPO_OLD = 66; // 2 byte, whole BPM
const EVT_TEMPO_FINE = 156; // 4 byte, BPM * 1000

async function readFlpTempo(filePath) {
  let buf;
  try {
    buf = await fs.readFile(filePath);
  } catch (err) {
    return { bpm: null, error: `Could not read project: ${err.message}` };
  }

  if (buf.length < 16 || buf.toString('ascii', 0, 4) !== 'FLhd') {
    return { bpm: null, error: 'Not a recognisable FL project' };
  }

  let pos = 8 + buf.readUInt32LE(4);
  if (buf.toString('ascii', pos, pos + 4) !== 'FLdt') {
    return { bpm: null, error: 'FL data chunk missing' };
  }

  const end = Math.min(pos + 8 + buf.readUInt32LE(pos + 4), buf.length);
  pos += 8;

  let fallback = null;

  while (pos < end) {
    const id = buf[pos];
    pos += 1;

    if (id < 64) {
      pos += 1;
    } else if (id < 128) {
      if (pos + 2 > end) break;
      const value = buf.readUInt16LE(pos);
      pos += 2;
      if (id === EVT_TEMPO_OLD && fallback === null) fallback = value;
    } else if (id < 192) {
      if (pos + 4 > end) break;
      const value = buf.readUInt32LE(pos);
      pos += 4;
      if (id === EVT_TEMPO_FINE) return { bpm: round2(value / 1000) };
    } else {
      let length = 0;
      let shift = 0;
      let byte;
      do {
        if (pos >= end) return finishFlp(fallback, buf);
        byte = buf[pos];
        pos += 1;
        length |= (byte & 0x7f) << shift;
        shift += 7;
      } while (byte & 0x80);
      pos += length;
    }
  }

  return finishFlp(fallback, buf);
}

function finishFlp(fallback, buf) {
  if (fallback !== null) return { bpm: fallback };

  // The sequential walk found nothing. On FL 26 that's expected — see below.
  const scanned = scanFlpTempo(buf);
  if (scanned !== null) return { bpm: scanned };

  return { bpm: null, error: 'No tempo event found' };
}

/**
 * Fallback: scan the first few KB for a tempo event directly.
 *
 * Why this exists. The event walk above implements the classic FLP rules —
 * ids 0-63 carry one byte, 64-127 two, 128-191 four, 192+ a varint length
 * then that many bytes. On FL Studio 26 that is no longer accurate. Traced
 * against a real 26.1.3 project:
 *
 *     @  46 id= 28  byte  1
 *     @  48 id=172  dword 3221225729   <- 0xC0000101, wrong
 *     @  53 id= 54  byte  70           <- now reading "FL Studio" as events
 *
 * Event 172 is read as a 4-byte event and swallows the 0xC0 that begins the
 * next event. Every offset after that is wrong, and the walk marches through
 * the whole file without ever landing on the tempo — which in that file sat
 * at byte 128 and read 140 BPM.
 *
 * Rather than guess which ids changed size and risk confidently wrong tempos,
 * we look directly for event 156 followed by a plausible value.
 *
 * Bounded to the header region on purpose: project settings live near the
 * top, and scanning the whole file turns up event-66 lookalikes inside
 * pattern data that would produce nonsense like 368 BPM.
 */
function scanFlpTempo(buf, limit = 8192) {
  if (!buf) return null;
  const end = Math.min(buf.length - 5, limit);

  for (let i = 22; i < end; i += 1) {
    if (buf[i] !== EVT_TEMPO_FINE) continue;
    const value = buf.readUInt32LE(i + 1);
    // Milli-BPM, so 20-400 BPM.
    if (value >= 20000 && value <= 400000) return round2(value / 1000);
  }
  return null;
}

/**
 * FL writes its backups IN THE PROJECT FOLDER, not in a Backup subfolder:
 *
 *   Align yogi.flp
 *   Align yogi (autosaved on 06-08-2026 at 17h06).flp
 *   Maniac remix (overwritten on 04-08-2026 at 13h41).flp
 *
 * These are newer than the real session, so treating them as sessions meant
 * reading BPM and dates off an autosave. They're backups — and counting them
 * finally gives FL projects a working health bar.
 */
const FL_BACKUP = /\((?:autosaved|overwritten)\b[^)]*\)\s*$/i;

function isFlBackup(filename) {
  const stem = filename.replace(/\.[^.]+$/, '');
  return FL_BACKUP.test(stem);
}

/**
 * FL puts backups in BOTH places, which an earlier version got wrong.
 *
 *   Reel alignment ai voice/
 *   ├── Reel alignment ai voice.flp
 *   └── Backup/
 *       ├── ...(autosaved on 10-08-2026 at 9h46).flp
 *       └── ...(overwritten on 10-08-2026 at 12h59).flp
 *
 * A Backup subfolder exactly like Ableton, and sometimes autosave siblings
 * next to the project as well. Count both.
 */
async function countFlBackups(projectPath) {
  const inFolder = await countFilesIn(path.join(projectPath, 'Backup'));

  let siblings = 0;
  try {
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    siblings = entries.filter(
      (entry) =>
        entry.isFile() &&
        path.extname(entry.name).toLowerCase() === '.flp' &&
        isFlBackup(entry.name)
    ).length;
  } catch {
    siblings = 0;
  }

  return inFolder + siblings;
}

/* ================================================================== */
/* REAPER — .rpp, plain text                                          */
/* ================================================================== */

/**
 * The easy one. An .rpp is human-readable — open it in Notepad and you can
 * read the whole session. Tempo sits near the top:  TEMPO 128 4 4
 */
async function readReaperTempo(filePath) {
  try {
    // The tempo is in the first few lines; no need to read a 40MB project.
    const handle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(buffer, 0, 65536, 0);
    await handle.close();

    const head = buffer.toString('utf8', 0, bytesRead);
    const match = head.match(/^\s*TEMPO\s+([\d.]+)/m);
    if (match) return { bpm: round2(parseFloat(match[1])) };
    return { bpm: null, error: 'No TEMPO line found' };
  } catch (err) {
    return { bpm: null, error: `Could not read project: ${err.message}` };
  }
}

/** REAPER writes .rpp-bak files alongside the project. */
async function countReaperBackups(projectPath, sessionPath) {
  let entries;
  try {
    entries = await fs.readdir(projectPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  const stem = sessionPath
    ? path.basename(sessionPath, '.rpp').toLowerCase()
    : null;
  return entries.filter((entry) => {
    if (!entry.isFile()) return false;
    const lower = entry.name.toLowerCase();
    if (!lower.endsWith('.rpp-bak')) return false;
    return stem ? lower.startsWith(stem) : true;
  }).length;
}

/* ================================================================== */
/* Bitwig Studio — .bwproject, proprietary project container          */
/* ================================================================== */

/**
 * Bitwig documents the .bwproject extension and project-folder layout, but
 * not the project file's internal schema. List and open the project safely;
 * do not invent a tempo parser that could return a convincing wrong value.
 * A render can still be analysed for BPM/key through the player.
 */
async function readBitwigTempo(filePath) {
  try {
    const handle = await fs.open(filePath, 'r');
    await handle.close();
    return { bpm: null, error: 'Bitwig tempo not readable yet' };
  } catch (err) {
    return { bpm: null, error: `Could not read project: ${err.message}` };
  }
}

/**
 * Bitwig keeps recent copies in auto-backup/ and version-migration copies in
 * auto-backup/versions/. The scanner skips that tree so these count toward
 * project health without appearing as separate projects.
 */
async function countBitwigBackups(projectPath) {
  const backupRoot = path.join(projectPath, 'auto-backup');
  const folders = [backupRoot, path.join(backupRoot, 'versions')];
  let total = 0;

  for (const folder of folders) {
    try {
      const entries = await fs.readdir(folder, { withFileTypes: true });
      total += entries.filter(
        (entry) =>
          entry.isFile() &&
          path.extname(entry.name).toLowerCase() === '.bwproject'
      ).length;
    } catch {
      /* folder is optional */
    }
  }

  return total;
}

/* ================================================================== */
/* Pro Tools — .ptx, proprietary session file                         */
/* ================================================================== */

/**
 * Avid documents .ptx as the current session extension, but does not publish
 * a schema suitable for a trustworthy tempo parser. List and open sessions;
 * use render analysis for BPM and key until real files prove a parser.
 */
async function readProToolsTempo(filePath) {
  try {
    const handle = await fs.open(filePath, 'r');
    await handle.close();
    return { bpm: null, error: 'Pro Tools tempo not readable yet' };
  } catch (err) {
    return { bpm: null, error: `Could not read session: ${err.message}` };
  }
}

/** Pro Tools writes incremental .ptx copies to Session File Backups/. */
async function countProToolsBackups(projectPath) {
  try {
    const entries = await fs.readdir(
      path.join(projectPath, 'Session File Backups'),
      { withFileTypes: true }
    );
    return entries.filter(
      (entry) =>
        entry.isFile() && path.extname(entry.name).toLowerCase() === '.ptx'
    ).length;
  } catch {
    return 0;
  }
}

/* ================================================================== */
/* Fender Studio Pro (was Studio One) — .song, a zip container        */
/* ================================================================== */

/**
 * A .song is a zip. We list what's inside and look through the small text-ish
 * entries for a tempo value.
 *
 * Being straight about this one: the internal layout isn't published and I've
 * had no real .song file to check against. The search below covers the shapes
 * these formats usually take, but if it comes back empty that's expected —
 * the project still lists with everything except BPM.
 */
async function readStudioOneTempo(filePath) {
  let buf;
  try {
    buf = await fs.readFile(filePath);
  } catch (err) {
    return { bpm: null, error: `Could not read song: ${err.message}` };
  }

  const entries = zip.listEntries(buf);
  if (!entries) return { bpm: null, error: 'Not a readable .song container' };

  const candidates = entries
    .filter((entry) => entry.size > 0 && entry.size < 4 * 1024 * 1024)
    .filter((entry) => !/\.(wav|aiff|flac|mp3|png|jpg)$/i.test(entry.name))
    .slice(0, 40);

  for (const entry of candidates) {
    const data = zip.readEntry(buf, entry);
    if (!data) continue;
    const text = data.toString('utf8');

    const patterns = [
      /["']?[Tt]empo["']?\s*[=:]\s*["']?([\d.]+)/,
      /<Tempo[^>]*[Vv]alue\s*=\s*"([\d.]+)"/,
      /name\s*=\s*"[Tt]empo"[^>]*value\s*=\s*"([\d.]+)"/
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const bpm = parseFloat(match[1]);
      // Sanity check: a real tempo, not some unrelated number that
      // happened to sit next to the word "tempo".
      if (bpm >= 20 && bpm <= 400) return { bpm: round2(bpm) };
    }
  }

  return { bpm: null, error: 'Tempo not found in this .song' };
}

/* ================================================================== */
/* Cubase — .cpr, undocumented binary                                 */
/* ================================================================== */

/**
 * No published spec, and the layout changes between Cubase versions. Rather
 * than guess at byte offsets and hand back a confident wrong number, this
 * reports nothing and lets everything else work.
 *
 * If you supply a few .cpr files along with their real tempos, a byte pattern
 * can be found and dropped in here — the rest of the app needs no changes.
 */
async function readCubaseTempo(filePath) {
  try {
    const handle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(64);
    await handle.read(buffer, 0, 64, 0);
    await handle.close();
    // Just confirm it looks like a Cubase file so the row can say so.
    return { bpm: null, error: 'Cubase tempo not readable yet' };
  } catch (err) {
    return { bpm: null, error: `Could not read project: ${err.message}` };
  }
}

async function countCubaseBackups(projectPath) {
  let entries;
  try {
    entries = await fs.readdir(projectPath, { withFileTypes: true });
  } catch {
    return 0;
  }
  return entries.filter(
    (entry) => entry.isFile() && /\.bak$/i.test(entry.name)
  ).length;
}

/* ================================================================== */
/* Logic Pro — .logicx, a FOLDER pretending to be a file              */
/* ================================================================== */

/**
 * .logicx is a macOS package: a folder that Finder shows as one item. On
 * Windows it's simply a folder with a dot in the name.
 *
 * Inside:
 *   Alternatives/000/ProjectData    the project itself, undocumented binary
 *   Project File Backups/           the health bar count
 *   Bounces/                        renders live in here, inside the package
 *
 * Tempo isn't readable for the same reason as Cubase. Everything else works,
 * including key detection — that reads audio, not project files.
 */
async function readLogicTempo(packagePath) {
  try {
    await fs.access(path.join(packagePath, 'Alternatives'));
    return { bpm: null, error: 'Logic tempo not readable yet' };
  } catch {
    return { bpm: null, error: 'Logic package looks incomplete' };
  }
}

async function countLogicBackups(packagePath) {
  const direct = await countFilesIn(
    path.join(packagePath, 'Project File Backups')
  );
  if (direct > 0) return direct;

  // Alternatives are Logic's other saved versions of the same project.
  try {
    const entries = await fs.readdir(path.join(packagePath, 'Alternatives'), {
      withFileTypes: true
    });
    return entries.filter((e) => e.isDirectory()).length;
  } catch {
    return 0;
  }
}

/* ================================================================== */
/* The registry                                                       */
/* ================================================================== */

/**
 * Bump a format's version when its parser changes. The cache stores this
 * alongside each parsed result, so fixing a parser invalidates only that
 * format's cached entries and leaves the others intact.
 *
 * Without this, fixing the FL parser would leave every wrong FL tempo cached
 * forever and it would look like the fix had failed.
 */
const PARSER_VERSIONS = {
  '.als': 2,
  '.flp': 3, // 3 = bounded-scan fallback for FL 26
  '.rpp': 1,
  '.bwproject': 1,
  '.ptx': 1,
  '.song': 1,
  '.cpr': 1,
  '.logicx': 1,
  '.logic': 1
};

const FORMATS = {
  '.als': {
    ext: '.als',
    name: 'Ableton',
    isPackage: false,
    readTempo: readAbletonTempo,
    isBackup: () => false,
    countBackups: countAbletonBackups
  },
  '.flp': {
    ext: '.flp',
    name: 'FL Studio',
    isPackage: false,
    readTempo: readFlpTempo,
    isBackup: isFlBackup,
    countBackups: countFlBackups
  },
  '.rpp': {
    ext: '.rpp',
    name: 'REAPER',
    isPackage: false,
    readTempo: readReaperTempo,
    isBackup: () => false,
    countBackups: countReaperBackups
  },
  '.bwproject': {
    ext: '.bwproject',
    name: 'Bitwig Studio',
    isPackage: false,
    readTempo: readBitwigTempo,
    isBackup: () => false,
    countBackups: countBitwigBackups
  },
  '.ptx': {
    ext: '.ptx',
    name: 'Pro Tools',
    isPackage: false,
    readTempo: readProToolsTempo,
    isBackup: () => false,
    countBackups: countProToolsBackups
  },
  '.song': {
    ext: '.song',
    name: 'Fender Studio Pro',
    isPackage: false,
    readTempo: readStudioOneTempo,
    isBackup: () => false,
    countBackups: async (projectPath) =>
      countFilesIn(path.join(projectPath, 'History'))
  },
  '.cpr': {
    ext: '.cpr',
    name: 'Cubase',
    isPackage: false,
    readTempo: readCubaseTempo,
    isBackup: (filename) => /\.bak$/i.test(filename),
    countBackups: countCubaseBackups
  },
  '.logicx': {
    ext: '.logicx',
    name: 'Logic Pro',
    isPackage: true,
    readTempo: readLogicTempo,
    isBackup: () => false,
    countBackups: countLogicBackups
  },
  '.logic': {
    ext: '.logic',
    name: 'Logic Pro',
    isPackage: true,
    readTempo: readLogicTempo,
    isBackup: () => false,
    countBackups: countLogicBackups
  }
};

const SESSION_EXTENSIONS = new Set(Object.keys(FORMATS));
const PACKAGE_EXTENSIONS = new Set(
  Object.values(FORMATS)
    .filter((f) => f.isPackage)
    .map((f) => f.ext)
);

function formatFor(name) {
  return FORMATS[path.extname(name).toLowerCase()] || null;
}

function isSessionFile(name) {
  return SESSION_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/** True for a folder that is really a project — Logic's .logicx. */
function isSessionPackage(name) {
  return PACKAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/** True when this file is a DAW's own backup rather than a session. */
function isBackupFile(name) {
  const format = formatFor(name);
  return format ? Boolean(format.isBackup(name)) : false;
}

/* ---------------------------- helpers ---------------------------- */

async function countFilesIn(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && !e.name.startsWith('.')).length;
  } catch {
    return 0;
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function parserVersion(name) {
  return PARSER_VERSIONS[path.extname(name).toLowerCase()] || 0;
}

module.exports = {
  FORMATS,
  PARSER_VERSIONS,
  parserVersion,
  formatFor,
  isSessionFile,
  isSessionPackage,
  isBackupFile,
  SESSION_EXTENSIONS,
  PACKAGE_EXTENSIONS
};
