// Telegram: un bot tuyo para hablar con kara y mandar cosas por WhatsApp estando fuera, sin abrir WhatsApp.
//
// - Es un bot que TÚ creas con @BotFather (oficial, gratis, sin riesgo de baneo). El token se guarda
//   cifrado con el cifrado del sistema.
// - Solo obedece a UN chat: el tuyo. Se vincula escribiéndole "/vincular 123456" con el código que la
//   app muestra; cualquier otra persona que le escriba es ignorada sin respuesta.
// - Cualquier cosa que salga hacia otra persona (texto, foto, video, pin de ubicación) se confirma antes
//   con un botón, y solo a contactos que guardaste en la app (o respondiendo a un mensaje que te reenvió).
// - Con el reenvío activado (Conexiones → WhatsApp), te manda aquí los mensajes que te llegan por WhatsApp.
//   Se responden contestando el mensaje reenviado. Nada se guarda en la PC.
const crypto = require('crypto');
const store = require('./store');
const files = require('./send-files');
const location = require('./location');
const cmd = require('./tg-commands');
const { parseLocationCommand } = require('./wa-commands');

const API = 'https://api.telegram.org';
const MAX_DOWNLOAD = 20 * 1024 * 1024; // límite de Telegram para que un bot baje archivos
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let deps = { whatsapp: null, chat: null };
let gen = 0;
let offset = 0;
let fails = 0;
let lastError = null;
let pairing = null; // { code, expires, tries }
let awaiting = null; // { media, caption } mientras espera "¿a quién se lo mando?"
const pending = new Map(); // confirmaciones: id -> { run, desc, expires }
const forwarded = new Map(); // id del mensaje en Telegram -> { jid, label }
let history = [];

const cfg = () => store.getSecret('telegram') || null;
const saveCfg = (c) => store.setSecret('telegram', c);

async function api(method, body, { timeout = 15000 } = {}) {
  const c = cfg();
  if (!c) throw new Error('Telegram no está conectado.');
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(`${API}/bot${c.token}/${method}`, {
    method: 'POST',
    ...(isForm ? { body } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }),
    signal: AbortSignal.timeout(timeout)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(`Telegram: ${data.description || res.status}`);
  return data.result;
}

async function say(text, extra = {}) {
  const c = cfg();
  if (!c || !c.chatId) throw new Error('Primero vincula tu chat de Telegram.');
  const parts = String(text).match(/[\s\S]{1,3900}/g) || [''];
  let sent = null;
  for (let i = 0; i < parts.length; i++) sent = await api('sendMessage', { chat_id: c.chatId, text: parts[i], ...(i === parts.length - 1 ? extra : {}) });
  return sent;
}

// ---------- Ajustes ----------
async function save(token) {
  token = String(token || '').trim();
  if (!/^\d{6,}:[\w-]{30,}$/.test(token)) throw new Error('Ese token no parece válido. Copia el que te dio @BotFather completo.');
  const old = cfg();
  saveCfg({ token, chatId: old && old.token === token ? old.chatId : null, bot: null });
  try {
    const me = await api('getMe');
    const c = cfg();
    saveCfg({ ...c, bot: me.username });
  } catch (err) {
    saveCfg(old);
    throw new Error('Telegram no aceptó ese token: ' + err.message.replace(/^Telegram: /, ''));
  }
  start();
  return info();
}

// Código de 6 dígitos, válido 10 minutos, con 5 intentos.
function pairCode() {
  if (!cfg()) throw new Error('Primero guarda el token del bot.');
  pairing = { code: String(crypto.randomInt(100000, 1000000)), expires: Date.now() + 10 * 60000, tries: 0 };
  return { code: pairing.code, bot: cfg().bot };
}

function disconnect() {
  gen++;
  pairing = null;
  awaiting = null;
  pending.clear();
  forwarded.clear();
  history = [];
  saveCfg(null);
}

function unpair() {
  const c = cfg();
  if (c) saveCfg({ ...c, chatId: null });
  awaiting = null;
  pending.clear();
}

function info() {
  const c = cfg();
  return {
    state: !c ? 'sin-bot' : c.chatId ? 'vinculado' : 'sin-chat',
    bot: c ? c.bot : null,
    error: lastError,
    pairing: pairing && pairing.expires > Date.now() ? { code: pairing.code } : null
  };
}

async function sendTest() {
  await say('Listo, kara ya te escribe por aquí. Manda /ayuda para ver lo que puedo hacer.');
}

// ---------- Recibir ----------
function start() {
  const mine = ++gen;
  fails = 0;
  loop(mine).catch((err) => console.error('Telegram:', err.message));
}

async function loop(mine) {
  while (mine === gen && cfg()) {
    try {
      const updates = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, { timeout: 40000 });
      fails = 0;
      lastError = null;
      for (const u of updates) {
        offset = u.update_id + 1;
        if (mine !== gen) return;
        await handle(u).catch((err) => console.error('Telegram:', err.message));
      }
    } catch (err) {
      if (mine !== gen) return;
      lastError = err.message.replace(/^Telegram: /, '');
      await sleep(Math.min(60000, 3000 * 2 ** Math.min(fails++, 5)));
    }
  }
}

async function handle(u) {
  const c = cfg();
  if (!c) return;
  if (u.callback_query) return onCallback(u.callback_query, c);
  const m = u.message;
  if (!m || !m.chat || m.chat.type !== 'private') return;
  if (!c.chatId) return tryPair(m, c);
  if (m.chat.id !== c.chatId) return; // cualquier otra persona: se ignora sin responder
  await onMessage(m);
}

async function tryPair(m, c) {
  const code = cmd.parsePair(m.text);
  if (!code || !pairing || pairing.expires < Date.now()) return;
  if (++pairing.tries > 5) { pairing = null; return; }
  if (code !== pairing.code) return;
  pairing = null;
  saveCfg({ ...c, chatId: m.chat.id });
  await say('Vinculado. Desde aquí puedes pedirme cosas. Manda /ayuda para ver la lista.');
}

const HELP = [
  'Esto puedo hacer:',
  '',
  '• "dile a Mamá que llego tarde": mando ese mensaje desde tu WhatsApp (antes te pido confirmar).',
  '• Mándame una foto o video con el pie "para Mamá" y se lo paso.',
  '• Contesta un mensaje reenviado para responderle a esa persona.',
  '• "ubicación a Mamá": le mando el pin de tu PC. "mi ubicación": te lo mando a ti.',
  '• "archivo reporte física": te traigo ese archivo de la PC.',
  '• Cualquier otra cosa se la paso a kara como si le hablaras en la app.',
  '',
  'Solo mando a contactos que guardaste en la app, y siempre confirmo antes de enviar.'
].join('\n');

function contactList() {
  const list = deps.whatsapp.contacts().map((c) => c.name);
  return list.length ? `Tus contactos: ${list.join(', ')}.` : 'Aún no guardaste contactos en la app (Conexiones → WhatsApp).';
}

function needContact(name) {
  const c = deps.whatsapp.findContact(name);
  if (!c) return { error: `No tengo guardado a "${name}". ${contactList()}` };
  return { contact: c };
}

// ---------- Confirmaciones ----------
async function confirm(desc, run) {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
  const id = crypto.randomBytes(4).toString('hex');
  pending.set(id, { run, desc, expires: now + 10 * 60000 });
  await say(`${desc}\n\n¿Lo mando?`, { reply_markup: { inline_keyboard: [[{ text: 'Enviar', callback_data: 'ok:' + id }, { text: 'Cancelar', callback_data: 'no:' + id }]] } });
}

async function onCallback(q, c) {
  if (!c.chatId || !q.message || q.message.chat.id !== c.chatId) return;
  const [action, id] = String(q.data || '').split(':');
  const p = pending.get(id);
  api('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
  const done = (text) => api('editMessageText', { chat_id: c.chatId, message_id: q.message.message_id, text }).catch(() => {});
  if (!p || p.expires < Date.now()) { pending.delete(id); return done('Esa confirmación ya caducó. Vuelve a pedirlo.'); }
  pending.delete(id);
  if (action !== 'ok') return done(`${p.desc}\n\nCancelado, no mandé nada.`);
  try {
    const result = await p.run();
    await done(`${p.desc}\n\nListo, enviado.${result ? ' ' + result : ''}`);
  } catch (err) {
    await done(`${p.desc}\n\nNo pude enviarlo: ${err.message}`);
  }
}

// ---------- Mensajes tuyos ----------
function mediaOf(m) {
  if (m.photo && m.photo.length) {
    const p = m.photo[m.photo.length - 1];
    return { kind: 'image', fileId: p.file_id, size: p.file_size || 0, name: 'foto.jpg', mime: 'image/jpeg', label: 'la foto' };
  }
  if (m.video) return { kind: 'video', fileId: m.video.file_id, size: m.video.file_size || 0, name: m.video.file_name || 'video.mp4', mime: m.video.mime_type || 'video/mp4', label: 'el video' };
  if (m.document) return { kind: 'document', fileId: m.document.file_id, size: m.document.file_size || 0, name: m.document.file_name || 'archivo', mime: m.document.mime_type || 'application/octet-stream', label: `el archivo ${m.document.file_name || ''}`.trim() };
  return null;
}

async function download(media) {
  if (media.size > MAX_DOWNLOAD) throw new Error('Telegram solo deja que un bot baje archivos de hasta 20 MB. Para algo más grande, mándalo desde la app.');
  const f = await api('getFile', { file_id: media.fileId });
  const c = cfg();
  const res = await fetch(`${API}/file/bot${c.token}/${f.file_path}`, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error('No pude bajar el archivo de Telegram.');
  return Buffer.from(await res.arrayBuffer());
}

function waContent(media, buffer, caption) {
  const cap = caption ? { caption } : {};
  if (media.kind === 'image') return { image: buffer, ...cap };
  if (media.kind === 'video') return { video: buffer, ...cap };
  return { document: buffer, fileName: media.name, mimetype: media.mime, ...cap };
}

async function askMedia(name, media, caption) {
  const r = needContact(name);
  if (r.error) return say(r.error);
  await confirm(`Mandar ${media.label} a ${r.contact.name} por WhatsApp${caption ? `, con el texto «${caption}»` : ''}.`, async () => {
    const buffer = await download(media);
    await deps.whatsapp.sendMediaToContact(r.contact.name, waContent(media, buffer, caption));
  });
}

async function onMedia(m, media, text) {
  const t = cmd.parseCaptionTarget(text);
  if (t) return askMedia(t.contact, media, t.caption);
  awaiting = { media, caption: text };
  await say(`¿A quién le mando ${media.label}? Escribe el nombre. ${contactList()} (o "cancelar").`);
}

async function sendMyLocation() {
  const loc = await location.current();
  const c = cfg();
  await api('sendLocation', { chat_id: c.chatId, latitude: loc.lat, longitude: loc.lon });
  await say('Esa es la ubicación de tu PC, no la de tu celular.');
}

async function sendPcFile(query) {
  const hit = files.find(query)[0];
  if (!hit) return say(`No encontré ningún archivo con "${query}" en Escritorio, Documentos o Descargas.`);
  files.check(hit.file);
  const buffer = await require('fs').promises.readFile(hit.file);
  const form = new FormData();
  form.append('chat_id', String(cfg().chatId));
  form.append('document', new Blob([buffer]), hit.name);
  await api('sendDocument', form, { timeout: 120000 });
}

async function onMessage(m) {
  const text = String(m.text || m.caption || '').trim();
  const media = mediaOf(m);
  try {
    if (media) return await onMedia(m, media, text);
    if (!text) return;
    if (/^cancelar$/i.test(text)) { awaiting = null; return await say('Cancelado.'); }
    if (/^\/(start|ayuda|help)\b/i.test(text)) return await say(HELP);
    if (awaiting) {
      const { media: md, caption } = awaiting;
      awaiting = null;
      const name = cmd.parseTargetName(text);
      if (name) return await askMedia(name, md, caption);
    }
    const replied = m.reply_to_message && forwarded.get(m.reply_to_message.message_id);
    if (replied) {
      return await confirm(`Responderle a ${replied.label} por WhatsApp:\n«${text.slice(0, 500)}»`, () => deps.whatsapp.replyTo(replied.jid, text));
    }
    const locTo = parseLocationCommand(text);
    if (locTo) {
      const r = needContact(locTo);
      if (r.error) return await say(r.error);
      return await confirm(`Mandarle a ${r.contact.name} el pin con la ubicación de tu PC (un solo envío).`, () => deps.whatsapp.sendLocationTo(r.contact.name).then(() => ''));
    }
    if (cmd.isMyLocation(text)) return await sendMyLocation();
    const send = cmd.parseSend(text);
    if (send) {
      const r = needContact(send.contact);
      if (r.error) return await say(r.error);
      return await confirm(`Mandar a ${r.contact.name} por WhatsApp:\n«${send.message}»`, () => deps.whatsapp.sendTextToContact(r.contact.name, send.message));
    }
    const file = cmd.parseFileRequest(text);
    if (file) return await sendPcFile(file);
    if (!deps.chat) return await say(HELP);
    api('sendChatAction', { chat_id: cfg().chatId, action: 'typing' }).catch(() => {});
    history = [...history, { role: 'user', content: text }].slice(-8);
    const answer = String(await deps.chat(history) || 'No tengo respuesta para eso.');
    history = [...history, { role: 'assistant', content: answer }].slice(-8);
    await say(answer);
  } catch (err) {
    await say('No pude hacerlo: ' + err.message).catch(() => {});
  }
}

// ---------- Mensajes de WhatsApp reenviados ----------
async function notifyIncoming({ jid, label, text }) {
  const c = cfg();
  if (!c || !c.chatId) return;
  const sent = await say(`${label} (WhatsApp):\n${text}`);
  forwarded.set(sent.message_id, { jid, label });
  if (forwarded.size > 300) forwarded.delete(forwarded.keys().next().value);
}

function init(d) {
  deps = { ...deps, ...d };
  if (deps.whatsapp) deps.whatsapp.setIncomingHandler(notifyIncoming);
  if (cfg()) start();
}

function shutdown() { gen++; }

module.exports = { init, shutdown, save, pairCode, disconnect, unpair, info, sendTest, notifyIncoming, _handle: handle };
