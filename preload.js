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

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  addRoot: () => ipcRenderer.invoke('settings:addRoot'),
  removeRoot: (root) => ipcRenderer.invoke('settings:removeRoot', root),

  scan: () => ipcRenderer.invoke('projects:scan'),
  browse: (folder) => ipcRenderer.invoke('projects:browse', folder),

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

  pickFolder: () => ipcRenderer.invoke('tools:pickFolder'),
  renameList: (folder, extensions) =>
    ipcRenderer.invoke('tools:renameList', folder, extensions),
  renamePlan: (files, options) =>
    ipcRenderer.invoke('tools:renamePlan', files, options),
  renameApply: (planned) => ipcRenderer.invoke('tools:renameApply', planned),
  renameUndo: () => ipcRenderer.invoke('tools:renameUndo'),

  dedupeScan: () => ipcRenderer.invoke('dedupe:scan'),
  dedupeLink: (groups) => ipcRenderer.invoke('dedupe:link', groups),

  onBounce: (callback) =>
    ipcRenderer.on('bounce:detected', (event, bounce) => callback(bounce)),
  onDedupeProgress: (callback) =>
    ipcRenderer.on('dedupe:progress', (event, data) => callback(data)),
  onNoteRenamed: (callback) =>
    ipcRenderer.on('note:renamed', (event, data) => callback(data))
});
