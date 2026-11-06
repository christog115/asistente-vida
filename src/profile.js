// Perfil de uso: "personal" (escuela, música, estudio) o "contador" (clientes,
// calendario del SAT y facturas CFDI). Cambia qué se muestra en el tablero, qué
// avisa y cómo habla el asistente. Todo lo demás (Google, voz, celular) es igual.
const store = require('./store');

const PROFILES = ['personal', 'contador'];

function get() {
  const p = store.get('profile');
  return PROFILES.includes(p) ? p : 'personal';
}

function userName() {
  return String(store.get('userName') || 'Christopher').trim() || 'Christopher';
}

function set(profile, name) {
  if (PROFILES.includes(profile)) store.set('profile', profile);
  if (name != null) store.set('userName', String(name).trim().slice(0, 60));
}

module.exports = { get, set, userName, PROFILES };
