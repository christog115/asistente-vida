// Clima (Open-Meteo) y tiempo de traslado (OSRM) sin claves ni cuentas.
// Los lugares ("casa", "escuela"...) se buscan con OpenStreetMap (Nominatim) y se guardan en config.json.
const store = require('./store');

const UA = { 'User-Agent': 'asistente-vida-personal' };
const plain = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

async function getJson(url, ms = 10000) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`El servicio respondió ${res.status}.`);
  return res.json();
}

async function geocode(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Escribe una dirección o ciudad.');
  const r = await getJson(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
  if (!Array.isArray(r) || !r.length) throw new Error(`No encontré "${q}". Prueba con colonia y ciudad.`);
  return { lat: Number(r[0].lat), lon: Number(r[0].lon), label: String(r[0].display_name).split(',').slice(0, 3).join(',').trim() };
}

function places() {
  return store.get('places') || {};
}

function list() {
  return Object.entries(places()).map(([name, p]) => ({ name, label: p.label }));
}

async function setPlace(name, address) {
  name = plain(name);
  if (!name) throw new Error('Ponle un nombre al lugar (casa, escuela...).');
  const g = await geocode(address);
  store.set('places', { ...places(), [name]: g });
  return list();
}

function removePlace(name) {
  const p = { ...places() };
  delete p[plain(name)];
  store.set('places', p);
  return list();
}

const CODES = [
  [[0], 'despejado'], [[1, 2], 'poco nublado'], [[3], 'nublado'], [[45, 48], 'con niebla'],
  [[51, 53, 55, 56, 57], 'con llovizna'], [[61, 63, 65, 66, 67, 80, 81, 82], 'con lluvia'],
  [[71, 73, 75, 77, 85, 86], 'con nieve'], [[95, 96, 99], 'con tormenta']
];
const describe = (c) => (CODES.find(([l]) => l.includes(c)) || [0, 'variable'])[1];

// Clima de hoy en "casa" (o en otro lugar guardado). Devuelve null si no hay lugar configurado.
async function fetchWeather(name = 'casa') {
  const p = places()[plain(name)];
  if (!p) return null;
  const j = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`);
  return {
    place: plain(name), label: p.label,
    temp: Math.round(j.current.temperature_2m), desc: describe(j.current.weather_code),
    max: Math.round(j.daily.temperature_2m_max[0]), min: Math.round(j.daily.temperature_2m_min[0]),
    rain: j.daily.precipitation_probability_max[0] ?? 0
  };
}

function weatherText(w) {
  if (!w || w.error) return '';
  const rain = w.rain >= 40 ? ` Hay ${w.rain}% de probabilidad de lluvia, lleva paraguas.` : '';
  return `Clima: ${w.desc}, ${w.temp} grados ahora, máxima de ${w.max} y mínima de ${w.min}.${rain}`;
}

// Tiempo en auto desde "casa" hasta un lugar guardado o una dirección (sin tráfico en vivo).
async function route(destination) {
  const home = places().casa;
  if (!home) throw new Error('Primero guarda tu casa en "Clima y rutas".');
  const key = plain(destination).replace(/^(a |al |a la |a el |la |el |mi |a mi )/, '');
  const dest = places()[key] || await geocode(destination);
  const j = await getJson(`https://router.project-osrm.org/route/v1/driving/${home.lon},${home.lat};${dest.lon},${dest.lat}?overview=false`, 15000);
  if (!j.routes || !j.routes.length) throw new Error('No encontré una ruta hacia ahí.');
  return { minutes: Math.max(1, Math.round(j.routes[0].duration / 60)), km: Math.round(j.routes[0].distance / 100) / 10, to: dest.label || destination };
}

module.exports = { geocode, setPlace, removePlace, list, fetchWeather, weatherText, route };
