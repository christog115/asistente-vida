// Configuración local en la carpeta de datos de la app.
// Los secretos (tokens) se cifran con safeStorage del sistema operativo
// (DPAPI en Windows, Llavero en Mac) y nunca se guardan en texto plano.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const file = () => path.join(app.getPath('userData'), 'config.json');

const defaults = {
  reminderTimes: ['07:00', '20:00'],
  moodle: { url: 'https://tonala-virtual.ceti.mx', mode: 'token' },
  secrets: {}
};

const backupsDir = () => path.join(app.getPath('userData'), 'backups');
const KEEP = 7;

function load() {
  let text;
  try {
    text = fs.readFileSync(file(), 'utf8');
  } catch {
    return structuredClone(defaults); // todavía no hay configuración
  }
  try {
    return { ...defaults, ...JSON.parse(text) };
  } catch {
    return recover();
  }
}

// Si config.json quedó dañado se aparta (no se borra) y se usa la copia diaria más reciente;
// sin esto el siguiente guardado lo reemplazaría por la configuración vacía.
function recover() {
  try { fs.renameSync(file(), file().replace(/\.json$/, `.corrupto-${Date.now()}.json`)); } catch {}
  let names = [];
  try { names = fs.readdirSync(backupsDir()).filter((n) => /^config-.*\.json$/.test(n)).sort().reverse(); } catch {}
  for (const n of names) {
    try {
      const text = fs.readFileSync(path.join(backupsDir(), n), 'utf8');
      const cfg = { ...defaults, ...JSON.parse(text) };
      fs.writeFileSync(file(), text);
      return cfg;
    } catch {}
  }
  return structuredClone(defaults);
}

// Copia local de config.json: una por día (se conservan las últimas 7) o con nombre propio.
function snapshot(name) {
  try {
    if (!fs.existsSync(file())) return false;
    fs.mkdirSync(backupsDir(), { recursive: true });
    const target = path.join(backupsDir(), name || `config-${new Date().toISOString().slice(0, 10)}.json`);
    if (!name && fs.existsSync(target)) return false;
    JSON.parse(fs.readFileSync(file(), 'utf8')); // no se copia un archivo dañado
    fs.copyFileSync(file(), target);
    const old = fs.readdirSync(backupsDir()).filter((n) => /^config-.*\.json$/.test(n)).sort().reverse().slice(KEEP);
    for (const n of old) fs.unlinkSync(path.join(backupsDir(), n));
    return true;
  } catch {
    return false;
  }
}

function save(cfg) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cfg, null, 2));
}

function get(key) {
  return load()[key];
}

function set(key, value) {
  const cfg = load();
  cfg[key] = value;
  save(cfg);
}

function setSecret(name, value) {
  const cfg = load();
  if (value == null) {
    delete cfg.secrets[name];
  } else {
    const data = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(JSON.stringify(value)).toString('base64')
      : null;
    if (!data) throw new Error('El cifrado del sistema no está disponible.');
    cfg.secrets[name] = data;
  }
  save(cfg);
}

function getSecret(name) {
  const data = load().secrets[name];
  if (!data) return null;
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(data, 'base64')));
  } catch {
    return null;
  }
}

module.exports = { get, set, getSecret, setSecret, snapshot, load };
