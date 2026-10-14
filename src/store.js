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

function load() {
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    return structuredClone(defaults);
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

module.exports = { get, set, getSecret, setSecret };
