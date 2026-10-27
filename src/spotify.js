// Conexión con Spotify (Web API): qué suena ahora y lo último que escuchaste.
// Spotify exige tu propia app (gratis, ver README). Usa OAuth con PKCE, así que
// solo se necesita el Client ID (no hay secreto) y el permiso es de solo lectura.
const { shell } = require('electron');
const crypto = require('crypto');
const http = require('http');
const store = require('./store');

const API = 'https://api.spotify.com/v1';
const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const PORT = 47824;
const REDIRECT = `http://127.0.0.1:${PORT}/spotify`;
const SCOPE = 'user-read-currently-playing user-read-recently-played';

const b64url = (buf) => buf.toString('base64url');

function status() {
  if (!store.getSecret('spotifyApp')) return 'sin-credenciales';
  return store.getSecret('spotify') ? 'conectado' : 'desconectado';
}

function setApp(clientId) {
  clientId = String(clientId || '').trim();
  if (!clientId) throw new Error('Escribe el Client ID de Spotify.');
  store.setSecret('spotifyApp', { clientId });
  store.setSecret('spotify', null);
}

async function tokenRequest(params, previous) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Spotify rechazó el acceso (${body.error_description || body.error || res.status}).`);
  // Al renovar, Spotify a veces no devuelve un refresh_token nuevo: se conserva el anterior.
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token || (previous && previous.refresh_token),
    expiresAt: Date.now() + (body.expires_in || 3600) * 1000
  };
}

function connect() {
  const app = store.getSecret('spotifyApp');
  if (!app) return Promise.reject(new Error('Primero guarda el Client ID de Spotify.'));
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    const timer = setTimeout(() => { server.close(); reject(new Error('Se acabó el tiempo para aceptar en Spotify.')); }, 5 * 60 * 1000);
    const done = (fn, v) => { clearTimeout(timer); server.close(); fn(v); };
    server.on('error', (err) => done(reject, new Error(
      err.code === 'EADDRINUSE' ? `El puerto ${PORT} está ocupado; cierra otra conexión a Spotify en curso.` : err.message)));
    server.on('request', async (req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/spotify') { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const code = u.searchParams.get('code');
      if (u.searchParams.get('state') !== state || !code) {
        res.end('<h2>No se pudo conectar. Cierra esta pestaña e inténtalo otra vez.</h2>');
        return done(reject, new Error(u.searchParams.get('error') || 'Spotify no devolvió el permiso.'));
      }
      res.end('<h2>Listo. Ya puedes cerrar esta pestaña y volver al Asistente.</h2>');
      try {
        store.setSecret('spotify', await tokenRequest({
          grant_type: 'authorization_code', code, redirect_uri: REDIRECT,
          client_id: app.clientId, code_verifier: verifier
        }));
        done(resolve);
      } catch (err) {
        done(reject, err);
      }
    });
    server.listen(PORT, '127.0.0.1', () => {
      const q = new URLSearchParams({
        response_type: 'code', client_id: app.clientId, scope: SCOPE, redirect_uri: REDIRECT,
        state, code_challenge_method: 'S256', code_challenge: challenge
      });
      shell.openExternal(`${AUTH_URL}?${q}`);
    });
  });
}

function disconnect() {
  store.setSecret('spotify', null);
}

async function accessToken() {
  const app = store.getSecret('spotifyApp');
  let t = store.getSecret('spotify');
  if (!app || !t) return null;
  if (t.expiresAt - Date.now() < 60 * 1000) {
    t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: app.clientId }, t);
    store.setSecret('spotify', t);
  }
  return t.access_token;
}

async function get(token, path) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    store.setSecret('spotify', null);
    throw new Error('Spotify pidió volver a conectar.');
  }
  if (!res.ok) throw new Error((body.error && body.error.message) || `Spotify respondió ${res.status}.`);
  return body;
}

const track = (t) => ({
  title: t.name,
  artist: (t.artists || []).map((a) => a.name).join(', '),
  url: t.external_urls && t.external_urls.spotify
});

async function fetchAll() {
  const token = await accessToken();
  if (!token) return null;
  const [now, recent] = await Promise.all([
    get(token, '/me/player/currently-playing'),
    get(token, '/me/player/recently-played?limit=8')
  ]);
  return {
    // Los episodios de podcast no traen artistas; se muestran solo si son canciones.
    nowPlaying: now && now.is_playing && now.item && now.currently_playing_type === 'track' ? track(now.item) : null,
    recent: ((recent && recent.items) || []).map((i) => ({ ...track(i.track), playedAt: i.played_at }))
  };
}

module.exports = { status, setApp, connect, disconnect, fetchAll };
