// Voz natural de Microsoft Edge (servicio "Leer en voz alta"). Es gratis y sin
// clave, pero no es oficial para apps de terceros y necesita internet: si falla,
// la ventana usa la voz de Windows/Mac.
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const VOICES = [
  { id: 'es-MX-DaliaNeural', label: 'Dalia (mexicana, natural)' },
  { id: 'es-MX-JorgeNeural', label: 'Jorge (mexicano, natural)' },
  { id: 'es-ES-ElviraNeural', label: 'Elvira (España, natural)' },
  { id: 'es-US-PalomaNeural', label: 'Paloma (EE. UU., natural)' }
];
const DEFAULT_VOICE = VOICES[0].id;
const MAX_CHARS = 1500;

const escapeXml = (s) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

async function synth(text, voiceId) {
  const voice = VOICES.find((v) => v.id === voiceId) ? voiceId : DEFAULT_VOICE;
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 8000, synthesisTimeoutMs: 20000 });
  const chunks = [];
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeXml(String(text).slice(0, MAX_CHARS)));
    await new Promise((resolve, reject) => {
      audioStream.on('data', (d) => chunks.push(d));
      audioStream.on('error', reject);
      audioStream.on('close', resolve);
    });
  } finally {
    tts.close();
  }
  const audio = Buffer.concat(chunks);
  if (!audio.length) throw new Error('El servicio de voz no devolvió audio.');
  return audio;
}

module.exports = { VOICES, DEFAULT_VOICE, synth };
