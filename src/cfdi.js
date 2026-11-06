// Facturas electrónicas (CFDI) que llegan a tu Gmail, para el perfil Contador.
// Busca correos recientes con un XML adjunto, lee del XML quién emite, quién
// recibe, el total y el folio fiscal (UUID), y los relaciona con tus clientes
// por RFC. Con un clic las guarda en Drive en "Facturas (Asistente)/Cliente/AAAA-MM".
// Solo lee: no manda, borra ni cambia correos.
const { google } = require('googleapis');
const { Readable } = require('stream');
const gauth = require('./google');
const store = require('./store');
const clients = require('./clients');

const QUERY = 'has:attachment filename:xml newer_than:60d';
const MAX = 30;
const ROOT = 'Facturas (Asistente)';
const TIPOS = { I: 'Ingreso', E: 'Egreso', P: 'Pago', N: 'Nómina', T: 'Traslado' };

const cache = new Map(); // id del correo -> { cfdis: [...], pdfs: [...] }
let last = null; // última lista (para actualizar sin volver a Gmail)

function decode(s) {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
}

function attr(xml, tag, name) {
  const m = new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*?\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
  return m ? decode(m[1]).trim() : null;
}

// Lee los datos básicos de un CFDI (versión 3.3 o 4.0; también la 3.2 con atributos en minúscula).
function parse(buf) {
  const xml = buf.toString('utf8').replace(/^﻿/, '');
  if (!/<(?:[\w-]+:)?Comprobante\b/i.test(xml)) return null;
  const uuid = attr(xml, 'TimbreFiscalDigital', 'UUID');
  const total = Number(attr(xml, 'Comprobante', 'Total'));
  return {
    uuid: uuid ? uuid.toUpperCase() : null,
    fecha: attr(xml, 'Comprobante', 'Fecha'),
    serie: attr(xml, 'Comprobante', 'Serie') || '',
    folio: attr(xml, 'Comprobante', 'Folio') || '',
    total: isFinite(total) ? total : null,
    moneda: attr(xml, 'Comprobante', 'Moneda') || 'MXN',
    tipo: TIPOS[(attr(xml, 'Comprobante', 'TipoDeComprobante') || '').toUpperCase()] || attr(xml, 'Comprobante', 'TipoDeComprobante') || '',
    emisor: { rfc: (attr(xml, 'Emisor', 'Rfc') || '').toUpperCase(), nombre: attr(xml, 'Emisor', 'Nombre') || '' },
    receptor: { rfc: (attr(xml, 'Receptor', 'Rfc') || '').toUpperCase(), nombre: attr(xml, 'Receptor', 'Nombre') || '' }
  };
}

// Adjuntos de un correo (las partes pueden venir anidadas).
function attachments(part, out = []) {
  if (!part) return out;
  if (part.filename && (part.body?.attachmentId || part.body?.data)) {
    out.push({ filename: part.filename, mimeType: part.mimeType, attachmentId: part.body.attachmentId, data: part.body.data });
  }
  for (const p of part.parts || []) attachments(p, out);
  return out;
}

async function download(gmail, messageId, a) {
  const data = a.data || (await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: a.attachmentId })).data.data;
  return Buffer.from(data, 'base64url');
}

async function readMessage(gmail, id) {
  const m = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
  const files = attachments(m.data.payload);
  const xmls = files.filter((f) => /\.xml$/i.test(f.filename));
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.filename));
  const cfdis = [];
  for (const x of xmls) {
    try {
      const c = parse(await download(gmail, id, x));
      if (c) cfdis.push({ ...c, file: x });
    } catch { /* un adjunto dañado no detiene a los demás */ }
  }
  return { cfdis, pdfs, date: Number(m.data.internalDate) || null };
}

function key(messageId, c, i) {
  return c.uuid || `${messageId}:${i}`;
}

// Junta cada factura con su cliente y si ya está en Drive.
function annotate(entries) {
  const saved = store.get('cfdiSaved') || {};
  const out = [];
  for (const [messageId, e] of entries) {
    e.cfdis.forEach((c, i) => {
      const asEmisor = clients.byRfc(c.emisor.rfc);
      const asReceptor = clients.byRfc(c.receptor.rfc);
      const client = asReceptor || asEmisor;
      const k = key(messageId, c, i);
      out.push({
        key: k, messageId, uuid: c.uuid, fecha: c.fecha, serie: c.serie, folio: c.folio, total: c.total, moneda: c.moneda, tipo: c.tipo,
        emisor: c.emisor, receptor: c.receptor,
        client: client ? client.name : null, clientId: client ? client.id : null,
        direccion: asReceptor ? 'recibida' : asEmisor ? 'emitida' : null,
        savedUrl: saved[k] || null,
        url: `https://mail.google.com/mail/u/0/#all/${messageId}`
      });
    });
  }
  return out.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

async function recent() {
  const auth = gauth.authedClient();
  if (!auth) return null;
  const gmail = google.gmail({ version: 'v1', auth });
  const list = await gmail.users.messages.list({ userId: 'me', q: QUERY, maxResults: MAX });
  const ids = (list.data.messages || []).map((m) => m.id);
  await Promise.all(ids.filter((id) => !cache.has(id)).map(async (id) => {
    try { cache.set(id, await readMessage(gmail, id)); } catch { /* se reintenta en la siguiente actualización */ }
  }));
  // No crece sin límite: se quedan solo los correos que siguen en la búsqueda.
  for (const id of [...cache.keys()]) if (!ids.includes(id)) cache.delete(id);
  last = ids.filter((id) => cache.has(id)).map((id) => [id, cache.get(id)]);
  return annotate(last);
}

// Vuelve a relacionar con los clientes sin ir a Gmail (después de agregar un cliente o guardar en Drive).
function current() {
  return last ? annotate(last) : null;
}

const safeName = (t) => String(t).replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

async function folder(drive, name, parent) {
  const folders = store.get('driveFolders') || {};
  const path = `${parent || ''}/${name}`;
  if (folders[path]) {
    try {
      const f = await drive.files.get({ fileId: folders[path], fields: 'id,trashed' });
      if (!f.data.trashed) return folders[path];
    } catch { /* la borraste: se crea otra */ }
  }
  const res = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: parent ? [parent] : undefined },
    fields: 'id'
  });
  store.set('driveFolders', { ...(store.get('driveFolders') || {}), [path]: res.data.id });
  return res.data.id;
}

async function upload(drive, parent, name, mimeType, buf) {
  const res = await drive.files.create({
    requestBody: { name, parents: [parent] },
    media: { mimeType, body: Readable.from(buf) },
    fields: 'id,webViewLink'
  });
  return res.data.webViewLink;
}

function driveError(err) {
  if (err.code === 403 || /insufficient/i.test(err.message)) {
    return new Error('Google no me deja guardar en Drive todavía: en Conexiones toca Desconectar y luego Conectar con Google para dar el permiso nuevo.');
  }
  return err;
}

// Guarda en Drive el XML (y los PDF del mismo correo) de una factura.
async function saveToDrive(k) {
  const auth = gauth.authedClient();
  if (!auth) throw new Error('Conecta Google en Conexiones.');
  const item = (current() || []).find((x) => x.key === k);
  if (!item) throw new Error('Ya no encuentro esa factura; toca Actualizar.');
  if (item.savedUrl) return item.savedUrl;
  const entry = cache.get(item.messageId);
  const c = entry.cfdis.find((x, i) => key(item.messageId, x, i) === k);
  const gmail = google.gmail({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });
  try {
    const root = await folder(drive, ROOT);
    const byClient = await folder(drive, safeName(item.client || 'Sin cliente'), root);
    const month = await folder(drive, String(item.fecha || '').slice(0, 7) || 'sin fecha', byClient);
    const base = safeName([String(item.fecha || '').slice(0, 10), item.emisor.nombre || item.emisor.rfc, `${item.serie}${item.folio}`, (item.uuid || '').slice(0, 8)].filter(Boolean).join(' '));
    const url = await upload(drive, month, base + '.xml', 'text/xml', await download(gmail, item.messageId, c.file));
    // Si el correo trae una sola factura, sus PDF van con ella; si trae varias, solo el PDF que menciona su UUID.
    const pdfs = entry.cfdis.length === 1 ? entry.pdfs
      : entry.pdfs.filter((p) => item.uuid && p.filename.toUpperCase().includes(item.uuid.slice(0, 8)));
    for (const p of pdfs) await upload(drive, month, base + '.pdf', 'application/pdf', await download(gmail, item.messageId, p));
    store.set('cfdiSaved', { ...(store.get('cfdiSaved') || {}), [k]: url });
    return url;
  } catch (err) {
    throw driveError(err);
  }
}

// Guarda todas las de tus clientes que aún no están en Drive.
async function saveAllClients() {
  const pending = (current() || []).filter((x) => x.clientId && !x.savedUrl);
  for (const x of pending) await saveToDrive(x.key);
  return pending.length;
}

module.exports = { recent, current, parse, saveToDrive, saveAllClients };
