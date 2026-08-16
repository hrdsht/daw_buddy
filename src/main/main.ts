'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fsp = require('fs/promises');

const { scanRoots, scanFolder } = require('./lib/scanner');
const { ProjectStore } = require('./lib/notes');
const { NoteWriter } = require('./lib/notetext');
const { Settings, isInside, samePath } = require('./lib/settings');
const { startWatching, stopWatching } = require('./lib/watcher');
const media = require('./lib/media');
const renders = require('./lib/renders');
const videos = require('./lib/videos');
const { ParseCache } = require('./lib/cache');
const { migrate } = require('./lib/migrate');
const id3 = require('./lib/id3');
const renamer = require('./lib/renamer');
const silence = require('./lib/silence');
const audioqc = require('./lib/audioqc');
const { groupVersions } = require('./lib/versions');
const dedupe = require('./lib/dedupe');
const procs = require('./lib/procs');

let mainWindow: any = null;
let splashWindow: any = null;
let store: any = null;
let settings: any = null;
let notes: any = null;
let cache: any = null;
let initialScanPromise = null;
let quitting = false;
const pendingNoteSaves = new Set();

const isMac = process.platform === 'darwin';
const dataDir = () => app.getPath('userData');
const undoLog = () => path.join(dataDir(), 'rename-undo.json');

function createSplashWindow() {
  let resolveFinished;
  let settled = false;
  const finished = new Promise((resolve) => {
    resolveFinished = resolve;
  });

  const splash = new BrowserWindow({
    width: 640,
    height: 640,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'splash-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const finish = () => {
    if (settled) return;
    settled = true;
    clearTimeout(fallback);
    ipcMain.removeListener('splash:finished', onFinished);
    resolveFinished();
  };
  const onFinished = (event) => {
    if (event.sender === splash.webContents) finish();
  };
  const fallback = setTimeout(finish, 12000);

  ipcMain.on('splash:finished', onFinished);

  splash.loadFile(path.join(__dirname, '..', 'renderer', 'splash.html'));
  splash.once('ready-to-show', () => splash.show());
  splash.on('closed', () => {
    finish();
    if (splashWindow === splash) splashWindow = null;
  });
  splashWindow = splash;
  return { splash, finished };
}

function createWindow({ splash = null, revealWhen = Promise.resolve() }: any = {}) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: '#101310',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'dawbuddy-logo-v2.png'),
    alwaysOnTop: settings.get().alwaysOnTop,
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 22 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    Promise.resolve(revealWhen)
      .catch((error) => console.error('[startup] Could not prepare the first view:', error.message))
      .finally(() => {
        // Give the renderer one paint after it receives the prefetched scan.
        setTimeout(() => {
          if (splash && !splash.isDestroyed()) splash.close();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
          }
        }, 100);
      });
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * One instance only.
 *
 * Two copies running means two processes both writing notes.json, and
 * last-write-wins silently loses whichever finished first. That's a quiet way
 * to lose notes, so a second launch focuses the existing window instead.
 *
 * It also clears up the Chromium "Unable to move the cache: Access is denied"
 * errors, which are the second instance failing to take the lock on the
 * shader cache — harmless in themselves, but a symptom of the real problem.
 */
if (!app.requestSingleInstanceLock()) {
  console.log('[app] DAW Buddy is already running — focusing that window.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

app.whenReady().then(async () => {
  const splashState = createSplashWindow();

  // Renaming the app moved the data folder. Bring the old one across before
  // anything reads from it, or it looks like every note vanished.
  await migrate(dataDir());

  settings = new Settings(path.join(dataDir(), 'settings.json'));
  settings.load();

  store = new ProjectStore(path.join(dataDir(), 'notes.json'));
  await store.load();
  Object.values(store.all()).forEach((record: any) => {
    if (record && record.stemsPath) pickedFolders.add(path.resolve(record.stemsPath));
  });

  cache = new ParseCache(path.join(dataDir(), 'cache.json'));
  await cache.load();

  await ensureOutputFolder();

  // Start the expensive first scan while the eight-second animation plays.
  // The renderer will reuse this exact promise instead of scanning twice.
  initialScanPromise = scanProjects().catch((error) => ({
    entries: [],
    grouped: [],
    errors: [{ root: 'Startup scan', message: error.message }],
    truncated: false,
    foldersRead: 0,
    roots: settings.get().roots,
    cache: cache.stats()
  }));

  notes = new NoteWriter();
  notes.onRenamed = (sessionPath, newFile) => {
    store.set(sessionPath, { noteFile: newFile });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('note:renamed', { sessionPath, file: newFile });
    }
  };

  createWindow({
    splash: splashState.splash,
    revealWhen: Promise.all([splashState.finished, initialScanPromise])
  });
  restartWatcher();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) {
    stopWatching();
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  stopWatching();

  Promise.allSettled([...pendingNoteSaves])
    .then(() =>
      Promise.allSettled([
        store ? store.flush() : Promise.resolve(),
        cache ? cache.save() : Promise.resolve()
      ])
    )
    .finally(() => app.quit());
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
  if (!target) target = path.join(current.roots[0], 'DAW Buddy Output');

  try {
    await fsp.mkdir(target, { recursive: true });
  } catch (err) {
    console.error('[output] Could not create output folder:', err.message);
    return null;
  }

  const patch: Record<string, any> = {};
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
      // One notification per render, however many formats it arrived in.
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
  if (typeof target !== 'string' || !target) return null;
  return settings
    .get()
    .roots.find((root) => samePath(target, root) || isInside(target, root));
}

/**
 * The renamer can be pointed at any folder the user picked themselves — a
 * stems folder on another drive, say. A folder chosen through the OS dialog
 * is the user speaking directly, which is exactly what the root check exists
 * to distinguish from a path the window made up.
 */
const pickedFolders = new Set();

function pickedBaseFor(target) {
  const resolved = path.resolve(target);
  for (const folder of pickedFolders) {
    if (samePath(resolved, folder) || isInside(resolved, folder)) return folder;
  }
  return null;
}

function approvedBaseFor(target) {
  return withinRoots(target) || pickedBaseFor(target);
}

function guardApproved(target) {
  const base = approvedBaseFor(target);
  if (!base) throw new Error('That path is outside your approved folders.');
  return base;
}

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

ipcMain.handle('settings:update', (event, patch: any) => {
  patch = patch && typeof patch === 'object' ? patch : {};
  const allowed: Record<string, any> = {};
  if (typeof patch.alwaysOnTop === 'boolean') allowed.alwaysOnTop = patch.alwaysOnTop;
  if (typeof patch.pollWatching === 'boolean') allowed.pollWatching = patch.pollWatching;
  if (typeof patch.followLinks === 'boolean') allowed.followLinks = patch.followLinks;
  if (Array.isArray(patch.ignore)) {
    allowed.ignore = patch.ignore.filter((name) => typeof name === 'string');
  }

  const before = settings.get();
  const after = settings.update(allowed);

  if (allowed.alwaysOnTop !== undefined && mainWindow) {
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

  if (changed) {
    await ensureOutputFolder();
    restartWatcher();
  }
  return { settings: fullSettings(), messages };
});

ipcMain.handle('settings:removeRoot', async (event, root) => {
  settings.removeRoot(root);
  const current = settings.get();
  if (
    current.outputFolder &&
    !current.roots.some(
      (remaining) => samePath(current.outputFolder, remaining) || isInside(current.outputFolder, remaining)
    )
  ) {
    settings.update({ outputFolder: null });
    await ensureOutputFolder();
  }
  restartWatcher();
  return fullSettings();
});

/* ---------------------------- scanning ---------------------------- */

async function scanProjects() {
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
    grouped: groupVersions(entries),
    errors,
    truncated,
    foldersRead,
    roots: current.roots,
    cache: cache.stats()
  };
}

ipcMain.handle('projects:scan', async () => {
  if (initialScanPromise) {
    const prefetched = initialScanPromise;
    const result = await prefetched;
    if (initialScanPromise === prefetched) initialScanPromise = null;
    return result;
  }
  return scanProjects();
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
  return { entries, grouped: groupVersions(entries), errors, truncated, root, browsing: target };
});

/* ----------------------------- records ---------------------------- */

ipcMain.handle('records:all', () => store.all());

ipcMain.handle('records:set', (event, key, patch) => {
  guardApproved(key);
  patch = patch && typeof patch === 'object' ? patch : {};
  const allowed: Record<string, any> = {};
  [
    'key', 'camelot', 'keyConfidence', 'keyAlternate', 'detectedBpm',
    'analysedFrom', 'favourite'
  ].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(patch, field)) allowed[field] = patch[field];
  });
  return store.set(key, allowed);
});

ipcMain.handle('records:chooseStems', async (event, projectPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Where are the stems for this project?',
    buttonLabel: 'Use this folder',
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  guardApproved(projectPath);
  const chosen = path.resolve(result.filePaths[0]);
  pickedFolders.add(chosen);
  return store.set(projectPath, { stemsPath: chosen });
});

/* ------------------------------ notes ----------------------------- */

/**
 * Notes are keyed by session file, so each version of a project keeps its own.
 * The text file lives beside the project and is renamed as you edit.
 */
ipcMain.handle('notes:load', async (event, sessionPath) => {
  guardApproved(sessionPath);
  const record = store.get(sessionPath);

  // If the app lost track of the file — moved machine, edited by hand — go
  // and look for it rather than starting a second one.
  let file = record.noteFile;
  if (!file) file = await notes.find(sessionPath);
  if (
    file &&
    (!approvedBaseFor(file) ||
      !samePath(path.dirname(file), path.dirname(sessionPath)) ||
      path.extname(file).toLowerCase() !== '.txt')
  ) {
    file = null;
  }

  let text = record.note || '';
  if (file) {
    const onDisk = await notes.read(file);
    // The file on disk wins: you may have edited it in Notepad.
    if (onDisk !== null) text = onDisk;
  }

  if (file !== record.noteFile) store.set(sessionPath, { noteFile: file });
  return { text, file };
});

ipcMain.handle('notes:save', (event, sessionPath, text) => {
  const task = saveNote(sessionPath, text);
  pendingNoteSaves.add(task);
  task.then(
    () => pendingNoteSaves.delete(task),
    () => pendingNoteSaves.delete(task)
  );
  return task;
});

async function saveNote(sessionPath, text) {
  guard(path.dirname(sessionPath));
  const record = store.get(sessionPath);
  const existingFile =
    record.noteFile &&
    approvedBaseFor(record.noteFile) &&
    samePath(path.dirname(record.noteFile), path.dirname(sessionPath)) &&
    path.extname(record.noteFile).toLowerCase() === '.txt'
    ? record.noteFile
    : null;

  let file = null;
  try {
    file = await notes.save(sessionPath, text, existingFile);
  } catch (err) {
    console.error('[notes] Could not write note file:', err.message);
  }

  store.set(sessionPath, { note: text, noteFile: file });
  return { file };
}

/* ------------------------------ media ----------------------------- */

/**
 * Everything belonging to one session file. Siblings are passed so the more
 * specific name wins — "Bangalore entry 1.wav" belongs to
 * "Bangalore entry 1.als", not to "Bangalore entry.als".
 */
ipcMain.handle('renders:find', async (event, sessionPath, root, extras, siblings) => {
  guardApproved(sessionPath);
  guardApproved(root);
  const approvedExtras = (extras || []).filter((folder) => approvedBaseFor(folder));
  return renders.findRenders(sessionPath, root, approvedExtras, siblings || []);
});

ipcMain.handle('renders:all', async (event, folder) => {
  guardApproved(folder);
  return renders.listAllAudio(folder);
});

ipcMain.handle('videos:list', async (event, folder) => {
  guardApproved(folder);
  return videos.listVideos(folder);
});

ipcMain.handle('media:list', async (event, folder) => {
  guardApproved(folder);
  const files = await media.listAudio(folder);
  return { files, renders: media.groupRenders(files) };
});

ipcMain.handle('media:read', async (event, filePath) => {
  guardApproved(filePath);
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
  guardApproved(target);
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

ipcMain.handle('shell:reveal', (event, target) => {
  if (!samePath(target, dataDir())) guardApproved(target);
  return shell.showItemInFolder(target);
});

ipcMain.handle('shell:open', async (event, target) => {
  guardApproved(target);
  const error = await shell.openPath(target);
  return error || null;
});

ipcMain.handle('daws:running', () => procs.runningDaws());

/* ------------------------------ tools ----------------------------- */

ipcMain.handle('tools:id3Inspect', async (event, folder) => {
  guardApproved(folder);
  return id3.inspectFolder(folder);
});

ipcMain.handle('tools:id3Strip', async (event, paths) => {
  const results = [];
  for (const filePath of paths) {
    try {
      guardApproved(filePath);
      if (path.extname(filePath).toLowerCase() !== '.mp3') {
        throw new Error('Only MP3 files can be stripped.');
      }
      results.push(await id3.strip(filePath));
    } catch (err) {
      results.push({ path: filePath, changed: false, error: err.message });
    }
  }
  return results;
});

ipcMain.handle('tools:id3Write', async (event, jobs) => {
  if (!Array.isArray(jobs)) throw new Error('Invalid ID3 edit list.');
  const results = [];
  for (const job of jobs.slice(0, 10000)) {
    try {
      const filePath = job && job.path;
      guardApproved(filePath);
      if (path.extname(filePath).toLowerCase() !== '.mp3') {
        throw new Error('ID3 metadata can only be written to MP3 files.');
      }
      results.push(await id3.write(filePath, id3.sanitiseFields(job.fields)));
    } catch (err) {
      results.push({ path: job && job.path, changed: false, error: err.message });
    }
  }
  return results;
});

ipcMain.handle('tools:pickFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder',
    buttonLabel: 'Use this folder',
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const chosen = path.resolve(result.filePaths[0]);
  pickedFolders.add(chosen);
  return chosen;
});

ipcMain.handle('tools:renameList', async (event, folder, extensions) => {
  guardApproved(folder);
  return renamer.listFiles(folder, extensions);
});

ipcMain.handle('tools:renamePlan', (event, files, options) =>
  renamer.plan(files, options)
);

ipcMain.handle('tools:renameApply', async (event, planned) => {
  if (!planned || !Array.isArray(planned.rows)) throw new Error('Invalid rename plan.');
  const renameable = new Set(['.wav', '.mp3', '.aiff', '.aif', '.flac']);
  planned.rows.forEach((row) => {
    const dir = path.dirname(row.path);
    guardApproved(dir);
    if (!renameable.has(path.extname(row.path).toLowerCase())) {
      throw new Error('Only audio files can be renamed here.');
    }
  });
  return renamer.apply(planned, undoLog());
});

ipcMain.handle('tools:renameUndo', () => renamer.undo(undoLog()));

/* ---------------------------- de-dupe ----------------------------- */

ipcMain.handle('output:get', () => settings.get().outputFolder);

ipcMain.handle('output:ensure', () => ensureOutputFolder());

/* --------------------------- silence ------------------------------ */

/** Any WAV in the folder. Only WAV — the tool refuses everything else. */
ipcMain.handle('silence:list', async (event, folder) => {
  guardApproved(folder);

  const files = await media.listAudio(folder, 1);
  return files
    .filter((file) => file.ext === '.wav')
    .map((file) => ({ path: file.path, name: file.name, size: file.size }));
});

/**
 * Dry run. Measures what would be trimmed and writes nothing, so the numbers
 * on screen come from the same measurement the real pass will use.
 */
ipcMain.handle('silence:analyse', async (event, paths, options) => {
  const results = [];
  for (let i = 0; i < paths.length; i += 1) {
    guardApproved(paths[i]);
    results.push(await silence.analyse(paths[i], options));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('silence:progress', {
        done: i + 1,
        total: paths.length,
        phase: 'analyse'
      });
    }
  }
  return results;
});

ipcMain.handle('silence:process', async (event, paths, options) => {
  const outputRoot = await ensureOutputFolder();
  if (!outputRoot) {
    throw new Error('No output folder — add a project folder in Settings first.');
  }

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Cancel', 'Process'],
    defaultId: 1,
    cancelId: 0,
    title: 'Remove silence',
    message: `Process ${paths.length} file(s)?`,
    detail: `Trimmed copies are written to:\n${outputRoot}\n\nYour originals are not touched.`
  });
  if (response !== 1) return { cancelled: true, results: [] };

  const results = [];
  for (let i = 0; i < paths.length; i += 1) {
    const sourceRoot = guardApproved(paths[i]);
    results.push(
      await silence.removeSilence(paths[i], outputRoot, { ...options, sourceRoot })
    );
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('silence:progress', {
        done: i + 1,
        total: paths.length,
        phase: 'process'
      });
    }
  }

  return { cancelled: false, results, outputRoot };
});

/* ---------------------------- audio QC ---------------------------- */

ipcMain.handle('qc:scan', async (event, folder, options) => {
  guardApproved(folder);
  return audioqc.scanFolder(folder, options, (done, total) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('qc:progress', { done, total });
    }
  });
});

/* ------------------------ deep audio list ------------------------- */

ipcMain.handle('audio:deep', async (event, folder) => {
  guardApproved(folder);
  return renders.listAllAudio(folder);
});

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
