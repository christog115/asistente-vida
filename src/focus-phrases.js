// Frases para los recordatorios de trabajo: directas, duras y sobre tu porqué.
// {porque} = tu motivo (lo escribes en ajustes), {falta} = lo que te falta hoy,
// {hecho} = lo que llevas, {meta} = la meta del día, {app} = lo que tienes abierto.

const WITH_WHY = [
  'Lo dijiste tú: {porque}. Te faltan {falta}. Eso no se va a hacer solo.',
  'Tu porqué: {porque}. Eso es lo que estás aplazando ahora mismo. Faltan {falta}.',
  'Llevas {hecho} de {meta}. ¿De verdad quieres esto? {porque}. Demuéstralo hoy, no mañana.',
  'Nadie va a hacer esto por ti. Tu porqué: {porque}. Te faltan {falta}. Empieza.',
  'Cada día que no cumples te aleja de esto: {porque}. Faltan {falta}.',
  'Tu porqué no cambió: {porque}. Lo que cambió es que hoy todavía no has trabajado. Faltan {falta}.',
  'Acuérdate por qué empezaste: {porque}. Las ganas no llegan solas. Siéntate y empieza. Faltan {falta}.',
  'Hoy cuentan las horas, no las intenciones. Tu porqué: {porque}. Te faltan {falta}.',
  'Si hoy no cumples, mañana va a costar el doble. Por esto lo haces: {porque}. Faltan {falta}.',
  'El de ayer ya cumplió o ya falló. El de hoy todavía puede. Tu porqué: {porque}. Faltan {falta}.'
];

const WITHOUT_WHY = [
  'Te faltan {falta} de trabajo hoy. No es opcional, es tu mínimo.',
  'Llevas {hecho} de {meta}. El mínimo es el mínimo. Empieza ya.',
  'La constancia no se negocia un día sí y otro no. Faltan {falta}.',
  'Cada vez que lo aplazas te entrenas para aplazarlo. Faltan {falta}. Empieza.',
  'Hoy no se trata de ganas, se trata de cumplir. Te faltan {falta}.',
  'Escribe tu porqué en ajustes para que te lo recuerde. Mientras: te faltan {falta}.'
];

const DISTRACTED = [
  'Estás en {app} y te faltan {falta} de trabajo. Ciérralo.',
  '{app} no te va a llevar a donde quieres. Tu porqué: {porque}. Faltan {falta}.',
  'Cada minuto en {app} es un minuto menos para lo que de verdad quieres. Faltan {falta}.'
];

function fill(t, v) {
  return t.replace(/\{(\w+)\}/g, (_, k) => (v[k] != null && v[k] !== '' ? v[k] : ''));
}

// Mayúscula al empezar cada oración (tu porqué puede venir en minúsculas).
function tidy(text) {
  return String(text).replace(/\s+\./g, '.').replace(/\s{2,}/g, ' ').trim()
    .replace(/(^|[.!?¿]\s+|¿)([a-záéíóúñ])/g, (_, a, b) => a + b.toUpperCase());
}

let last = -1;
function pick(list, rand = Math.random) {
  let i = Math.floor(rand() * list.length);
  if (list.length > 1 && i === last) i = (i + 1) % list.length;
  last = i;
  return list[i];
}

// vars: { porque, falta, hecho, meta, app, distracted }
function phrase(vars, rand) {
  const why = String(vars.porque || '').trim().replace(/[.\s]+$/, '');
  const v = { ...vars, porque: why };
  let list = why ? WITH_WHY : WITHOUT_WHY;
  if (vars.distracted && vars.app) list = why ? DISTRACTED.concat(WITH_WHY.slice(0, 2)) : DISTRACTED.filter((t) => !t.includes('{porque}'));
  return tidy(fill(pick(list, rand), v));
}

// Instrucción para que la IA escriba frases nuevas en el mismo tono.
function aiPrompt(why, n = 12) {
  return `Escribe ${n} frases cortas (máximo 25 palabras cada una) en español de México para recordarme que debo ponerme a trabajar. ` +
    'Tono: directo, duro y honesto, como un entrenador exigente que me respeta. Nada de clichés como "sigue así y cumplirás tus metas", "tú puedes" o "cree en ti". ' +
    'Céntrate en el porqué y en la constancia: lo que pierdo cada día que aplazo, que las ganas no llegan solas, que hoy cuenta. ' +
    (why ? `Mi porqué, en mis palabras: "${why}". Úsalo en la mayoría de las frases. ` : '') +
    'Puedes usar {falta} donde va el tiempo que me falta hoy (por ejemplo "1 h 20 min"). No uses emojis ni comillas. ' +
    'Devuelve solo las frases, una por línea, sin numerar.';
}

function parseAi(text) {
  return String(text || '').split('\n')
    .map((s) => s.replace(/^[\s\-*•\d.)]+/, '').replace(/^["“]|["”]$/g, '').trim())
    .filter((s) => s.length > 15 && s.length < 220 && !/[{}]/.test(s.replace(/\{falta\}/g, '')))
    .slice(0, 20);
}

module.exports = { phrase, fill, tidy, aiPrompt, parseAi, WITH_WHY, WITHOUT_WHY };
