# Asistente de Vida: app del celular

App de Android (iPhone después, es el mismo código) que se conecta **directo con tu PC**: ves el tablero y le hablas al asistente desde el celular. No hay servidores en medio; la PC debe estar prendida con el Asistente abierto.

Pantallas: **Tablero** (tareas de la escuela, calendario, pendientes, correos, Drive y el resumen de la mañana), **Asistente** (chat) y **Ajustes**.

## 1. En la PC

1. Abre el Asistente de Vida → **Conexiones → App del celular** → **Activar**.
2. La primera vez Windows pregunta si permites el acceso a la red: elige **Permitir** (redes privadas).
3. Toca **Emparejar celular**: aparece un código de 6 números y un QR (vale 10 minutos y una sola vez).

## 2. Fuera de casa: Tailscale (una sola vez)

[Tailscale](https://tailscale.com) es gratis para uso personal y hace que tu PC y tu celular se vean como si estuvieran en la misma red, desde cualquier lugar y con la conexión cifrada.

1. Instala Tailscale en la PC (<https://tailscale.com/download>) e inicia sesión.
2. Instala Tailscale en el celular (Google Play) e inicia sesión **con la misma cuenta**.
3. En el Asistente de la PC, la lista de direcciones marca la de Tailscale (empieza con `100.`). El QR ya trae todas las direcciones; la app usa la primera que responda (Wi-Fi de casa o Tailscale).

> En Wi-Fi público usa solo Tailscale: en una red local normal la conexión viaja sin cifrar (con una clave de acceso que solo conoce tu celular).

## 3. Instalar la app en el celular

### Opción rápida para probar: Expo Go

1. Instala **Expo Go** desde Google Play.
2. En la PC, en esta carpeta (`mobile/`): `npm install` y luego `npx expo start`.
3. Escanea el QR de la terminal con Expo Go. El celular y la PC deben estar en el mismo Wi-Fi.

### Instalación normal: archivo APK

Necesitas una cuenta gratis en <https://expo.dev>.

```bash
cd mobile
npm install
npx eas-cli login
npx eas-cli init
npx eas-cli build -p android --profile preview
```

Tarda unos 15 minutos en la nube de Expo. Al terminar te da un enlace: ábrelo en el celular, descarga el `.apk` y permite "instalar apps de origen desconocido" cuando Android lo pida.

## 4. Emparejar

Abre la app y toca **Escanear código QR** (o escribe la dirección de la PC y el código de 6 números). Para quitar un celular, ábrelo en la PC (Conexiones → App del celular) y toca **Quitar**.

## Si no conecta

- ¿La PC está prendida y el Asistente abierto (icono en la bandeja)?
- ¿**Activar** está encendido en la PC? ¿El código sigue vigente?
- En casa: celular y PC en el mismo Wi-Fi. Fuera: Tailscale activo en los dos.
- Si Windows nunca preguntó por el acceso a la red, busca "Permitir una aplicación a través del Firewall" y marca **Asistente de Vida** en redes privadas. Para Tailscale, si no conecta, márcala también en redes públicas.

## Cómo está hecho

- `src/api.js`: cliente del servidor local de la PC (`src/mobile.js` en la carpeta de arriba). Guarda varias direcciones y usa la primera que responde.
- `src/storage.js`: la clave de acceso se guarda en el almacén seguro del teléfono.
- Android permite HTTP sin cifrar a propósito (`usesCleartextTraffic` en `app.json`) porque la PC habla HTTP dentro de tu red.
- iPhone: se puede compilar con el mismo código, pero Apple pide una cuenta de desarrollador de pago para instalarla fuera de Expo Go.
