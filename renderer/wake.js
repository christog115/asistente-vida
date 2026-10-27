// Palabra clave: se busca en las primeras palabras de lo que dices ("oye kara",
// "kara, qué hora es"), no en cualquier parte de la frase, para que una palabra
// parecida dicha en una conversación no active al asistente. Se compara por
// sonido (c/k/qu, v/b, h muda, acentos) porque el reconocedor escribe a su manera.
const WAKE_WINDOW = 3;
const WAKE_ALIASES = {
  jarvis: ['yarvis', 'jarbis', 'yarbis', 'harvis', 'charvis'],
  kara: ['karra']
};

function soundKey(word) {
  return String(word).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/qu(?=[ei])/g, 'k').replace(/c(?=[aou]|$)/g, 'k').replace(/c(?=[ei])/g, 's')
    .replace(/z/g, 's').replace(/v/g, 'b').replace(/h/g, '').replace(/ll/g, 'y')
    .replace(/(.)\1+/g, '$1');
}

// "kara, jarvis" -> claves de sonido de cada palabra con sus variantes.
function wakeKeys(setting) {
  const keys = new Set();
  for (const base of String(setting).split(',').map((w) => w.trim()).filter(Boolean)) {
    keys.add(soundKey(base));
    (WAKE_ALIASES[base.toLowerCase()] || []).forEach((a) => keys.add(soundKey(a)));
  }
  return keys;
}

// Devuelve { found, rest }: rest es lo que se dijo después de la palabra clave.
function findWake(text, keys) {
  const words = String(text || '').toLowerCase().replace(/[¿?¡!,.;:]/g, ' ').split(/\s+/).filter(Boolean);
  const i = words.slice(0, WAKE_WINDOW).findIndex((w) => keys.has(soundKey(w)));
  return i < 0 ? { found: false, rest: '' } : { found: true, rest: words.slice(i + 1).join(' ') };
}

if (typeof module !== 'undefined') module.exports = { soundKey, wakeKeys, findWake };
