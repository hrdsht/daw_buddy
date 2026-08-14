'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fsp = require('fs/promises');

const { scanRoots, scanFolder } = require('./lib/scanner');
const { ProjectStore } = require('./lib/notes');
const { NoteWriter } = require('./lib/notetext');
const { Settings, isInside } = require('./lib/settings');
const { startWatching, stopWatching } = require('./lib/watcher');
const media = require('./lib/media');
const renders = require('./lib/renders');
const { ParseCache } = require('./lib/cache');
const id3 = require('./lib/id3');
const renamer = require('./lib/renamer');
const dedupe = require('./lib/dedupe');
const procs = require('./lib/procs');

let mainWindow = null;
let store = null;
let settings = null;
let notes = null;
let cache = null;

const isMac = process.platform === 'darwin';
const dataDir = () => app.getPath('userData');
const undoLog = () => path.join(dataDir(), 'rename-undo.json');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#0d0d0e',
    alwaysOnTop: settings.get().alwaysOnTop,
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 22 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  settings = new Settings(path.join(dataDir(), 'settings.json'));
  settings.load();

  store = new ProjectStore(path.join(dataDir(), 'notes.json'));
  await store.load();

  cache = new ParseCache(path.join(dataDir(), 'cache.json'));
  await cache.load();

  await ensureOutputFolder();

  notes = new NoteWriter();
  notes.onRenamed = (sessionPath, newFile) => {
    store.set(sessionPath, { noteFile: newFile });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('note:renamed', { sessionPath, file: newFile });
    }
  };

  createWindow();
  restartWatcher();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopWatching();
  if (store) store.flush();
  if (cache) cache.save();
  if (!isMac) app.quit();
});

/**
 * Created on first run inside the first project root, and added to the skip
 * list straight away — otherwise the app scans its own output and processed
 * files start appearing as renders belonging to projects.
 */
async function ensureOutputFolder() {
  const current = settings.get();
  if (current.roots.length === 0) return null;

  let target = current.outputFolder;
  if (!target) target = path.join(current.roots[0], 'Project Browser Output');

  try {
    await fsp.mkdir(target, { recursive: true });
  } catch (err) {
    console.error('[output] Could not create output folder:', err.message);
    return null;
  }

  const patch = {};
  if (current.outputFolder !== target) patch.outputFolder = target;

  const folderName = path.basename(target);
  if (!current.ignore.some((n) => n.toLowerCase() === folderName.toLowerCase())) {
    patch.ignore = [...current.ignore, folderName];
  }
  if (Object.keys(patch).length > 0) settings.update(patch);

  return target;
}

function restartWatcher() {
  const current = settings.get();
  startWatching(
    current.roots,
    (bounce) => {
      // The hook for the email API later on. One event per render, however
      // many formats it arrived in.
      console.log(
        `[bounce] ${bounce.label} rendered in "${bounce.project}" (${bounce.formats.join(' + ')})`
      );
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('bounce:detected', bounce);
      }
    },
    { pollWatching: current.pollWatching }
  );
}

/**
 * Every path from the window is checked against the configured roots before
 * anything is read, renamed or rewritten. The window is not allowed to
 * nominate arbitrary folders — this matters more now that several of these
 * tools modify files.
 */
function withinRoots(target) {
  return settings
    .get()
    .roots.find((root) => target === root || isInside(target, root));
}

/**
 * The renamer can be pointed at any folder the user picked themselves — a
 * stems folder on another drive, say. A folder chosen through the OS dialog
 * is the user speaking directly, which is exactly what the root check exists
 * to distinguish from a path the window made up.
 */
const pickedFolders = new Set();

function guard(target) {
  if (!withinRoots(target)) {
    throw new Error('That folder is outside your project folders.');
  }
}

/* ---------------------------- settings ---------------------------- */

const platformInfo = () => ({
  platform: process.platform,
  isMac,
  fileManager: isMac ? 'Finder' : 'File Explorer'
});

const fullSettings = () => ({
  ...settings.get(),
  dataDir: dataDir(),
  ...platformInfo()
});

ipcMain.handle('settings:get', () => fullSettings());

ipcMain.handle('settings:update', (event, patch) => {
  const before = settings.get();
  const after = settings.update(patch);

  if (patch.alwaysOnTop !== undefined && mainWindow) {
    mainWindow.setAlwaysOnTop(after.alwaysOnTop);
  }
  if (
    JSON.stringify(before.roots) !== JSON.stringify(after.roots) ||
    before.pollWatching !== after.pollWatching
  ) {
    restartWatcher();
  }
  return fullSettings();
});

ipcMain.handle('settings:addRoot', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Add a projects folder',
    buttonLabel: 'Add folder',
    properties: ['openDirectory', 'multiSelections']
  });
  if (result.canceled) return { settings: fullSettings(), messages: [] };

  const messages = [];
  let changed = false;

  for (const folder of result.filePaths) {
    const outcome = settings.addRoot(folder);
    if (outcome.added) changed = true;
    if (outcome.reason) {
      messages.push(`${path.basename(folder)}: ${outcome.reason}`);
    }
  }

  if (changed) restartWatcher();
  return { settings: fullSettings(), messages };
});

ipcMain.handle('settings:removeRoot', (event, root) => {
  settings.removeRoot(root);
  restartWatcher();
  return fullSettings();
});

/* ---------------------------- scanning ---------------------------- */

ipcMain.handle('projects:scan', async () => {
  const current = settings.get();
  if (current.roots.length === 0) return { entries: [], errors: [], roots: [] };

  cache.resetCounters();

  const { entries, errors, truncated, foldersRead } = await scanRoots(
    current.roots,
    {
      ignore: current.ignore,
      followLinks: current.followLinks,
      cache
    }
  );

  cache.prune(entries.map((e) => e.sessionPath));
  await cache.save();

  return {
    entries,
    errors,
    truncated,
    foldersRead,
    roots: current.roots,
    cache: cache.stats()
  };
});

ipcMain.handle('projects:browse', async (event, target) => {
  const root = withinRoots(target);
  if (!root) {
    return {
      entries: [],
      errors: [{ root: target, message: 'That folder is outside your list.' }]
    };
  }

  const current = settings.get();
  const { entries, errors, truncated } = await scanFolder(target, root, {
    ignore: current.ignore,
    followLinks: current.followLinks,
    cache
  });
  return { entries, errors, truncated, root, browsing: target };
});

/* ----------------------------- records ---------------------------- */

ipcMain.handle('records:all', () => store.all());

ipcMain.handle('records:set', (event, key, patch) => store.set(key, patch));

ipcMain.handle('records:chooseStems', async (event, projectPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Where are the stems for this project?',
    buttonLabel: 'Use this folder',
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return store.set(projectPath, { stemsPath: result.filePaths[0] });
});

/* ------------------------------ notes ----------------------------- */

/**
 * Notes are keyed by session file, so each version of a project keeps its own.
 * The text file lives beside the project and is renamed as you edit.
 */
ipcMain.handle('notes:load', async (event, sessionPath) => {
  const record = store.get(sessionPath);

  // If the app lost track of the file — moved machine, edited by hand — go
  // and look for it rather than starting a second one.
  let file = record.noteFile;
  if (!file) file = await notes.find(sessionPath);

  let text = record.note || '';
  if (file) {
    const onDisk = await notes.read(file);
    // The file on disk wins: you may have edited it in Notepad.
    if (onDisk !== null) text = onDisk;
  }

  if (file !== record.noteFile) store.set(sessionPath, { noteFile: file });
  return { text, file };
});

ipcMain.handle('notes:save', async (event, sessionPath, text) => {
  guard(path.dirname(sessionPath));
  const record = store.get(sessionPath);

  let file = null;
  try {
    file = await notes.save(sessionPath, text, record.noteFile);
  } catch (err) {
    console.error('[notes] Could not write note file:', err.message);
  }

  store.set(sessionPath, { note: text, noteFile: file });
  return { file };
});

/* ------------------------------ media ----------------------------- */

/**
 * Everything belonging to one session file. Siblings are passed so the more
 * specific name wins — "Bangalore entry 1.wav" belongs to
 * "Bangalore entry 1.als", not to "Bangalore entry.als".
 */
ipcMain.handle('renders:find', async (event, sessionPath, root, extras, siblings) => {
  return renders.findRenders(sessionPath, root, extras || [], siblings || []);
});

ipcMain.handle('renders:all', async (event, folder) =>
  renders.listAllAudio(folder)
);

ipcMain.handle('media:list', async (event, folder) => {
  const files = await media.listAudio(folder);
  return { files, renders: media.groupRenders(files) };
});

ipcMain.handle('media:read', async (event, filePath) => {
  const buf = await media.readFile(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

/* --------------------------- opening -------------------------------*/

/**
 * Ask before launching if a DAW is already running. Three accidental clicks
 * is three unwanted launches, and a second session loading over the first is
 * the worst possible time for it.
 */
ipcMain.handle('shell:openProject', async (event, target, projectName) => {
  const running = await procs.runningDaws();

  if (running.length > 0) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Open anyway'],
      defaultId: 0,
      cancelId: 0,
      title: 'A DAW is already running',
      message: `${running.join(' and ')} ${running.length > 1 ? 'are' : 'is'} already open.`,
      detail: `Opening "${projectName || path.basename(target)}" will load a second session. Continue?`
    });
    if (response !== 1) return { opened: false, cancelled: true };
  }

  const error = await shell.openPath(target);
  procs.forget();
  return { opened: !error, error: error || null };
});

ipcMain.handle('shell:reveal', (event, target) =>
  shell.showItemInFolder(target)
);

ipcMain.handle('shell:open', async (event, target) => {
  const error = await shell.openPath(target);
  return error || null;
});

ipcMain.handle('daws:running', () => procs.runningDaws());

/* ------------------------------ tools ----------------------------- */

ipcMain.handle('tools:id3Inspect', async (event, folder) => {
  guard(folder);
  const files = await media.listAudio(folder, 1);
  const mp3s = files.filter((f) => f.ext === '.mp3');
  return Promise.all(mp3s.map((f) => id3.inspect(f.path)));
});

ipcMain.handle('tools:id3Strip', async (event, paths) => {
  const results = [];
  for (const filePath of paths) {
    try {
      guard(path.dirname(filePath));
      results.push(await id3.strip(filePath));
    } catch (err) {
      results.push({ path: filePath, changed: false, error: err.message });
    }
  }
  return results;
});

ipcMain.handle('tools:pickFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder to rename files in',
    buttonLabel: 'Use this folder',
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('tools:renameList', async (event, folder, extensions) => {
  if (!withinRoots(folder) && !pickedFolders.has(folder)) {
    throw new Error('Choose that folder with the picker first.');
  }
  return renamer.listFiles(folder, extensions);
});

ipcMain.handle('tools:renamePlan', (event, files, options) =>
  renamer.plan(files, options)
);

ipcMain.handle('tools:renameApply', async (event, planned) => {
  planned.rows.forEach((row) => {
    const dir = path.dirname(row.path);
    if (!withinRoots(dir) && !pickedFolders.has(dir)) {
      throw new Error('That folder was not chosen with the picker.');
    }
  });
  return renamer.apply(planned, undoLog());
});

ipcMain.handle('tools:renameUndo', () => renamer.undo(undoLog()));

/* ---------------------------- de-dupe ----------------------------- */

ipcMain.handle('output:get', () => settings.get().outputFolder);

ipcMain.handle('output:ensure', () => ensureOutputFolder());

ipcMain.handle('dedupe:scan', async () => {
  const roots = settings.get().roots;
  if (roots.length === 0) return { groups: [], scanned: 0, folders: 0 };

  return dedupe.findDuplicates(roots, (done, total) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('dedupe:progress', { done, total });
    }
  });
});

ipcMain.handle('dedupe:link', async (event, groups) => {
  groups.forEach((group) =>
    group.files.forEach((file) => guard(path.dirname(file.path)))
  );

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Cancel', 'Link them'],
    defaultId: 1,
    cancelId: 0,
    title: 'Replace duplicates with links',
    message: `Link ${groups.length} group(s) of duplicate samples?`,
    detail:
      'Every file keeps its path and every session still opens — the drive just stores one copy instead of several. Nothing is deleted.'
  });
  if (response !== 1) return { linked: 0, reclaimed: 0, cancelled: true };

  return dedupe.linkGroups(groups);
});
