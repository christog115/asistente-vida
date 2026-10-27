// Programas que el asistente puede abrir por voz. Solo se abre lo que está en
// esta lista (más lo que agregues en config.json → "apps": { "nombre": "enlace o ruta" }),
// nunca lo que diga un texto cualquiera.
const { shell } = require('electron');
const store = require('./store');

const DEFAULTS = {
  spotify: 'spotify:',
  'marvel rivals': 'steam://rungameid/2767030',
  steam: 'steam://open/main',
  discord: 'discord:',
  whatsapp: 'whatsapp:',
  canva: 'https://www.canva.com',
  youtube: 'https://www.youtube.com',
  gmail: 'https://mail.google.com',
  classroom: 'https://classroom.google.com',
  calendario: 'https://calendar.google.com',
  drive: 'https://drive.google.com'
};

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function registry() {
  const mine = store.get('apps') || {};
  return { ...DEFAULTS, ...mine };
}

function names() {
  return Object.keys(registry());
}

function find(name) {
  const wanted = norm(name);
  const reg = registry();
  const key = Object.keys(reg).find((k) => norm(k) === wanted) || Object.keys(reg).find((k) => wanted && (norm(k).includes(wanted) || wanted.includes(norm(k))));
  return key ? { name: key, target: reg[key] } : null;
}

async function open(name) {
  const app = find(name);
  if (!app) return null;
  // Enlaces (http, spotify:, steam://...) se abren con el programa que los maneja; una ruta, directo.
  if (/^[a-z][a-z0-9+.-]*:/i.test(app.target) && !/^[a-z]:[\\/]/i.test(app.target)) await shell.openExternal(app.target);
  else {
    const err = await shell.openPath(app.target);
    if (err) throw new Error(err);
  }
  return app.name;
}

module.exports = { names, find, open };
