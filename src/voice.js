// Voz tipo Jarvis. El reconocimiento corre completo en tu PC con Vosk
// (Apache 2.0), sin mandar audio a internet. Aquí se descarga una sola vez el
// modelo en español y se le sirve a la ventana por el protocolo voz://.
const { app, protocol, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const AdmZip = require('adm-zip');
const tar = require('tar');
const store = require('./store');

// Modelo chico en español (~40 MB). Se puede cambiar en config.json ("voiceModelUrl")
// por uno más grande de https://alphacephei.com/vosk/models si quieres más precisión.
const MODEL_URL = 'https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip';

const DEFAULTS = { enabled: false, wakeWord: 'jarvis', voiceName: '' };

const dir = () => path.join(app.getPath('userData'), 'voz');
const modelUrl = () => store.get('voiceModelUrl') || MODEL_URL;
// El nombre del archivo cambia con el modelo para que la ventana no use uno viejo guardado.
const archiveName = () => path.basename(modelUrl()).replace(/\.(zip|tar\.gz)$/, '') + '.tar.gz';
const archive = () => path.join(dir(), archiveName());

function settings() {
  return { ...DEFAULTS, ...store.get('voice') };
}

function set(changes) {
  const next = { ...settings(), ...changes };
  next.wakeWord = String(next.wakeWord || DEFAULTS.wakeWord).trim().toLowerCase();
  next.voiceName = String(next.voiceName || '');
  store.set('voice', next);
  return next;
}

function status() {
  return { ...settings(), modelReady: fs.existsSync(archive()) };
}

// Tiene que llamarse antes de que la app esté lista.
function registerScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'voz',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  }]);
}

function serve() {
  protocol.handle('voz', () => {
    const file = archive();
    if (!fs.existsSync(file)) return new Response('Falta el modelo de voz', { status: 404 });
    return new Response(Readable.toWeb(fs.createReadStream(file)), {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Length': String(fs.statSync(file).size),
        'Access-Control-Allow-Origin': '*'
      }
    });
  });
}

async function download(url, dest, onProgress) {
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar el modelo de voz (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(dest);
  let done = 0;
  let lastPct = -1;
  try {
    for await (const chunk of res.body) {
      done += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      const pct = total ? Math.floor((done / total) * 100) : -1;
      if (pct !== lastPct) { lastPct = pct; onProgress(pct); }
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
}

// Descarga el modelo la primera vez y lo deja como .tar.gz, que es lo que lee Vosk.
let preparing = null;
function ensureModel(onProgress = () => {}) {
  if (fs.existsSync(archive())) return Promise.resolve(archiveName());
  if (preparing) return preparing;
  preparing = (async () => {
    fs.mkdirSync(dir(), { recursive: true });
    const url = modelUrl();
    const tmp = path.join(dir(), 'descarga');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp);
    try {
      const downloaded = path.join(tmp, path.basename(url));
      await download(url, downloaded, onProgress);
      if (url.endsWith('.tar.gz')) {
        fs.renameSync(downloaded, archive());
      } else {
        const unpacked = path.join(tmp, 'modelo');
        new AdmZip(downloaded).extractAllTo(unpacked, true);
        // Vosk quita la primera carpeta del archivo, así que se empaca dentro de una.
        await tar.c({ gzip: true, file: archive() + '.part', cwd: unpacked }, fs.readdirSync(unpacked));
        fs.renameSync(archive() + '.part', archive());
      }
      return archiveName();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      preparing = null;
    }
  })();
  return preparing;
}

module.exports = { settings, set, status, registerScheme, serve, ensureModel };
