// Recordatorios diarios: a las horas configuradas manda una notificación de
// Windows/Mac con lo pendiente, y avisa una vez por cada tarea que vence en
// menos de 24 horas.
const { Notification } = require('electron');
const store = require('./store');
const phone = require('./phone');
const whatsapp = require('./whatsapp');
const weather = require('./weather');

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

// Perfil Contador: lo del SAT que vence en 7 días y los pendientes de clientes.
function workSummary(data) {
  const week = (data.fiscal || []).filter((f) => !f.done && new Date(f.due) - Date.now() < 7 * DAY);
  const late = week.filter((f) => new Date(f.due) < Date.now());
  const pend = (data.clients || []).reduce((n, c) => n + (c.pending || []).length, 0);
  const parts = [];
  if (week.length) parts.push(`${week.length} obligaciones del SAT en 7 días${late.length ? ` (${late.length} vencidas)` : ''}`);
  if (pend) parts.push(`${pend} pendientes de clientes`);
  return parts;
}

function dailySummary(data) {
  const b = data.briefing;
  if (b && b.date === new Date().toDateString() && b.text) return b.text.slice(0, 240);
  const school = data.school || [];
  const soon = school.filter((t) => t.due && new Date(t.due) - Date.now() < 2 * DAY);
  const parts = data.profile === 'contador' ? workSummary(data) : [];
  if (school.length) parts.push(`${school.length} tareas de la escuela (${soon.length} vencen pronto)`);
  if (Array.isArray(data.events) && data.events.length) parts.push(`${data.events.length} eventos en el calendario`);
  if (Array.isArray(data.emails) && data.emails.length) parts.push(`${data.emails.length} correos sin leer`);
  return parts.length ? parts.join(' · ') : 'No tienes pendientes. ¡Buen día!';
}

// Versión para leer en voz alta: el resumen completo del asistente si ya está, sin pasarse de largo.
function spokenSummary(data, fallback) {
  const b = data.briefing;
  const text = b && b.date === new Date().toDateString() && b.text ? b.text : fallback;
  const clima = b && b.text && /clima|llov|paraguas|grados/i.test(b.text) ? '' : ' ' + weather.weatherText(data.weather);
  return 'Buenos días. ' + (text.replace(/[*_#`]/g, '').slice(0, 700) + clima).trim();
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
  fiscalTick(data, openWindow, speak);
}

// Avisos del calendario fiscal: 3 días antes y 1 día antes (este también en voz alta).
const FISCAL_STAGES = [{ ms: DAY, tag: '1d' }, { ms: 3 * DAY, tag: '3d' }];
function fiscalTick(data, openWindow, speak) {
  const now = Date.now();
  for (const f of data.fiscal || []) {
    if (f.done || !f.due) continue;
    const left = new Date(f.due) - now;
    if (left <= 0) continue;
    const reached = FISCAL_STAGES.filter((st) => left < st.ms);
    const fresh = reached.filter((st) => !warned.has(`fiscal:${f.id}:${st.tag}`));
    if (!fresh.length) continue;
    reached.forEach((st) => remember(`fiscal:${f.id}:${st.tag}`));
    const st = fresh[0];
    const date = new Date(f.due).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
    const today = new Date(f.due).toDateString() === new Date().toDateString();
    const title = st.tag === '1d' ? `Vence ${today ? 'hoy' : 'mañana'}: ${f.title}` : `Vence en menos de 3 días: ${f.title}`;
    const body = `${f.client} · fecha límite ${date}`;
    notify(title, body, openWindow);
    if (st.tag === '1d' && speak) speak(`Aviso del SAT: ${f.title} de ${f.client} vence el ${date}.`);
    phone.trySend(title, body, { priority: st.tag === '1d' ? 5 : 4, tags: ['warning'] });
    whatsapp.trySend(title, body);
  }
}

module.exports = { tick, morning, dailySummary };
