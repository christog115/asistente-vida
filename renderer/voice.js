// Jarvis: escucha todo el tiempo la palabra clave y luego tu pregunta.
// El reconocimiento corre en tu PC con Vosk; la respuesta la da el asistente
// (Claude o Gemini) y se lee en voz alta con las voces de Windows.
const voice = {
  state: 'off', // off | cargando | espera | escuchando | pensando | hablando
  model: null, wake: null, cmd: null, ctx: null, stream: null, node: null,
  timer: null, heardSomething: false
};

const COMMAND_TIMEOUT_MS = 7000;

// Vosk escribe lo que oye con ortografía en español, así que "Jarvis" puede
// llegar como "yarvis" o "jarbis". Se aceptan las variantes más comunes.
// Puedes escribir varias palabras separadas por coma ("kara, cara") para cubrir cómo la oye el reconocedor.
const ALIASES = {
  jarvis: ['yarvis', 'jarbis', 'yarbis', 'harvis', 'charvis'],
  kara: ['cara', 'karra']
};
function wakeVariants(word) {
  const out = new Set();
  for (const base of word.toLowerCase().split(',').map((w) => w.trim()).filter(Boolean)) {
    out.add(base);
    (ALIASES[base] || []).forEach((w) => out.add(w));
  }
  return [...out];
}

function heardWake(text) {
  const words = (text || '').toLowerCase().split(/\s+/);
  return voice.wakeWords.some((w) => w.split(' ').every((part) => words.includes(part)));
}

function setVoiceState(state, detail) {
  voice.state = state;
  const labels = {
    off: 'Voz apagada',
    cargando: detail || 'Preparando la voz…',
    espera: `Di "${voice.wakeWord}"`,
    escuchando: detail ? `Te escucho: ${detail}` : 'Te escucho…',
    pensando: 'Pensando…',
    hablando: 'Hablando…'
  };
  const text = labels[state];
  const pill = $('voice-pill');
  pill.textContent = '🎙 ' + text;
  pill.className = 'voice-pill ' + state;
  pill.classList.toggle('hidden', state === 'off');
  $('voice-status').textContent = text;
  api.voiceState(text);
}

function beep(freq) {
  if (!voice.ctx) return;
  const osc = voice.ctx.createOscillator();
  const gain = voice.ctx.createGain();
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.15, voice.ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, voice.ctx.currentTime + 0.18);
  osc.connect(gain).connect(voice.ctx.destination);
  osc.start();
  osc.stop(voice.ctx.currentTime + 0.2);
}

// Nombres de voces femeninas comunes en Windows/Mac; el sistema no dice el género.
const FEMALE = /sabina|helena|laura|paulina|elvira|dalia|mónica|monica|marisol|lucia|lucía|paloma|female|mujer/i;
let chosenVoice = '';

function spanishVoices() {
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('es'));
}

function spanishVoice() {
  const voices = spanishVoices();
  return voices.find((v) => v.name === chosenVoice)
    || voices.find((v) => v.lang === 'es-MX' && FEMALE.test(v.name))
    || voices.find((v) => FEMALE.test(v.name))
    || voices.find((v) => v.lang === 'es-MX') || voices[0] || null;
}

function fillVoices() {
  const sel = $('voice-name');
  const voices = spanishVoices();
  sel.replaceChildren(...voices.map((v) => new Option(`${v.name} (${v.lang})`, v.name)));
  const cur = spanishVoice();
  if (cur) sel.value = cur.name;
}
speechSynthesis.onvoiceschanged = fillVoices;

function speak(text) {
  return new Promise((resolve) => {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = spanishVoice();
    if (v) u.voice = v;
    u.lang = v ? v.lang : 'es-MX';
    u.onend = resolve;
    u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}

async function say(text) {
  setVoiceState('hablando');
  await speak(text);
  backToWaiting();
}

function backToWaiting() {
  clearTimeout(voice.timer);
  if (voice.state !== 'off') setVoiceState('espera');
}

// Se dijo la palabra clave (o se usó el atajo): ahora se escucha la pregunta.
function activate() {
  if (voice.state === 'off' || voice.state === 'cargando') return;
  speechSynthesis.cancel();
  voice.wake.retrieveFinalResult(); // descarta el "jarvis" que ya oyó
  voice.heardSomething = false;
  setVoiceState('escuchando');
  beep(880);
  clearTimeout(voice.timer);
  voice.timer = setTimeout(() => {
    if (voice.state !== 'escuchando') return;
    if (voice.heardSomething) voice.cmd.retrieveFinalResult();
    else { beep(440); backToWaiting(); }
  }, COMMAND_TIMEOUT_MS);
}

// Órdenes que se resuelven aquí mismo, sin preguntarle a la inteligencia.
const LOCAL_COMMANDS = [
  [/^(cancela|nada|olvídalo|olvidalo|ya no)\b/, () => { beep(440); backToWaiting(); }],
  [/(abre|abrir|muestra|enséñame|enseñame).*(tablero|app|ventana|asistente)/, () => { api.showWindow(); say('Listo.'); }],
  [/^(actualiza|refresca)/, () => { api.refresh().then(render); say('Actualizando tus datos.'); }],
  [/(deja de escuchar|apaga la voz|desactiva la voz)/, async () => { await speak('Listo, dejo de escuchar.'); setVoiceEnabled(false); }]
];

async function handleCommand(text) {
  clearTimeout(voice.timer);
  const local = LOCAL_COMMANDS.find(([re]) => re.test(text));
  if (local) return local[1]();
  setVoiceState('pensando');
  addMsg('user', '🎙 ' + text);
  chatHistory.push({ role: 'user', content: text });
  const pending = addMsg('assistant', 'Pensando…');
  try {
    const answer = await api.aiChat(chatHistory, { voice: true });
    pending.textContent = answer;
    chatHistory.push({ role: 'assistant', content: answer });
    await say(answer);
  } catch (err) {
    chatHistory.pop();
    pending.textContent = 'Error: ' + cleanError(err);
    await say(cleanError(err));
  }
}

// Vosk.createModel no avisa bien cuando falla, así que se espera el evento a mano.
function loadModel(url) {
  return new Promise((resolve, reject) => {
    const model = new Vosk.Model(url);
    const timer = setTimeout(() => { model.terminate(); reject(new Error('El modelo de voz tardó demasiado en cargar.')); }, 120000);
    model.on('load', (m) => {
      clearTimeout(timer);
      if (m.result) resolve(model);
      else { model.terminate(); reject(new Error('No se pudo cargar el modelo de voz.')); }
    });
    model.on('error', (m) => {
      console.error('Voz:', m.error);
      if (model.ready) return; // ya cargó: un error suelto no apaga la voz
      clearTimeout(timer);
      model.terminate();
      reject(new Error(m.error || 'Error en el modelo de voz.'));
    });
  });
}

async function startVoice() {
  if (voice.state !== 'off') return;
  const cfg = await api.voiceStatus();
  voice.wakeWord = cfg.wakeWord;
  voice.wakeWords = wakeVariants(cfg.wakeWord);
  setVoiceState('cargando', cfg.modelReady ? 'Cargando la voz…' : 'Descargando la voz en español (solo la primera vez, ~40 MB)…');
  try {
    const file = await api.voicePrepare();
    setVoiceState('cargando', 'Cargando la voz…');
    voice.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false
    });
    voice.ctx = new AudioContext({ sampleRate: 16000 });
    voice.model = await loadModel('voz://modelo/' + file);
    const rate = voice.ctx.sampleRate;
    // Uno solo busca la palabra clave (gramática cerrada, casi sin falsas alarmas);
    // el otro entiende frases completas y solo se usa después de la palabra clave.
    voice.wake = new voice.model.KaldiRecognizer(rate, JSON.stringify([...voice.wakeWords, '[unk]']));
    voice.cmd = new voice.model.KaldiRecognizer(rate);
    voice.wake.on('partialresult', (m) => { if (voice.state === 'espera' && heardWake(m.result.partial)) activate(); });
    voice.wake.on('result', (m) => { if (voice.state === 'espera' && heardWake(m.result.text)) activate(); });
    voice.cmd.on('partialresult', (m) => {
      if (voice.state !== 'escuchando' || !m.result.partial) return;
      voice.heardSomething = true;
      setVoiceState('escuchando', m.result.partial);
    });
    voice.cmd.on('result', (m) => {
      if (voice.state !== 'escuchando') return;
      const text = (m.result.text || '').trim();
      if (text) handleCommand(text);
    });
    const source = voice.ctx.createMediaStreamSource(voice.stream);
    voice.node = voice.ctx.createScriptProcessor(4096, 1, 1);
    voice.node.onaudioprocess = (e) => {
      // Mientras habla o piensa no se escucha, para que no se oiga a sí mismo.
      try {
        if (voice.state === 'espera') voice.wake.acceptWaveform(e.inputBuffer);
        else if (voice.state === 'escuchando') voice.cmd.acceptWaveform(e.inputBuffer);
      } catch (err) {
        console.error('Voz:', err);
      }
    };
    source.connect(voice.node);
    voice.node.connect(voice.ctx.destination);
    setVoiceState('espera');
  } catch (err) {
    stopVoice();
    const msg = err && (err.name === 'NotAllowedError' || err.name === 'NotFoundError')
      ? 'No pude usar el micrófono. Revisa Configuración de Windows → Privacidad → Micrófono.'
      : 'No se pudo iniciar la voz: ' + (err ? cleanError(err) : 'error desconocido');
    $('voice-status').textContent = msg;
  }
}

function stopVoice() {
  clearTimeout(voice.timer);
  speechSynthesis.cancel();
  if (voice.node) voice.node.disconnect();
  if (voice.stream) voice.stream.getTracks().forEach((t) => t.stop());
  if (voice.ctx) voice.ctx.close();
  if (voice.model) voice.model.terminate();
  Object.assign(voice, { model: null, wake: null, cmd: null, ctx: null, stream: null, node: null });
  setVoiceState('off');
}

async function setVoiceEnabled(on) {
  await api.voiceSet({ enabled: on });
  $('voice-enabled').checked = on;
  if (on) startVoice();
  else stopVoice();
}

api.onVoiceProgress((pct) => {
  if (voice.state === 'cargando' && pct >= 0) setVoiceState('cargando', `Descargando la voz en español… ${pct}%`);
});
api.onVoiceActivate(() => {
  if (voice.state === 'off') $('voice-status').textContent = 'Activa la voz en Conexiones para usar el atajo.';
  else activate();
});

$('voice-enabled').onchange = (e) => setVoiceEnabled(e.target.checked);
$('voice-form').onsubmit = async (e) => {
  e.preventDefault();
  const word = $('voice-wake').value.trim().toLowerCase();
  if (!word) return;
  const cfg = await api.voiceSet({ wakeWord: word });
  $('voice-wake').value = cfg.wakeWord;
  // Se reinicia para que el reconocedor use la nueva palabra.
  if (voice.state !== 'off') { stopVoice(); startVoice(); }
  $('voice-status').textContent = `Palabra clave: "${cfg.wakeWord}".`;
};
$('voice-name').onchange = async (e) => {
  chosenVoice = e.target.value;
  await api.voiceSet({ voiceName: chosenVoice });
  speak('Hola Christopher, así sueno.');
};
// El resumen del día también se lee en voz alta a la hora del recordatorio.
api.onVoiceSpeak((text) => { if (voice.state === 'espera') say(text); });
$('voice-test').onclick = () => speak('Hola Christopher, aquí estoy.');

(async () => {
  const cfg = await api.voiceStatus();
  $('voice-enabled').checked = cfg.enabled;
  $('voice-wake').value = cfg.wakeWord;
  chosenVoice = cfg.voiceName || '';
  fillVoices();
  if (cfg.enabled) startVoice();
  else setVoiceState('off');
})();
