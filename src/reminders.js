// Recordatorios diarios: a las horas configuradas manda una notificación de
// Windows/Mac con lo pendiente, y avisa una vez por cada tarea que vence en
// menos de 24 horas.
const { Notification } = require('electron');
const store = require('./store');

const DAY = 24 * 3600 * 1000;
let lastSlot = null;
const warned = new Set();

function hhmm(d) {
  return d.toTimeString().slice(0, 5);
}

function notify(title, body, onClick) {
  const n = new Notification({ title, body });
  if (onClick) n.on('click', onClick);
  n.show();
}

function dailySummary(data) {
  const school = data.school || [];
  const soon = school.filter((t) => t.due && new Date(t.due) - Date.now() < 2 * DAY);
  const parts = [];
  if (school.length) parts.push(`${school.length} tareas de la escuela (${soon.length} vencen pronto)`);
  if (Array.isArray(data.events) && data.events.length) parts.push(`${data.events.length} eventos en el calendario`);
  if (Array.isArray(data.emails) && data.emails.length) parts.push(`${data.emails.length} correos sin leer`);
  return parts.length ? parts.join(' · ') : 'No tienes pendientes. ¡Buen día!';
}

// Se llama cada minuto con los datos más recientes del tablero.
function tick(data, openWindow) {
  if (!data) return;
  const now = new Date();
  const slot = `${now.toDateString()} ${hhmm(now)}`;
  if (store.get('reminderTimes').includes(hhmm(now)) && lastSlot !== slot) {
    lastSlot = slot;
    notify('Tu resumen del día', dailySummary(data), openWindow);
  }
  for (const t of data.school || []) {
    if (!t.due) continue;
    const left = new Date(t.due) - now;
    const key = `${t.source}:${t.title}:${t.due}`;
    if (left > 0 && left < DAY && !warned.has(key)) {
      warned.add(key);
      notify(`Vence pronto: ${t.title}`, `${t.course} · ${new Date(t.due).toLocaleString('es-MX')}`, openWindow);
    }
  }
}

module.exports = { tick, dailySummary };
