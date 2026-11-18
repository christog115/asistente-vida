// Historial de productividad: un archivo JSON por día en la carpeta de datos de la app
// (%APPDATA%\Asistente de Vida\productividad\2026-11-18.json). Todo es local.
// A propósito no hay ninguna función para borrar: el historial se puede ver, no borrar.
const fs = require('fs');
const path = require('path');

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

// El día "lógico" empieza a la hora que digas (04:00 por defecto): si trabajas hasta la 1:00,
// eso cuenta para el día anterior.
function dayKey(now = Date.now(), dayStart = '04:00') {
  return toKey(new Date(now - minutesOf(dayStart) * 60000));
}

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

// Lunes de la semana del día dado.
function weekStart(key) {
  const d = parseKey(key);
  const dow = (d.getDay() + 6) % 7; // lunes = 0
  d.setDate(d.getDate() - dow);
  return toKey(d);
}

function emptyDay(key) {
  return {
    v: 1, date: key, goalMin: null,
    cats: { trabajo: 0, entretenimiento: 0, escuela: 0, neutral: 0, otro: 0 },
    kinds: { investigacion: 0, produccion: 0 },
    apps: {}, hours: {}, manual: [],
    afk: 0, nags: 0, forced: { shown: 0, snoozes: 0, closedApp: 0 },
    firstSeen: null, lastSeen: null
  };
}

function createLog(dir) {
  const days = new Map(); // cache de días abiertos
  const dirty = new Set();
  const file = (key) => path.join(dir, `${key}.json`);

  function read(key) {
    if (days.has(key)) return days.get(key);
    let d = null;
    try { d = { ...emptyDay(key), ...JSON.parse(fs.readFileSync(file(key), 'utf8')) }; } catch { d = null; }
    return d;
  }

  function open(key) {
    let d = read(key);
    if (!d) d = emptyDay(key);
    days.set(key, d);
    return d;
  }

  // Suma segundos a la categoría/app y a la hora del reloj.
  function add(key, { label, cat, kind }, sec, at = Date.now(), goalMin = null) {
    if (!(sec > 0)) return;
    const d = open(key);
    if (d.goalMin == null && goalMin != null) d.goalMin = goalMin;
    d.cats[cat] = (d.cats[cat] || 0) + sec;
    if (cat === 'trabajo' && kind) d.kinds[kind] = (d.kinds[kind] || 0) + sec;
    if (cat !== 'neutral') {
      const a = d.apps[label] || (d.apps[label] = { cat, kind: kind || '', sec: 0 });
      a.sec += sec;
      a.cat = cat;
    }
    const h = String(new Date(at).getHours());
    const hour = d.hours[h] || (d.hours[h] = {});
    hour[cat] = (hour[cat] || 0) + sec;
    if (!d.firstSeen) d.firstSeen = new Date(at).toISOString();
    d.lastSeen = new Date(at).toISOString();
    dirty.add(key);
  }

  function update(key, fn) {
    const d = open(key);
    fn(d);
    dirty.add(key);
    return d;
  }

  function flush() {
    if (!dirty.size) return;
    fs.mkdirSync(dir, { recursive: true });
    for (const key of dirty) {
      const tmp = file(key) + '.tmp';
      try {
        fs.writeFileSync(tmp, JSON.stringify(days.get(key)));
        fs.renameSync(tmp, file(key));
      } catch (err) {
        console.error('Productividad: no se pudo guardar', key, err.message);
        continue;
      }
    }
    dirty.clear();
    // Solo se queda en memoria el día de hoy y ayer.
    const keep = new Set([...days.keys()].sort().slice(-2));
    for (const k of [...days.keys()]) if (!keep.has(k)) days.delete(k);
  }

  function list() {
    try { return fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).map((n) => n.slice(0, 10)).sort(); } catch { return []; }
  }

  function range(fromKey, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const k = addDays(fromKey, i);
      out.push(read(k) || emptyDay(k));
    }
    return out;
  }

  return { read, open, add, update, flush, list, range };
}

module.exports = { createLog, dayKey, addDays, weekStart, parseKey, toKey, minutesOf, emptyDay };
