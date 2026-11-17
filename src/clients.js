// Clientes del perfil Contador: nombre, RFC, régimen, qué obligaciones del SAT
// le llevas y una lista corta de pendientes ("falta el estado de cuenta de octubre").
const crypto = require('crypto');
const store = require('./store');
const fiscal = require('./fiscal');

const REGIMENES = ['moral', 'fisica', 'resico'];
// RFC: 3 letras (moral) o 4 (física), fecha AAMMDD y homoclave de 3.
const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

function list() {
  return store.get('clients') || [];
}

function save(all) {
  store.set('clients', all);
}

function cleanRfc(rfc) {
  return String(rfc || '').toUpperCase().replace(/[\s-]/g, '');
}

// Agrega o actualiza (si ya existe uno con el mismo RFC o, sin RFC, el mismo nombre).
function upsert({ name, rfc, regimen, obligations }) {
  name = String(name || '').trim().slice(0, 120);
  if (!name) throw new Error('Escribe el nombre del cliente.');
  rfc = cleanRfc(rfc);
  if (rfc && !RFC_RE.test(rfc)) throw new Error('El RFC no se ve bien: son 12 caracteres (persona moral) o 13 (persona física).');
  if (!REGIMENES.includes(regimen)) regimen = rfc.length === 12 ? 'moral' : 'fisica';
  const obl = Array.isArray(obligations)
    ? obligations.filter((o) => fiscal.OBLIGATIONS[o])
    : fiscal.DEFAULTS[regimen];
  const all = list();
  const same = (c) => (rfc && c.rfc === rfc) || (!rfc && !c.rfc && c.name.toLowerCase() === name.toLowerCase());
  const old = all.find(same);
  if (old) Object.assign(old, { name, rfc, regimen, obligations: obl });
  else all.push({ id: crypto.randomBytes(4).toString('hex'), name, rfc, regimen, obligations: obl, pending: [], createdAt: new Date().toISOString() });
  all.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  save(all);
  return all;
}

function remove(id) {
  save(list().filter((c) => c.id !== id));
}

function addPending(id, text) {
  text = String(text || '').trim().slice(0, 200);
  if (!text) throw new Error('Escribe qué falta.');
  const all = list();
  const c = all.find((x) => x.id === id);
  if (!c) throw new Error('No encontré ese cliente.');
  c.pending = [...(c.pending || []), { id: crypto.randomBytes(4).toString('hex'), text, at: new Date().toISOString() }];
  save(all);
}

function donePending(id, pendingId) {
  const all = list();
  const c = all.find((x) => x.id === id);
  if (!c) return;
  c.pending = (c.pending || []).filter((p) => p.id !== pendingId);
  save(all);
}

// Busca el cliente por RFC (emisor o receptor de una factura) o por nombre dicho en voz.
function byRfc(rfc) {
  rfc = cleanRfc(rfc);
  return rfc ? list().find((c) => c.rfc === rfc) || null : null;
}

function byName(text) {
  const plain = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const q = plain(text);
  if (!q) return null;
  const all = list();
  return all.find((c) => plain(c.name) === q) || all.find((c) => plain(c.name).includes(q) || q.includes(plain(c.name))) || null;
}

module.exports = { list, upsert, remove, addPending, donePending, byRfc, byName, REGIMENES };
