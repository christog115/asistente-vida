// El asistente: responde preguntas y arma el resumen del día usando tus datos
// del tablero. Puede usar Claude (Anthropic), Gemini (Google) u OpenJarvis
// (IA local que corre en tu PC o en tu servidor de casa, sin internet); tú eliges
// en "Conexiones". Las claves de API se guardan cifradas como los demás tokens.
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenAI } = require('@google/genai');
const store = require('./store');

const CLAUDE_MODEL = 'claude-opus-5-5';
// Se puede cambiar en config.json ("geminiModel") cuando Google saque otro.
// Google retira modelos seguido: si el primero ya no existe (404) se prueba el siguiente.
const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash'];

// El texto del error de Google viene como JSON; se deja solo el mensaje.
function googleMessage(err) {
  try { return JSON.parse(err.message).error.message.slice(0, 220); } catch { return String(err.message).slice(0, 220); }
}

const SYSTEM = `Eres el asistente personal de Christopher, estudiante en México.
Respondes en español, en tono cercano y directo, con frases cortas.
Abajo tienes sus datos actuales: tareas de la escuela (Classroom y Moodle),
calendario, pendientes, correos sin leer, archivos recientes y su hoja de
pendientes de Google Sheets. Úsalos para responder. Si algo no está en los
datos, dilo en vez de inventarlo. Las fechas están en formato ISO (UTC);
conviértelas a la hora de México al mencionarlas.`;

const PROVIDERS = ['claude', 'gemini', 'openjarvis'];
// "jarvis serve" escucha aquí por defecto. Si lo instalas en el servidor de casa,
// pon su dirección (por ejemplo http://192.168.1.50:8000 o la de Tailscale).
const OPENJARVIS_DEFAULT_URL = 'http://127.0.0.1:8000';

function provider() {
  const p = store.get('aiProvider');
  return PROVIDERS.includes(p) ? p : 'claude';
}

function openJarvisUrl() {
  return (store.get('openjarvisUrl') || OPENJARVIS_DEFAULT_URL).replace(/\/+$/, '');
}

function status() {
  return {
    provider: provider(),
    claude: store.getSecret('anthropicKey') ? 'conectado' : 'desconectado',
    gemini: store.getSecret('geminiKey') ? 'conectado' : 'desconectado',
    // OpenJarvis no necesita clave: cuenta como listo en cuanto lo eliges o guardas su dirección.
    openjarvis: store.get('openjarvisUrl') || provider() === 'openjarvis' ? 'conectado' : 'desconectado',
    openjarvisUrl: openJarvisUrl(),
    openjarvisModel: store.get('openjarvisModel') || '',
    openjarvisOffline: store.get('openjarvisOffline') !== false
  };
}

function setKey(which, key) {
  const name = { gemini: 'geminiKey', openjarvis: 'openjarvisKey' }[which] || 'anthropicKey';
  store.setSecret(name, key ? key.trim() : null);
}

function setProvider(p) {
  store.set('aiProvider', PROVIDERS.includes(p) ? p : 'claude');
}

// changes: { url, model, key, offline }. La clave solo hace falta si OpenJarvis
// corre en otra máquina (ahí "jarvis serve" exige OPENJARVIS_API_KEY).
function setOpenJarvis(changes = {}) {
  if (changes.url !== undefined) {
    let url = String(changes.url || '').trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url;
    if (url) new URL(url); // lanza si la dirección no es válida
    store.set('openjarvisUrl', url || OPENJARVIS_DEFAULT_URL);
  }
  if (changes.model !== undefined) store.set('openjarvisModel', String(changes.model || '').trim() || null);
  if (changes.key !== undefined && changes.key !== '') store.setSecret('openjarvisKey', String(changes.key).trim() || null);
  if (changes.offline !== undefined) store.set('openjarvisOffline', !!changes.offline);
  return status();
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
    clima: data && data.weather && !data.weather.error ? data.weather : undefined,
    notion: data && Array.isArray(data.notion) ? data.notion.map(({ title, edited }) => ({ title, edited })) : undefined,
    disenosCanva: pick(data && data.designs).map(({ title, updatedAt }) => ({ title, updatedAt }))
  });
}

// Las dos APIs rechazan (400) mensajes vacíos, turnos seguidos del mismo lado o un primer turno del asistente:
// se limpia el historial antes de enviarlo para que un turno malo no arruine todas las preguntas siguientes.
function cleanMessages(messages) {
  const out = [];
  for (const m of messages) {
    const content = String(m.content || '').trim();
    if (!content) continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    if (!out.length && role === 'assistant') continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n' + content;
    else out.push({ role, content });
  }
  return out;
}

async function askClaude(system, messages) {
  messages = cleanMessages(messages);
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
    if (err instanceof Anthropic.APIConnectionError) throw Object.assign(new Error('Sin conexión a internet.'), { offline: true });
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
      if (i >= tries || ![500, 503].includes(err.status)) throw err;
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
  const contents = cleanMessages(messages).map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  // Primero el que funcionó la última vez; si Google retira modelos, se prueban los demás.
  const models = [...new Set([store.get('geminiModel'), store.get('geminiModelOk'), ...GEMINI_MODELS].filter(Boolean))];
  let first404 = null;
  let first429 = null;
  for (const [i, model] of models.entries()) {
    try {
      // Sin "pensar" largo contesta mucho más rápido; si el modelo no acepta ese ajuste, se reintenta sin él.
      const generate = (config) => withRetry(() => withTimeout(ai.models.generateContent({ model, contents, config }), 15000));
      const res = await generate({ systemInstruction: system, thinkingConfig: { thinkingBudget: 0 } })
        .catch((err) => {
          // Algunos modelos no aceptan apagar el "pensar" y contestan 400 sin decir por qué.
          if (err.status === 400 && !/API_KEY_INVALID/.test(err.message)) return generate({ systemInstruction: system });
          throw err;
        });
      const text = (res.text || '').trim();
      if (!text) throw Object.assign(new Error('vacía'), { empty: true });
      if (store.get('geminiModelOk') !== model) store.set('geminiModelOk', model);
      return text;
    } catch (err) {
      if (err.status === 404 && !first404) first404 = `${model}: ${googleMessage(err)}`;
      if (err.status === 429 && !first429) first429 = `${model}: ${googleMessage(err)}`;
      if ((err.status === 404 || err.status === 429 || err.timeout) && i < models.length - 1) continue;
      if ((err.status === 503 || err.status === 500 || err.empty) && i < models.length - 1) continue;
      if (err.empty) throw new Error('Gemini no devolvió respuesta; intenta de nuevo o pregúntalo de otra forma.');
      if (err.status === 503 || err.status === 500) throw new Error('Gemini está saturado en este momento; intenta de nuevo en unos segundos.');
      if (err.timeout) throw new Error('Gemini tardó demasiado en contestar; intenta de nuevo.');
      if (err.status === 404) throw new Error(`Google no encontró ningún modelo de Gemini para tu clave (${first404}). Avísale a Claude con este mensaje o cambia a Claude en Conexiones → Asistente.`);
      if (err.status === 400 && /API_KEY_INVALID/.test(err.message)) throw new Error('La clave de Gemini no es válida.');
      // 429 = cuota o límite de la clave (no es "ocupado"); se muestra lo que dice Google.
      if (err.status === 429) throw new Error(`Google rechazó la petición por límite de cuota de tu clave de Gemini (${first429}). Espera un minuto, revisa la cuota en aistudio.google.com o cambia a Claude en Conexiones → Asistente.`);
      if (err.status === 400) throw new Error(`Gemini rechazó la petición (${model}: ${googleMessage(err)}). Prueba otra vez; si sigue, avísale a Claude con este mensaje.`);
      throw err;
    }
  }
}

// OpenJarvis habla el mismo idioma que la API de OpenAI (/v1/chat/completions).
async function openJarvisFetch(path, body, ms) {
  const headers = { 'Content-Type': 'application/json' };
  const key = store.getSecret('openjarvisKey');
  if (key) headers.Authorization = 'Bearer ' + key;
  let res;
  try {
    res = await fetch(openJarvisUrl() + path, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(ms)
    });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error('OpenJarvis tardó demasiado en contestar. Los modelos locales son más lentos la primera vez; intenta de nuevo.');
    throw new Error(`No encontré OpenJarvis en ${openJarvisUrl()}. Revisa que esté abierto ("jarvis serve") y que la dirección en Conexiones → Asistente sea la correcta.`);
  }
  if (res.status === 401 || res.status === 403) throw new Error('OpenJarvis pidió clave: pon la misma que usaste en OPENJARVIS_API_KEY (Conexiones → Asistente).');
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`OpenJarvis respondió con error ${res.status}${text ? ': ' + text : ''}`);
  }
  return res.json();
}

// Si no elegiste modelo se usa el primero que tenga instalado OpenJarvis.
async function openJarvisModel() {
  const chosen = store.get('openjarvisModel');
  if (chosen) return chosen;
  const list = await openJarvisFetch('/v1/models', null, 10000);
  const id = list && Array.isArray(list.data) && list.data[0] && list.data[0].id;
  if (!id) throw new Error('OpenJarvis no tiene ningún modelo instalado. En la terminal corre "jarvis doctor" para ver qué falta.');
  return id;
}

async function askOpenJarvis(system, messages) {
  const model = await openJarvisModel();
  const res = await openJarvisFetch('/v1/chat/completions', {
    model,
    messages: [{ role: 'system', content: system }, ...cleanMessages(messages)],
    max_tokens: 1024,
    stream: false
  }, 120000);
  const text = String((res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || '')
    // Algunos modelos locales (Qwen, DeepSeek) escriben su "pensamiento" entre <think>…</think>.
    .replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!text) throw new Error('OpenJarvis no devolvió respuesta; intenta de nuevo.');
  return text;
}

// ¿El error fue por falta de internet? (Claude ya lo traduce; Gemini deja el error de fetch).
function isOffline(err) {
  if (err && err.offline) return true;
  const msg = String((err && err.message) || '');
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network/i.test(msg) && !(err && err.status);
}

// Usa la IA elegida; si es Claude o Gemini y no hay internet, contesta OpenJarvis
// (si ya lo configuraste y no apagaste esa opción).
async function ask_(system, messages) {
  const p = provider();
  if (p === 'openjarvis') return askOpenJarvis(system, messages);
  try {
    return await (p === 'gemini' ? askGemini(system, messages) : askClaude(system, messages));
  } catch (err) {
    if (!isOffline(err) || !store.get('openjarvisUrl') || store.get('openjarvisOffline') === false) throw err;
    return askOpenJarvis(system, messages);
  }
}

const VOICE = `Esta respuesta se va a leer en voz alta: contesta en una a tres
frases cortas, sin listas, sin markdown, sin emojis y sin links.`;

// history: [{ role: 'user' | 'assistant', content: string }]
// opts.voice: la pregunta llegó por voz y la respuesta se va a hablar.
async function chat(history, data, opts = {}) {
  const system = `${SYSTEM}${opts.voice ? '\n\n' + VOICE : ''}\n\nDatos actuales:\n${context(data)}`;
  return ask_(system, history);
}

async function dailyBriefing(data) {
  return chat([{
    role: 'user',
    content: 'Hazme el resumen de hoy en 5 líneas o menos: qué entrego primero, qué tengo en el calendario y si hay algún correo importante, y si el clima pide algo (paraguas, abrigo). Termina con una sugerencia concreta de por dónde empezar.'
  }], data);
}

function ready() {
  const s = status();
  return s[s.provider] === 'conectado';
}

// Una pregunta suelta sin los datos del tablero (para interpretar órdenes).
function ask(system, text) {
  return ask_(system, [{ role: 'user', content: text }]);
}

// Prueba la conexión con OpenJarvis y dice qué modelo va a usar.
async function testOpenJarvis() {
  const model = await openJarvisModel();
  const reply = await askOpenJarvis('Responde en español con una sola frase corta.', [{ role: 'user', content: 'Di hola.' }]);
  return { model, reply };
}

module.exports = { status, setKey, setProvider, setOpenJarvis, testOpenJarvis, chat, ask, dailyBriefing, ready };
