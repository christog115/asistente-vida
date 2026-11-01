// Copia de seguridad exportable: toda la configuración, los recordatorios y las claves,
// cifrada con una contraseña tuya (las claves del sistema solo sirven en esta PC).
const crypto = require('crypto');
const fs = require('fs');
const store = require('./store');

const MIN_PASSWORD = 6;

function key(password, salt) {
  return crypto.scryptSync(password, salt, 32);
}

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    throw new Error(`La contraseña de la copia debe tener al menos ${MIN_PASSWORD} caracteres.`);
  }
}

function exportTo(file, password) {
  checkPassword(password);
  const { secrets = {}, ...config } = store.load();
  const plain = {};
  for (const name of Object.keys(secrets)) {
    const v = store.getSecret(name);
    if (v != null) plain[name] = v;
  }
  const payload = Buffer.from(JSON.stringify({ app: 'asistente-vida', config, secrets: plain }));
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(password, salt), iv);
  const data = Buffer.concat([cipher.update(payload), cipher.final()]);
  fs.writeFileSync(file, JSON.stringify({
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  }));
  return { secrets: Object.keys(plain).length };
}

function importFrom(file, password) {
  checkPassword(password);
  let box;
  try {
    box = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('Ese archivo no es una copia del asistente.');
  }
  let payload;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(password, Buffer.from(box.salt, 'base64')), Buffer.from(box.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
    payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString());
  } catch {
    throw new Error('Contraseña incorrecta o archivo dañado.');
  }
  if (payload.app !== 'asistente-vida') throw new Error('Ese archivo no es una copia del asistente.');
  store.snapshot('previo-a-importar.json');
  for (const [k, v] of Object.entries(payload.config)) if (k !== 'secrets') store.set(k, v);
  for (const [name, v] of Object.entries(payload.secrets)) store.setSecret(name, v);
  return { secrets: Object.keys(payload.secrets).length };
}

module.exports = { exportTo, importFrom, checkPassword };
