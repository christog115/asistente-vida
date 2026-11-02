// Modo estudio: durante un rato silencia la voz de los resúmenes y avisos, abre tu música de
// estudio (si agregaste un programa llamado "musica de estudio") y te avisa cuándo descansar.
// Tus recordatorios de voz ("recuérdame...") siguen sonando.
const { Notification } = require('electron');
const store = require('./store');
const apps = require('./apps');

const MUSIC_APP = 'musica de estudio';
const DEFAULT_MINUTES = 120;
const BREAK_EVERY_MIN = 25;
const REST_MIN = 5;
const MAX_MINUTES = 12 * 60;

const read = () => store.get('study') || null;

function active(now = Date.now()) {
  const s = read();
  return !!(s && s.until > now);
}

function status(now = Date.now()) {
  const s = read();
  if (!s || s.until <= now) return { active: false };
  return { active: true, until: s.until, minutesLeft: Math.ceil((s.until - now) / 60000), music: !!apps.find(MUSIC_APP) };
}

async function start(minutes, now = Date.now()) {
  const n = Math.min(MAX_MINUTES, Math.max(5, Math.round(Number(minutes) || DEFAULT_MINUTES)));
  store.set('study', { until: now + n * 60000, nextBreak: now + BREAK_EVERY_MIN * 60000 });
  let music = false;
  if (apps.find(MUSIC_APP)) {
    try { music = !!(await apps.open(MUSIC_APP)); } catch { /* si no abre, el modo estudio sigue */ }
  }
  return { minutes: n, music };
}

function stop() {
  const was = active();
  store.set('study', null);
  return was;
}

// Se llama seguido (cada 15 s): avisa los descansos y cierra el modo cuando se acaba el tiempo.
function tick(speak, now = Date.now()) {
  const s = read();
  if (!s) return;
  const say = (title, body) => {
    new Notification({ title, body }).show();
    if (speak) speak(`${title}. ${body}`);
  };
  if (s.until <= now) {
    store.set('study', null);
    say('Terminó el modo estudio', 'Buen trabajo.');
  } else if (s.nextBreak <= now) {
    store.set('study', { ...s, nextBreak: now + (REST_MIN + BREAK_EVERY_MIN) * 60000 });
    say('Hora de descansar', `Levántate y descansa ${REST_MIN} minutos.`);
  }
}

module.exports = { start, stop, active, status, tick, MUSIC_APP };
