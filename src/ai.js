// El asistente: responde preguntas y arma el resumen del día usando tus datos
// del tablero. Puede usar Claude (Anthropic) o Gemini (Google); tú eliges en
// "Conexiones". Las claves de API se guardan cifradas como los demás tokens.
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenAI } = require('@google/genai');
const store = require('./store');

const CLAUDE_MODEL = 'claude-opus-5-5';
// Se puede cambiar en config.json ("geminiModel") cuando Google saque otro.
const GEMINI_MODEL = 'gemini-2.5-flash';

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
    archivos: pick(data && data.files).map(({ name }) => name)
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

async function askGemini(system, messages) {
  const key = store.getSecret('geminiKey');
  if (!key) throw new Error('Falta la clave de Gemini (Conexiones → Asistente).');
  const ai = new GoogleGenAI({ apiKey: key });
  try {
    const res = await ai.models.generateContent({
      model: store.get('geminiModel') || GEMINI_MODEL,
      contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      config: { systemInstruction: system }
    });
    return (res.text || '').trim();
  } catch (err) {
    if (err.status === 400 && /API_KEY_INVALID/.test(err.message)) throw new Error('La clave de Gemini no es válida.');
    if (err.status === 429) throw new Error('Gemini está ocupado; intenta en un momento.');
    throw err;
  }
}

// history: [{ role: 'user' | 'assistant', content: string }]
async function chat(history, data) {
  const system = `${SYSTEM}\n\nDatos actuales:\n${context(data)}`;
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

module.exports = { status, setKey, setProvider, chat, dailyBriefing, ready };
