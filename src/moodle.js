// Lector de la plataforma Moodle de la escuela (ej. https://tonala-virtual.ceti.mx).
//
// Dos formas de conectarse, y la app prueba la primera y cae a la segunda:
//  1. "token": la API oficial de Moodle (la misma que usa la app móvil de Moodle).
//     Escribes usuario y contraseña en la ventana de la app, se mandan directo a
//     la escuela y solo se guarda el token resultante, cifrado. La contraseña no
//     se guarda en ningún lado.
//  2. "navegador": si la escuela tiene la API apagada, se abre la página real
//     de la escuela, inicias sesión ahí como siempre, y la app lee la sección
//     "Próximos eventos" en una ventana oculta usando esa sesión.
const { BrowserWindow } = require('electron');
const store = require('./store');

const PARTITION = 'persist:moodle';

function baseUrl() {
  return store.get('moodle').url.replace(/\/+$/, '');
}

function status() {
  const cfg = store.get('moodle');
  if (cfg.mode === 'navegador') return cfg.browserReady ? 'conectado' : 'desconectado';
  return store.getSecret('moodle') ? 'conectado' : 'desconectado';
}

// --- Modo 1: API oficial ---------------------------------------------------

async function connectWithPassword(username, password) {
  const body = new URLSearchParams({ username, password, service: 'moodle_mobile_app' });
  const res = await fetch(`${baseUrl()}/login/token.php`, { method: 'POST', body });
  const data = await res.json();
  if (!data.token) {
    // "enablewsdescription" o similar significa que la escuela no permite la API.
    throw new Error(data.error || 'La escuela no devolvió un token.');
  }
  const info = await call(data.token, 'core_webservice_get_site_info');
  store.setSecret('moodle', { token: data.token, userid: info.userid });
  store.set('moodle', { ...store.get('moodle'), mode: 'token' });
}

async function call(token, wsfunction, params = {}) {
  const body = new URLSearchParams({ wstoken: token, wsfunction, moodlewsrestformat: 'json' });
  for (const [k, v] of Object.entries(params)) body.append(k, String(v));
  const res = await fetch(`${baseUrl()}/webservice/rest/server.php`, { method: 'POST', body });
  const data = await res.json();
  if (data && data.exception) throw new Error(data.message);
  return data;
}

// La misma lista que muestra el bloque "Línea de tiempo" del Moodle:
// entregas pendientes con fecha, incluyendo las vencidas de la última semana.
async function pendingViaApi() {
  const { token } = store.getSecret('moodle');
  const from = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
  const data = await call(token, 'core_calendar_get_action_events_by_timesort', {
    timesortfrom: from, limitnum: 50
  });
  return (data.events || []).map((e) => ({
    source: 'Moodle',
    course: e.course ? e.course.fullname : '',
    title: e.activityname || e.name,
    due: new Date(e.timesort * 1000).toISOString(),
    url: (e.action && e.action.url) || e.url
  }));
}

// --- Modo 2: leer la página con tu sesión ---------------------------------

function openLoginWindow(parent) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      parent, width: 1000, height: 760, title: 'Inicia sesión en tu escuela',
      webPreferences: { partition: PARTITION }
    });
    win.loadURL(`${baseUrl()}/my/`);
    // Cuando la página ya no está en /login/, la sesión quedó abierta.
    win.webContents.on('did-navigate', (_e, url) => {
      if (url.startsWith(baseUrl()) && !url.includes('/login/')) {
        store.set('moodle', { ...store.get('moodle'), mode: 'navegador', browserReady: true });
      }
    });
    win.on('closed', () => resolve(status()));
  });
}

async function pendingViaBrowser() {
  const win = new BrowserWindow({ show: false, webPreferences: { partition: PARTITION } });
  try {
    await win.loadURL(`${baseUrl()}/calendar/view.php?view=upcoming`);
    if (win.webContents.getURL().includes('/login/')) {
      store.set('moodle', { ...store.get('moodle'), browserReady: false });
      throw new Error('La sesión de la escuela expiró. Vuelve a iniciar sesión.');
    }
    const items = await win.webContents.executeJavaScript(`
      Array.from(document.querySelectorAll('[data-type="event"], .event')).map((el) => {
        const title = el.querySelector('h3, .name')?.innerText.trim() || el.getAttribute('data-event-title') || '';
        const link = el.querySelector('a.card-link, .card-footer a, a[href*="/mod/"]');
        const course = el.querySelector('a[href*="course/view.php"]')?.innerText.trim() || '';
        const when = el.querySelector('.description .row .col-11, .date')?.innerText.trim() || '';
        return { title, course, when, url: link ? link.href : '' };
      }).filter((x) => x.title);
    `);
    return items.map((x) => ({ source: 'Moodle', course: x.course, title: x.title, due: null, dueText: x.when, url: x.url }));
  } finally {
    win.destroy();
  }
}

async function fetchPending() {
  const cfg = store.get('moodle');
  if (cfg.mode === 'token' && store.getSecret('moodle')) return pendingViaApi();
  if (cfg.mode === 'navegador' && cfg.browserReady) return pendingViaBrowser();
  return null;
}

function disconnect() {
  store.setSecret('moodle', null);
  store.set('moodle', { ...store.get('moodle'), browserReady: false });
}

module.exports = { status, connectWithPassword, openLoginWindow, fetchPending, disconnect };
