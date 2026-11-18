// Sesión de WhatsApp vinculada: Baileys necesita guardar sus llaves. En vez de dejar decenas de
// archivos sueltos en texto plano (lo que hace useMultiFileAuthState), todo se guarda en UN archivo
// cifrado con el cifrado del sistema (DPAPI en Windows). Quien copie el archivo no puede usarlo.
// `seal` y `open` se inyectan para poder probarlo sin Electron.
const fs = require('fs');
const path = require('path');

function createAuthStore(file, { seal, open, B }) {
  let data = { creds: null, keys: {} };
  try {
    data = JSON.parse(open(fs.readFileSync(file)), B.BufferJSON.reviver);
    data.keys = data.keys || {};
  } catch { /* primera vez, o archivo ilegible: se vincula de nuevo */ }
  if (!data.creds) data.creds = B.initAuthCreds();

  let timer = null;
  let writing = false;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    if (writing) { timer = setTimeout(flush, 200); return; }
    writing = true;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, seal(JSON.stringify(data, B.BufferJSON.replacer)));
      fs.renameSync(tmp, file);
    } finally {
      writing = false;
    }
  };
  // Se guarda un instante después del último cambio (llegan muchos seguidos).
  const save = () => { if (!timer) timer = setTimeout(flush, 500); };

  const state = {
    creds: data.creds,
    keys: {
      get: async (type, ids) => {
        const out = {};
        for (const id of ids) {
          let v = (data.keys[type] || {})[id];
          if (type === 'app-state-sync-key' && v) v = B.proto.Message.AppStateSyncKeyData.fromObject(v);
          out[id] = v;
        }
        return out;
      },
      set: async (batch) => {
        for (const type of Object.keys(batch)) {
          for (const id of Object.keys(batch[type])) {
            const v = batch[type][id];
            if (v) (data.keys[type] = data.keys[type] || {})[id] = v;
            else if (data.keys[type]) delete data.keys[type][id];
          }
        }
        save();
      }
    }
  };

  return {
    state,
    saveCreds: async () => { save(); },
    flush,
    registered: () => !!(data.creds && data.creds.registered),
    wipe: () => {
      clearTimeout(timer);
      timer = null;
      for (const f of [file, file + '.tmp']) { try { fs.unlinkSync(f); } catch {} }
    }
  };
}

module.exports = { createAuthStore };
