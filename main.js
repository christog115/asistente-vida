// Proceso principal: ventana del tablero, ícono en la bandeja, arranque con
// el sistema, actualización periódica y recordatorios.
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require('electron');
const path = require('path');
const google = require('./src/google');
const moodle = require('./src/moodle');
const reminders = require('./src/reminders');
const ai = require('./src/ai');
const phone = require('./src/phone');
const store = require('./src/store');

const REFRESH_MS = 15 * 60 * 1000;

let win = null;
let tray = null;
let latest = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showWindow());

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 720, minHeight: 520, show: false,
    title: 'Asistente de Vida',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win.show();
  });
  // Cerrar la ventana solo la esconde; la app sigue viva en la bandeja.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'renderer', 'icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('Asistente de Vida');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir tablero', click: showWindow },
    { label: 'Actualizar ahora', click: () => refresh() },
    { type: 'separator' },
    { label: 'Salir', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', showWindow);
}

async function refresh() {
  const safe = (p) => p.catch((err) => ({ error: err.message }));
  const [g, m] = await Promise.all([safe(google.fetchAll()), safe(moodle.fetchPending())]);
  const school = [];
  for (const part of [g && g.school, m]) {
    if (Array.isArray(part)) school.push(...part);
  }
  school.sort((a, b) => (a.due ? new Date(a.due) : Infinity) - (b.due ? new Date(b.due) : Infinity));
  latest = {
    updatedAt: new Date().toISOString(),
    emails: g && g.emails, events: g && g.events, tasks: g && g.tasks, files: g && g.files,
    sheet: g && g.sheet,
    school,
    briefing: store.get('briefing') || null,
    errors: {
      google: g && g.error, classroom: g && g.school && g.school.error, moodle: m && m.error
    }
  };
  if (win) win.webContents.send('data', latest);
  maybeBriefing();
  return latest;
}

// Una vez al día (a partir de las 5:00) el asistente arma el resumen de la mañana.
let briefingRunning = false;
async function makeBriefing() {
  briefingRunning = true;
  try {
    const text = await ai.dailyBriefing(latest);
    const briefing = { date: new Date().toDateString(), text, at: new Date().toISOString() };
    store.set('briefing', briefing);
    latest = { ...latest, briefing };
    if (win) win.webContents.send('data', latest);
    return latest;
  } finally {
    briefingRunning = false;
  }
}

function maybeBriefing() {
  const b = store.get('briefing');
  const today = new Date().toDateString();
  if (briefingRunning || !ai.ready() || new Date().getHours() < 5 || (b && b.date === today)) return;
  makeBriefing().catch((err) => console.error('Resumen del asistente:', err.message));
}

function statuses() {
  return {
    google: google.status(),
    moodle: moodle.status(),
    moodleUrl: store.get('moodle').url,
    reminderTimes: store.get('reminderTimes'),
    autoStart: app.getLoginItemSettings().openAtLogin,
    sheetUrl: store.get('sheetUrl') || '',
    ai: ai.status(),
    phone: phone.status()
  };
}

ipcMain.handle('get-data', () => latest || refresh());
ipcMain.handle('refresh', () => refresh());
ipcMain.handle('get-status', () => statuses());
ipcMain.handle('google-connect', async () => { await google.connect(); return refresh(); });
ipcMain.handle('google-disconnect', () => { google.disconnect(); return refresh(); });
ipcMain.handle('moodle-set-url', (_e, url) => {
  store.set('moodle', { ...store.get('moodle'), url });
});
ipcMain.handle('moodle-connect-password', async (_e, user, pass) => {
  await moodle.connectWithPassword(user, pass);
  return refresh();
});
ipcMain.handle('moodle-connect-browser', async () => {
  await moodle.openLoginWindow(win);
  return refresh();
});
ipcMain.handle('moodle-disconnect', () => { moodle.disconnect(); return refresh(); });
ipcMain.handle('set-sheet-url', (_e, url) => { store.set('sheetUrl', url); return refresh(); });
ipcMain.handle('ai-set-key', (_e, which, key) => ai.setKey(which, key));
ipcMain.handle('ai-set-provider', (_e, p) => ai.setProvider(p));
ipcMain.handle('ai-chat', (_e, history) => ai.chat(history, latest));
ipcMain.handle('ai-briefing', () => makeBriefing());
ipcMain.handle('phone-create', () => { phone.createTopic(); return phone.qr(); });
ipcMain.handle('phone-qr', () => phone.qr());
ipcMain.handle('phone-set-enabled', (_e, on) => phone.setEnabled(on));
ipcMain.handle('phone-set-server', (_e, url) => phone.setServer(url));
ipcMain.handle('phone-disable', () => phone.disable());
ipcMain.handle('phone-test', async () => {
  await phone.send('Asistente de Vida', 'Listo, tu celular ya recibe los avisos.', { tags: ['white_check_mark'] });
});
ipcMain.handle('set-reminders', (_e, times) => store.set('reminderTimes', times));
ipcMain.handle('set-autostart', (_e, on) => {
  app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
});

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('mx.christopher.asistente-vida');
  // La primera vez se activa el arranque con el sistema; luego se respeta lo que elijas.
  if (store.get('autoStartInit') !== true) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
    store.set('autoStartInit', true);
  }
  createWindow();
  createTray();
  refresh();
  setInterval(refresh, REFRESH_MS);
  setInterval(() => reminders.tick(latest, showWindow), 60 * 1000);
});

app.on('activate', showWindow);
app.on('before-quit', () => { quitting = true; });
// No salir cuando se cierran las ventanas: la app vive en la bandeja.
app.on('window-all-closed', () => {});
