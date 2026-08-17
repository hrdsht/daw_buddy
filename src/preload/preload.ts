'use strict';

/**
 * The security airlock. The window can't touch your drive directly — it gets
 * exactly these functions and nothing else.
 *
 * This matters more with every version: these tools now rename files, rewrite
 * mp3s and replace duplicates with links. Every path is still checked against
 * your configured folders on the far side, in main.js.
 */

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  addRoot: () => ipcRenderer.invoke('settings:addRoot'),
  removeRoot: (root) => ipcRenderer.invoke('settings:removeRoot', root),

  scan: () => ipcRenderer.invoke('projects:scan'),
  browse: (folder) => ipcRenderer.invoke('projects:browse', folder),
  onProjectsUpdated: (callback) => subscribe('projects:updated', callback),
  onNavigateBack: (callback) => subscribe('navigation:back', callback),
  onNavigateForward: (callback) => subscribe('navigation:forward', callback),

  getRecords: () => ipcRenderer.invoke('records:all'),
  setRecord: (key, patch) => ipcRenderer.invoke('records:set', key, patch),
  chooseStems: (projectPath) =>
    ipcRenderer.invoke('records:chooseStems', projectPath),

  loadNote: (sessionPath) => ipcRenderer.invoke('notes:load', sessionPath),
  saveNote: (sessionPath, text) =>
    ipcRenderer.invoke('notes:save', sessionPath, text),

  findRenders: (sessionPath, root, extras, siblings) =>
    ipcRenderer.invoke('renders:find', sessionPath, root, extras, siblings),
  listAllAudio: (folder) => ipcRenderer.invoke('renders:all', folder),
  listVideos: (folder) => ipcRenderer.invoke('videos:list', folder),
  getOutputFolder: () => ipcRenderer.invoke('output:get'),

  listMedia: (folder) => ipcRenderer.invoke('media:list', folder),
  readMedia: (filePath) => ipcRenderer.invoke('media:read', filePath),

  openProject: (target, name) =>
    ipcRenderer.invoke('shell:openProject', target, name),
  reveal: (target) => ipcRenderer.invoke('shell:reveal', target),
  open: (target) => ipcRenderer.invoke('shell:open', target),
  runningDaws: () => ipcRenderer.invoke('daws:running'),

  id3Inspect: (folder) => ipcRenderer.invoke('tools:id3Inspect', folder),
  id3Strip: (paths) => ipcRenderer.invoke('tools:id3Strip', paths),
  id3Write: (jobs) => ipcRenderer.invoke('tools:id3Write', jobs),

  pickFolder: () => ipcRenderer.invoke('tools:pickFolder'),
  renameList: (folder, extensions) =>
    ipcRenderer.invoke('tools:renameList', folder, extensions),
  renamePlan: (files, options) =>
    ipcRenderer.invoke('tools:renamePlan', files, options),
  renameApply: (planned) => ipcRenderer.invoke('tools:renameApply', planned),
  renameUndo: () => ipcRenderer.invoke('tools:renameUndo'),

  qcScan: (folder, options) => ipcRenderer.invoke('qc:scan', folder, options),
  onQcProgress: (callback) => subscribe('qc:progress', callback),
  deepAudio: (folder) => ipcRenderer.invoke('audio:deep', folder),

  diskScan: (folders) => ipcRenderer.invoke('disk:scan', folders),
  diskCancel: () => ipcRenderer.invoke('disk:cancel'),
  onDiskProgress: (callback) => subscribe('disk:progress', callback),

  silenceList: (folder) => ipcRenderer.invoke('silence:list', folder),
  silenceAnalyse: (paths, options) =>
    ipcRenderer.invoke('silence:analyse', paths, options),
  silenceProcess: (paths, options) =>
    ipcRenderer.invoke('silence:process', paths, options),
  onSilenceProgress: (callback) => subscribe('silence:progress', callback),

  vocalListWav: (folder) => ipcRenderer.invoke('vocal:listWav', folder),
  vocalSplitAnalyse: (inputPath, options) =>
    ipcRenderer.invoke('vocal:splitAnalyse', inputPath, options),
  vocalSplit: (inputPath, options) => ipcRenderer.invoke('vocal:split', inputPath, options),
  vocalSplitBatch: (inputPaths, options) =>
    ipcRenderer.invoke('vocal:splitBatch', inputPaths, options),
  vocalPickManifest: () => ipcRenderer.invoke('vocal:pickManifest'),
  vocalRebuildAnalyse: (manifestPath, blocksFolder) =>
    ipcRenderer.invoke('vocal:rebuildAnalyse', manifestPath, blocksFolder),
  vocalRebuild: (manifestPath, blocksFolder, options) =>
    ipcRenderer.invoke('vocal:rebuild', manifestPath, blocksFolder, options),

  finishList: (folder) => ipcRenderer.invoke('finish:list', folder),
  finishAnalyse: (paths, options) => ipcRenderer.invoke('finish:analyse', paths, options),
  finishProcess: (paths, options) => ipcRenderer.invoke('finish:process', paths, options),
  onFinishProgress: (callback) => subscribe('finish:progress', callback),

  dedupeScan: () => ipcRenderer.invoke('dedupe:scan'),
  dedupeLink: (groups) => ipcRenderer.invoke('dedupe:link', groups),

  onBounce: (callback) => subscribe('bounce:detected', callback),
  onDedupeProgress: (callback) => subscribe('dedupe:progress', callback),
  onNoteRenamed: (callback) => subscribe('note:renamed', callback)
});
