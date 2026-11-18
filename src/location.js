// Dónde está tu PC. Primero el servicio de ubicación de Windows (Wi-Fi/GPS, preciso a unos metros);
// si está apagado, y SOLO si lo permites en Conexiones → WhatsApp, se usa la ubicación aproximada
// por tu dirección IP (a nivel ciudad; esto manda tu IP a ipwho.is).
const { execFile } = require('child_process');
const store = require('./store');

const PS = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Device
$w = New-Object System.Device.Location.GeoCoordinateWatcher([System.Device.Location.GeoPositionAccuracy]::High)
[void]$w.TryStart($false, [TimeSpan]::FromSeconds(8))
$t = 0
while ($w.Status -ne 'Ready' -and $t -lt 40) { Start-Sleep -Milliseconds 250; $t++ }
$p = $w.Position.Location
if ($w.Status -eq 'Ready' -and -not $p.IsUnknown) {
  @{ lat = $p.Latitude; lon = $p.Longitude; acc = $p.HorizontalAccuracy } | ConvertTo-Json -Compress
} else { @{ error = [string]$w.Permission } | ConvertTo-Json -Compress }
$w.Stop()
`;

function windowsLocation() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    const enc = Buffer.from(PS, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { windowsHide: true, timeout: 20000 }, (err, out) => {
      if (err) return resolve(null);
      try {
        const j = JSON.parse(String(out).trim());
        resolve(j && typeof j.lat === 'number' && isFinite(j.lat) ? { lat: j.lat, lon: j.lon, accuracy: Math.round(j.acc) || null, source: 'windows' } : null);
      } catch { resolve(null); }
    });
  });
}

async function ipLocation() {
  const res = await fetch('https://ipwho.is/', { signal: AbortSignal.timeout(10000) });
  const j = await res.json();
  if (!j || j.success === false || typeof j.latitude !== 'number') throw new Error('No se pudo estimar la ubicación por IP.');
  return { lat: j.latitude, lon: j.longitude, accuracy: null, source: 'ip', place: [j.city, j.region].filter(Boolean).join(', ') };
}

const allowIp = () => store.get('locationIp') === true;
const setAllowIp = (on) => store.set('locationIp', !!on);

async function current() {
  const w = await windowsLocation();
  if (w) return w;
  if (allowIp()) return ipLocation();
  throw new Error('No pude leer la ubicación de Windows. Actívala en Configuración → Privacidad → Ubicación (y deja que las apps de escritorio la usen), o permite la ubicación aproximada por IP en Conexiones → WhatsApp.');
}

// Metros entre dos puntos (para no mandar el mismo lugar una y otra vez).
function distance(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

module.exports = { current, distance, allowIp, setAllowIp };
