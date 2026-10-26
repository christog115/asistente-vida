const DAY = 24 * 3600 * 1000;

export function fmtDate(iso, allDay) {
  const opts = allDay
    ? { weekday: 'short', day: 'numeric', month: 'short' }
    : { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
  return new Date(iso).toLocaleString('es-MX', opts);
}

// 'overdue' si ya pasó, 'soon' si vence en menos de 2 días.
export function dueState(iso) {
  if (!iso) return null;
  const left = new Date(iso) - Date.now();
  if (Number.isNaN(left)) return null;
  if (left < 0) return 'overdue';
  return left < 2 * DAY ? 'soon' : null;
}

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días, Christopher' : h < 19 ? 'Buenas tardes, Christopher' : 'Buenas noches, Christopher';
}
