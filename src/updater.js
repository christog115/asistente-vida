// Actualización automática: revisa GitHub Releases al arrancar y cada 6 horas,
// descarga la versión nueva en segundo plano y la instala al cerrar la app (o
// cuando tocas "Reiniciar para actualizar"). Solo funciona en la app instalada.
const { app, Notification } = require('electron');
const store = require('./store');

const EVERY = 6 * 3600 * 1000;
let autoUpdater = null;
let state = { state: 'inactivo', version: null, error: null };

function enabled() {
  return store.get('autoUpdate') !== false;
}

function set(patch) {
  state = { ...state, ...patch };
}

function init() {
  if (!app.isPackaged) {
    set({ state: 'desarrollo' });
    return;
  }
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set({ state: 'buscando', error: null }));
  autoUpdater.on('update-not-available', () => set({ state: 'al-dia' }));
  autoUpdater.on('update-available', (info) => set({ state: 'descargando', version: info.version }));
  autoUpdater.on('update-downloaded', (info) => {
    set({ state: 'lista', version: info.version });
    new Notification({
      title: 'Asistente de Vida',
      body: `La versión ${info.version} está lista; se instala al cerrar la app.`
    }).show();
  });
  autoUpdater.on('error', (err) => set({ state: 'error', error: err.message.split('\n')[0] }));
  if (enabled()) check();
  setInterval(() => enabled() && check(), EVERY);
}

function check() {
  if (!autoUpdater) return status();
  autoUpdater.checkForUpdates().catch(() => {});
  return status();
}

function setEnabled(on) {
  store.set('autoUpdate', !!on);
  if (on) check();
}

function installNow() {
  if (autoUpdater && state.state === 'lista') autoUpdater.quitAndInstall();
}

function status() {
  return { enabled: enabled(), current: app.getVersion(), ...state };
}

module.exports = { init, check, setEnabled, installNow, status };
