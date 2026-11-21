// WhatsApp. Dos formas de conectarlo (si hay las dos, se usa la vinculada):
//
// 1) Número personal vinculado (la que sirve para archivos y ubicación): la app se une a tu cuenta
//    como un "dispositivo vinculado" (igual que WhatsApp Web) escaneando un QR, con la librería
//    abierta Baileys. Todo se manda a TU PROPIO chat ("Tú"), sin servidor ni Docker en medio.
//    Ojo: no es una API oficial. WhatsApp puede cambiar el protocolo y romperla, y su política no
//    permite clientes no oficiales, así que existe el riesgo de que restrinjan el número. Por eso
//    manda a tu propio chat y, solo si tú lo pides, mensajes, fotos y el pin de ubicación a contactos que guardaste; no guarda
//    conversaciones. Solo reacciona a la orden "ubicación a <contacto>" escrita por ti en tu propio chat y, si TÚ activas el
//    reenvío a Telegram, reenvía los mensajes que te llegan (nada se guarda en la PC).
// 2) La API oficial de Meta (Cloud API): solo avisos de texto, a tu número.
const path = require('path');
const fs = require('fs');
const { app, safeStorage } = require('electron');
const QRCode = require('qrcode');
const store = require('./store');
const { createAuthStore } = require('./whatsapp-auth');
const location = require('./location');
const files = require('./send-files');
const { parseLocationCommand } = require('./wa-commands');

const GRAPH = 'https://graph.facebook.com/v21.0';

// ---------- Cloud API (la de antes) ----------
function cloudStatus() {
  const c = store.getSecret('whatsapp');
  return !c ? 'desconectado' : c.enabled === false ? 'pausado' : 'conectado';
}

function save({ token, phoneId, to }) {
  token = String(token || '').trim();
  phoneId = String(phoneId || '').replace(/\D/g, '');
  to = String(to || '').replace(/\D/g, '');
  if (!token || !phoneId) throw new Error('Faltan el token y el ID del número de WhatsApp.');
  if (to.length < 10) throw new Error('Escribe tu número con lada de país, por ejemplo 523312345678.');
  store.setSecret('whatsapp', { token, phoneId, to, enabled: true });
}

function disconnect() {
  store.setSecret('whatsapp', null);
}

async function post(body) {
  const c = store.getSecret('whatsapp');
  if (!c) throw new Error('WhatsApp no está conectado.');
  const res = await fetch(`${GRAPH}/${c.phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: c.to, ...body }),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))).error || {};
    throw new Error(`WhatsApp rechazó el mensaje (${err.message || res.status}).`);
  }
}

// La plantilla de ejemplo de Meta sirve para probar sin esperar la ventana de 24 h.
const sendTestCloud = () => post({ type: 'template', template: { name: 'hello_world', language: { code: 'en_US' } } });

// ---------- Número personal vinculado (Baileys) ----------
let B = null; // la librería (es ESM: se carga la primera vez que se usa)
let sock = null;
let auth = null;
let link = { state: 'idle', qr: null, error: null }; // idle | qr | connecting | open
let selfJid = null;
let wantLinked = false;
let retry = 0;
let retryTimer = null;
let seq = 0;

const silent = { level: 'silent', child() { return silent; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };
const authFile = () => path.join(app.getPath('userData'), 'whatsapp-sesion.bin');
const linkedConfig = () => store.get('whatsappLinked') || null;

const seal = (text) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('El cifrado del sistema no está disponible.');
  return safeStorage.encryptString(text);
};
const open = (buf) => safeStorage.decryptString(buf);

async function lib() {
  if (!B) B = await import('@whiskeysockets/baileys');
  return B;
}

async function connect() {
  const mine = ++seq; // si llega un cierre de un socket viejo, se ignora
  clearTimeout(retryTimer);
  const lb = await lib();
  if (mine !== seq) return;
  if (!auth) auth = createAuthStore(authFile(), { seal, open, B: lb });
  const makeSocket = lb.default || lb.makeWASocket;
  let version;
  try { ({ version } = await lb.fetchLatestBaileysVersion()); } catch { /* se usa la que trae la librería */ }
  if (mine !== seq) return;
  link = { state: 'connecting', qr: null, error: null };
  const s = makeSocket({
    auth: auth.state, ...(version ? { version } : {}), logger: silent,
    browser: lb.Browsers ? lb.Browsers.windows('Asistente de Vida') : ['Asistente de Vida', 'Desktop', '1.0'],
    printQRInTerminal: false,
    // No baja el historial ni se marca "en línea": tu teléfono sigue avisándote normal.
    syncFullHistory: false, markOnlineOnConnect: false, generateHighQualityLinkPreview: false,
    // Nunca se piden mensajes viejos de tus chats.
    getMessage: async () => undefined
  });
  sock = s;
  s.ev.on('creds.update', () => auth.saveCreds());
  s.ev.on('messages.upsert', (u) => { for (const m of (u && u.messages) || []) onMessage(m, lb, s); });
  s.ev.on('connection.update', async (u) => {
    if (mine !== seq) return;
    if (u.qr) {
      try { link = { state: 'qr', qr: await QRCode.toDataURL(u.qr, { margin: 1, width: 280 }), error: null }; } catch {}
    }
    if (u.connection === 'open') {
      retry = 0;
      selfJid = lb.jidNormalizedUser(s.user && s.user.id);
      const number = String(selfJid || '').split('@')[0];
      store.set('whatsappLinked', { number, since: (linkedConfig() || {}).since || new Date().toISOString() });
      auth.flush();
      link = { state: 'open', qr: null, error: null };
    }
    if (u.connection === 'close') {
      selfJid = null;
      const code = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output && u.lastDisconnect.error.output.statusCode;
      if (code === lb.DisconnectReason.loggedOut) {
        // Quitaron la vinculación desde el teléfono.
        wipeSession();
        link = { state: 'idle', qr: null, error: 'Se cerró la vinculación desde tu teléfono. Vuelve a vincular.' };
        return;
      }
      if (!wantLinked) return;
      link = { ...link, state: 'connecting', qr: null };
      // 515 = reinicio normal justo después de escanear el QR.
      const wait = code === lb.DisconnectReason.restartRequired ? 500 : Math.min(5 * 60000, 5000 * 2 ** retry++);
      retryTimer = setTimeout(() => connect().catch(onConnectError), wait);
    }
  });
}

// Órdenes desde tu chat "Tú": de tus propios mensajes solo se actúa si dicen "ubicación a <contacto
// guardado>". Los mensajes de otras personas solo se miran si activaste el reenvío a Telegram
// (waForward) y se pasan tal cual al reenviador, sin guardarlos.
const seenIds = new Set();
const remoteOn = () => store.get('waRemote') !== false;
let incomingHandler = null;
const setIncomingHandler = (fn) => { incomingHandler = fn; };

// 'off' (por defecto) | 'saved' (solo tus contactos guardados) | 'all' (cualquier chat individual).
const forwardMode = () => { const v = store.get('waForward'); return v === 'saved' || v === 'all' ? v : 'off'; };
function setForward(mode) {
  if (!['off', 'saved', 'all'].includes(mode)) throw new Error('Modo de reenvío no válido.');
  store.set('waForward', mode);
  return mode;
}

function isOwnChat(jid, s, lb) {
  if (!jid || !s.user) return false;
  const norm = (j) => (j ? lb.jidNormalizedUser(j) : null);
  return jid === norm(s.user.id) || jid === norm(s.user.lid);
}

// Solo mensajes recientes (al reconectar WhatsApp reenvía los viejos) y sin repetir.
function fresh(m) {
  const ts = m.messageTimestamp && typeof m.messageTimestamp === 'object' && m.messageTimestamp.toNumber ? m.messageTimestamp.toNumber() : Number(m.messageTimestamp);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 120) return false;
  if (seenIds.has(m.key.id)) return false;
  seenIds.add(m.key.id);
  if (seenIds.size > 500) seenIds.delete(seenIds.values().next().value);
  return true;
}

function onMessage(m, lb, s) {
  try {
    if (!m || !m.key || !m.message) return;
    if (m.key.fromMe) onOwnMessage(m, lb, s);
    else onIncoming(m);
  } catch (err) {
    console.error('Mensaje de WhatsApp:', err.message);
  }
}

function onOwnMessage(m, lb, s) {
  if (!remoteOn() || !isOwnChat(m.key.remoteJid, s, lb)) return;
  const text = m.message.conversation || (m.message.extendedTextMessage && m.message.extendedTextMessage.text);
  if (!text) return;
  const name = parseLocationCommand(text);
  if (!name || !fresh(m)) return;
  sendLocationTo(name)
    .then((r) => sendLinked({ text: `*Asistente de Vida*\nListo, le mandé a ${r.contact} la ubicación de la PC (un solo pin).` }))
    .catch((err) => sendLinked({ text: `*Asistente de Vida*\nNo pude mandar la ubicación: ${err.message}` }).catch(() => {}));
}

// Texto corto de lo que llegó (las fotos y videos no se descargan: solo se avisa que llegaron).
function describe(msg) {
  const x = (msg.ephemeralMessage && msg.ephemeralMessage.message) || (msg.viewOnceMessage && msg.viewOnceMessage.message) || msg;
  if (x.conversation) return x.conversation;
  if (x.extendedTextMessage && x.extendedTextMessage.text) return x.extendedTextMessage.text;
  const cap = (o) => (o && o.caption ? ' ' + o.caption : '');
  if (x.imageMessage) return '[Foto]' + cap(x.imageMessage);
  if (x.videoMessage) return '[Video]' + cap(x.videoMessage);
  if (x.audioMessage) return '[Nota de voz o audio]';
  if (x.documentMessage) return `[Documento: ${x.documentMessage.fileName || 'sin nombre'}]`;
  if (x.locationMessage) return '[Ubicación]';
  if (x.contactMessage) return '[Contacto]';
  return null;
}

// Número (solo dígitos) de quien escribe; con identificadores "lid" se busca el número alterno.
function numberOf(m) {
  const k = m.key || {};
  for (const j of [k.remoteJid, k.remoteJidAlt, k.senderPn, k.participantAlt]) {
    const mm = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(j || '');
    if (mm) return mm[1];
  }
  return null;
}

const last10 = (n) => String(n || '').replace(/\D/g, '').slice(-10);
const savedByNumber = (num) => (num ? contacts().find((c) => last10(c.number) === last10(num)) || null : null);

function onIncoming(m) {
  const mode = forwardMode();
  if (mode === 'off' || !incomingHandler) return;
  const jid = m.key.remoteJid || '';
  if (!/@(s\.whatsapp\.net|lid)$/.test(jid)) return; // sin grupos, estados, canales ni difusiones
  const body = describe(m.message);
  if (!body) return;
  const num = numberOf(m);
  const saved = savedByNumber(num);
  if (mode === 'saved' && !saved) return;
  if (!fresh(m)) return;
  const label = saved ? saved.name : m.pushName ? `${m.pushName}${num ? ` (+${num})` : ''}` : num ? `+${num}` : 'Alguien';
  Promise.resolve(incomingHandler({ jid, label, text: body })).catch((err) => console.error('Reenvío a Telegram:', err.message));
}

function onConnectError(err) {
  console.error('WhatsApp vinculado:', err.message);
  link = { state: 'idle', qr: null, error: err.message };
  if (wantLinked) retryTimer = setTimeout(() => connect().catch(onConnectError), Math.min(5 * 60000, 5000 * 2 ** retry++));
}

function wipeSession() {
  wantLinked = false;
  seq++;
  clearTimeout(retryTimer);
  if (auth) auth.wipe();
  else { try { fs.unlinkSync(authFile()); } catch {} }
  auth = null;
  sock = null;
  selfJid = null;
  store.set('whatsappLinked', null);
}

// Al abrir la app: si ya estaba vinculado, reconecta solo.
function init() {
  if (linkedConfig() && fs.existsSync(authFile())) {
    wantLinked = true;
    connect().catch(onConnectError);
  }
}

// Empieza la vinculación: la pantalla pide linkState() cada par de segundos para mostrar el QR.
function startLink() {
  if (link.state === 'open') return linkState();
  wantLinked = true;
  retry = 0;
  if (sock) { seq++; try { sock.end(undefined); } catch {} sock = null; }
  connect().catch(onConnectError);
  return linkState();
}

// Cierra una vinculación a medias. Una sesión ya vinculada no se toca (para eso está unlink).
function cancelLink() {
  if (link.state === 'open' || (auth && auth.registered())) return;
  wantLinked = false;
  seq++;
  clearTimeout(retryTimer);
  try { sock && sock.end(undefined); } catch {}
  sock = null;
  if (auth) auth.wipe();
  auth = null;
  link = { state: 'idle', qr: null, error: null };
}

async function unlink() {
  const s = sock;
  wipeSession();
  link = { state: 'idle', qr: null, error: null };
  try { if (s) await s.logout(); } catch { try { s && s.end(undefined); } catch {} }
}

const linkState = () => ({ state: link.state, qr: link.qr, error: link.error, number: (linkedConfig() || {}).number || null });
const linkedReady = () => link.state === 'open' && !!sock && !!selfJid;

function needLinked() {
  if (linkedReady()) return;
  throw new Error(wantLinked ? 'WhatsApp se está reconectando; inténtalo en un momento.' : 'Primero vincula tu WhatsApp en Conexiones → WhatsApp.');
}

async function sendLinked(content) {
  needLinked();
  await sock.sendMessage(selfJid, content);
}

// ---------- Mandar cosas ----------
const send = async (title, message) => {
  if (linkedReady()) return sendLinked({ text: `*${title}*\n${message}` });
  if (cloudStatus() === 'conectado') return post({ type: 'text', text: { body: `*${title}*\n${message}` } });
  throw new Error('WhatsApp no está conectado.');
};

function trySend(title, message) {
  if (!linkedReady() && cloudStatus() !== 'conectado') return;
  send(title, message).catch((err) => console.error('Aviso por WhatsApp:', err.message));
}

async function sendTest() {
  if (linkedReady()) return sendLinked({ text: '*Asistente de Vida*\nListo, tu WhatsApp ya recibe los avisos.' });
  if (cloudStatus() === 'conectado') return sendTestCloud();
  throw new Error('WhatsApp no está conectado.');
}

async function sendFile(file) {
  needLinked();
  files.check(file);
  const buffer = await fs.promises.readFile(file);
  await sendLinked(files.messageFor(file, buffer));
  return path.basename(file);
}

// Solo coordenadas: con nombre o dirección, Maps busca ese texto en vez de abrir el punto exacto.
function pin(loc) {
  return { location: { degreesLatitude: loc.lat, degreesLongitude: loc.lon } };
}

async function sendLocation() {
  needLinked();
  const loc = await location.current();
  await sendLinked(pin(loc));
  return loc;
}

// ---------- Contactos a los que puedes mandar tu ubicación ----------
// Solo a personas que TÚ guardas aquí con nombre y número (nunca a un número que diga un texto o
// la IA), un solo pin por envío, y con un tope diario para no parecer spam.
const MAX_TO_OTHERS_PER_DAY = 20;
let sentToday = { day: '', n: 0 };

const plain = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const setRemote = (on) => store.set('waRemote', !!on);

function contacts() {
  return Object.entries(store.get('waContacts') || {}).map(([name, number]) => ({ name, number }));
}

function addContact(name, number) {
  name = String(name || '').trim().slice(0, 40);
  const digits = String(number || '').replace(/\D/g, '');
  if (!name) throw new Error('Escribe el nombre del contacto.');
  if (digits.length < 10 || digits.length > 15) throw new Error('Escribe el número con lada de país, por ejemplo 523312345678.');
  store.set('waContacts', { ...(store.get('waContacts') || {}), [name]: digits });
  return contacts();
}

function removeContact(name) {
  const mine = { ...(store.get('waContacts') || {}) };
  delete mine[name];
  store.set('waContacts', mine);
  return contacts();
}

function findContact(text) {
  const wanted = plain(text);
  if (!wanted) return null;
  const list = contacts();
  return list.find((c) => plain(c.name) === wanted) || list.find((c) => plain(c.name).includes(wanted) || wanted.includes(plain(c.name))) || null;
}

// Tope diario de envíos a otras personas (cuenta todo: texto, fotos y pines).
function reserveSend() {
  const day = new Date().toDateString();
  if (sentToday.day !== day) sentToday = { day, n: 0 };
  if (sentToday.n >= MAX_TO_OTHERS_PER_DAY) throw new Error('Ya llegaste al tope de mensajes a otras personas por hoy.');
  sentToday.n++;
}

// Manda algo a un contacto guardado (nunca a un número que no guardaste tú).
async function sendToContact(name, content) {
  needLinked();
  const c = findContact(name);
  if (!c) throw new Error(`No tengo guardado a "${name}". Agrégalo en Conexiones → WhatsApp → Contactos.`);
  const found = await sock.onWhatsApp(c.number);
  const hit = Array.isArray(found) ? found.find((x) => x && x.exists) : null;
  if (!hit) throw new Error(`${c.name} (+${c.number}) no aparece en WhatsApp; revisa el número.`);
  reserveSend();
  await sock.sendMessage(hit.jid, content);
  return { contact: c.name };
}

const sendTextToContact = (name, text) => sendToContact(name, { text: String(text).slice(0, 3000) });
const sendMediaToContact = (name, content) => sendToContact(name, content);

// Contesta en un chat que te escribió (solo desde la confirmación de Telegram).
async function replyTo(jid, text) {
  needLinked();
  if (!/@(s\.whatsapp\.net|lid)$/.test(String(jid))) throw new Error('Ese chat no admite respuestas desde aquí.');
  reserveSend();
  await sock.sendMessage(jid, { text: String(text).slice(0, 3000) });
}

// Manda UN pin con la ubicación de la PC a un contacto guardado. No se actualiza después.
async function sendLocationTo(name) {
  needLinked();
  if (!findContact(name)) throw new Error(`No tengo guardado a "${name}". Agrégalo en Conexiones → WhatsApp → Contactos.`);
  const loc = await location.current();
  const r = await sendToContact(name, pin(loc));
  return { contact: r.contact, loc };
}

// Para la pantalla.
function status() {
  return linkedReady() ? 'conectado' : cloudStatus();
}

function info() {
  return {
    cloud: cloudStatus(),
    linked: linkState(),
    contacts: contacts(),
    remote: remoteOn(),
    forward: forwardMode(),
    locationIp: location.allowIp()
  };
}

function shutdown() {
  seq++;
  clearTimeout(retryTimer);
  if (auth) auth.flush();
  try { sock && sock.end(undefined); } catch {}
}

module.exports = {
  status, info, init, shutdown, save, disconnect, send, sendTest, trySend,
  startLink, cancelLink, unlink, linkState,
  sendFile, sendLocation, sendLocationTo, sendTextToContact, sendMediaToContact, replyTo, setForward, setIncomingHandler, contacts, addContact, removeContact, findContact,
  setLocationIp: location.setAllowIp, setRemote, linkedReady
};
