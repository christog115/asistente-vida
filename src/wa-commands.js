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

module.exports = { parseLocationCommand, plain };
