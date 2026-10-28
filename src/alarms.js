// Recordatorios que le pides al asistente ("recuérdame en 25 minutos...",
// "cada hora..."). Se guardan en config.json para que sobrevivan si cierras la app.
const crypto = require('crypto');
const store = require('./store');

const MIN_REPEAT_MS = 5 * 60 * 1000;

const all = () => store.get('alarms') || [];

function add({ text, at, everyMs }) {
  const alarm = { id: crypto.randomUUID(), text: String(text).slice(0, 200), at, every: everyMs ? Math.max(everyMs, MIN_REPEAT_MS) : null };
  store.set('alarms', [...all(), alarm]);
  return alarm;
}

const list = () => all().slice().sort((a, b) => a.at - b.at);

function remove(id) {
  store.set('alarms', all().filter((a) => a.id !== id));
}

function clear() {
  const n = all().length;
  store.set('alarms', []);
  return n;
}

// Llama a fire(alarm) por cada recordatorio vencido; los repetidos se reprograman
// al siguiente momento futuro (sin avisar de golpe los que se perdieron con la app cerrada).
function due(now = Date.now()) {
  const fired = [];
  const next = [];
  for (const a of all()) {
    if (a.at > now) { next.push(a); continue; }
    fired.push(a);
    if (a.every) {
      const missed = Math.floor((now - a.at) / a.every) + 1;
      next.push({ ...a, at: a.at + missed * a.every });
    }
  }
  if (fired.length) store.set('alarms', next);
  return fired;
}

module.exports = { add, list, remove, clear, due, MIN_REPEAT_MS };
