// Monitor de productividad (solo PC). Cada 5 s mira qué ventana tienes al frente y cuánto llevas
// sin tocar teclado ni mouse, lo clasifica (trabajo, entretenimiento, escuela) y lo suma al día.
// Además: cronómetro manual, recordatorios cada 30 min con kara, la ventana que te obliga a
// trabajar al final del día y el reporte semanal con IA. Todo se guarda solo en esta PC.
const { app, BrowserWindow, Notification, powerMonitor } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const store = require('./store');
const ai = require('./ai');
const rulesLib = require('./focus-rules');
const logLib = require('./focus-log');
const stats = require('./focus-stats');
const plan = require('./focus-plan');
const phrases = require('./focus-phrases');

const TICK_MS = 5000;
const MAX_GAP_MS = 15000; // si la PC se durmió, ese hueco no cuenta (salvo el cronómetro)
const FUN_IDLE_MAX_SEC = 45 * 60; // ver un video sin tocar nada sigue contando, hasta 45 min
const STOPWATCH_MAX_MIN = 6 * 60;
const STOPWATCH_LABEL = 'Cronómetro (papel y lápiz)';

const DEFAULTS = {
  enabled: true,
  why: '',
  goals: { ...stats.DEFAULT_GOALS },
  afkMin: 5,
  nagEnabled: true,
  nagEveryMin: 30,
  nagSpeak: true,
  forceEnabled: true,
  forceFrom: '21:30',
  dayEnd: '23:30',
  dayStart: '04:00',
  snoozesPerDay: 2,
  snoozeMin: 10,
  aiPhrases: true,
  school: { enabled: true, startDate: '2027-01-01', goalMin: 60, goalMaxMin: 120 },
  reportDay: 0,
  reportTime: '21:00',
  rules: null
};

const dir = () => path.join(app.getPath('userData'), 'productividad');
const reportsDir = () => path.join(dir(), 'reportes');
let log = null;

function cfg() {
  const c = store.get('focus') || {};
  return { ...DEFAULTS, ...c, goals: { ...DEFAULTS.goals, ...(c.goals || {}) }, school: { ...DEFAULTS.school, ...(c.school || {}) } };
}
function rules() {
  return cfg().rules || rulesLib.DEFAULT_RULES;
}

// ---------- Ventana activa (Windows, por PowerShell; sin módulos nativos que compilar) ----------
const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class AvFw {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
}
"@
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $h = [AvFw]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [void][AvFw]::GetWindowText($h, $sb, 512)
  $procId = [uint32]0
  [void][AvFw]::GetWindowThreadProcessId($h, [ref]$procId)
  $p = Get-Process -Id $procId
  $o = @{ title = $sb.ToString(); name = ''; path = '' }
  if ($p) { $o.name = $p.ProcessName; $o.path = [string]$p.Path }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}
`;

let ps = null;
let psBuf = '';
let psWaiting = null;
let psFails = 0;
let psRetryAt = 0;
let monitorError = null;

function startPs() {
  if (process.platform !== 'win32') { monitorError = 'La detección de ventanas solo funciona en Windows por ahora.'; return null; }
  if (Date.now() < psRetryAt) return null;
  const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
  try {
    ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  } catch (err) {
    monitorError = err.message;
    ps = null;
    return null;
  }
  psBuf = '';
  ps.stdout.setEncoding('utf8');
  ps.stdout.on('data', (chunk) => {
    psBuf += chunk;
    let i;
    while ((i = psBuf.indexOf('\n')) >= 0) {
      const line = psBuf.slice(0, i).trim();
      psBuf = psBuf.slice(i + 1);
      if (!line || !psWaiting) continue;
      const w = psWaiting;
      psWaiting = null;
      try { w(JSON.parse(line)); } catch { w(null); }
    }
  });
  const dead = () => {
    ps = null;
    if (psWaiting) { psWaiting(null); psWaiting = null; }
    psFails++;
    // Si PowerShell se cae seguido, se descansa un rato antes de reintentar.
    if (psFails >= 5) { psRetryAt = Date.now() + 10 * 60000; psFails = 0; monitorError = 'PowerShell no responde; reintento en 10 min.'; }
  };
  ps.on('exit', dead);
  ps.on('error', (err) => { monitorError = err.message; });
  return ps;
}

function foreground() {
  if (!ps && !startPs()) return Promise.resolve(null);
  if (psWaiting) return Promise.resolve(null); // la anterior sigue sin contestar
  return new Promise((resolve) => {
    const timer = setTimeout(() => { if (psWaiting === done) { psWaiting = null; resolve(null); } }, 4000);
    const done = (v) => { clearTimeout(timer); if (v) { psFails = 0; monitorError = null; } resolve(v); };
    psWaiting = done;
    try { ps.stdin.write('\n'); } catch { psWaiting = null; clearTimeout(timer); resolve(null); }
  });
}

// ---------- Estado en memoria ----------
let hooks = { speak: () => false, showWindow: () => {} };
let lastTick = Date.now();
let current = { label: '—', cat: 'neutral', kind: '', idleSec: 0, afk: false, locked: false };
let lastWorkAt = 0;
let activeSince = null; // primera actividad del día (para el primer recordatorio)
let activeDay = null;
let afkWarned = 0;
let funWarnAt = 0;
let lastFlush = Date.now();
let ticking = false;

function todayKey(now = Date.now()) {
  return logLib.dayKey(now, cfg().dayStart);
}

function goalToday(now = Date.now()) {
  const key = todayKey(now);
  const d = log.read(key);
  return d && d.goalMin != null ? d.goalMin : stats.goalFor(key, cfg().goals);
}

function workedToday(now = Date.now()) {
  const d = log.read(todayKey(now));
  return d ? Math.round((d.cats.trabajo || 0) / 60) : 0;
}

function remainingToday(now = Date.now()) {
  return Math.max(0, goalToday(now) - workedToday(now));
}

// ---------- Cronómetro manual ----------
let swMem = null;
let swSavedAt = 0;
function stopwatch() {
  if (swMem) return swMem;
  swMem = store.get('focusStopwatch') || null;
  return swMem;
}

function stopwatchStart(note = '') {
  if (stopwatch()) return stopwatch();
  const sw = { start: Date.now(), note: String(note || '').slice(0, 80), counted: 0 };
  swMem = sw;
  store.set('focusStopwatch', sw);
  hideForce();
  return sw;
}

function stopwatchStop() {
  const sw = stopwatch();
  if (!sw) return null;
  swMem = null;
  store.set('focusStopwatch', null);
  const end = Date.now();
  const entry = { start: new Date(sw.start).toISOString(), end: new Date(end).toISOString(), min: Math.round((sw.counted || 0) / 60), note: sw.note };
  log.update(todayKey(sw.start), (d) => d.manual.push(entry));
  log.flush();
  return entry;
}

function notify(title, body) {
  const n = new Notification({ title, body });
  n.on('click', () => hooks.showWindow('productividad'));
  n.show();
}

// ---------- Cada 5 s ----------
async function tick() {
  if (ticking || !cfg().enabled) return;
  ticking = true;
  try {
    const c = cfg();
    const now = Date.now();
    const gap = now - lastTick;
    lastTick = now;
    const dt = Math.min(gap, MAX_GAP_MS) / 1000;
    const key = todayKey(now);
    const goal = stats.goalFor(key, c.goals);
    const afkSec = c.afkMin * 60;
    const idle = powerMonitor.getSystemIdleTime();
    const locked = powerMonitor.getSystemIdleState(afkSec) === 'locked';
    const sample = locked ? null : await foreground();
    const cls = sample ? rulesLib.classify(sample, rules(), { school: c.school }, now) : { label: locked ? 'Pantalla bloqueada' : 'Sin datos', cat: 'neutral', kind: '' };
    const afk = idle >= afkSec;
    current = { ...cls, idleSec: idle, afk, locked, at: now };

    if (activeDay !== key) { activeDay = key; activeSince = null; afkWarned = 0; }
    if (!activeSince && !locked && !afk) activeSince = now;

    const sw = stopwatch();
    if (sw) {
      // El cronómetro cuenta aunque la PC esté bloqueada o dormida (estás en papel).
      // Si mientras corre abres un juego o YouTube, ese rato es entretenimiento.
      const swDt = Math.min(gap, 30 * 60000) / 1000;
      if (cls.cat === 'entretenimiento' && !afk) {
        log.add(key, cls, dt, now, goal);
        if (now - funWarnAt > 5 * 60000) {
          funWarnAt = now;
          notify('El cronómetro está corriendo', `Pero estás en ${cls.label}. Ese tiempo no cuenta como trabajo.`);
        }
      } else {
        log.add(key, { label: STOPWATCH_LABEL, cat: 'trabajo', kind: 'produccion' }, swDt, now, goal);
        const counted = (sw.counted || 0) + swDt;
        swMem = { ...sw, counted };
        // Se guarda en disco cada minuto (no cada 5 s) para no escribir la configuración a cada rato.
        if (now - swSavedAt > 60000) { store.set('focusStopwatch', swMem); swSavedAt = now; }
        lastWorkAt = now;
        if (counted >= STOPWATCH_MAX_MIN * 60) {
          stopwatchStop();
          notify('Cronómetro detenido', `Llegó a ${STOPWATCH_MAX_MIN / 60} horas y lo paré por si se te olvidó.`);
        }
      }
    } else if (!locked) {
      if (cls.cat === 'trabajo' || cls.cat === 'escuela') {
        if (!afk) {
          log.add(key, cls, dt, now, goal);
          lastWorkAt = now;
          afkWarned = 0;
        } else {
          // AFK: el reloj se pausa y te avisa a los 5, 10 y 15 min.
          const step = Math.floor(idle / afkSec);
          if (step > afkWarned && afkWarned < 3) {
            afkWarned = step;
            log.update(key, (d) => { d.afk = (d.afk || 0) + 1; });
            notify('¿Sigues ahí?', `Llevas ${Math.round(idle / 60)} min sin mover el mouse ni el teclado en ${cls.label}. Pausé el reloj de trabajo.`);
          }
        }
      } else if (cls.cat === 'entretenimiento') {
        if (idle < FUN_IDLE_MAX_SEC) log.add(key, cls, dt, now, goal);
      } else if (!afk) {
        log.add(key, cls, dt, now, goal);
      }
    }

    if (now - lastFlush > 60000) { log.flush(); lastFlush = now; }
  } catch (err) {
    console.error('Productividad:', err.message);
  } finally {
    ticking = false;
  }
}

// ---------- Recordatorios ----------
let lastNagAt = 0;
let lastNagDay = null;

function aiList() {
  const p = store.get('focusPhrases');
  return p && p.date === todayKey() && Array.isArray(p.list) ? p.list : [];
}

let aiRunning = false;
async function refreshAiPhrases() {
  const c = cfg();
  if (aiRunning || !c.aiPhrases || !ai.ready() || aiList().length) return;
  aiRunning = true;
  try {
    const text = await ai.ask('Eres un entrenador exigente y honesto. Respondes solo con lo que se te pide.', phrases.aiPrompt(c.why));
    const list = phrases.parseAi(text);
    if (list.length) store.set('focusPhrases', { date: todayKey(), list });
  } catch (err) {
    console.error('Frases de la IA:', err.message);
  } finally {
    aiRunning = false;
  }
}

function makePhrase(distracted) {
  const c = cfg();
  const falta = stats.fmtMin(remainingToday());
  const vars = { porque: c.why, falta, hecho: stats.fmtMin(workedToday()), meta: stats.fmtMin(goalToday()), app: current.label, distracted };
  const mine = aiList();
  if (mine.length && Math.random() < 0.6) return phrases.tidy(phrases.fill(mine[Math.floor(Math.random() * mine.length)], vars));
  return phrases.phrase(vars);
}

function nag(force = false) {
  const now = Date.now();
  const left = remainingToday(now);
  if (!force && left <= 0) return false;
  const distracted = current.cat === 'entretenimiento';
  const text = makePhrase(distracted);
  notify(`Te faltan ${stats.fmtMin(left)} de trabajo hoy`, text);
  const c = cfg();
  if (c.nagSpeak) hooks.speak(text);
  lastNagAt = now;
  store.set('focusLastNag', now);
  log.update(todayKey(now), (d) => { d.nags = (d.nags || 0) + 1; });
  return text;
}

// ---------- Ventana forzada ----------
let forceWin = null;
let forceShownAt = 0;
let graceUntil = 0;
let snoozeUntil = 0;
let testUntil = 0; // la prueba desde ajustes dura 1 min aunque ya hayas cumplido

function snoozesLeft() {
  const s = store.get('focusSnoozes');
  const used = s && s.date === todayKey() ? s.used : 0;
  return Math.max(0, cfg().snoozesPerDay - used);
}

function forceState() {
  return {
    remaining: stats.fmtMin(remainingToday()),
    worked: stats.fmtMin(workedToday()),
    goal: stats.fmtMin(goalToday()),
    phrase: makePhrase(current.cat === 'entretenimiento'),
    why: cfg().why,
    snoozesLeft: snoozesLeft(),
    snoozeMin: cfg().snoozeMin,
    dayEnd: cfg().dayEnd
  };
}

function showForce() {
  if (forceWin && !forceWin.isDestroyed()) {
    if (!forceWin.isVisible()) {
      forceWin.show();
      forceWin.webContents.send('force-state', forceState());
    }
    forceWin.setAlwaysOnTop(true, 'screen-saver');
    forceWin.focus();
    return;
  }
  forceWin = new BrowserWindow({
    fullscreen: true, frame: false, alwaysOnTop: true, skipTaskbar: false, resizable: false, minimizable: false,
    closable: true, show: false, backgroundColor: '#0b0d10', title: 'Hora de trabajar',
    webPreferences: { preload: path.join(__dirname, '..', 'preload-forzar.js') }
  });
  forceWin.setAlwaysOnTop(true, 'screen-saver');
  forceWin.removeMenu();
  forceWin.loadFile(path.join(__dirname, '..', 'renderer', 'forzar.html'));
  forceWin.once('ready-to-show', () => { forceWin.show(); forceWin.focus(); });
  // No se cierra con Alt+F4 ni Esc: solo empezando a trabajar, con el cronómetro o con una pausa de emergencia.
  forceWin.on('close', (e) => { if (!forceWin.allowClose) e.preventDefault(); });
  // Si intentas irte a otra ventana, vuelve al frente.
  forceWin.on('blur', () => setTimeout(() => {
    if (forceWin && !forceWin.isDestroyed() && forceWin.isVisible()) { forceWin.moveTop(); forceWin.focus(); }
  }, 300));
  forceWin.on('leave-full-screen', () => { if (forceWin && forceWin.isVisible()) forceWin.setFullScreen(true); });
  forceShownAt = Date.now();
  store.set('focusForceOpen', todayKey());
  log.update(todayKey(), (d) => { d.forced.shown = (d.forced.shown || 0) + 1; });
  const text = makePhrase(current.cat === 'entretenimiento');
  hooks.speak(`Se acabó el margen. Te faltan ${stats.fmtMin(remainingToday())}. ${text}`);
}

function hideForce() {
  if (Date.now() < testUntil) return;
  if (forceWin && !forceWin.isDestroyed() && forceWin.isVisible()) {
    forceWin.hide();
    store.set('focusForceOpen', null);
  }
}

function forceAction(what) {
  const now = Date.now();
  testUntil = 0;
  if (what === 'work') {
    graceUntil = now + 3 * 60000; // 3 min para abrir lo tuyo; si no trabajas, regresa
    hideForce();
    return true;
  }
  if (what === 'stopwatch') {
    stopwatchStart('Desde la ventana forzada');
    hideForce();
    return true;
  }
  if (what === 'snooze') {
    if (!snoozesLeft()) return false;
    const s = store.get('focusSnoozes');
    const used = s && s.date === todayKey() ? s.used : 0;
    store.set('focusSnoozes', { date: todayKey(), used: used + 1 });
    snoozeUntil = now + cfg().snoozeMin * 60000;
    log.update(todayKey(), (d) => { d.forced.snoozes = (d.forced.snoozes || 0) + 1; });
    hideForce();
    return true;
  }
  return false;
}

// ---------- Cada minuto ----------
function minute() {
  const c = cfg();
  if (!c.enabled) return;
  const now = Date.now();
  const key = todayKey(now);
  if (lastNagDay !== key) { lastNagDay = key; lastNagAt = 0; snoozeUntil = 0; graceUntil = 0; }
  const left = remainingToday(now);
  const workingNow = now - lastWorkAt < 2 * 60000;
  const sw = !!stopwatch();
  refreshAiPhrases();

  if (plan.nagDue(now, { remainingMin: left, workingNow, stopwatch: sw, activeSince, lastNagAt }, c) && !(forceWin && forceWin.isVisible())) nag();

  if (plan.forceDue(now, left, c) && !current.locked) {
    if (workingNow || sw) { if (now > graceUntil) graceUntil = now + 2 * 60000; }
    if (!workingNow && !sw && now > graceUntil && now > snoozeUntil) showForce();
  } else {
    hideForce();
  }
  if (forceWin && !forceWin.isDestroyed() && forceWin.isVisible()) {
    if (workingNow || sw || left <= 0) hideForce();
    else forceWin.webContents.send('force-state', forceState());
  }
  weeklyReportTick(now);
}

// ---------- Reporte semanal con IA ----------
function reportFile(weekKey) {
  return path.join(reportsDir(), `${weekKey}.json`);
}

function readReport(weekKey) {
  try { return JSON.parse(fs.readFileSync(reportFile(weekKey), 'utf8')); } catch { return null; }
}

function week(weekKey) {
  const c = cfg();
  const prev = logLib.addDays(weekKey, -7);
  return stats.weekStats(log.range(weekKey, 7), log.range(prev, 7), todayKey(), c.goals, (k) => log.read(k), log.list()[0] || null);
}

function reportPrompt(w) {
  const c = cfg();
  const lines = w.days.map((d) => `${d.weekday} ${d.date}: trabajo ${d.work} min de ${d.goal} (${d.state}), entretenimiento ${d.fun} min, investigación ${d.research} min, producción ${d.production} min, papel ${d.manual} min, escuela ${d.school} min, AFK ${d.afk} veces, ventana forzada ${d.forced.shown || 0} veces`);
  const top = (list) => list.map((a) => `${a.label} ${a.min} min`).join(', ') || 'nada';
  return [
    'Analiza mi semana de productividad y dime la verdad, en español, directo y sin adornos. Datos (minutos):',
    ...lines,
    `Total: trabajo ${w.totals.work} min de ${w.totals.goal} de meta, entretenimiento ${w.totals.fun} min, días cumplidos ${w.totals.met} de ${w.totals.elapsed}.`,
    `Semana anterior: trabajo ${w.previous.work} min, entretenimiento ${w.previous.fun} min, días cumplidos ${w.previous.met}.`,
    `Racha actual ${w.streak ? w.streak.current : 0} días (mejor ${w.streak ? w.streak.best : 0}).`,
    `Dónde trabajé: ${top(w.top.trabajo)}. Entretenimiento: ${top(w.top.entretenimiento)}.`,
    `Hora con más trabajo: ${w.hours.work != null ? w.hours.work + ':00' : 'sin datos'}. Hora con más entretenimiento: ${w.hours.fun != null ? w.hours.fun + ':00' : 'sin datos'}.`,
    c.why ? `Mi porqué: "${c.why}".` : '',
    'Escribe: 1) un veredicto de una línea; 2) trabajo contra juegos y actividades no funcionales, con números; 3) qué días y horas fallé y por qué parece; 4) tres consejos concretos para la próxima semana (horarios, qué cerrar, cómo usar mejor investigación contra producción); 5) una frase final dura sobre mi porqué y la constancia, sin clichés. Máximo 250 palabras, sin tablas.'
  ].filter(Boolean).join('\n');
}

function plainReport(w) {
  const t = w.totals;
  const lines = [
    `Trabajaste ${stats.fmtMin(t.work)} de ${stats.fmtMin(t.goal)} (${t.met} de ${t.elapsed} días cumplidos).`,
    `Entretenimiento: ${stats.fmtMin(t.fun)}.${w.ratio != null ? ` Por cada hora de entretenimiento trabajaste ${w.ratio} h.` : ''}`,
    `Investigación ${stats.fmtMin(t.research)} contra producción ${stats.fmtMin(t.production)}.`
  ];
  const failed = w.days.filter((d) => d.state === 'fallado').map((d) => d.weekday);
  if (failed.length) lines.push(`Fallaste: ${failed.join(', ')}.`);
  lines.push('Conecta la IA (Claude, Gemini u OpenJarvis) para recibir el análisis con consejos.');
  return lines.join('\n');
}

let reportRunning = null;
function makeReport(weekKey = logLib.weekStart(todayKey())) {
  if (reportRunning) return reportRunning;
  reportRunning = (async () => {
    log.flush();
    const w = week(weekKey);
    let text;
    let byAi = false;
    if (ai.ready()) {
      try { text = await ai.ask('Eres un coach de productividad honesto y exigente. Hablas claro y das consejos accionables.', reportPrompt(w)); byAi = true; } catch (err) { text = plainReport(w) + `\n\n(La IA no contestó: ${err.message})`; }
    } else text = plainReport(w);
    const old = readReport(weekKey);
    // Si lo vuelves a generar se guarda la versión anterior también (nada se borra).
    const r = { week: weekKey, at: new Date().toISOString(), text, byAi, totals: w.totals, previous: old ? [...(old.previous || []), { at: old.at, text: old.text }].slice(-5) : [] };
    fs.mkdirSync(reportsDir(), { recursive: true });
    fs.writeFileSync(reportFile(weekKey), JSON.stringify(r, null, 2));
    return r;
  })().finally(() => { reportRunning = null; });
  return reportRunning;
}

function weeklyReportTick(now) {
  const c = cfg();
  const d = new Date(now);
  if (d.getDay() !== Number(c.reportDay)) return;
  if (d.getHours() * 60 + d.getMinutes() < logLib.minutesOf(c.reportTime)) return;
  const wk = logLib.weekStart(todayKey(now));
  if (store.get('focusReportDone') === wk) return;
  store.set('focusReportDone', wk);
  makeReport(wk).then((r) => {
    const first = r.text.split('\n').find((l) => l.trim()) || '';
    notify('Tu reporte de la semana está listo', first.replace(/[*#_]/g, '').slice(0, 200));
    hooks.speak('Tu reporte de la semana está listo. ' + first.replace(/[*#_]/g, '').slice(0, 300));
  }).catch((err) => console.error('Reporte semanal:', err.message));
}

// ---------- Para la pantalla ----------
function today() {
  const c = cfg();
  const key = todayKey();
  const d = log.read(key) || logLib.emptyDay(key);
  const s = stats.daySummary(d, key, c.goals, key);
  const sw = stopwatch();
  const schoolOn = rulesLib.schoolActive({ school: c.school }, Date.now());
  return {
    ...s,
    remaining: Math.max(0, s.goal - s.work),
    current,
    monitor: { ok: !monitorError, error: monitorError, platform: process.platform },
    stopwatch: sw ? { start: sw.start, min: Math.round((sw.counted || 0) / 60), note: sw.note } : null,
    school: { active: schoolOn, startDate: c.school.startDate, goalMin: c.school.goalMin, goalMaxMin: c.school.goalMaxMin, min: s.school },
    forceAt: (() => { const m = plan.forceStart(Math.max(0, s.goal - s.work), c) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; })(),
    snoozesLeft: snoozesLeft()
  };
}

function weekView(weekKey) {
  const wk = weekKey || logLib.weekStart(todayKey());
  const first = log.list()[0] || null;
  return { ...week(wk), report: readReport(wk), current: logLib.weekStart(todayKey()), firstDay: first, prevWeek: logLib.addDays(wk, -7), nextWeek: logLib.addDays(wk, 7) };
}

function settings() {
  const c = cfg();
  return { ...c, rules: rules(), customRules: !!c.rules };
}

function hhmmOk(v) { return /^\d{1,2}:\d{2}$/.test(String(v)) && logLib.minutesOf(v) < 1440; }

function saveSettings(changes = {}) {
  const c = { ...(store.get('focus') || {}) };
  const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v))));
  if ('enabled' in changes) c.enabled = !!changes.enabled;
  if ('why' in changes) c.why = String(changes.why || '').slice(0, 300);
  if (changes.goals) {
    const g = {};
    for (let i = 0; i < 7; i++) if (changes.goals[i] != null && changes.goals[i] !== '') g[i] = num(changes.goals[i], 0, 16 * 60);
    c.goals = { ...(c.goals || {}), ...g };
  }
  for (const k of ['afkMin', 'nagEveryMin', 'snoozesPerDay', 'snoozeMin', 'reportDay']) {
    if (k in changes && changes[k] !== '' && Number.isFinite(Number(changes[k]))) {
      const lim = { afkMin: [1, 60], nagEveryMin: [5, 240], snoozesPerDay: [0, 5], snoozeMin: [1, 30], reportDay: [0, 6] }[k];
      c[k] = num(changes[k], lim[0], lim[1]);
    }
  }
  for (const k of ['nagEnabled', 'nagSpeak', 'forceEnabled', 'aiPhrases']) if (k in changes) c[k] = !!changes[k];
  for (const k of ['forceFrom', 'dayEnd', 'dayStart', 'reportTime']) {
    if (k in changes) {
      if (!hhmmOk(changes[k])) throw new Error('Escribe la hora como 21:30.');
      c[k] = changes[k];
    }
  }
  if (changes.school) {
    const s = { ...(c.school || {}) };
    if ('enabled' in changes.school) s.enabled = !!changes.school.enabled;
    if (changes.school.startDate && /^\d{4}-\d{2}-\d{2}$/.test(changes.school.startDate)) s.startDate = changes.school.startDate;
    if (changes.school.goalMin) s.goalMin = num(changes.school.goalMin, 0, 600);
    if (changes.school.goalMaxMin) s.goalMaxMin = num(changes.school.goalMaxMin, 0, 600);
    c.school = s;
  }
  store.set('focus', c);
  if ('why' in changes) store.set('focusPhrases', null); // frases nuevas con tu nuevo porqué
  return settings();
}

function saveRule(rule) {
  const clean = rulesLib.cleanRule(rule);
  const list = rules().filter((r) => r.label.toLowerCase() !== clean.label.toLowerCase());
  // Las reglas nuevas van primero para que ganen sobre las de fábrica.
  store.set('focus', { ...(store.get('focus') || {}), rules: [clean, ...list] });
  return settings();
}

function removeRule(label) {
  store.set('focus', { ...(store.get('focus') || {}), rules: rules().filter((r) => r.label !== label) });
  return settings();
}

function resetRules() {
  const c = { ...(store.get('focus') || {}) };
  delete c.rules;
  store.set('focus', c);
  return settings();
}

// Desde "Lo que no reconocí": convierte una app o sitio en regla con un clic.
function quickRule(label, cat, kind) {
  const isWeb = /^Web: /.test(label);
  const name = isWeb ? label.slice(5) : label;
  return saveRule({ label: name, cat, kind, procs: isWeb ? [] : [name], titles: isWeb ? [name] : [] });
}

// Lo que sigue corriendo si la cerraron desde la bandeja con la ventana forzada abierta.
function onQuit() {
  if (forceWin && !forceWin.isDestroyed()) {
    if (forceWin.isVisible()) log.update(todayKey(), (d) => { d.forced.closedApp = (d.forced.closedApp || 0) + 1; });
    forceWin.allowClose = true;
  }
  if (swMem) store.set('focusStopwatch', swMem);
  log.flush();
  if (ps) { try { ps.kill(); } catch {} }
}

function init(h = {}) {
  hooks = { ...hooks, ...h };
  log = logLib.createLog(dir());
  lastNagAt = store.get('focusLastNag') || 0;
  // Si la app se cerró con la ventana forzada abierta, al volver se anota.
  const open = store.get('focusForceOpen');
  if (open) { log.update(open, (d) => { d.forced.closedApp = (d.forced.closedApp || 0) + 1; }); store.set('focusForceOpen', null); }
  lastTick = Date.now();
  setInterval(tick, TICK_MS);
  setInterval(minute, 60 * 1000);
  powerMonitor.on('lock-screen', () => log.flush());
  powerMonitor.on('suspend', () => log.flush());
  app.on('before-quit', onQuit);
}

module.exports = {
  init, today, weekView, settings, saveSettings, saveRule, removeRule, resetRules, quickRule,
  stopwatchStart, stopwatchStop, makeReport, readReport, forceAction, forceState,
  testNag: () => nag(true), testForce: () => { testUntil = Date.now() + 60000; showForce(); },
  history: () => log.list()
};
