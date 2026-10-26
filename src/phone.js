// Avisos en el celular con ntfy (https://ntfy.sh): app gratis para Android y
// iPhone que recibe notificaciones push sin cuenta. La PC publica a un "tema"
// con nombre aleatorio y largo; quien conozca el nombre puede leer los avisos,
// así que se guarda cifrado y solo se muestra como QR en tu pantalla.
const crypto = require('crypto');
const QRCode = require('qrcode');
const store = require('./store');

const DEFAULT_SERVER = 'https://ntfy.sh';

function config() {
  return { server: DEFAULT_SERVER, enabled: false, ...(store.get('phone') || {}) };
}

function topic() {
  return store.getSecret('phoneTopic');
}

function status() {
  const c = config();
  return { enabled: c.enabled && !!topic(), hasTopic: !!topic(), server: c.server };
}

// Nombre fácil de escribir en el celular: 16 letras/números sin los que se
// confunden (i, l, o, 0, 1), en grupos de 4. Son ~79 bits al azar.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function randomTopic() {
  const chars = Array.from({ length: 16 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]);
  return chars.join('').match(/.{4}/g).join('-');
}

// Crea un tema nuevo (el anterior deja de funcionar) y enciende los avisos.
function createTopic() {
  store.setSecret('phoneTopic', randomTopic());
  store.set('phone', { ...config(), enabled: true });
}

function setEnabled(on) {
  store.set('phone', { ...config(), enabled: !!on });
}

function setServer(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('La dirección debe empezar con https://');
  store.set('phone', { ...config(), server: u.origin });
}

function disable() {
  store.setSecret('phoneTopic', null);
  store.set('phone', { ...config(), enabled: false });
}

// Datos para suscribir el celular. La app ntfy pide escribir el nombre del
// tema (no tiene escáner), así que se muestra el nombre; el QR es un extra
// para abrir el enlace con la cámara.
async function pairing() {
  const t = topic();
  if (!t) return null;
  const { host } = new URL(config().server);
  const link = `ntfy://${host}/${t}`;
  return { topic: t, host, link, image: await QRCode.toDataURL(link, { margin: 1, width: 240 }) };
}

// Publica con JSON (no con encabezados) para que los acentos lleguen bien.
async function send(title, message, { priority = 3, tags = [] } = {}) {
  const c = config();
  const t = topic();
  if (!c.enabled || !t) return false;
  const res = await fetch(c.server, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: t, title, message, priority, tags }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`ntfy respondió ${res.status}`);
  return true;
}

// Los avisos del celular nunca deben tumbar a los de la PC.
function trySend(title, message, opts) {
  send(title, message, opts).catch((err) => console.error('Aviso al celular:', err.message));
}

module.exports = { status, createTopic, setEnabled, setServer, disable, pairing, send, trySend };
