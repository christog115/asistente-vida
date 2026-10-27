// Voz natural sin internet con Piper (MIT, https://github.com/rhasspy/piper).
// Se descarga una sola vez el programa (~25 MB) y una voz en español (~60 MB)
// y se usa como respaldo cuando la voz de Edge no está disponible.
const { app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const tar = require('tar');
const store = require('./store');
const { download } = require('./voice');

const RELEASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/';
const BUILDS = {
  'win32-x64': 'piper_windows_amd64.zip',
  'darwin-arm64': 'piper_macos_aarch64.tar.gz',
  'darwin-x64': 'piper_macos_x64.tar.gz',
  'linux-x64': 'piper_linux_x86_64.tar.gz'
};
// Voz mexicana "claude" (calidad alta). Se puede cambiar en config.json ("piperModelUrl").
const MODEL_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/claude/high/es_MX-claude-high.onnx';

const dir = () => path.join(app.getPath('userData'), 'piper');
const exe = () => path.join(dir(), 'piper', process.platform === 'win32' ? 'piper.exe' : 'piper');
const modelUrl = () => store.get('piperModelUrl') || MODEL_URL;
const modelFile = () => path.join(dir(), path.basename(modelUrl()));

function status() {
  return { ready: fs.existsSync(exe()) && fs.existsSync(modelFile()) && fs.existsSync(modelFile() + '.json') };
}

let installing = null;
function install(onProgress = () => {}) {
  if (status().ready) return Promise.resolve();
  if (installing) return installing;
  installing = (async () => {
    const build = BUILDS[`${process.platform}-${process.arch}`];
    if (!build) throw new Error('Esta computadora no tiene versión de Piper.');
    fs.mkdirSync(dir(), { recursive: true });
    try {
      if (!fs.existsSync(exe())) {
        const archive = path.join(dir(), build);
        await download(RELEASE + build, archive, (pct) => onProgress('Descargando el programa de voz', pct));
        if (build.endsWith('.zip')) new AdmZip(archive).extractAllTo(dir(), true);
        else await tar.x({ file: archive, cwd: dir() });
        fs.rmSync(archive, { force: true });
        if (process.platform !== 'win32') fs.chmodSync(exe(), 0o755);
      }
      for (const url of [modelUrl(), modelUrl() + '.json']) {
        const dest = path.join(dir(), path.basename(url));
        if (fs.existsSync(dest)) continue;
        await download(url, dest + '.part', (pct) => onProgress('Descargando la voz', pct));
        fs.renameSync(dest + '.part', dest);
      }
    } finally {
      installing = null;
    }
  })();
  return installing;
}

function synth(text) {
  if (!status().ready) return Promise.reject(new Error('La voz sin internet no está instalada.'));
  const out = path.join(app.getPath('temp'), `asistente-voz-${Date.now()}.wav`);
  return new Promise((resolve, reject) => {
    const child = spawn(exe(), ['--model', modelFile(), '--output_file', out], { cwd: path.dirname(exe()) });
    const timer = setTimeout(() => { child.kill(); reject(new Error('La voz sin internet tardó demasiado.')); }, 30000);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw new Error('Piper falló (código ' + code + ').');
        resolve(fs.readFileSync(out));
      } catch (err) {
        reject(err);
      } finally {
        fs.rmSync(out, { force: true });
      }
    });
    child.stdin.end(String(text).slice(0, 1500).replace(/\s+/g, ' '));
  });
}

module.exports = { status, install, synth };
