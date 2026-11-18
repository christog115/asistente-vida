// Cuándo avisar y cuándo forzar (sin Electron, se prueba con npm test).
const { minutesOf } = require('./focus-log');

// Minutos desde la medianoche, contando el día lógico: con inicio a las 04:00, la 1:00 es 25:00.
function clock(now, dayStart) {
  const d = new Date(now);
  let m = d.getHours() * 60 + d.getMinutes();
  if (m < minutesOf(dayStart)) m += 1440;
  return m;
}
function norm(hhmm, dayStart) {
  let m = minutesOf(hhmm);
  if (m < minutesOf(dayStart)) m += 1440;
  return m;
}

// A partir de qué minuto del día se fuerza: a la hora fija (21:30) o antes si ya no alcanza el
// tiempo para la meta antes del fin del día (con 15 min de margen), pero nunca más de 3 h antes.
function forceStart(remainingMin, cfg) {
  const from = norm(cfg.forceFrom, cfg.dayStart);
  const end = norm(cfg.dayEnd, cfg.dayStart);
  const lastCall = end - remainingMin - 15;
  return Math.max(Math.min(from, lastCall), from - 180);
}

// ¿Toca la ventana forzada ahora?
function forceDue(now, remainingMin, cfg) {
  if (!cfg.forceEnabled || remainingMin <= 0) return false;
  const m = clock(now, cfg.dayStart);
  return m >= forceStart(remainingMin, cfg) && m < norm(cfg.dayEnd, cfg.dayStart);
}

// ¿Toca el recordatorio de cada 30 min? El primero sale a los 2 min de prender la PC.
// Si estás trabajando en este momento no te interrumpe.
function nagDue(now, s, cfg) {
  if (!cfg.nagEnabled || s.remainingMin <= 0 || s.workingNow || s.stopwatch) return false;
  if (!s.activeSince) return false;
  const m = clock(now, cfg.dayStart);
  if (m >= norm(cfg.dayEnd, cfg.dayStart)) return false;
  if (!s.lastNagAt) return now - s.activeSince >= 2 * 60000;
  return now - s.lastNagAt >= (cfg.nagEveryMin || 30) * 60000;
}

module.exports = { forceDue, nagDue, forceStart, clock };
