// El asistente: responde preguntas y arma el resumen del día usando tus datos
// del tablero. Puede usar Claude (Anthropic) o Gemini (Google); tú eliges en
// "Conexiones". Las claves de API se guardan cifradas como los demás tokens.
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenAI } = require('@google/genai');
const store = require('./store');

const CLAUDE_MODEL = 'claude-opus-5-5';
// Se puede cambiar en config.json ("geminiModel") cuando Google saque otro.
// Google retira modelos seguido: si el primero ya no existe (404) se prueba el siguiente.
const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-2.5-flash'];

const SYSTEM = `Eres el asistente personal de Christopher, estudiante en México.
Respondes en español, en tono cercano y directo, con frases cortas.
Abajo tienes sus datos actuales: tareas de la escuela (Classroom y Moodle),
calendario, pendientes, correos sin leer, archivos recientes y su hoja de
pendientes de Google Sheets. Úsalos para responder. Si algo no está en los
datos, dilo en vez de inventarlo. Las fechas están en formato ISO (UTC);
conviértelas a la hora de México al mencionarlas.`;

function provider() {
  return store.get('aiProvider') || 'claude';
}

function status() {
  return {
    provider: provider(),
    claude: store.getSecret('anthropicKey') ? 'conectado' : 'desconectado',
    gemini: store.getSecret('geminiKey') ? 'conectado' : 'desconectado'
  };
}

function setKey(which, key) {
  store.setSecret(which === 'gemini' ? 'geminiKey' : 'anthropicKey', key ? key.trim() : null);
}

function setProvider(p) {
  store.set('aiProvider', p === 'gemini' ? 'gemini' : 'claude');
}

// Datos del tablero en texto compacto para el modelo.
function context(data) {
  const pick = (v) => (Array.isArray(v) ? v : []);
  return JSON.stringify({
    ahora: new Date().toISOString(),
    escuela: pick(data && data.school).map(({ source, course, title, due, dueText }) => ({ source, course, title, due: due || dueText })),
    calendario: pick(data && data.events).map(({ title, start }) => ({ title, start })),
    pendientes: pick(data && data.tasks).map(({ title, due, list }) => ({ title, due, list })),
    hoja: pick(data && data.sheet),
    correos: pick(data && data.emails).map(({ from, subject }) => ({ from, subject })),
    archivos: pick(data && data.files).map(({ name }) => name),
    spotify: data && data.spotify && !data.spotify.error ? { sonandoAhora: data.spotify.nowPlaying, reciente: pick(data.spotify.recent).map(({ title, artist }) => ({ title, artist })) } : undefined,
    disenosCanva: pick(data && data.designs).map(({ title, updatedAt }) => ({ title, updatedAt }))
  });
}

async function askClaude(system, messages) {
  const key = store.getSecret('anthropicKey');
  if (!key) throw new Error('Falta la clave de Claude (Conexiones → Asistente).');
  const client = new Anthropic({ apiKey: key });
  try {
    const response = await client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      output_config: { effort: 'low' },
      // Si Claude rechaza algo por seguridad, la API reintenta con otro modelo.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages
    });
    if (response.stop_reason === 'refusal') {
      return 'No puedo ayudarte con eso. Intenta preguntarlo de otra forma.';
    }
    return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('La clave de Claude no es válida.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('Claude está ocupado; intenta en un momento.');
    if (err instanceof Anthropic.APIConnectionError) throw new Error('Sin conexión a internet.');
    throw err;
  }
}

// Gemini avisa "alta demanda" (503) seguido y casi siempre se resuelve reintentando.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(fn, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tries || ![429, 500, 503].includes(err.status)) throw err;
      await sleep(1500 * i);
    }
  }
}
function withTimeout(promise, ms) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { timeout: true })), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

async function askGemini(system, messages) {
  const key = store.getSecret('geminiKey');
  if (!key) throw new Error('Falta la clave de Gemini (Conexiones → Asistente).');
  const ai = new GoogleGenAI({ apiKey: key });
  const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const models = [store.get('geminiModel'), ...GEMINI_MODELS].filter(Boolean);
  for (const [i, model] of models.entries()) {
    try {
      const res = await withRetry(() => withTimeout(
        ai.models.generateContent({ model, contents, config: { systemInstruction: system } }), 30000));
      return (res.text || '').trim();
    } catch (err) {
      if (err.status === 404 && i < models.length - 1) continue;
      if ((err.status === 503 || err.status === 500) && i < models.length - 1) continue;
      if (err.status === 503 || err.status === 500) throw new Error('Gemini está saturado en este momento; intenta de nuevo en unos segundos.');
      if (err.timeout) throw new Error('Gemini tardó demasiado en contestar; intenta de nuevo.');
      if (err.status === 404) throw new Error('Google retiró el modelo de Gemini que usa la app; avísale a Claude para actualizarlo.');
      if (err.status === 400 && /API_KEY_INVALID/.test(err.message)) throw new Error('La clave de Gemini no es válida.');
      if (err.status === 429) throw new Error('Gemini está ocupado; intenta en un momento.');
      throw err;
    }
  }
}

const VOICE = `Esta respuesta se va a leer en voz alta: contesta en una a tres
frases cortas, sin listas, sin markdown, sin emojis y sin links.`;

// history: [{ role: 'user' | 'assistant', content: string }]
// opts.voice: la pregunta llegó por voz y la respuesta se va a hablar.
async function chat(history, data, opts = {}) {
  const system = `${SYSTEM}${opts.voice ? '\n\n' + VOICE : ''}\n\nDatos actuales:\n${context(data)}`;
  return provider() === 'gemini' ? askGemini(system, history) : askClaude(system, history);
}

async function dailyBriefing(data) {
  return chat([{
    role: 'user',
    content: 'Hazme el resumen de hoy en 5 líneas o menos: qué entrego primero, qué tengo en el calendario y si hay algún correo importante. Termina con una sugerencia concreta de por dónde empezar.'
  }], data);
}

function ready() {
  const s = status();
  return s[s.provider] === 'conectado';
}

// Una pregunta suelta sin los datos del tablero (para interpretar órdenes).
function ask(system, text) {
  return provider() === 'gemini' ? askGemini(system, [{ role: 'user', content: text }]) : askClaude(system, [{ role: 'user', content: text }]);
}

module.exports = { status, setKey, setProvider, chat, ask, dailyBriefing, ready };
