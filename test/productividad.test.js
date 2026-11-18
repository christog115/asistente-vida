// Pruebas de la lógica del monitor de productividad (sin Electron): npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { classify, cleanRule, siteOf } = require('../src/focus-rules');
const logLib = require('../src/focus-log');
const stats = require('../src/focus-stats');
const plan = require('../src/focus-plan');
const phrases = require('../src/focus-phrases');

const school = { enabled: true, startDate: '2027-01-01' };
const nov = new Date(2026, 10, 18, 15).getTime();
const feb = new Date(2027, 1, 3, 15).getTime();
const c = (name, title = '', p = '', now = nov) => classify({ name, title, path: p }, undefined, { school }, now);

test('apps de trabajo', () => {
  assert.deepStrictEqual(c('Code', 'main.js - asistente - Visual Studio Code'), { label: 'VS Code', cat: 'trabajo', kind: 'produccion' });
  assert.strictEqual(c('krita').label, 'Krita');
  assert.strictEqual(c('godot').cat, 'trabajo');
  assert.strictEqual(c('Godot_v4.3-stable_win64').label, 'Godot');
  assert.strictEqual(c('blender').cat, 'trabajo');
  assert.deepStrictEqual(c('chrome', 'Nuevo chat - Claude - Google Chrome'), { label: 'Claude', cat: 'trabajo', kind: 'investigacion' });
  assert.strictEqual(c('msedge', 'Gemini - Microsoft Edge').label, 'Gemini');
  assert.strictEqual(c('chrome', 'Presupuesto - Hojas de cálculo de Google - Google Chrome').label, 'Google Docs, Sheets y Slides');
  assert.strictEqual(c('chrome', 'Untitled document - Google Docs - Google Chrome').kind, 'produccion');
});

test('entretenimiento: juegos instalados, YouTube y series', () => {
  assert.strictEqual(c('FortniteClient-Win64-Shipping').cat, 'entretenimiento');
  assert.strictEqual(c('Marvel-Win64-Shipping').label, 'Marvel Rivals');
  assert.strictEqual(c('HollowKnight', 'Hollow Knight', 'D:\\SteamLibrary\\steamapps\\common\\Hollow Knight\\hollow_knight.exe').label, 'Juegos de Steam');
  assert.strictEqual(c('Game', '', 'C:\\Program Files\\Epic Games\\Game\\game.exe').cat, 'entretenimiento');
  assert.strictEqual(c('chrome', 'Cómo dibujar manos - YouTube - Google Chrome').label, 'YouTube');
  assert.strictEqual(c('msedge', 'Netflix - Microsoft Edge').cat, 'entretenimiento');
});

test('palabras cortas no confunden y el título no cuenta fuera del navegador', () => {
  assert.strictEqual(c('chrome', 'Maximizar ventanas en Windows - Google Chrome').cat, 'otro'); // "max" no es HBO Max
  assert.strictEqual(c('code', 'youtube-api.js - Visual Studio Code').cat, 'trabajo');
});

test('escuela apagada hasta enero de 2027', () => {
  assert.strictEqual(c('chrome', 'Classroom - Google Chrome').cat, 'neutral');
  assert.strictEqual(c('chrome', 'Classroom - Google Chrome', '', feb).cat, 'escuela');
  assert.strictEqual(classify({ name: 'chrome', title: 'Classroom' }, undefined, { school: { enabled: false } }, feb).cat, 'neutral');
});

test('lo desconocido guarda solo el sitio, no el título', () => {
  const r = c('chrome', 'Mi cuenta privada 1234 - Banco Ejemplo - Google Chrome');
  assert.deepStrictEqual(r, { label: 'Web: Banco Ejemplo', cat: 'otro', kind: '' });
  assert.strictEqual(siteOf('Solo un título - Google Chrome'), 'Otra página');
  assert.strictEqual(c('electron', 'Asistente de Vida').cat, 'neutral');
});

test('reglas propias ganan y se validan', () => {
  const mine = cleanRule({ label: 'Godot 4', cat: 'trabajo', kind: 'produccion', procs: 'Godot_v4.3-stable_win64.exe' });
  assert.deepStrictEqual(mine.procs, ['godot_v4.3-stable_win64']);
  assert.strictEqual(classify({ name: 'Godot_v4.3-stable_win64' }, [mine]).cat, 'trabajo');
  assert.throws(() => cleanRule({ label: 'x', cat: 'trabajo' }));
  assert.throws(() => cleanRule({ label: 'x', cat: 'malo', procs: 'a' }));
});

test('historial por día, sin borrar, y día lógico desde las 04:00', () => {
  assert.strictEqual(logLib.dayKey(new Date(2026, 10, 19, 1, 30).getTime(), '04:00'), '2026-11-18');
  assert.strictEqual(logLib.dayKey(new Date(2026, 10, 19, 5).getTime(), '04:00'), '2026-11-19');
  assert.strictEqual(logLib.weekStart('2026-11-22'), '2026-11-16'); // domingo -> lunes
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-'));
  const log = logLib.createLog(dir);
  log.add('2026-11-18', { label: 'VS Code', cat: 'trabajo', kind: 'produccion' }, 3600, nov, 180);
  log.add('2026-11-18', { label: 'YouTube', cat: 'entretenimiento', kind: '' }, 1800, nov, 180);
  log.flush();
  const again = logLib.createLog(dir).read('2026-11-18');
  assert.strictEqual(again.cats.trabajo, 3600);
  assert.strictEqual(again.apps.YouTube.sec, 1800);
  assert.strictEqual(again.goalMin, 180);
  assert.strictEqual(typeof log.remove, 'undefined');
  assert.deepStrictEqual(log.list(), ['2026-11-18']);
});

test('metas por día y tablero semanal', () => {
  assert.strictEqual(stats.goalFor('2026-11-16'), 180); // lunes
  assert.strictEqual(stats.goalFor('2026-11-20'), 120); // viernes
  assert.strictEqual(stats.goalFor('2026-11-21'), 240); // sábado
  assert.strictEqual(stats.goalFor('2026-11-22'), 30); // domingo
  const mk = (date, work, fun) => ({ ...logLib.emptyDay(date), firstSeen: date + 'T10:00:00Z', cats: { trabajo: work * 60, entretenimiento: fun * 60, escuela: 0, neutral: 0, otro: 0 }, kinds: { investigacion: work * 30, produccion: work * 30 } });
  const days = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'].map((d, i) => mk(d, i < 2 ? 200 : i === 2 ? 60 : 0, 90));
  const prev = days.map((d) => mk(logLib.addDays(d.date, -7), 100, 200));
  const byKey = Object.fromEntries([...days, ...prev].map((d) => [d.date, d]));
  const w = stats.weekStats(days, prev, '2026-11-18', undefined, (k) => byKey[k] || null);
  assert.deepStrictEqual(w.days.map((d) => d.state), ['cumplido', 'cumplido', 'hoy', 'futuro', 'futuro', 'futuro', 'futuro']);
  assert.strictEqual(w.totals.met, 2);
  assert.strictEqual(w.totals.work, 460);
  assert.strictEqual(w.change.work, 53); // 460 contra 300 de lunes a miércoles pasados
  assert.strictEqual(w.streak.current, 3); // hoy aún no; lunes, martes y el domingo pasado (meta 30 min) sí
  assert.strictEqual(stats.fmtMin(95), '1 h 35 min');
});

const cfg = { forceEnabled: true, nagEnabled: true, nagEveryMin: 30, forceFrom: '21:30', dayEnd: '23:30', dayStart: '04:00' };
const at = (h, m = 0) => new Date(2026, 10, 18, h, m).getTime();

test('ventana forzada: a las 21:30 o antes si ya no alcanza', () => {
  assert.strictEqual(plan.forceDue(at(21, 0), 30, cfg), false);
  assert.strictEqual(plan.forceDue(at(21, 31), 30, cfg), true);
  assert.strictEqual(plan.forceDue(at(20, 0), 180, cfg), false);
  assert.strictEqual(plan.forceDue(at(20, 20), 180, cfg), true); // 23:30 - 3 h - 15 min = 20:15 (nunca antes de 18:30)
  assert.strictEqual(plan.forceDue(at(18, 0), 300, cfg), false);
  assert.strictEqual(plan.forceDue(at(23, 45), 30, cfg), false); // el día ya cerró
  assert.strictEqual(plan.forceDue(at(22, 0), 0, cfg), false);
});

test('recordatorio: 2 min después de prender la PC y luego cada 30', () => {
  const base = { remainingMin: 60, workingNow: false, stopwatch: false, activeSince: at(10), lastNagAt: 0 };
  assert.strictEqual(plan.nagDue(at(10, 1), base, cfg), false);
  assert.strictEqual(plan.nagDue(at(10, 2), base, cfg), true);
  assert.strictEqual(plan.nagDue(at(10, 20), { ...base, lastNagAt: at(10, 2) }, cfg), false);
  assert.strictEqual(plan.nagDue(at(10, 32), { ...base, lastNagAt: at(10, 2) }, cfg), true);
  assert.strictEqual(plan.nagDue(at(10, 32), { ...base, lastNagAt: at(10, 2), workingNow: true }, cfg), false);
  assert.strictEqual(plan.nagDue(at(10, 32), { ...base, lastNagAt: at(10, 2), remainingMin: 0 }, cfg), false);
});

test('frases duras con tu porqué', () => {
  const t = phrases.phrase({ porque: 'quiero vivir de mis juegos.', falta: '1 h', hecho: '2 h', meta: '3 h' }, () => 0);
  assert.match(t, /quiero vivir de mis juegos/);
  assert.doesNotMatch(t, /\{|\}/);
  const d = phrases.phrase({ porque: '', falta: '1 h', app: 'YouTube', distracted: true }, () => 0);
  assert.match(d, /YouTube/);
  assert.deepStrictEqual(phrases.parseAi('1. Primera frase dura y directa aquí\n- Faltan {falta} y sigues sin empezar hoy\n{raro} no'), ['Primera frase dura y directa aquí', 'Faltan {falta} y sigues sin empezar hoy']);
});

test('los días antes de instalar no cuentan como fallados', () => {
  const days = ['2026-11-16', '2026-11-17', '2026-11-18'].map((d) => logLib.emptyDay(d));
  const w = stats.weekStats(days, days, '2026-11-18', undefined, null, '2026-11-18');
  assert.deepStrictEqual(w.days.map((d) => d.state), ['sin-datos', 'sin-datos', 'hoy']);
  assert.strictEqual(w.totals.elapsed, 1);
});
