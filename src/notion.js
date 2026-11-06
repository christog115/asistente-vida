// Notion con una integración interna (token propio, gratis). Solo toca lo que TÚ compartas con ella
// en Notion ("..." > Conexiones). Con el ID de una base de datos puede anotar páginas nuevas por voz.
const store = require('./store');

const API = 'https://api.notion.com/v1';

function status() {
  return store.getSecret('notion') ? 'conectado' : 'desconectado';
}

// Acepta el ID suelto o el enlace de la base de datos (toma los 32 caracteres hexadecimales).
function parseId(text) {
  const m = String(text || '').replace(/-/g, '').match(/[0-9a-f]{32}/i);
  return m ? m[0].toLowerCase() : '';
}

async function api(path, method = 'GET', body) {
  const c = store.getSecret('notion');
  if (!c) throw new Error('Notion no está conectado.');
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${c.token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('Notion rechazó el token; vuelve a conectar.');
  if (!res.ok) throw new Error(`Notion respondió: ${json.message || res.status}`);
  return json;
}

async function connect(token, databaseId) {
  token = String(token || '').trim();
  if (!token) throw new Error('Pega el token de tu integración de Notion.');
  const db = databaseId ? parseId(databaseId) : '';
  if (databaseId && !db) throw new Error('No reconocí el ID de la base de datos; pega el enlace o los 32 caracteres.');
  store.setSecret('notion', { token, databaseId: db });
  try {
    await api('/users/me');
    if (db) await api(`/databases/${db}`);
  } catch (err) {
    store.setSecret('notion', null);
    throw err;
  }
}

function disconnect() {
  store.setSecret('notion', null);
}

const titleOf = (page) => {
  if (page.object === 'database') return (page.title || []).map((t) => t.plain_text).join('') || 'Base de datos sin título';
  for (const p of Object.values(page.properties || {})) {
    if (p.type === 'title') return p.title.map((t) => t.plain_text).join('') || 'Sin título';
  }
  return 'Sin título';
};

function simplify(r) {
  return { title: titleOf(r), url: r.url, edited: r.last_edited_time };
}

// Lo último que editaste (o lo que coincide con la búsqueda) dentro de lo que compartiste con la integración.
async function search(query, size = 5) {
  const body = { page_size: size, sort: { direction: 'descending', timestamp: 'last_edited_time' } };
  if (query) body.query = String(query).slice(0, 200);
  const r = await api('/search', 'POST', body);
  return r.results.map(simplify);
}

async function recent() {
  if (status() !== 'conectado') return null;
  return search('', 5);
}

// Crea una página nueva (con título) en la base de datos configurada.
async function addPage(title) {
  const c = store.getSecret('notion');
  if (!c) throw new Error('Notion no está conectado.');
  if (!c.databaseId) throw new Error('Falta el ID de la base de datos donde anotar. Agrégalo en la tarjeta de Notion.');
  const db = await api(`/databases/${c.databaseId}`);
  const titleProp = Object.entries(db.properties).find(([, p]) => p.type === 'title');
  if (!titleProp) throw new Error('Esa base de datos no tiene columna de título.');
  const page = await api('/pages', 'POST', {
    parent: { database_id: c.databaseId },
    properties: { [titleProp[0]]: { title: [{ text: { content: String(title).slice(0, 200) } }] } }
  });
  return simplify(page);
}

module.exports = { status, connect, disconnect, search, recent, addPage, parseId };
