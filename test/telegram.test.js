// Pruebas del bot de Telegram con un Telegram y un WhatsApp de mentira: npm test
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const Module = require('module');
const cmd = require('../src/tg-commands');

test('órdenes de texto: mandar mensaje, pie de foto, ubicación y archivo', () => {
  assert.deepStrictEqual(cmd.parseSend('Dile a Mamá que llego tarde'), { contact: 'Mamá', message: 'llego tarde' });
  assert.deepStrictEqual(cmd.parseSend('mándale a Juan Pérez: nos vemos a las 5'), { contact: 'Juan Pérez', message: 'nos vemos a las 5' });
  assert.deepStrictEqual(cmd.parseSend('kara, mensaje para Ana: Hola, ¿qué tal?'), { contact: 'Ana', message: 'Hola, ¿qué tal?' });
  assert.strictEqual(cmd.parseSend('hola kara, ¿qué tengo hoy?'), null);
  assert.deepStrictEqual(cmd.parseCaptionTarget('para Mamá: mira esto'), { contact: 'Mamá', caption: 'mira esto' });
  assert.deepStrictEqual(cmd.parseCaptionTarget('para Mamá'), { contact: 'Mamá', caption: '' });
  assert.strictEqual(cmd.parseCaptionTarget('qué bonita'), null);
  assert.ok(cmd.isMyLocation('mi ubicación'));
  assert.ok(cmd.isMyLocation('Mándame la ubicación de mi PC'));
  assert.ok(cmd.isMyLocation('¿dónde está mi compu?'));
  assert.ok(!cmd.isMyLocation('ubicación a mamá'));
  assert.strictEqual(cmd.parseFileRequest('archivo reporte física'), 'reporte física');
  assert.strictEqual(cmd.parseFileRequest('Mándame el archivo del reporte'), 'reporte');
  assert.strictEqual(cmd.parsePair('/vincular 123456'), '123456');
  assert.strictEqual(cmd.parsePair('/vincular 12'), null);
});

// ---- el bot completo, sin red ----
const secrets = {};
const orig = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { app: { getPath: () => os.tmpdir() }, safeStorage: { isEncryptionAvailable: () => true } };
  if (req === './store') return { get: () => null, set() {}, getSecret: (k) => secrets[k] || null, setSecret: (k, v) => { if (v == null) delete secrets[k]; else secrets[k] = v; } };
  return orig.call(this, req, ...rest);
};
const telegram = require('../src/telegram');
Module._load = orig;

const calls = [];
let msgId = 100;
global.fetch = async (url, opts) => {
  const method = String(url).split('/').pop();
  const body = opts && typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
  calls.push({ method, body, url: String(url) });
  const json = (result) => ({ ok: true, json: async () => ({ ok: true, result }) });
  if (String(url).includes('/file/bot')) return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  if (method === 'getUpdates') { await new Promise((r) => setTimeout(r, 50)); return json([]); }
  if (method === 'sendMessage') return json({ message_id: ++msgId });
  if (method === 'getFile') return json({ file_path: 'photos/a.jpg' });
  return json(true);
};
const sent = () => calls.filter((c) => c.method === 'sendMessage').map((c) => c.body);
const wa = {
  out: [],
  setIncomingHandler() {},
  contacts: () => [{ name: 'Mamá', number: '523312345678' }],
  findContact: (n) => (/mam/i.test(n) ? { name: 'Mamá', number: '523312345678' } : null),
  sendTextToContact: async (n, t) => wa.out.push(['texto', n, t]),
  sendMediaToContact: async (n, c) => wa.out.push(['media', n, c]),
  replyTo: async (j, t) => wa.out.push(['reply', j, t]),
  sendLocationTo: async (n) => wa.out.push(['pin', n])
};
const from = (chat, extra) => ({ update_id: 1, message: { chat: { id: chat, type: 'private' }, ...extra } });
const press = (chat, data, messageId = 1) => ({ update_id: 2, callback_query: { id: 'q', data, message: { chat: { id: chat }, message_id: messageId } } });
const lastButtons = () => sent().filter((b) => b.reply_markup).pop().reply_markup.inline_keyboard[0];

test.after(() => telegram.shutdown());

test('vincular el chat, ignorar a extraños y confirmar antes de mandar', async () => {
  secrets.telegram = { token: '123456:' + 'a'.repeat(35), chatId: null, bot: 'kara_bot' };
  telegram.init({ whatsapp: wa, chat: async () => 'hola desde kara' });
  const { code } = telegram.pairCode();
  await telegram._handle(from(55, { text: '/vincular 000000' }));
  assert.strictEqual(secrets.telegram.chatId, null);
  await telegram._handle(from(55, { text: '/vincular ' + code }));
  assert.strictEqual(secrets.telegram.chatId, 55);

  calls.length = 0;
  await telegram._handle(from(99, { text: 'dile a mamá que hola' }));
  assert.strictEqual(calls.length, 0); // un extraño no recibe ni respuesta

  await telegram._handle(from(55, { text: 'dile a mamá que llego tarde' }));
  assert.deepStrictEqual(wa.out, []); // aún no se manda
  const [ok] = lastButtons();
  await telegram._handle(press(55, ok.callback_data));
  assert.deepStrictEqual(wa.out, [['texto', 'Mamá', 'llego tarde']]);
  // Una confirmación no se puede usar dos veces.
  await telegram._handle(press(55, ok.callback_data));
  assert.strictEqual(wa.out.length, 1);
});

test('cancelar no manda nada y un contacto desconocido se rechaza', async () => {
  wa.out.length = 0;
  await telegram._handle(from(55, { text: 'dile a mamá que hola' }));
  const [, no] = lastButtons();
  await telegram._handle(press(55, no.callback_data));
  assert.strictEqual(wa.out.length, 0);
  await telegram._handle(from(55, { text: 'dile a un desconocido que hola' }));
  assert.match(sent().pop().text, /No tengo guardado/);
  assert.strictEqual(wa.out.length, 0);
});

test('contestar un mensaje reenviado responde a ese chat, con confirmación', async () => {
  wa.out.length = 0;
  await telegram.notifyIncoming({ jid: '5215511111111@s.whatsapp.net', label: 'Ana', text: '¿vienes?' });
  const forwardedId = msgId;
  await telegram._handle(from(55, { text: 'sí, ya voy', reply_to_message: { message_id: forwardedId } }));
  assert.strictEqual(wa.out.length, 0);
  await telegram._handle(press(55, lastButtons()[0].callback_data));
  assert.deepStrictEqual(wa.out, [['reply', '5215511111111@s.whatsapp.net', 'sí, ya voy']]);
});

test('una foto con "para Mamá" se baja de Telegram y se manda como imagen', async () => {
  wa.out.length = 0;
  await telegram._handle(from(55, { photo: [{ file_id: 'chica', file_size: 10 }, { file_id: 'grande', file_size: 20 }], caption: 'para Mamá: mira' }));
  assert.strictEqual(wa.out.length, 0);
  await telegram._handle(press(55, lastButtons()[0].callback_data));
  assert.strictEqual(wa.out.length, 1);
  const [kind, name, content] = wa.out[0];
  assert.strictEqual(kind, 'media');
  assert.strictEqual(name, 'Mamá');
  assert.ok(Buffer.isBuffer(content.image) && content.image.length === 3);
  assert.strictEqual(content.caption, 'mira');
  assert.ok(calls.some((c) => c.method === 'getFile' && c.body.file_id === 'grande'));
});

test('una foto sin destinatario pregunta a quién y luego confirma', async () => {
  wa.out.length = 0;
  await telegram._handle(from(55, { video: { file_id: 'v1', file_size: 50, mime_type: 'video/mp4' } }));
  assert.match(sent().pop().text, /A quién/);
  await telegram._handle(from(55, { text: 'Mamá' }));
  await telegram._handle(press(55, lastButtons()[0].callback_data));
  assert.strictEqual(wa.out[0][0], 'media');
  assert.ok(wa.out[0][2].video);
});

test('lo demás se le pasa a kara como charla', async () => {
  await telegram._handle(from(55, { text: '¿qué tengo hoy?' }));
  assert.strictEqual(sent().pop().text, 'hola desde kara');
});

test('comandos guiados: /mensaje pregunta contacto y texto, y confirma', async () => {
  wa.out.length = 0;
  await telegram._handle(from(55, { text: '/mensaje' }));
  const ask = sent().pop();
  assert.match(ask.text, /A quién/);
  assert.deepStrictEqual(ask.reply_markup.keyboard, [[{ text: 'Mamá' }]]); // contactos como botones
  await telegram._handle(from(55, { text: 'Mamá' }));
  assert.match(sent().pop().text, /Qué le digo a Mamá/);
  await telegram._handle(from(55, { text: 'ya casi llego' }));
  assert.strictEqual(wa.out.length, 0);
  await telegram._handle(press(55, lastButtons()[0].callback_data));
  assert.deepStrictEqual(wa.out, [['texto', 'Mamá', 'ya casi llego']]);
});

test('/foto: elige contacto, manda la foto con pie y confirma', async () => {
  wa.out.length = 0;
  await telegram._handle(from(55, { text: '/foto' }));
  await telegram._handle(from(55, { text: 'Mamá' }));
  assert.match(sent().pop().text, /Mándame ahora la foto/);
  await telegram._handle(from(55, { photo: [{ file_id: 'p', file_size: 5 }], caption: 'mira el atardecer' }));
  await telegram._handle(press(55, lastButtons()[0].callback_data));
  assert.strictEqual(wa.out[0][0], 'media');
  assert.strictEqual(wa.out[0][2].caption, 'mira el atardecer');
});

test('/ubicacion y /cancelar', async () => {
  wa.out.length = 0;
  await telegram._handle(from(55, { text: '/ubicacion Mamá' }));
  await telegram._handle(press(55, lastButtons()[0].callback_data));
  assert.deepStrictEqual(wa.out, [['pin', 'Mamá']]);
  await telegram._handle(from(55, { text: '/mensaje' }));
  await telegram._handle(from(55, { text: '/cancelar' }));
  await telegram._handle(from(55, { text: 'hola' }));
  assert.strictEqual(sent().pop().text, 'hola desde kara'); // ya no está en un paso guiado
});

test('"manda esta foto a mamá" como pie y "¿quién me escribió?"', async () => {
  assert.deepStrictEqual(cmd.parseCaptionTarget('manda esta foto a mamá'), { contact: 'mamá', caption: '' });
  assert.deepStrictEqual(cmd.parseCaptionTarget('Mándale esta foto a Mamá: mira'), { contact: 'Mamá', caption: 'mira' });
  assert.ok(cmd.isWhoWrote('¿Quién me escribió?') && cmd.isWhoWrote('quién me mandó mensaje') && !cmd.isWhoWrote('quién es Ana'));
  await telegram.notifyIncoming({ jid: '1@s.whatsapp.net', label: 'Pedro', text: 'hola, ¿ya llegaste?' });
  await telegram._handle(from(55, { text: '¿quién me escribió?' }));
  assert.match(sent().pop().text, /Pedro: hola, ¿ya llegaste\?/);
});
