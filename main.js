// Proceso principal: ventana del tablero, ícono en la bandeja, arranque con
// el sistema, actualización periódica y recordatorios.
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, session, globalShortcut, Notification } = require('electron');
const path = require('path');
const google = require('./src/google');
const moodle = require('./src/moodle');
const reminders = require('./src/reminders');
const ai = require('./src/ai');
const voice = require('./src/voice');
const phone = require('./src/phone');
const canva = require('./src/canva');
const spotify = require('./src/spotify');
const whatsapp = require('./src/whatsapp');
const updater = require('./src/updater');
const tts = require('./src/tts');
const piper = require('./src/piper');
const actions = require('./src/actions');
const alarms = require('./src/alarms');
const mobile = require('./src/mobile');
const store = require('./src/store');

const REFRESH_MS = 15 * 60 * 1000;

let win = null;
let tray = null;
let latest = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showWindow());
voice.registerScheme();

// Atajo para hablarle sin decir la palabra clave.
const VOICE_SHORTCUT = 'CommandOrControl+Shift+J';

// En desarrollo (npm start) Windows tiene que abrir Electron con la carpeta de
// la app; ya instalada basta con el .exe.
function loginItem(openAtLogin) {
  const args = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'];
  return openAtLogin === undefined ? { args } : { openAtLogin, args };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 720, minHeight: 520, show: false,
    title: 'Asistente de Vida',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    // Sin pausas en segundo plano para que la voz siga escuchando con la ventana escondida.
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false }
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
    { label: 'Hablar con el asistente', accelerator: VOICE_SHORTCUT, click: () => win && win.webContents.send('voice-activate') },
    { type: 'separator' },
    { label: 'Salir', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', showWindow);
}

async function refresh() {
  const safe = (p) => p.catch((err) => ({ error: err.message }));
  const [g, m, c, sp] = await Promise.all([
    safe(google.fetchAll()), safe(moodle.fetchPending()), safe(canva.recentDesigns()), safe(spotify.fetchAll())
  ]);
  const school = [];
  for (const part of [g && g.school, m]) {
    if (Array.isArray(part)) school.push(...part);
  }
  school.sort((a, b) => (a.due ? new Date(a.due) : Infinity) - (b.due ? new Date(b.due) : Infinity));
  latest = {
    updatedAt: new Date().toISOString(),
    emails: g && g.emails, events: g && g.events, tasks: g && g.tasks, files: g && g.files,
    sheet: g && g.sheet,
    designs: c,
    spotify: sp,
    school,
    briefing: store.get('briefing') || null,
    errors: {
      canva: c && c.error, spotify: sp && sp.error, google: g && g.error, classroom: g && g.school && g.school.error, moodle: m && m.error
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
    canva: canva.status(),
    spotify: spotify.status(),
    whatsapp: whatsapp.status(),
    update: updater.status(),
    moodleUrl: store.get('moodle').url,
    reminderTimes: store.get('reminderTimes'),
    autoStart: app.getLoginItemSettings(loginItem()).openAtLogin,
    sheetUrl: store.get('sheetUrl') || '',
    ai: ai.status(),
    phone: phone.status(),
    mobile: mobile.status()
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
ipcMain.handle('canva-set-app', (_e, id, secret) => { canva.setApp(id, secret); return refresh(); });
ipcMain.handle('canva-connect', async () => { await canva.connect(); return refresh(); });
ipcMain.handle('canva-disconnect', () => { canva.disconnect(); return refresh(); });
ipcMain.handle('spotify-set-app', (_e, id) => { spotify.setApp(id); return refresh(); });
ipcMain.handle('spotify-connect', async () => { await spotify.connect(); return refresh(); });
ipcMain.handle('spotify-disconnect', () => { spotify.disconnect(); return refresh(); });
ipcMain.handle('whatsapp-save', (_e, cfg) => whatsapp.save(cfg));
ipcMain.handle('whatsapp-test', () => whatsapp.sendTest());
ipcMain.handle('whatsapp-disconnect', () => whatsapp.disconnect());
ipcMain.handle('update-set-enabled', (_e, on) => updater.setEnabled(on));
ipcMain.handle('update-check', () => updater.check());
ipcMain.handle('update-install', () => { quitting = true; updater.installNow(); });
ipcMain.handle('set-sheet-url', (_e, url) => { store.set('sheetUrl', url); return refresh(); });
ipcMain.handle('ai-set-key', (_e, which, key) => ai.setKey(which, key));
ipcMain.handle('ai-set-provider', (_e, p) => ai.setProvider(p));
ipcMain.handle('ai-chat', async (_e, history, opts) => {
  // Si la última frase es una orden (recordatorio, evento, abrir un programa) se ejecuta en vez de charlar.
  const last = history[history.length - 1];
  if (last && last.role === 'user') {
    const done = await actions.tryHandle(last.content);
    if (done) { refresh(); return done; }
  }
  return ai.chat(history, latest, opts);
});
ipcMain.handle('voice-status', () => ({
  ...voice.status(), edgeVoices: tts.VOICES, defaultEdge: tts.DEFAULT_VOICE, piperReady: piper.status().ready
}));
ipcMain.handle('piper-install', async () => {
  await piper.install((what, pct) => { if (win) win.webContents.send('piper-progress', what, pct); });
  return true;
});
ipcMain.handle('piper-speak', (_e, text) => piper.synth(text));
ipcMain.handle('tts-speak', (_e, text, voiceId) => tts.synth(text, voiceId));
ipcMain.handle('voice-set', (_e, changes) => voice.set(changes));
ipcMain.handle('voice-prepare', () => voice.ensureModel((pct) => {
  if (win) win.webContents.send('voice-progress', pct);
}));
ipcMain.handle('voice-state', (_e, text) => { if (tray) tray.setToolTip('Asistente de Vida · ' + text); });
ipcMain.handle('show-window', () => showWindow());
ipcMain.handle('ai-briefing', () => makeBriefing());
ipcMain.handle('phone-create', () => { phone.createTopic(); return phone.pairing(); });
ipcMain.handle('phone-qr', () => phone.pairing());
ipcMain.handle('phone-set-enabled', (_e, on) => phone.setEnabled(on));
ipcMain.handle('phone-set-server', (_e, url) => phone.setServer(url));
ipcMain.handle('phone-disable', () => phone.disable());
ipcMain.handle('phone-test', async () => {
  await phone.send('Asistente de Vida', 'Listo, tu celular ya recibe los avisos.', { tags: ['white_check_mark'] });
});
ipcMain.handle('mobile-set-enabled', (_e, on) => { mobile.setEnabled(on); return mobile.status(); });
ipcMain.handle('mobile-start-pairing', () => mobile.startPairing());
ipcMain.handle('mobile-revoke', (_e, id) => { mobile.revoke(id); return mobile.status(); });
ipcMain.handle('set-reminders', (_e, times) => store.set('reminderTimes', times));
ipcMain.handle('set-autostart', (_e, on) => {
  app.setLoginItemSettings(loginItem(on));
});

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('mx.christopher.asistente-vida');
  // La primera vez se activa el arranque con el sistema; luego se respeta lo que elijas.
  if (store.get('autoStartInit') !== true) {
    app.setLoginItemSettings(loginItem(true));
    store.set('autoStartInit', true);
  }
  voice.serve();
  updater.init();
  // El micrófono solo se permite a la ventana del tablero.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(permission !== 'media' || (win && wc === win.webContents));
  });
  mobile.start({
    getData: async () => latest || refresh(),
    refresh,
    chat: (history) => ai.chat(history, latest)
  });
  createWindow();
  globalShortcut.register(VOICE_SHORTCUT, () => win && win.webContents.send('voice-activate'));
  createTray();
  refresh();
  setInterval(refresh, REFRESH_MS);
  setInterval(() => {
    for (const a of alarms.due()) {
      const n = new Notification({ title: 'Recordatorio', body: a.text });
      n.on('click', showWindow);
      n.show();
      if (win && voice.status().enabled) win.webContents.send('voice-speak', 'Recordatorio: ' + a.text);
      phone.trySend('Recordatorio', a.text, { priority: 4, tags: ['bell'] });
      whatsapp.trySend('Recordatorio', a.text);
    }
  }, 15 * 1000);
  setInterval(() => reminders.tick(latest, showWindow, (text) => {
    if (win && voice.status().enabled) win.webContents.send('voice-speak', text);
  }), 60 * 1000);
});

app.on('activate', showWindow);
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
// No salir cuando se cierran las ventanas: la app vive en la bandeja.
app.on('window-all-closed', () => {});
