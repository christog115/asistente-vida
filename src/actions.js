// Órdenes habladas o escritas: crear eventos, recordatorios, abrir programas.
// El asistente (Claude/Gemini) solo traduce tu frase a una acción con datos;
// lo que se ejecuta lo decide este archivo y únicamente a partir de lo que TÚ
// dices, nunca de correos o tareas, y los programas salen de una lista cerrada.
const ai = require('./ai');
const google = require('./google');
const alarms = require('./alarms');
const apps = require('./apps');

// Solo se gasta una consulta extra si la frase parece una orden.
const LOOKS_LIKE_COMMAND = /(^|[^a-z])(recuerda(me)?|avisa(me)?|agenda|agendar|crea|crear|programa|pon(me)?|abre|abreme|abrir|inicia|ejecuta|lanza|alarma|temporizador|cancela|borra|que recordatorios|cada\s+\w+\s+(hora|minuto)s?|en\s+\d+\s+(minuto|hora)s?)/;
const plain = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const SYSTEM = (now) => `Conviertes la orden del usuario en una acción para su asistente. Responde SOLO con un JSON, sin texto extra.
Ahora es ${now.toString()} (${now.toISOString()} en UTC). Usa SIEMPRE la zona horaria local con desfase (ej. 2026-10-28T15:00:00-06:00).
Acciones:
{"action":"create_event","title":"...","start":"ISO con desfase","durationMinutes":60}
{"action":"create_reminder","text":"qué recordar, en infinitivo o frase corta","inMinutes":25,"everyMinutes":null}  // o "at":"ISO con desfase" en vez de inMinutes; everyMinutes si es repetido ("cada hora" = 60)
{"action":"list_reminders"}
{"action":"cancel_reminders"}
{"action":"open_app","name":"nombre del programa"}
{"action":"none"}  // si no es una orden de estas (es una pregunta o charla)
Programas que puede abrir: ${apps.names().join(', ')}.`;

function parseJson(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const when = (d) => d.toLocaleString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
function span(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} minuto${min === 1 ? '' : 's'}`;
  const h = min / 60;
  return Number.isInteger(h) ? `${h} hora${h === 1 ? '' : 's'}` : `${min} minutos`;
}

async function run(a, now) {
  switch (a.action) {
    case 'create_event': {
      const start = new Date(a.start);
      if (isNaN(start)) return 'No entendí la fecha del evento; dímela otra vez.';
      const end = new Date(start.getTime() + (Number(a.durationMinutes) > 0 ? Number(a.durationMinutes) : 60) * 60000);
      await google.createEvent({ title: String(a.title || 'Evento').slice(0, 200), start, end });
      return `Listo, agendé "${a.title}" el ${when(start)}.`;
    }
    case 'create_reminder': {
      const at = a.inMinutes != null ? now.getTime() + Number(a.inMinutes) * 60000 : new Date(a.at).getTime();
      if (!isFinite(at) || at < now.getTime() - 60000) return 'No entendí cuándo recordártelo; dímelo otra vez.';
      const everyMs = Number(a.everyMinutes) > 0 ? Number(a.everyMinutes) * 60000 : null;
      const alarm = alarms.add({ text: a.text, at, everyMs });
      const rep = alarm.every ? `, y luego cada ${span(alarm.every)}` : '';
      return alarm.at - now.getTime() < 6 * 3600000 && !everyMs
        ? `Listo, te lo recuerdo en ${span(alarm.at - now.getTime())}.`
        : `Listo, te recuerdo "${alarm.text}" el ${when(new Date(alarm.at))}${rep}.`;
    }
    case 'list_reminders': {
      const l = alarms.list();
      return l.length ? 'Tienes: ' + l.map((x) => `${x.text}, ${when(new Date(x.at))}`).join('; ') + '.' : 'No tienes recordatorios pendientes.';
    }
    case 'cancel_reminders': {
      const n = alarms.clear();
      return n ? `Listo, borré ${n} recordatorio${n === 1 ? '' : 's'}.` : 'No tenías recordatorios.';
    }
    case 'open_app': {
      const name = await apps.open(a.name);
      return name ? `Abriendo ${name}.` : `No sé abrir "${a.name}". Puedes agregarlo en config.json, en "apps".`;
    }
    default:
      return null;
  }
}

// Devuelve el texto con el que contestar, o null si no era una orden.
async function tryHandle(text) {
  if (!LOOKS_LIKE_COMMAND.test(plain(text)) || !ai.ready()) return null;
  const now = new Date();
  let parsed = null;
  try {
    parsed = parseJson(await ai.ask(SYSTEM(now), text));
  } catch {
    return null; // si no se pudo interpretar, se contesta como charla normal
  }
  if (!parsed || !parsed.action || parsed.action === 'none') return null;
  return run(parsed, now);
}

module.exports = { tryHandle, run, parseJson, LOOKS_LIKE_COMMAND };
