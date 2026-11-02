// Recordatorios diarios: a las horas configuradas manda una notificación de
// Windows/Mac con lo pendiente, y avisa una vez por cada tarea que vence en
// menos de 24 horas.
const { Notification } = require('electron');
const store = require('./store');
const phone = require('./phone');
const whatsapp = require('./whatsapp');

const DAY = 24 * 3600 * 1000;
// Cada entrega avisa dos veces: a menos de 24 h y a menos de 3 h (esta última también en voz alta).
const STAGES = [{ ms: 3 * 3600 * 1000, tag: '3h' }, { ms: DAY, tag: '24h' }];
let lastSlot = null;
// Se guarda en disco para no repetir avisos (PC y celular) cuando reinicias la app.
const warned = new Set(store.get('warned') || []);

function remember(key) {
  warned.add(key);
  store.set('warned', [...warned].slice(-200));
}

function hhmm(d) {
  return d.toTimeString().slice(0, 5);
}

function notify(title, body, onClick) {
  const n = new Notification({ title, body });
  if (onClick) n.on('click', onClick);
  n.show();
}

function dailySummary(data) {
  const b = data.briefing;
  if (b && b.date === new Date().toDateString() && b.text) return b.text.slice(0, 240);
  const school = data.school || [];
  const soon = school.filter((t) => t.due && new Date(t.due) - Date.now() < 2 * DAY);
  const parts = [];
  if (school.length) parts.push(`${school.length} tareas de la escuela (${soon.length} vencen pronto)`);
  if (Array.isArray(data.events) && data.events.length) parts.push(`${data.events.length} eventos en el calendario`);
  if (Array.isArray(data.emails) && data.emails.length) parts.push(`${data.emails.length} correos sin leer`);
  return parts.length ? parts.join(' · ') : 'No tienes pendientes. ¡Buen día!';
}

// Versión para leer en voz alta: el resumen completo del asistente si ya está, sin pasarse de largo.
function spokenSummary(data, fallback) {
  const b = data.briefing;
  const text = b && b.date === new Date().toDateString() && b.text ? b.text : fallback;
  return 'Buenos días. ' + text.replace(/[*_#`]/g, '').slice(0, 700);
}

// Al encender la PC (primera vez del día, entre las 5:00 y las 12:00) dice el resumen en voz alta
// sin esperar a la hora fija. Espera hasta 3 minutos al resumen del asistente; si no llega, usa el básico.
let firstSeen = null;
function morning(data, speak) {
  const now = new Date();
  const today = now.toDateString();
  if (!data || !speak || store.get('morningSpeech') === false) return;
  if (now.getHours() < 5 || now.getHours() >= 12 || store.get('morningSpoken') === today) return;
  const b = data.briefing;
  if (!firstSeen) firstSeen = Date.now();
  if (!(b && b.date === today && b.text) && Date.now() - firstSeen < 3 * 60000) return;
  store.set('morningSpoken', today);
  speak(spokenSummary(data, dailySummary(data)));
}

// Se llama cada minuto con los datos más recientes del tablero.
function tick(data, openWindow, speak) {
  if (!data) return;
  const now = new Date();
  const slot = `${now.toDateString()} ${hhmm(now)}`;
  if (store.get('reminderTimes').includes(hhmm(now)) && lastSlot !== slot) {
    lastSlot = slot;
    const summary = dailySummary(data);
    notify('Tu resumen del día', summary, openWindow);
    if (speak) {
      speak(spokenSummary(data, summary));
      if (now.getHours() < 12) store.set('morningSpoken', now.toDateString());
    }
    phone.trySend('Tu resumen del día', summary, { tags: ['calendar'] });
    whatsapp.trySend('Tu resumen del día', summary);
  }
  for (const t of data.school || []) {
    if (!t.due) continue;
    const left = new Date(t.due) - now;
    if (left <= 0) continue;
    const base = `${t.source}:${t.title}:${t.due}`;
    const key = (st) => (st.ms === DAY ? base : `${base}:${st.tag}`); // la clave de las 24 h no cambia para no repetir avisos viejos
    const reached = STAGES.filter((st) => left < st.ms);
    const fresh = reached.filter((st) => !warned.has(key(st)));
    if (!fresh.length) continue;
    reached.forEach((st) => remember(key(st)));
    const st = fresh[0]; // el aviso más cercano a la entrega
    const hours = Math.max(1, Math.round(left / 3600000));
    const title = st.ms === DAY ? `Vence pronto: ${t.title}` : `Vence en ${hours} h: ${t.title}`;
    const body = `${t.course} · ${new Date(t.due).toLocaleString('es-MX')}`;
    notify(title, body, openWindow);
    if (st.ms !== DAY && speak) speak(`Aviso: ${t.title}, de ${t.course}, vence en ${hours} ${hours === 1 ? 'hora' : 'horas'}.`);
    phone.trySend(title, body, { priority: st.ms === DAY ? 4 : 5, tags: ['warning'] });
    whatsapp.trySend(title, body);
  }
}

module.exports = { tick, morning, dailySummary };
