const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('blinkflowStorage', {
  info: () => ipcRenderer.invoke('storage:info'),
  open: () => ipcRenderer.invoke('storage:open'),
  clear: () => ipcRenderer.invoke('storage:clear'),
});

contextBridge.exposeInMainWorld('blinkflowDownloads', { saveImages: (files) => ipcRenderer.invoke('downloads:images', files) });
