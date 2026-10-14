// Puente seguro entre la ventana y el proceso principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('asistente', {
  getData: () => ipcRenderer.invoke('get-data'),
  refresh: () => ipcRenderer.invoke('refresh'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  googleConnect: () => ipcRenderer.invoke('google-connect'),
  googleDisconnect: () => ipcRenderer.invoke('google-disconnect'),
  moodleSetUrl: (url) => ipcRenderer.invoke('moodle-set-url', url),
  moodleConnectPassword: (user, pass) => ipcRenderer.invoke('moodle-connect-password', user, pass),
  moodleConnectBrowser: () => ipcRenderer.invoke('moodle-connect-browser'),
  moodleDisconnect: () => ipcRenderer.invoke('moodle-disconnect'),
  setReminders: (times) => ipcRenderer.invoke('set-reminders', times),
  setAutostart: (on) => ipcRenderer.invoke('set-autostart', on),
  onData: (cb) => ipcRenderer.on('data', (_e, data) => cb(data))
});
