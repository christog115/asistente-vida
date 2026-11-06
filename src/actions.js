// Órdenes habladas o escritas: crear eventos, recordatorios, abrir programas.
// El asistente (Claude/Gemini) solo traduce tu frase a una acción con datos;
// lo que se ejecuta lo decide este archivo y únicamente a partir de lo que TÚ
// dices, nunca de correos o tareas, y los programas salen de una lista cerrada.
const ai = require('./ai');
const google = require('./google');
const alarms = require('./alarms');
const apps = require('./apps');
const study = require('./study');
const spotify = require('./spotify');

// Solo se gasta una consulta extra si la frase parece una orden.
const LOOKS_LIKE_COMMAND = /(^|[^a-z])(recuerda(me)?|avisa(me)?|agenda|agendar|crea|crear|programa|pon(me)?|abre|abreme|abrir|inicia|ejecuta|lanza|alarma|temporizador|cancela|borra|que recordatorios|pausa(r)?|reanuda(r)?|siguiente cancion|cancion siguiente|cancion anterior|salta|agrega(me)?|anade(me)?|anota(me)?|apunta(me)?|a mis pendientes|a mi lista|busca(me)?|encuentra(me)?|que me (mando|escribio|envio)|notion|modo estudio|a estudiar|voy a estudiar|termine de estudiar|termina el modo|cada\s+\w+\s+(hora|minuto)s?|en\s+\d+\s+(minuto|hora)s?)/;
const notion = require('./notion');
const plain = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const SYSTEM = (now) => `Conviertes la orden del usuario en una acción para su asistente. Responde SOLO con un JSON, sin texto extra.
Ahora es ${now.toString()} (${now.toISOString()} en UTC). Usa SIEMPRE la zona horaria local con desfase (ej. 2026-10-28T15:00:00-06:00).
Acciones:
{"action":"create_event","title":"...","start":"ISO con desfase","durationMinutes":60}
{"action":"create_reminder","text":"qué recordar, en infinitivo o frase corta","inMinutes":25,"everyMinutes":null}  // o "at":"ISO con desfase" en vez de inMinutes; everyMinutes si es repetido ("cada hora" = 60)
{"action":"search_mail","query":"consulta de Gmail, ej. from:profesor matematicas"}  // "qué me mandó...", "busca el correo de..."; usa operadores from:, subject:, after:YYYY/MM/DD, is:unread
{"action":"search_drive","query":"palabras del nombre del archivo"}  // "busca el archivo de..."
{"action":"study_start","minutes":120}  // "modo estudio", "voy a estudiar 90 minutos"; minutes null si no dijo cuánto
{"action":"study_stop"}  // "termina el modo estudio", "ya terminé de estudiar"
{"action":"create_task","title":"la tarea o pendiente, frase corta","due":"YYYY-MM-DD o null si no dijo fecha"}  // para "agrega a mis pendientes...", "anota que debo..."
{"action":"music","command":"pause|resume|next|previous"}  // "pausa la música", "sigue/reanuda", "siguiente canción", "canción anterior"
{"action":"notion_add","title":"texto a anotar, frase corta"}  // "anota en Notion...", "agrega a Notion..."
{"action":"notion_search","query":"palabras a buscar en Notion"}  // "busca en Notion..."
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
    case 'search_mail': {
      const q = String(a.query || '').trim();
      if (!q) return 'No entendí qué correo buscar; dímelo otra vez.';
      const { total, items } = await google.searchMail(q);
      if (!items.length) return 'No encontré correos con eso.';
      const shown = items.slice(0, 3).map((m) => `de ${m.from}: ${m.subject}`).join('. ');
      const head = total > items.length ? 'Encontré varios correos; los más recientes' : `Encontré ${items.length} correo${items.length === 1 ? '' : 's'}`;
      return `${head}: ${shown}.` + (items.length > 3 ? ` Y ${items.length - 3} más.` : '');
    }
    case 'search_drive': {
      const q = String(a.query || '').trim();
      if (!q) return 'No entendí qué archivo buscar; dímelo otra vez.';
      const files = await google.searchDrive(q);
      if (!files.length) return 'No encontré archivos con eso en tu Drive.';
      return `En tu Drive encontré: ${files.slice(0, 3).map((f) => f.name).join(', ')}` + (files.length > 3 ? ` y ${files.length - 3} más.` : '.');
    }
    case 'study_start': {
      const r = await study.start(a.minutes);
      const h = r.minutes % 60 === 0 ? `${r.minutes / 60} hora${r.minutes === 60 ? '' : 's'}` : `${r.minutes} minutos`;
      return `Modo estudio por ${h}${r.music ? ', con tu música' : ''}. Te aviso cuándo descansar.`;
    }
    case 'study_stop':
      return study.stop() ? 'Listo, terminé el modo estudio.' : 'El modo estudio no estaba activo.';
    case 'create_task': {
      const title = String(a.title || '').trim().slice(0, 200);
      if (!title) return 'No entendí qué pendiente anotar; dímelo otra vez.';
      const m = String(a.due || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const due = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
      await google.createTask({ title, due });
      return due ? `Listo, anoté "${title}" para el ${due.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}.` : `Listo, anoté "${title}" en tus pendientes.`;
    }
    case 'music': {
      const words = { pause: 'Pausé la música.', resume: 'Seguimos con la música.', next: 'Siguiente canción.', previous: 'Canción anterior.' };
      if (!words[a.command]) return null;
      await spotify.control(a.command);
      return words[a.command];
    }
    case 'notion_add': {
      const title = String(a.title || '').trim();
      if (!title) return 'No entendí qué anotar en Notion; dímelo otra vez.';
      await notion.addPage(title);
      return `Listo, lo anoté en Notion: "${title.slice(0, 80)}".`;
    }
    case 'notion_search': {
      const q = String(a.query || '').trim();
      const r = await notion.search(q, 5);
      if (!r.length) return q ? 'No encontré nada en Notion con eso.' : 'No hay páginas compartidas con la integración.';
      return `En Notion encontré: ${r.slice(0, 3).map((p) => p.title).join(', ')}` + (r.length > 3 ? ` y ${r.length - 3} más.` : '.');
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
