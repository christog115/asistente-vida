// Conexión con Google: Gmail, Calendar, Tasks, Drive y Classroom.
// Usa OAuth de "app de escritorio": se abre tu navegador, aceptas los permisos
// y Google devuelve el acceso a un servidor local temporal. Tu contraseña
// de Google nunca pasa por la app.
const { app, shell } = require('electron');
const { google } = require('googleapis');
const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly'
];

// El archivo de credenciales se descarga de Google Cloud (ver README).
function credentialsPath() {
  const candidates = [
    path.join(app.getPath('userData'), 'google-credentials.json'),
    path.join(__dirname, '..', 'credentials', 'google-credentials.json')
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function makeClient(redirectUri) {
  const p = credentialsPath();
  if (!p) return null;
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const { client_id, client_secret } = raw.installed || raw.web;
  const client = new google.auth.OAuth2(client_id, client_secret, redirectUri);
  client.on('tokens', (tokens) => {
    store.setSecret('google', { ...store.getSecret('google'), ...tokens });
  });
  return client;
}

function authedClient() {
  const tokens = store.getSecret('google');
  if (!tokens) return null;
  const client = makeClient();
  if (!client) return null;
  client.setCredentials(tokens);
  return client;
}

function status() {
  if (!credentialsPath()) return 'sin-credenciales';
  return store.getSecret('google') ? 'conectado' : 'desconectado';
}

function connect() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}`;
      const client = makeClient(redirectUri);
      if (!client) {
        server.close();
        return reject(new Error('Falta google-credentials.json (ver README).'));
      }
      const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
      server.on('request', async (req, res) => {
        const code = new URL(req.url, redirectUri).searchParams.get('code');
        if (!code) return res.end();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<h2>Listo. Ya puedes cerrar esta pestaña y volver al Asistente.</h2>');
        server.close();
        try {
          const { tokens } = await client.getToken(code);
          store.setSecret('google', tokens);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      shell.openExternal(url);
    });
  });
}

function disconnect() {
  store.setSecret('google', null);
}

async function unreadEmails(auth) {
  const gmail = google.gmail({ version: 'v1', auth });
  const list = await gmail.users.messages.list({ userId: 'me', q: 'is:unread in:inbox', maxResults: 10 });
  const msgs = list.data.messages || [];
  return Promise.all(msgs.map(async ({ id }) => {
    const m = await gmail.users.messages.get({
      userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'Subject']
    });
    const h = Object.fromEntries(m.data.payload.headers.map((x) => [x.name, x.value]));
    return { id, from: h.From, subject: h.Subject || '(sin asunto)', snippet: m.data.snippet,
      url: `https://mail.google.com/mail/u/0/#inbox/${id}` };
  }));
}

async function todayEvents(auth) {
  const calendar = google.calendar({ version: 'v3', auth });
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 2);
  const res = await calendar.events.list({
    calendarId: 'primary', timeMin: start.toISOString(), timeMax: end.toISOString(),
    singleEvents: true, orderBy: 'startTime'
  });
  return (res.data.items || []).map((e) => ({
    title: e.summary || '(sin título)',
    start: e.start.dateTime || e.start.date,
    allDay: !e.start.dateTime,
    url: e.htmlLink
  }));
}

async function tasks(auth) {
  const api = google.tasks({ version: 'v1', auth });
  const lists = (await api.tasklists.list()).data.items || [];
  const all = await Promise.all(lists.map(async (l) => {
    const res = await api.tasks.list({ tasklist: l.id, showCompleted: false });
    return (res.data.items || []).map((t) => ({ title: t.title, due: t.due || null, list: l.title }));
  }));
  return all.flat();
}

async function recentFiles(auth) {
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.list({
    pageSize: 8, orderBy: 'viewedByMeTime desc', q: 'trashed = false',
    fields: 'files(id,name,webViewLink,mimeType)'
  });
  return (res.data.files || []).map((f) => ({ name: f.name, url: f.webViewLink }));
}

// Tareas de Classroom que todavía no entregas.
async function classroomPending(auth) {
  const classroom = google.classroom({ version: 'v1', auth });
  const courses = (await classroom.courses.list({ studentId: 'me', courseStates: ['ACTIVE'] })).data.courses || [];
  const perCourse = await Promise.all(courses.map(async (c) => {
    const [work, subs] = await Promise.all([
      classroom.courses.courseWork.list({ courseId: c.id, orderBy: 'dueDate desc', pageSize: 30 }),
      classroom.courses.courseWork.studentSubmissions.list({ courseId: c.id, courseWorkId: '-', userId: 'me' })
    ]);
    const done = new Set((subs.data.studentSubmissions || [])
      .filter((s) => s.state === 'TURNED_IN' || s.state === 'RETURNED')
      .map((s) => s.courseWorkId));
    return (work.data.courseWork || [])
      .filter((w) => !done.has(w.id))
      .map((w) => ({
        source: 'Classroom',
        course: c.name,
        title: w.title,
        due: classroomDue(w),
        url: w.alternateLink
      }));
  }));
  return perCourse.flat();
}

function classroomDue(w) {
  if (!w.dueDate) return null;
  const { year, month, day } = w.dueDate;
  const { hours = 23, minutes = 59 } = w.dueTime || {};
  return new Date(Date.UTC(year, month - 1, day, hours, minutes)).toISOString();
}

// Hoja de pendientes en Google Sheets (ej. pendientes del trabajo).
// Columnas: Tarea | Fecha | Hecho. Si hay encabezados con esos nombres se
// usan; si no, se toman las tres primeras columnas en ese orden.
function sheetId(url) {
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(url || '');
  return m ? m[1] : (url || '').trim() || null;
}

const DONE = /^(s[ií]|x|✓|✔|hecho|listo|terminado|true|verdadero)$/i;

async function sheetPending(auth) {
  const id = sheetId(store.get('sheetUrl'));
  if (!id) return null;
  const sheets = google.sheets({ version: 'v4', auth });
  let res;
  try {
    res = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: 'A1:Z500' });
  } catch (err) {
    if (err.code === 403) throw new Error('Vuelve a conectar Google para darle permiso a Sheets.');
    throw err;
  }
  const rows = res.data.values || [];
  if (!rows.length) return [];
  const head = rows[0].map((h) => String(h).toLowerCase());
  const col = (re, fallback) => {
    const i = head.findIndex((h) => re.test(h));
    return i >= 0 ? i : fallback;
  };
  const hasHeader = head.some((h) => /tarea|pendiente|fecha|hecho|estado/.test(h));
  const ti = col(/tarea|pendiente|actividad/, 0);
  const di = col(/fecha|vence|entrega/, 1);
  const hi = col(/hecho|estado|listo/, 2);
  return rows.slice(hasHeader ? 1 : 0)
    .filter((r) => r[ti] && !DONE.test(String(r[hi] || '').trim()))
    .map((r) => ({ title: r[ti], due: r[di] || null, url: `https://docs.google.com/spreadsheets/d/${id}` }));
}

// Junta todo lo de Google; si una parte falla, las demás siguen.
async function fetchAll() {
  const auth = authedClient();
  if (!auth) return null;
  const safe = (p) => p.catch((err) => ({ error: err.message }));
  const [emails, events, todo, files, school, sheet] = await Promise.all([
    safe(unreadEmails(auth)), safe(todayEvents(auth)), safe(tasks(auth)),
    safe(recentFiles(auth)), safe(classroomPending(auth)), safe(sheetPending(auth))
  ]);
  return { emails, events, tasks: todo, files, school, sheet };
}

// Crea un evento en el calendario principal. start/end son fechas JS.
async function createEvent({ title, start, end }) {
  const auth = authedClient();
  if (!auth) throw new Error('Conecta Google en Conexiones para crear eventos.');
  const calendar = google.calendar({ version: 'v3', auth });
  try {
    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: { summary: title, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } }
    });
    return { url: res.data.htmlLink };
  } catch (err) {
    if (err.code === 403 || /insufficient/i.test(err.message)) {
      throw new Error('Google no me deja crear eventos todavía: en Conexiones toca Desconectar y luego Conectar con Google para dar el permiso nuevo.');
    }
    throw err;
  }
}

module.exports = { status, connect, disconnect, fetchAll, createEvent };
