'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splashApi', {
  finished: () => ipcRenderer.send('splash:finished')
});
