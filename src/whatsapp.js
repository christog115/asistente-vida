// WhatsApp. Dos formas de conectarlo (si hay las dos, se usa la vinculada):
//
// 1) Número personal vinculado (la que sirve para archivos y ubicación): la app se une a tu cuenta
//    como un "dispositivo vinculado" (igual que WhatsApp Web) escaneando un QR, con la librería
//    abierta Baileys. Todo se manda a TU PROPIO chat ("Tú"), sin servidor ni Docker en medio.
//    Ojo: no es una API oficial. WhatsApp puede cambiar el protocolo y romperla, y su política no
//    permite clientes no oficiales, así que existe el riesgo de que restrinjan el número. Por eso
//    solo manda a tu propio chat, nunca a otras personas, y no lee ni guarda ninguna conversación.
// 2) La API oficial de Meta (Cloud API): solo avisos de texto, a tu número.
const path = require('path');
const fs = require('fs');
const { app, safeStorage } = require('electron');
const QRCode = require('qrcode');
const store = require('./store');
const { createAuthStore } = require('./whatsapp-auth');
const location = require('./location');
const files = require('./send-files');

const GRAPH = 'https://graph.facebook.com/v21.0';
const LOCATION_EVERY_MS = 2 * 60 * 1000;
const LOCATION_MIN_MOVE_M = 30;
const LOCATION_RESEND_MS = 10 * 60 * 1000;
const MAX_SHARE_MIN = 8 * 60;

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
    // Nunca se pide ni se procesa ningún mensaje de tus chats.
    getMessage: async () => undefined
  });
  sock = s;
  s.ev.on('creds.update', () => auth.saveCreds());
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

function onConnectError(err) {
  console.error('WhatsApp vinculado:', err.message);
  link = { state: 'idle', qr: null, error: err.message };
  if (wantLinked) retryTimer = setTimeout(() => connect().catch(onConnectError), Math.min(5 * 60000, 5000 * 2 ** retry++));
}

function wipeSession() {
  wantLinked = false;
  seq++;
  clearTimeout(retryTimer);
  stopSharing();
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

function pin(loc, name) {
  return { location: { degreesLatitude: loc.lat, degreesLongitude: loc.lon, name, address: loc.accuracy ? `Precisión de unos ${loc.accuracy} m` : loc.place ? `Aproximada (${loc.place})` : undefined } };
}

async function sendLocation() {
  needLinked();
  const loc = await location.current();
  await sendLinked(pin(loc, loc.source === 'ip' ? 'Mi PC (ubicación aproximada)' : 'Mi PC'));
  return loc;
}

// "Ubicación en tiempo real": WhatsApp no deja a clientes no oficiales abrir su ubicación en vivo,
// así que se manda un pin nuevo cada 2 min mientras te muevas (o cada 10 min si estás quieto).
let share = null;
function stopSharing() {
  if (!share) return false;
  clearInterval(share.timer);
  share = null;
  return true;
}

function sharing() {
  return share ? { until: share.until, minutesLeft: Math.max(0, Math.ceil((share.until - Date.now()) / 60000)) } : null;
}

async function shareLocation(minutes) {
  needLinked();
  const min = Math.min(MAX_SHARE_MIN, Math.max(5, Math.round(Number(minutes) || 60)));
  stopSharing();
  const first = await location.current();
  await sendLinked(pin(first, 'Mi PC (inicio)'));
  const me = { until: Date.now() + min * 60000, last: first, lastAt: Date.now(), timer: null, busy: false };
  share = me;
  me.timer = setInterval(async () => {
    if (share !== me || me.busy) return;
    if (Date.now() >= me.until) { stopSharing(); sendLinked({ text: '*Asistente de Vida*\nTerminó la ubicación compartida de mi PC.' }).catch(() => {}); return; }
    me.busy = true;
    try {
      const loc = await location.current();
      const moved = location.distance(me.last, loc) > LOCATION_MIN_MOVE_M;
      if (moved || Date.now() - me.lastAt >= LOCATION_RESEND_MS) {
        await sendLinked(pin(loc, 'Mi PC'));
        me.last = loc;
        me.lastAt = Date.now();
      }
    } catch (err) {
      console.error('Ubicación compartida:', err.message);
    } finally {
      me.busy = false;
    }
  }, LOCATION_EVERY_MS);
  return min;
}

// Para la pantalla.
function status() {
  return linkedReady() ? 'conectado' : cloudStatus();
}

function info() {
  return {
    cloud: cloudStatus(),
    linked: linkState(),
    sharing: sharing(),
    locationIp: location.allowIp()
  };
}

function shutdown() {
  stopSharing();
  seq++;
  clearTimeout(retryTimer);
  if (auth) auth.flush();
  try { sock && sock.end(undefined); } catch {}
}

module.exports = {
  status, info, init, shutdown, save, disconnect, send, sendTest, trySend,
  startLink, cancelLink, unlink, linkState,
  sendFile, sendLocation, shareLocation, stopSharing, sharing,
  setLocationIp: location.setAllowIp, linkedReady
};
