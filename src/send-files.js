// Archivos que se pueden mandar por WhatsApp. Desde la pantalla los eliges tú con el selector;
// por voz/chat ("mándame el archivo del reporte") solo se buscan en Escritorio, Documentos y
// Descargas, y nunca claves, certificados ni archivos de contraseñas.
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_BYTES = 100 * 1024 * 1024;
const BLOCKED_NAME = /(^\.env|id_rsa|id_ed25519|\.pem$|\.key$|\.pfx$|\.p12$|\.kdbx$|\.ppk$|password|contrase[ñn]a|credential|secret|token|\.avbak$|config\.json$)/i;
const SKIP_DIRS = new Set(['node_modules', '.git', 'appdata', '$recycle.bin']);

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function roots(home = os.homedir()) {
  return ['Desktop', 'Documents', 'Downloads', 'Escritorio', 'Documentos', 'Descargas'].map((d) => path.join(home, d)).filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
}

function check(file) {
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error('Eso no es un archivo.');
  if (st.size === 0) throw new Error('El archivo está vacío.');
  if (st.size > MAX_BYTES) throw new Error(`El archivo pesa ${Math.round(st.size / 1048576)} MB; el máximo es ${MAX_BYTES / 1048576} MB.`);
  if (BLOCKED_NAME.test(path.basename(file))) throw new Error('Por seguridad no mando archivos de claves, contraseñas ni configuración.');
  return st;
}

// Busca por las palabras del nombre (todas deben aparecer). Devuelve los más recientes primero.
function find(query, dirs = roots(), { depth = 4, limit = 5 } = {}) {
  const words = norm(query).split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const hits = [];
  const walk = (dir, d) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (d < depth && !SKIP_DIRS.has(e.name.toLowerCase()) && !e.name.startsWith('.')) walk(full, d + 1);
      } else if (e.isFile()) {
        const n = norm(e.name);
        if (words.every((w) => n.includes(w)) && !BLOCKED_NAME.test(e.name)) {
          try { const st = fs.statSync(full); if (st.size > 0 && st.size <= MAX_BYTES) hits.push({ file: full, name: e.name, mtime: st.mtimeMs, size: st.size }); } catch {}
        }
      }
    }
  };
  for (const r of dirs) walk(r, 0);
  return hits.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

const MIME = {
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', json: 'application/json', zip: 'application/zip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', kra: 'application/x-krita', blend: 'application/octet-stream'
};

// Tipo de mensaje de WhatsApp para el archivo: foto, video o documento.
function messageFor(file, buffer) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const fileName = path.basename(file);
  const mimetype = MIME[ext] || 'application/octet-stream';
  if (/^(png|jpe?g|webp)$/.test(ext)) return { image: buffer, caption: fileName };
  if (ext === 'mp4') return { video: buffer, caption: fileName };
  return { document: buffer, fileName, mimetype };
}

module.exports = { check, find, roots, messageFor, MAX_BYTES, BLOCKED_NAME };
