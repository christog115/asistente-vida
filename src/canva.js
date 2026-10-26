// Conexión con Canva (Canva Connect API): lista tus diseños más recientes.
// Canva exige que registres tu propia "integración" (gratis, ver README); aquí
// se guarda el Client ID y el secreto cifrados y el permiso es solo de lectura
// (design:meta:read). Inicio de sesión OAuth con PKCE por un puerto local fijo.
const { shell } = require('electron');
const crypto = require('crypto');
const http = require('http');
const store = require('./store');

const API = 'https://api.canva.com/rest/v1';
const AUTH_URL = 'https://www.canva.com/api/oauth/authorize';
const PORT = 47823;
const REDIRECT = `http://127.0.0.1:${PORT}/canva`;
const SCOPE = 'design:meta:read';

const b64url = (buf) => buf.toString('base64url');

function status() {
  if (!store.getSecret('canvaApp')) return 'sin-credenciales';
  return store.getSecret('canva') ? 'conectado' : 'desconectado';
}

function setApp(clientId, clientSecret) {
  clientId = String(clientId || '').trim();
  clientSecret = String(clientSecret || '').trim();
  if (!clientId || !clientSecret) throw new Error('Escribe el Client ID y el Client Secret de Canva.');
  store.setSecret('canvaApp', { clientId, clientSecret });
  store.setSecret('canva', null);
}

function basic({ clientId, clientSecret }) {
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

async function tokenRequest(app, params) {
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { Authorization: basic(app), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Canva rechazó el acceso (${body.error_description || body.error || res.status}).`);
  return { ...body, expiresAt: Date.now() + (body.expires_in || 14400) * 1000 };
}

function connect() {
  const app = store.getSecret('canvaApp');
  if (!app) return Promise.reject(new Error('Primero guarda el Client ID y el Client Secret de Canva.'));
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    const timer = setTimeout(() => { server.close(); reject(new Error('Se acabó el tiempo para aceptar en Canva.')); }, 5 * 60 * 1000);
    const done = (fn, v) => { clearTimeout(timer); server.close(); fn(v); };
    server.on('error', (err) => done(reject, new Error(
      err.code === 'EADDRINUSE' ? `El puerto ${PORT} está ocupado; cierra otra conexión a Canva en curso.` : err.message)));
    server.on('request', async (req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/canva') { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const code = u.searchParams.get('code');
      if (u.searchParams.get('state') !== state || !code) {
        res.end('<h2>No se pudo conectar. Cierra esta pestaña e inténtalo otra vez.</h2>');
        return done(reject, new Error(u.searchParams.get('error_description') || 'Canva no devolvió el permiso.'));
      }
      res.end('<h2>Listo. Ya puedes cerrar esta pestaña y volver al Asistente.</h2>');
      try {
        store.setSecret('canva', await tokenRequest(app, {
          grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT
        }));
        done(resolve);
      } catch (err) {
        done(reject, err);
      }
    });
    server.listen(PORT, '127.0.0.1', () => {
      const q = new URLSearchParams({
        code_challenge: challenge, code_challenge_method: 's256', scope: SCOPE,
        response_type: 'code', client_id: app.clientId, state, redirect_uri: REDIRECT
      });
      shell.openExternal(`${AUTH_URL}?${q}`);
    });
  });
}

function disconnect() {
  store.setSecret('canva', null);
}

async function accessToken() {
  const app = store.getSecret('canvaApp');
  let t = store.getSecret('canva');
  if (!app || !t) return null;
  if (t.expiresAt - Date.now() < 60 * 1000) {
    // El token de refresco se usa una sola vez; Canva devuelve uno nuevo.
    t = await tokenRequest(app, { grant_type: 'refresh_token', refresh_token: t.refresh_token });
    store.setSecret('canva', t);
  }
  return t.access_token;
}

async function recentDesigns() {
  const token = await accessToken();
  if (!token) return null;
  const res = await fetch(`${API}/designs?sort_by=modified_descending&limit=8`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    store.setSecret('canva', null);
    throw new Error('Canva pidió volver a conectar.');
  }
  if (!res.ok) throw new Error(body.message || `Canva respondió ${res.status}.`);
  return (body.items || []).map((d) => ({
    id: d.id,
    title: d.title || '(sin título)',
    updatedAt: d.updated_at ? new Date(d.updated_at * 1000).toISOString() : null,
    url: d.urls && (d.urls.edit_url || d.urls.view_url)
  }));
}

module.exports = { status, setApp, connect, disconnect, recentDesigns };
