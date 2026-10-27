// Avisos por WhatsApp con la Cloud API oficial de Meta. Solo manda mensajes a
// tu propio número (no lee tus chats). Se guardan cifrados el token, el ID del
// número de prueba/empresa y tu número. Ojo: WhatsApp solo deja mandar texto
// libre dentro de las 24 h después de que TÚ le escribes al número de la API;
// fuera de ese plazo la prueba usa la plantilla "hello_world".
const store = require('./store');

const GRAPH = 'https://graph.facebook.com/v21.0';

function status() {
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
    body: JSON.stringify({ messaging_product: 'whatsapp', to: c.to, ...body })
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))).error || {};
    throw new Error(`WhatsApp rechazó el mensaje (${err.message || res.status}).`);
  }
}

const send = (title, message) => post({ type: 'text', text: { body: `*${title}*\n${message}` } });

// La plantilla de ejemplo de Meta sirve para probar sin esperar la ventana de 24 h.
const sendTest = () => post({ type: 'template', template: { name: 'hello_world', language: { code: 'en_US' } } });

function trySend(title, message) {
  if (status() !== 'conectado') return;
  send(title, message).catch((err) => console.error('Aviso por WhatsApp:', err.message));
}

module.exports = { status, save, disconnect, send, sendTest, trySend };
