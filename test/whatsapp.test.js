// Pruebas de las piezas de WhatsApp vinculado que no necesitan Electron ni internet: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const orig = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { app: { getPath: () => os.tmpdir() }, safeStorage: { isEncryptionAvailable: () => true } };
  return orig.call(this, req, ...rest);
};
const files = require('../src/send-files');
const location = require('../src/location');
const { createAuthStore } = require('../src/whatsapp-auth');
Module._load = orig;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wa-'));

test('la sesión se guarda cifrada en un solo archivo y se recupera', async () => {
  const B = await import('@whiskeysockets/baileys');
  const file = path.join(tmp(), 'sesion.bin');
  // Cifrado de mentira reversible, para comprobar que el archivo no queda en texto plano.
  const seal = (t) => Buffer.from(Buffer.from(t).toString('base64'));
  const open = (b) => Buffer.from(b.toString(), 'base64').toString();
  const a = createAuthStore(file, { seal, open, B });
  assert.strictEqual(a.registered(), false);
  const secret = Buffer.from('llave-secreta-123');
  await a.state.keys.set({ 'pre-key': { 1: { private: secret, public: Buffer.from('pub') } }, session: { 'x@s.whatsapp.net': secret } });
  a.state.creds.registered = true;
  a.flush();
  assert.ok(!fs.readFileSync(file, 'utf8').includes('llave-secreta-123'));
  assert.ok(!fs.readFileSync(file).toString().includes('registered'));
  const b = createAuthStore(file, { seal, open, B });
  assert.strictEqual(b.registered(), true);
  const got = await b.state.keys.get('session', ['x@s.whatsapp.net', 'otro']);
  assert.ok(Buffer.isBuffer(got['x@s.whatsapp.net']) && got['x@s.whatsapp.net'].equals(secret));
  assert.strictEqual(got.otro, undefined);
  await b.state.keys.set({ session: { 'x@s.whatsapp.net': null } });
  assert.strictEqual((await b.state.keys.get('session', ['x@s.whatsapp.net']))['x@s.whatsapp.net'], undefined);
  b.wipe();
  assert.strictEqual(fs.existsSync(file), false);
});

test('un archivo dañado o con otra clave no rompe: se vincula de nuevo', async () => {
  const B = await import('@whiskeysockets/baileys');
  const file = path.join(tmp(), 'sesion.bin');
  fs.writeFileSync(file, 'basura');
  const a = createAuthStore(file, { seal: (t) => Buffer.from(t), open: () => { throw new Error('no se puede descifrar'); }, B });
  assert.strictEqual(a.registered(), false);
  assert.ok(a.state.creds.noiseKey);
});

test('búsqueda de archivos: solo las carpetas dadas, por palabras, sin secretos', () => {
  const home = tmp();
  const docs = path.join(home, 'Documents');
  fs.mkdirSync(path.join(docs, 'escuela', 'fisica'), { recursive: true });
  fs.mkdirSync(path.join(home, 'AppData'), { recursive: true });
  fs.writeFileSync(path.join(docs, 'escuela', 'fisica', 'Reporte de Física.pdf'), 'x');
  fs.writeFileSync(path.join(docs, 'reporte fisica contraseñas.txt'), 'x');
  fs.writeFileSync(path.join(docs, '.env'), 'x');
  fs.writeFileSync(path.join(home, 'AppData', 'reporte fisica.pdf'), 'x');
  const hits = files.find('reporte fisica', files.roots(home));
  assert.deepStrictEqual(hits.map((h) => h.name), ['Reporte de Física.pdf']);
});

test('las palabras deben aparecer todas y los acentos no importan', () => {
  const home = tmp();
  fs.mkdirSync(path.join(home, 'Downloads'));
  fs.writeFileSync(path.join(home, 'Downloads', 'Presupuesto 2026.xlsx'), 'x');
  assert.strictEqual(files.find('presupuesto', files.roots(home)).length, 1);
  assert.strictEqual(files.find('presupuesto 2027', files.roots(home)).length, 0);
  assert.strictEqual(files.find('', files.roots(home)).length, 0);
});

test('check: tamaño, vacío y nombres sensibles', () => {
  const d = tmp();
  const ok = path.join(d, 'foto.png');
  fs.writeFileSync(ok, 'x');
  assert.doesNotThrow(() => files.check(ok));
  fs.writeFileSync(path.join(d, 'vacio.txt'), '');
  assert.throws(() => files.check(path.join(d, 'vacio.txt')), /vacío/);
  for (const n of ['id_rsa', 'cert.pfx', 'mis contraseñas.txt', 'config.json', 'copia.avbak', '.env.local']) {
    fs.writeFileSync(path.join(d, n), 'x');
    assert.throws(() => files.check(path.join(d, n)), /seguridad/, n);
  }
  assert.throws(() => files.check(d), /no es un archivo/);
});

test('tipo de mensaje según la extensión', () => {
  const buf = Buffer.from('x');
  assert.ok(files.messageFor('C:\\a\\foto.JPG', buf).image);
  assert.ok(files.messageFor('/a/clip.mp4', buf).video);
  const doc = files.messageFor('/a/Reporte.pdf', buf);
  assert.deepStrictEqual([doc.fileName, doc.mimetype], ['Reporte.pdf', 'application/pdf']);
  assert.strictEqual(files.messageFor('/a/x.blend', buf).mimetype, 'application/octet-stream');
});

test('distancia entre ubicaciones', () => {
  const gdl = { lat: 20.6597, lon: -103.3496 };
  assert.strictEqual(Math.round(location.distance(gdl, gdl)), 0);
  const d = location.distance(gdl, { lat: 20.6597, lon: -103.3496 + 0.001 });
  assert.ok(d > 90 && d < 120, String(d)); // 0.001° de longitud ≈ 104 m aquí
});
