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
  setSheetUrl: (url) => ipcRenderer.invoke('set-sheet-url', url),
  aiSetKey: (which, key) => ipcRenderer.invoke('ai-set-key', which, key),
  aiSetProvider: (p) => ipcRenderer.invoke('ai-set-provider', p),
  aiChat: (history) => ipcRenderer.invoke('ai-chat', history),
  aiBriefing: () => ipcRenderer.invoke('ai-briefing'),
  phoneCreate: () => ipcRenderer.invoke('phone-create'),
  phoneQr: () => ipcRenderer.invoke('phone-qr'),
  phoneSetEnabled: (on) => ipcRenderer.invoke('phone-set-enabled', on),
  phoneSetServer: (url) => ipcRenderer.invoke('phone-set-server', url),
  phoneDisable: () => ipcRenderer.invoke('phone-disable'),
  phoneTest: () => ipcRenderer.invoke('phone-test'),
  setReminders: (times) => ipcRenderer.invoke('set-reminders', times),
  setAutostart: (on) => ipcRenderer.invoke('set-autostart', on),
  onData: (cb) => ipcRenderer.on('data', (_e, data) => cb(data))
});
