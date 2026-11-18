// Reglas del monitor de productividad: a qué categoría pertenece la ventana que tienes al frente.
// Este archivo no usa Electron para poder probarlo solo (npm test).
//
// Cada regla: { label, cat, kind, procs, titles, paths }
//   cat:   trabajo | entretenimiento | escuela | neutral
//   kind:  investigacion | produccion (solo para trabajo)
//   procs: nombres del proceso sin .exe (code, krita...); con * al final, cualquiera que empiece así (godot*)
//   titles: palabras en el título de la pestaña del navegador (YouTube, Claude...)
//   paths: pedazos de la carpeta del programa (steamapps\common => cualquier juego de Steam)

const CATS = ['trabajo', 'entretenimiento', 'escuela', 'neutral'];
const KINDS = ['investigacion', 'produccion'];

const BROWSERS = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'opera_gx', 'vivaldi', 'arc', 'zen', 'iexplore'];
const BROWSER_SUFFIX = / [-–—] (Google Chrome|Microsoft​? Edge|Mozilla Firefox|Brave|Opera|Vivaldi|Arc|Zen Browser)$/i;
// La propia app (y su ventana forzada) no cuenta para nada.
const OWN = ['asistente de vida', 'electron'];

const r = (label, cat, kind, { procs = [], titles = [], paths = [] } = {}) => ({ label, cat, kind: cat === 'trabajo' ? kind : '', procs, titles, paths });

const DEFAULT_RULES = [
  // Escuela (se activa en la fecha que pongas en ajustes; antes cuenta como neutral).
  r('Google Classroom', 'escuela', '', { titles: ['classroom'] }),
  r('Moodle CETI', 'escuela', '', { titles: ['moodle', 'tonala-virtual', 'ceti'] }),

  // Trabajo: investigación y planeación.
  r('Claude', 'trabajo', 'investigacion', { procs: ['claude'], titles: ['claude'] }),
  r('Gemini', 'trabajo', 'investigacion', { titles: ['gemini', 'ai studio'] }),
  r('ChatGPT', 'trabajo', 'investigacion', { procs: ['chatgpt'], titles: ['chatgpt'] }),
  r('Perplexity', 'trabajo', 'investigacion', { procs: ['perplexity'], titles: ['perplexity'] }),
  r('NotebookLM', 'trabajo', 'investigacion', { titles: ['notebooklm'] }),
  r('GitHub', 'trabajo', 'investigacion', { procs: ['githubdesktop'], titles: ['github'] }),
  r('Stack Overflow / documentación', 'trabajo', 'investigacion', { titles: ['stack overflow', 'mdn web docs', 'godot docs', 'blender manual', 'documentation', 'documentación'] }),
  r('Gmail y Calendar', 'trabajo', 'investigacion', { titles: ['gmail', 'google calendar', 'calendario de google'] }),
  r('Google Drive', 'trabajo', 'investigacion', { titles: ['google drive', 'mi unidad'] }),

  // Trabajo: producción.
  r('VS Code', 'trabajo', 'produccion', { procs: ['code', 'code - insiders', 'cursor', 'windsurf', 'vscodium'] }),
  r('Otros editores de código', 'trabajo', 'produccion', { procs: ['devenv', 'idea64', 'pycharm64', 'webstorm64', 'rider64', 'studio64', 'notepad++', 'sublime_text', 'zed'] }),
  r('Terminal', 'trabajo', 'produccion', { procs: ['windowsterminal', 'wt', 'cmd', 'powershell', 'pwsh', 'git-bash', 'mintty'] }),
  r('Krita', 'trabajo', 'produccion', { procs: ['krita'] }),
  r('Godot', 'trabajo', 'produccion', { procs: ['godot*'] }), // Godot_v4.3-stable_win64 y demás versiones
  r('Blender', 'trabajo', 'produccion', { procs: ['blender', 'blender-launcher'] }),
  r('Dibujo y diseño', 'trabajo', 'produccion', { procs: ['photoshop', 'illustrator', 'clipstudiopaint', 'aseprite', 'gimp', 'gimp-2.10', 'inkscape', 'paintdotnet', 'affinity', 'designer', 'photo', 'medibangpaintpro', 'firealpaca', 'sai2', 'figma'] , titles: ['figma', 'photopea'] }),
  r('Motores y 3D', 'trabajo', 'produccion', { procs: ['unity', 'unity hub', 'unrealeditor', 'substancepainter', 'zbrush', 'maya', '3dsmax'] }),
  r('Edición de video y audio', 'trabajo', 'produccion', { procs: ['resolve', 'adobe premiere pro', 'afterfx', 'capcut', 'audacity', 'reaper', 'fl64', 'kdenlive', 'shotcut'] }),
  r('Google Docs, Sheets y Slides', 'trabajo', 'produccion', {
    titles: ['google docs', 'google sheets', 'google slides', 'google forms', 'documentos de google', 'hojas de cálculo de google', 'presentaciones de google', 'formularios de google', 'google keep', 'apps script']
  }),
  r('Office', 'trabajo', 'produccion', { procs: ['winword', 'excel', 'powerpnt', 'onenote'] }),
  r('Canva', 'trabajo', 'produccion', { procs: ['canva'], titles: ['canva'] }),
  r('Notion y Obsidian', 'trabajo', 'produccion', { procs: ['notion', 'obsidian'], titles: ['notion'] }),

  // Entretenimiento: cualquier juego instalado por las tiendas cuenta por estar en su carpeta.
  r('Fortnite', 'entretenimiento', '', { procs: ['fortniteclient-win64-shipping', 'fortniteclient-win64-shipping_eac_eos', 'fortnitelauncher'] }),
  r('Marvel Rivals', 'entretenimiento', '', { procs: ['marvel-win64-shipping', 'marvelrivals_launcher', 'marvel'] }),
  r('Juegos de Steam', 'entretenimiento', '', { procs: ['steam', 'steamwebhelper'], paths: ['steamapps\\common', 'steamapps/common', '\\steam\\'] }),
  r('Juegos de Epic', 'entretenimiento', '', { procs: ['epicgameslauncher'], paths: ['epic games\\'] }),
  r('Otros juegos', 'entretenimiento', '', {
    procs: ['riotclientservices', 'leagueclient', 'league of legends', 'valorant-win64-shipping', 'minecraft', 'javaw', 'robloxplayerbeta', 'battle.net', 'overwatch', 'gta5', 'rdr2', 'ea', 'eadesktop', 'ubisoftconnect', 'genshinimpact', 'zenlesszonezero', 'starrail', 'cs2', 'dota2', 'rocketleague', 'r5apex', 'gamebar'],
    paths: ['riot games\\', 'xboxgames\\', 'ubisoft game launcher\\games', 'ea games\\', 'battle.net\\', 'gog galaxy\\games', '\\games\\']
  }),
  r('YouTube', 'entretenimiento', '', { titles: ['youtube'] }),
  r('Series y películas', 'entretenimiento', '', {
    procs: ['netflix', 'vlc', 'mpc-hc64', 'potplayermini64', 'disneyplus', 'primevideo', 'stremio', 'plex'],
    titles: ['netflix', 'prime video', 'disney+', 'hbo max', ' max', 'crunchyroll', 'vix', 'paramount+', 'pluto tv', 'apple tv', 'star+', 'mubi']
  }),
  r('Twitch y Kick', 'entretenimiento', '', { titles: ['twitch', 'kick'] }),
  r('Redes sociales', 'entretenimiento', '', { procs: ['tiktok', 'instagram'], titles: ['tiktok', 'instagram', 'facebook', 'reddit', ' / x', 'twitter', 'threads', '9gag', 'pinterest'] }),

  // Neutral: no suma a nada (música de fondo, chats, el explorador).
  r('Spotify', 'neutral', '', { procs: ['spotify'], titles: ['spotify'] }),
  r('Discord y WhatsApp', 'neutral', '', { procs: ['discord', 'whatsapp', 'telegram'], titles: ['whatsapp'] }),
  r('Windows', 'neutral', '', { procs: ['explorer', 'searchhost', 'startmenuexperiencehost', 'shellexperiencehost', 'lockapp', 'taskmgr', 'systemsettings', 'applicationframehost', 'idle', ''] })
];

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

function procName(name) {
  return norm(name).replace(/\.exe$/, '');
}

// "Video - YouTube - Google Chrome" -> "Video - YouTube"
function pageTitle(title) {
  return String(title || '').replace(BROWSER_SUFFIX, '').trim();
}

// Nombre del sitio para una página que no reconoce ninguna regla: el último pedazo del título
// ("Página - Sitio"). Así se guarda el sitio y no el título completo de lo que viste.
function siteOf(title) {
  const parts = pageTitle(title).split(/ [-–—|·] /).map((s) => s.trim()).filter(Boolean);
  const site = parts.length > 1 ? parts[parts.length - 1] : 'Otra página';
  return site.slice(0, 40);
}

function isBrowser(proc) {
  return BROWSERS.includes(proc);
}

function hasWord(text, word) {
  const w = norm(word);
  if (!w) return false;
  // Palabras cortas (max, kick, x) solo como palabra completa para no confundir.
  if (w.replace(/[^a-z0-9]/g, '').length <= 4) {
    const esc = w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`).test(text);
  }
  return text.includes(w);
}

// Escuela cuenta desde la fecha de inicio que pongas (por defecto enero de 2027).
function schoolActive(opts, now) {
  const s = opts && opts.school;
  if (!s || !s.enabled) return false;
  if (!s.startDate) return true;
  return now >= new Date(s.startDate + 'T00:00:00').getTime();
}

// sample: { name, title, path } de la ventana al frente.
// Devuelve { label, cat, kind } con cat en trabajo | entretenimiento | escuela | neutral | otro.
function classify(sample, rules = DEFAULT_RULES, opts = {}, now = Date.now()) {
  const proc = procName(sample && sample.name);
  const title = norm(sample && sample.title);
  const p = norm(sample && sample.path);
  const fix = (rule) => {
    if (rule.cat === 'escuela' && !schoolActive(opts, now)) return { label: rule.label, cat: 'neutral', kind: '' };
    return { label: rule.label, cat: rule.cat, kind: rule.cat === 'trabajo' ? (rule.kind || 'produccion') : '' };
  };
  if (OWN.includes(proc) || /asistente de vida/.test(title)) return { label: 'Asistente de Vida', cat: 'neutral', kind: '' };

  if (isBrowser(proc)) {
    const page = norm(pageTitle(sample.title));
    for (const rule of rules) if ((rule.titles || []).some((w) => hasWord(page, w))) return fix(rule);
    return { label: page ? `Web: ${siteOf(sample.title)}` : 'Navegador', cat: 'otro', kind: '' };
  }
  const procMatch = (x) => {
    const n = procName(x);
    return n.endsWith('*') ? n.length > 1 && proc.startsWith(n.slice(0, -1)) : n === proc;
  };
  for (const rule of rules) if ((rule.procs || []).some(procMatch)) return fix(rule);
  if (p) for (const rule of rules) if ((rule.paths || []).some((x) => x && p.includes(norm(x)))) return fix(rule);
  // Apps de escritorio con el título del sitio (p. ej. la app de YouTube instalada desde Edge/Chrome).
  for (const rule of rules) if ((rule.titles || []).some((w) => hasWord(title, w)) && rule.cat !== 'neutral' && /^(msedgewebview2|chrome_proxy|pwa)$/.test(proc)) return fix(rule);
  return { label: proc || 'Desconocido', cat: 'otro', kind: '' };
}

// Valida una regla que viene de la pantalla de ajustes.
function cleanRule(rule) {
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(','))
    .map((s) => String(s).trim()).filter(Boolean).slice(0, 40).map((s) => s.slice(0, 80));
  const label = String(rule && rule.label || '').trim().slice(0, 50);
  if (!label) throw new Error('Ponle nombre a la regla.');
  const cat = CATS.includes(rule.cat) ? rule.cat : null;
  if (!cat) throw new Error('Elige la categoría.');
  const kind = cat === 'trabajo' ? (KINDS.includes(rule.kind) ? rule.kind : 'produccion') : '';
  const out = { label, cat, kind, procs: list(rule.procs).map(procName), titles: list(rule.titles), paths: list(rule.paths) };
  if (!out.procs.length && !out.titles.length && !out.paths.length) throw new Error('Escribe al menos un programa, una página o una carpeta.');
  return out;
}

module.exports = { DEFAULT_RULES, CATS, KINDS, classify, cleanRule, pageTitle, siteOf, procName, schoolActive, isBrowser };
