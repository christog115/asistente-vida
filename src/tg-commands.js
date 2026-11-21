// Órdenes que entiende el bot de Telegram (sin Electron, se prueban con npm test).
// Son frases fijas, sin IA de por medio: lo que no encaja aquí se trata como charla con kara.

// Minúsculas y sin acentos, pero sin tocar el largo del texto para poder cortar el original.
const flat = (t) => String(t || '').toLowerCase().normalize('NFC').normalize('NFD').replace(/[̀-ͯ]/g, '');

// "dile a Mamá que llego tarde", "mándale a Juan: nos vemos", "mensaje para Ana: hola".
function parseSend(text) {
  const raw = String(text || '').trim();
  if (raw.length > 1500) return null;
  const t = flat(raw);
  const m = /^(?:(?:kara|jarvis)[ ,:;.-]+)?(?:(?:dile|diles|mandale|escribele|avisale|contestale|respondele)\s+a|(?:manda|envia|escribe)\s+(?:un\s+)?mensaje\s+(?:a|para)|mensaje\s+(?:a|para))\s+(.{1,40}?)\s*(?:\s+que\s+|\s*[:,]\s*)(.+)$/ds.exec(t);
  if (!m) return null;
  const message = raw.slice(m.indices[2][0], m.indices[2][1]).trim();
  const contact = raw.slice(m.indices[1][0], m.indices[1][1]).trim();
  return contact && message ? { contact, message } : null;
}

// Pie de foto o video: "para Mamá", "para Mamá: mira esto" o "manda esta foto a Mamá".
// Devuelve { contact, caption }.
function parseCaptionTarget(text) {
  const raw = String(text || '').trim();
  const m = /^(?:(?:m[aá]nda|env[ií]a|p[aá]sa)(?:le|la|lo|selo|sela)?\s+(?:(?:esta|este|esto|esa|ese|estas|estos|la|el)\s+)?(?:(?:foto|fotos|imagen|video|v[ií]deo|archivo|documento|captura)\s+)?)?(?:para|a)\s+([^:,\n]{1,40}?)\s*(?:[:,]\s*(.*))?$/is.exec(raw);
  return m ? { contact: m[1].trim(), caption: (m[2] || '').trim() } : null;
}

// "/foto", "/mensaje Mamá", "/ayuda@mibot": devuelve { name, arg } o null si no empieza con "/".
function parseCommand(text) {
  const m = /^\/([a-z_]{1,32})(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(String(text || '').trim());
  return m ? { name: m[1].toLowerCase(), arg: (m[2] || '').trim() } : null;
}

// "¿quién me escribió?", "quién me mandó mensaje", "qué me llegó".
function isWhoWrote(text) {
  const t = flat(text).replace(/[¿?¡!.]+/g, '').trim();
  return t.length <= 60 && /^(?:quien(?:es)?\s+me\s+(?:escribio|mando|hablo|dijo|han\s+escrito)|que\s+me\s+(?:llego|mandaron|escribieron)|tengo\s+mensajes|hay\s+mensajes|mensajes\s+nuevos)/.test(t);
}

// Cuando se mandó la foto sin destinatario y se contesta solo con el nombre.
function parseTargetName(text) {
  const t = String(text || '').trim().replace(/^(?:para|a)\s+/i, '').replace(/[.!?¡¿]+$/, '').trim();
  return t && t.length <= 40 ? t : null;
}

// "mi ubicación", "mándame la ubicación de mi pc", "dónde está mi compu".
function isMyLocation(text) {
  const t = flat(text).replace(/^(kara|jarvis)[ ,:;.-]*/, '').replace(/[.!?¡¿]+/g, '').trim();
  if (t.length > 60) return false;
  return /^(?:(?:mand|envi|pas|dam)\w*\s+)?(?:me\s+)?(?:mi\s+|la\s+)?ubicacion(?:\s+(?:de\s+)?(?:mi\s+)?(?:pc|compu\w*|computadora))?$/.test(t)
    || /^donde\s+esta\s+(?:mi\s+)?(?:pc|compu\w*|computadora)$/.test(t);
}

// "archivo reporte física", "mándame el archivo del reporte".
function parseFileRequest(text) {
  const t = String(text || '').trim();
  const m = /^(?:(?:m[aá]nda|env[ií]a|p[aá]sa)me\s+)?(?:el\s+)?archivo\s+(?:de\s+|del\s+)?(.{2,80})$/i.exec(t);
  return m ? m[1].trim() : null;
}

const parsePair = (text) => { const m = /^\/vincular(?:@\w+)?\s+(\d{6})$/.exec(String(text || '').trim()); return m ? m[1] : null; };

module.exports = { parseSend, parseCommand, isWhoWrote, parseCaptionTarget, parseTargetName, isMyLocation, parseFileRequest, parsePair, flat };
