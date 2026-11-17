// Calendario fiscal (SAT, IMSS, INFONAVIT) para el perfil Contador.
// Calcula las fechas límite de cada cliente según las obligaciones que le
// llevas. Si el día cae en sábado, domingo o día inhábil, se recorre al
// siguiente día hábil (art. 12 del Código Fiscal). Los días inhábiles extra que
// el SAT anuncia cada año (vacaciones) no se cuentan: así el aviso nunca llega
// tarde, a lo mucho llega antes. Siempre conviene confirmar en sat.gob.mx.
const DAY = 24 * 3600 * 1000;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// kind: mensual (periodo = mes), bimestral (periodo = bimestre que termina en mes par), anual.
const OBLIGATIONS = {
  mensual: { label: 'Pago provisional ISR/IVA', kind: 'mensual', short: 'pago mensual' },
  diot: { label: 'DIOT', kind: 'mensual', short: 'DIOT' },
  balanza: { label: 'Contabilidad electrónica (balanza)', kind: 'mensual', short: 'balanza' },
  imss: { label: 'Cuotas obrero-patronales IMSS', kind: 'mensual', short: 'IMSS' },
  infonavit: { label: 'IMSS (RCV) e INFONAVIT bimestral', kind: 'bimestral', short: 'INFONAVIT' },
  anual: { label: 'Declaración anual', kind: 'anual', short: 'anual' }
};

// Lo que normalmente lleva cada régimen; en cada cliente se puede cambiar.
const DEFAULTS = {
  moral: ['mensual', 'diot', 'balanza', 'anual'],
  fisica: ['mensual', 'diot', 'anual'],
  resico: ['mensual', 'anual']
};

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function nthMonday(year, month, n) {
  const d = new Date(year, month, 1);
  const first = (8 - d.getDay()) % 7; // días hasta el primer lunes
  return new Date(year, month, 1 + first + (n - 1) * 7);
}

// Domingo de Pascua (algoritmo de Meeus/Jones/Butcher).
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month, day);
}

const holidayCache = new Map();
// Descanso obligatorio (Ley Federal del Trabajo, art. 74) más jueves y viernes santo.
function holidays(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const e = easter(y);
  const days = [
    new Date(y, 0, 1), nthMonday(y, 1, 1), nthMonday(y, 2, 3), new Date(y, 4, 1),
    new Date(y, 8, 16), nthMonday(y, 10, 3), new Date(y, 11, 25),
    new Date(y, e.getMonth(), e.getDate() - 3), new Date(y, e.getMonth(), e.getDate() - 2)
  ];
  if ((y - 2024) % 6 === 0) days.push(new Date(y, 9, 1)); // cambio del Poder Ejecutivo
  const set = new Set(days.map(ymd));
  holidayCache.set(y, set);
  return set;
}

function isBusinessDay(d) {
  return d.getDay() !== 0 && d.getDay() !== 6 && !holidays(d.getFullYear()).has(ymd(d));
}

function nextBusinessDay(d) {
  const x = new Date(d);
  while (!isBusinessDay(x)) x.setDate(x.getDate() + 1);
  return x;
}

// Fecha límite (23:59 hora local) de una obligación para un periodo.
// month: 0-11 del periodo (para la anual se ignora).
function dueDate(obligation, regimen, year, month) {
  let d;
  switch (obligation) {
    case 'mensual':
    case 'imss':
    case 'infonavit':
      d = new Date(year, month + 1, 17); break; // día 17 del mes siguiente
    case 'diot':
      d = new Date(year, month + 2, 0); break; // último día del mes siguiente
    case 'balanza':
      d = new Date(year, month + 2, regimen === 'moral' ? 3 : 5); break; // segundo mes posterior
    case 'anual':
      d = regimen === 'moral' ? new Date(year + 1, 2, 31) : new Date(year + 1, 3, 30); break;
    default:
      return null;
  }
  d = nextBusinessDay(d);
  d.setHours(23, 59, 0, 0);
  return d;
}

function periodLabel(obligation, year, month) {
  const kind = OBLIGATIONS[obligation].kind;
  if (kind === 'anual') return `del ejercicio ${year}`;
  if (kind === 'bimestral') return `del bimestre ${MESES[month - 1]}-${MESES[month]} ${year}`;
  return `de ${MESES[month]} ${year}`;
}

// Todas las fechas límite de los clientes entre "back" días atrás y "ahead" días adelante.
// done: { [id]: fechaISO } de las que ya marcaste como presentadas.
function deadlines(clients, done = {}, now = new Date(), { back = 30, ahead = 60 } = {}) {
  const from = now.getTime() - back * DAY;
  const to = now.getTime() + ahead * DAY;
  const out = [];
  for (const c of clients || []) {
    // Lo que venció antes de agregar al cliente no se marca como atrasado (ya lo habrás presentado).
    const since = c.createdAt ? new Date(c.createdAt).getTime() : 0;
    for (const ob of c.obligations || []) {
      const def = OBLIGATIONS[ob];
      if (!def) continue;
      const periods = [];
      if (def.kind === 'anual') {
        for (const y of [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()]) periods.push([y, 0, String(y)]);
      } else {
        for (let off = -4; off <= 3; off++) {
          const p = new Date(now.getFullYear(), now.getMonth() + off, 1);
          if (def.kind === 'bimestral' && p.getMonth() % 2 === 0) continue; // bimestres terminan en feb, abr, jun...
          periods.push([p.getFullYear(), p.getMonth(), `${p.getFullYear()}-${pad(p.getMonth() + 1)}`]);
        }
      }
      for (const [y, m, key] of periods) {
        const due = dueDate(ob, c.regimen, y, m);
        if (!due || due.getTime() < Math.max(from, since) || due.getTime() > to) continue;
        const id = `${c.id}:${ob}:${key}`;
        const isDone = !!done[id];
        if (isDone && due.getTime() < now.getTime()) continue; // ya presentada y vencida: no estorba
        out.push({
          id, source: 'SAT', obligation: ob, clientId: c.id, client: c.name,
          title: `${def.label} ${periodLabel(ob, y, m)}`,
          due: due.toISOString(), done: isDone
        });
      }
    }
  }
  return out.sort((a, b) => new Date(a.due) - new Date(b.due));
}

module.exports = { OBLIGATIONS, DEFAULTS, deadlines, dueDate, nextBusinessDay, isBusinessDay, holidays, easter };
