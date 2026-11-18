// Órdenes que se aceptan escritas en tu chat "Tú" de WhatsApp (para pedirle a la app, estando
// fuera, que mande tu ubicación). Es a propósito muy limitado: SOLO "ubicación a <contacto>",
// sin IA de por medio, y el contacto debe estar guardado en la app.
const plain = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// Ejemplos que sí: "kara ubicación a mamá", "ubicación a mamá", "mándale mi ubicación a Juan Pérez",
// "kara, manda mi ubicación a mamá". Devuelve el nombre dicho, o null si no es una orden así.
function parseLocationCommand(text) {
  const t = plain(text).replace(/^(kara|jarvis)[ ,:;.-]*/, '');
  if (t.length > 120) return null;
  const m = /^(?:(?:mand|envi|pas)(?:a|ale|ame|alo)?\s+)?(?:mi\s+)?ubicacion(?:\s+de\s+(?:mi\s+)?pc)?\s+(?:a|para)\s+(.{1,60})$/.exec(t);
  const name = m && m[1].replace(/[.!?¡¿]+$/, '').trim();
  return name || null;
}

// "ubicación en vivo a mamá" / "... por 2 horas" (EXPERIMENTAL). Devuelve { name, minutes|null } o null.
function parseLiveCommand(text) {
  const t = plain(text).replace(/^(kara|jarvis)[ ,:;.-]*/, '');
  if (t.length > 140) return null;
  const m = /^(?:(?:mand|envi|pas|comparte|compart)\w*\s+)?(?:mi\s+)?ubicacion\s+en\s+(?:vivo|tiempo real)\s+(?:a|para)\s+(.+?)(?:\s+(?:por|durante)\s+(\d+(?:[.,]\d+)?)\s*(horas?|h|minutos?|min))?[.!?¡¿]*$/.exec(t);
  if (!m) return null;
  const n = m[2] ? Number(m[2].replace(',', '.')) : null;
  return { name: m[1].trim(), minutes: n ? Math.round(/^h/.test(m[3]) ? n * 60 : n) : null };
}

// "deja de compartir mi ubicación", "para la ubicación en vivo".
function isStopCommand(text) {
  const t = plain(text).replace(/^(kara|jarvis)[ ,:;.-]*/, '').replace(/[.!?¡¿]+$/, '');
  return /^(?:deja(?:r)? de compartir|para(?:r)?|deten(?:er)?|termina(?:r)?|cancela(?:r)?)\s+(?:de compartir\s+)?(?:mi\s+|la\s+)?ubicacion(?:\s+en\s+(?:vivo|tiempo real))?$/.test(t);
}

module.exports = { parseLocationCommand, parseLiveCommand, isStopCommand, plain };
