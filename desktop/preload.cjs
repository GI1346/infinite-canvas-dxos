const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('blinkflowStorage', {
  info: () => ipcRenderer.invoke('storage:info'),
  open: () => ipcRenderer.invoke('storage:open'),
  clear: () => ipcRenderer.invoke('storage:clear'),
});

contextBridge.exposeInMainWorld('blinkflowDownloads', { saveImages: (files) => ipcRenderer.invoke('downloads:images', files) });

contextBridge.exposeInMainWorld('blinkflowHarness', {
  open: (options) => ipcRenderer.invoke('harness:open', options),
  publishModels: (state) => ipcRenderer.send('harness:models', state),
  onImageModel: (handler) => { const listener = (_event, value) => handler(value); ipcRenderer.on('harness:image-model', listener); return () => ipcRenderer.removeListener('harness:image-model', listener); },
  onTool: (handler) => { const listener = (_event, request) => handler(request); ipcRenderer.on('harness:tool', listener); return () => ipcRenderer.removeListener('harness:tool', listener); },
  onCancel: (handler) => { const listener = (_event, id) => handler(id); ipcRenderer.on('harness:cancel', listener); return () => ipcRenderer.removeListener('harness:cancel', listener); },
  respond: (id, result) => ipcRenderer.send('harness:response', id, result),
});
