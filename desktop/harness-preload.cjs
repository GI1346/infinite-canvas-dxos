const { contextBridge, ipcRenderer } = require('electron');
// Narrow, credential-free API available only in the official Harness window.
contextBridge.exposeInMainWorld('blinkflowHarnessModels', {
  get: () => ipcRenderer.invoke('harness:models-get'),
  select: (imageModel) => ipcRenderer.invoke('harness:model-select', imageModel),
  onChange: (handler) => { const listener = (_event, state) => handler(state); ipcRenderer.on('harness:models-changed', listener); return () => ipcRenderer.removeListener('harness:models-changed', listener); },
});
