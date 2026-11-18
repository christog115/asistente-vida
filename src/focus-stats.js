// Cuentas del tablero semanal (sin Electron, se prueba con npm test).
const { parseKey, addDays } = require('./focus-log');

// Minutos mínimos de trabajo por día de la semana (0 = domingo).
const DEFAULT_GOALS = { 0: 30, 1: 180, 2: 180, 3: 180, 4: 180, 5: 120, 6: 240 };
const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function goalFor(key, goals = DEFAULT_GOALS) {
  const g = goals[parseKey(key).getDay()];
  return Number.isFinite(Number(g)) ? Number(g) : DEFAULT_GOALS[parseKey(key).getDay()];
}

const min = (sec) => Math.round((sec || 0) / 60);

function dayGoal(d, goals) {
  return d.goalMin != null ? d.goalMin : goalFor(d.date, goals);
}

// firstDay: el primer día con historial; lo de antes no cuenta como fallado (aún no tenías la app).
function daySummary(d, todayKey, goals, firstDay = null) {
  const goal = dayGoal(d, goals);
  const work = min(d.cats.trabajo);
  const before = d.date < todayKey && (!firstDay || d.date < firstDay) && !d.firstSeen;
  const state = d.date > todayKey ? 'futuro' : work >= goal ? 'cumplido' : d.date === todayKey ? 'hoy' : before ? 'sin-datos' : 'fallado';
  return {
    date: d.date,
    weekday: DAY_NAMES[parseKey(d.date).getDay()],
    goal, work,
    fun: min(d.cats.entretenimiento),
    school: min(d.cats.escuela),
    other: min(d.cats.otro),
    research: min(d.kinds.investigacion),
    production: min(d.kinds.produccion),
    manual: (d.manual || []).reduce((n, m) => n + (m.min || 0), 0),
    afk: d.afk || 0,
    nags: d.nags || 0,
    forced: d.forced || { shown: 0, snoozes: 0, closedApp: 0 },
    firstSeen: d.firstSeen, lastSeen: d.lastSeen,
    state,
    pct: goal ? Math.min(100, Math.round((work / goal) * 100)) : 100
  };
}

function topApps(days, cat, n = 6) {
  const acc = {};
  for (const d of days) for (const [label, a] of Object.entries(d.apps || {})) {
    if (a.cat !== cat) continue;
    acc[label] = (acc[label] || 0) + a.sec;
  }
  return Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, sec]) => ({ label, min: min(sec) }));
}

// Hora del día en que más trabajas (para el consejo de la IA y el tablero).
function bestHours(days) {
  const work = {};
  const fun = {};
  for (const d of days) for (const [h, v] of Object.entries(d.hours || {})) {
    work[h] = (work[h] || 0) + (v.trabajo || 0);
    fun[h] = (fun[h] || 0) + (v.entretenimiento || 0);
  }
  const top = (o) => {
    const e = Object.entries(o).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1])[0];
    return e ? Number(e[0]) : null;
  };
  return { work: top(work), fun: top(fun) };
}

// Racha: días seguidos con la meta cumplida. Hoy suma solo si ya la cumpliste.
// readDay(key) devuelve el día guardado o null.
function streaks(readDay, todayKey, goals, maxDays = 400) {
  let current = 0;
  let k = todayKey;
  const today = readDay(k);
  if (today && min(today.cats.trabajo) >= dayGoal(today, goals)) current = 1;
  k = addDays(k, -1);
  for (let i = 0; i < maxDays; i++, k = addDays(k, -1)) {
    const d = readDay(k);
    if (!d || min(d.cats.trabajo) < dayGoal(d, goals)) break;
    current++;
  }
  let best = current;
  let run = 0;
  k = todayKey;
  for (let i = 0; i < maxDays; i++, k = addDays(k, -1)) {
    const d = readDay(k);
    if (d && min(d.cats.trabajo) >= dayGoal(d, goals)) { run++; best = Math.max(best, run); } else if (k !== todayKey) run = 0;
  }
  return { current, best };
}

function totals(sums) {
  const t = { work: 0, fun: 0, school: 0, goal: 0, research: 0, production: 0, manual: 0, afk: 0, met: 0, elapsed: 0, forced: 0, snoozes: 0 };
  for (const s of sums) {
    if (s.state === 'futuro' || s.state === 'sin-datos') continue;
    t.elapsed++;
    t.work += s.work; t.fun += s.fun; t.school += s.school; t.goal += s.goal;
    t.research += s.research; t.production += s.production; t.manual += s.manual; t.afk += s.afk;
    t.forced += s.forced.shown || 0; t.snoozes += s.forced.snoozes || 0;
    if (s.state === 'cumplido') t.met++;
  }
  return t;
}

function pctChange(now, before) {
  if (!before) return now ? null : 0;
  return Math.round(((now - before) / before) * 100);
}

// days / prevDays: los 7 días (lunes a domingo) de la semana y de la anterior.
function weekStats(days, prevDays, todayKey, goals = DEFAULT_GOALS, readDay = null, firstDay = null) {
  const first = firstDay || todayKey;
  const sums = days.map((d) => daySummary(d, todayKey, goals, first));
  const prev = prevDays.map((d) => daySummary(d, todayKey, goals, first));
  const t = totals(sums);
  // La semana anterior se compara con los mismos días que van de esta (si hoy es miércoles, lunes a miércoles).
  const prevSame = totals(prev.slice(0, Math.max(1, t.elapsed)));
  const prevAll = totals(prev);
  const unknown = topApps(days, 'otro', 8);
  return {
    from: days[0].date,
    to: days[days.length - 1].date,
    days: sums,
    totals: t,
    previous: { work: prevAll.work, fun: prevAll.fun, met: prevAll.met, sameDaysWork: prevSame.work, sameDaysFun: prevSame.fun },
    change: { work: pctChange(t.work, prevSame.work), fun: pctChange(t.fun, prevSame.fun) },
    ratio: t.fun ? Math.round((t.work / t.fun) * 10) / 10 : null,
    top: { trabajo: topApps(days, 'trabajo'), entretenimiento: topApps(days, 'entretenimiento'), escuela: topApps(days, 'escuela') },
    unknown,
    hours: bestHours(days),
    streak: readDay ? streaks(readDay, todayKey, goals) : null
  };
}

const fmtMin = (m) => {
  m = Math.round(m || 0);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`;
};

module.exports = { DEFAULT_GOALS, DAY_NAMES, goalFor, daySummary, weekStats, streaks, topApps, fmtMin };
