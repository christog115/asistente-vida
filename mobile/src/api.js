// Cliente de la app del celular para el servidor local del Asistente en la PC.
// Guarda varias direcciones (Wi-Fi y Tailscale) y usa la primera que responda.
export const DEFAULT_PORT = 47821;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const NO_CONNECTION =
  'No pude conectar con tu PC. ¿Está prendida y con el Asistente abierto? Si estás fuera de casa, ¿Tailscale está activo en los dos?';

// "192.168.1.5", "192.168.1.5:47821" o "http://192.168.1.5:47821" -> "http://192.168.1.5:47821"
export function normalizeAddress(input) {
  const m = /^(https?:\/\/)?([A-Za-z0-9.-]+)(?::(\d{1,5}))?\/*$/.exec(String(input || '').trim());
  if (!m) return null;
  return `${m[1] || 'http://'}${m[2]}:${m[3] || DEFAULT_PORT}`;
}

async function fetchJson(base, path, { method = 'GET', body, token, timeout = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } catch {
    throw new ApiError(NO_CONNECTION, 0);
  } finally {
    clearTimeout(timer);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError((json && json.error) || `Error ${res.status}`, res.status);
  return json;
}

// Primera dirección que responde al ping y es de verdad el Asistente.
export async function findReachable(urls) {
  const tries = urls.map((u) =>
    fetchJson(u, '/api/ping', { timeout: 4000 }).then((j) => {
      if (!j || j.app !== 'asistente-vida') throw new Error('otra cosa');
      return u;
    })
  );
  try {
    return await Promise.any(tries);
  } catch {
    throw new ApiError(NO_CONNECTION, 0);
  }
}

export async function pair(urls, code, name) {
  const base = await findReachable(urls);
  const { token } = await fetchJson(base, '/api/pair', { method: 'POST', body: { code: String(code).trim(), name } });
  return { urls, base, token };
}

// conn = { urls, base, token }. Si la dirección guardada ya no responde (cambió
// la red), busca otra de la lista y reintenta una vez.
export async function call(conn, path, opts = {}) {
  try {
    return await fetchJson(conn.base, path, { ...opts, token: conn.token });
  } catch (err) {
    if (err.status !== 0 || conn.urls.length === 0) throw err;
    conn.base = await findReachable(conn.urls);
    return fetchJson(conn.base, path, { ...opts, token: conn.token });
  }
}

export const getData = (conn) => call(conn, '/api/data');
export const refresh = (conn) => call(conn, '/api/refresh', { method: 'POST', timeout: 60000 });
export const chat = (conn, history) => call(conn, '/api/chat', { method: 'POST', body: { history }, timeout: 90000 }).then((j) => j.answer);

// Lo que trae el QR de la PC: { a: [direcciones], c: "123456" }
export function parsePairingQr(text) {
  try {
    const j = JSON.parse(text);
    const urls = (Array.isArray(j.a) ? j.a : []).map(normalizeAddress).filter(Boolean);
    if (urls.length && /^\d{6}$/.test(String(j.c))) return { urls, code: String(j.c) };
  } catch {
    // no era nuestro código
  }
  return null;
}
