// Puente de la ventana que te obliga a trabajar: solo puede pedir su estado y sus tres botones.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('forzar', {
  state: () => ipcRenderer.invoke('force-state'),
  action: (what) => ipcRenderer.invoke('force-action', what),
  onState: (cb) => ipcRenderer.on('force-state', (_e, s) => cb(s))
});
