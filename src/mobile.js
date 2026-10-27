// Servidor local para la app del celular. La PC responde solo a celulares
// emparejados: se empareja con un código de 6 dígitos (un solo uso, 10 minutos)
// y a cambio el celular recibe una clave larga que la PC guarda únicamente como
// huella (hash). No hay servidores intermedios: el celular habla directo con la
// PC por tu Wi-Fi o por Tailscale.
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const QRCode = require('qrcode');
const store = require('./store');

const PORT = 47821;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_BODY = 256 * 1024;

let server = null;
let startError = null;
let handlers = null;
let pairing = null; // { code, expires, failures }
let lockedUntil = 0;
let lastSeenWrite = 0;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function config() {
  return { enabled: false, ...(store.get('mobile') || {}) };
}

function devices() {
  return store.get('mobileDevices') || [];
}

function saveDevices(list) {
  store.set('mobileDevices', list);
}

// Direcciones donde el celular puede encontrar la PC. Las de Tailscale
// (100.64.0.0/10) funcionan también fuera de casa.
function addresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const [a, b] = i.address.split('.').map(Number);
      const tailscale = a === 100 && b >= 64 && b <= 127;
      out.push({ url: `http://${i.address}:${PORT}`, tailscale });
    }
  }
  return out.sort((x, y) => Number(x.tailscale) - Number(y.tailscale));
}

function status() {
  const p = livePairing();
  return {
    enabled: config().enabled,
    running: !!server && server.listening,
    error: startError,
    port: PORT,
    addresses: addresses(),
    devices: devices().map(({ id, name, createdAt, lastSeen }) => ({ id, name, createdAt, lastSeen })),
    pairing: p ? { code: p.code, expires: p.expires } : null
  };
}

function livePairing() {
  if (pairing && Date.now() > pairing.expires) pairing = null;
  return pairing;
}

async function startPairing() {
  pairing = { code: String(crypto.randomInt(0, 1e6)).padStart(6, '0'), expires: Date.now() + CODE_TTL_MS, failures: 0 };
  const urls = addresses().map((a) => a.url);
  const payload = JSON.stringify({ a: urls, c: pairing.code });
  const image = await QRCode.toDataURL(payload, { margin: 1, width: 240 });
  return { code: pairing.code, expires: pairing.expires, urls, image };
}

function revoke(id) {
  saveDevices(devices().filter((d) => d.id !== id));
}

// --- HTTP ---------------------------------------------------------------

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json), 'Cache-Control': 'no-store' });
  res.end(json);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 }));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('JSON inválido'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function authedDevice(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const h = sha(m[1]);
  const list = devices();
  const dev = list.find((d) => crypto.timingSafeEqual(Buffer.from(d.hash), Buffer.from(h)));
  if (dev && Date.now() - lastSeenWrite > 60000) {
    lastSeenWrite = Date.now();
    dev.lastSeen = new Date().toISOString();
    saveDevices(list);
  }
  return dev || null;
}

function pair(body) {
  const p = livePairing();
  if (Date.now() < lockedUntil) return { status: 429, body: { error: 'Demasiados intentos. Espera un minuto.' } };
  if (!p) return { status: 403, body: { error: 'Primero toca "Emparejar celular" en la PC.' } };
  const code = String(body.code || '');
  if (!/^\d{6}$/.test(code) || !crypto.timingSafeEqual(Buffer.from(code), Buffer.from(p.code))) {
    p.failures += 1;
    if (p.failures >= 5) {
      pairing = null;
      lockedUntil = Date.now() + 60000;
    }
    return { status: 403, body: { error: 'Código incorrecto.' } };
  }
  pairing = null;
  const token = crypto.randomBytes(32).toString('base64url');
  const name = String(body.name || 'Celular').slice(0, 40);
  saveDevices([...devices(), { id: crypto.randomUUID(), name, hash: sha(token), createdAt: new Date().toISOString(), lastSeen: null }]);
  return { status: 200, body: { token, name: 'Asistente de Vida' } };
}

function validHistory(h) {
  return Array.isArray(h) && h.length > 0 && h.length <= 40 &&
    h.every((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length <= 4000) &&
    h[h.length - 1].role === 'user';
}

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/api/ping') return send(res, 200, { ok: true, app: 'asistente-vida' });
  if (req.method === 'POST' && url.pathname === '/api/pair') {
    const r = pair(await readJson(req));
    return send(res, r.status, r.body);
  }
  if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'No existe' });
  if (!authedDevice(req)) return send(res, 401, { error: 'Celular no emparejado.' });

  if (req.method === 'GET' && url.pathname === '/api/data') return send(res, 200, await handlers.getData());
  if (req.method === 'POST' && url.pathname === '/api/refresh') return send(res, 200, await handlers.refresh());
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const { history } = await readJson(req);
    if (!validHistory(history)) return send(res, 400, { error: 'Historial inválido.' });
    return send(res, 200, { answer: await handlers.chat(history) });
  }
  return send(res, 404, { error: 'No existe' });
}

function onRequest(req, res) {
  route(req, res).catch((err) => {
    console.error('Servidor del celular:', err.message);
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Error en la PC.' });
  });
}

// handlers: { getData(), refresh(), chat(history) }
function start(h) {
  handlers = h;
  if (server || !config().enabled) return;
  startError = null;
  server = http.createServer(onRequest);
  server.on('error', (err) => {
    startError = err.code === 'EADDRINUSE' ? `El puerto ${PORT} ya está en uso.` : err.message;
    server = null;
  });
  server.listen(PORT, '0.0.0.0');
}

function stop() {
  if (server) {
    server.close();
    server.closeAllConnections();
  }
  server = null;
  pairing = null;
}

function setEnabled(on) {
  store.set('mobile', { ...config(), enabled: !!on });
  if (on) start(handlers);
  else stop();
}

module.exports = { start, stop, setEnabled, status, startPairing, revoke, PORT };
