# Asistente de Vida

App de escritorio (Windows y Mac) que vive en la bandeja del sistema y junta en un tablero:

- **Tareas de la escuela** de Google Classroom y de Moodle (ej. `tonala-virtual.ceti.mx`), ordenadas por fecha de entrega.
- **Calendario** de hoy y mañana, **pendientes** de Google Tasks, **correos sin leer** y **archivos recientes** de Drive.
- **Hoja de pendientes** de Google Sheets (por ejemplo, pendientes del trabajo).
- **Asistente con IA** (Claude o Gemini): te arma un resumen cada mañana y le puedes preguntar cosas como "¿qué entrego esta semana?".
- **Recordatorios diarios** como notificación del sistema (por defecto 7:00 y 20:00) y un aviso cuando una tarea vence en menos de 24 horas.
- **Avisos en el celular** (Android o iPhone): los mismos recordatorios llegan a tu teléfono.
- **Voz tipo Jarvis**: di la palabra clave (o Ctrl+Shift+J) y el asistente te contesta hablando.
- **Diseños recientes de Canva** en el tablero.
- **App del celular** (carpeta `mobile/`): ve el tablero y habla con el asistente desde el teléfono, en casa o fuera con Tailscale.

Arranca sola al prender la PC (en segundo plano) y al cerrar la ventana sigue funcionando en la bandeja.

## Cómo correrla

Necesitas [Node.js](https://nodejs.org) 20 o más reciente.

```bash
npm install
npm start
```

Para generar el instalador: `npm run build:win` (Windows) o `npm run build:mac` (Mac). Queda en `dist/`.

## Conectar Google (una sola vez)

Google exige que cada app tenga su propio "cliente OAuth". Es gratis:

1. Entra a <https://console.cloud.google.com>, crea un proyecto (ej. "Asistente de Vida").
2. En **APIs y servicios → Biblioteca**, habilita: Gmail API, Google Calendar API, Google Tasks API, Google Drive API, Google Classroom API y Google Sheets API.
3. En **Pantalla de consentimiento de OAuth**, elige "Externo", llena el nombre y agrega tu correo como **usuario de prueba**.
4. En **Credenciales → Crear credenciales → ID de cliente de OAuth**, elige **App de escritorio**.
5. Descarga el JSON y guárdalo como `credentials/google-credentials.json` dentro de esta carpeta.
6. Abre la app → **Conexiones → Conectar con Google** y acepta los permisos en tu navegador.

Si tu Classroom es de una cuenta de la escuela, conéctate con esa cuenta (o agrégala como usuario de prueba).

Si ya habías conectado Google antes de la Fase 2, dale **Desconectar** y **Conectar con Google** otra vez para aceptar el permiso nuevo de Sheets.

## Hoja de pendientes (Google Sheets)

Crea una hoja con tres columnas: **Tarea**, **Fecha** y **Hecho**. Pega su link en **Conexiones → Google**. Las filas con "sí", "x" o "listo" en *Hecho* no aparecen.

## Asistente (Claude o Gemini)

En **Conexiones → Asistente** eliges cuál usar y pegas su clave de API:

- **Claude:** crea una clave en <https://platform.claude.com> (Settings → API keys). Se cobra por uso; preguntas cortas cuestan centavos. Usa Claude Opus 5.5 con esfuerzo bajo, y si Claude rechaza algo por seguridad, la API reintenta sola con otro modelo.
- **Gemini:** crea una clave gratis en <https://aistudio.google.com/apikey>.

Cada mañana (desde las 5:00, en cuanto la PC esté prendida) el asistente arma tu resumen y lo usa en la notificación de las 7:00. También puedes pedirlo con **Generar resumen de hoy** en la pestaña Asistente.

## Avisos en el celular

Usa [ntfy](https://ntfy.sh), una app gratis (Google Play / App Store) que recibe notificaciones sin crear cuenta:

1. Instala **ntfy** en tu celular.
2. En la app de escritorio: **Conexiones → Celular → Conectar celular**. Aparece el **nombre del tema** (algo como `k7m2-x9pq-4rtd-hw5n`).
3. En ntfy toca **+**, escribe ese nombre en *Topic name* (deja el servidor ntfy.sh) y toca **Subscribe**. Si tu cámara abre enlaces `ntfy://`, también puedes escanear el QR que aparece bajo "¿Prefieres escanear?".
4. De vuelta en la PC toca **Enviar prueba**: debe sonar tu celular.

Recibes lo mismo que en la PC: el resumen del día y el aviso cuando una tarea vence en menos de 24 horas.

- El nombre del tema es largo y aleatorio, se guarda cifrado y solo se ve en tu pantalla. Quien conozca el nombre puede leer tus avisos; si lo compartes sin querer, dale **Desconectar** y **Conectar celular** para generar uno nuevo.
- Los avisos se mandan desde la PC, así que la app debe estar prendida. Si algún día quieres tu propio servidor ntfy, la dirección está en `config.json` (`phone.server`).

## App del celular

La app está en [`mobile/`](mobile/README.md) (Android ahora, iPhone después). La PC activa un servidor local, **Conexiones → App del celular → Activar**, y el celular se empareja con un código de 6 números o un QR. Para usarla fuera de casa instala Tailscale (gratis) en la PC y el celular; la guía paso a paso, con la instalación del APK, está en [`mobile/README.md`](mobile/README.md).

- Solo los celulares emparejados pueden pedir datos; la PC guarda únicamente una huella de cada clave y los puedes quitar cuando quieras.
- El código de emparejamiento vale 10 minutos y una vez; 5 intentos fallidos lo invalidan y bloquean un minuto.
- Todo va directo PC ↔ celular, sin servidores en medio. La PC debe estar prendida.

## Canva

Canva exige que crees tu propia integración (gratis, solo lectura):

1. Entra a <https://www.canva.com/developers/integrations/connect-api> y crea una integración (Connect API). Puede que Canva te pida activar la verificación en dos pasos.
2. En **Scopes** marca solo `design:meta:read`.
3. En **Authentication** agrega esta URL de redirección: `http://127.0.0.1:47823/canva`
4. Copia el **Client ID** y genera el **Client Secret**.
5. En la app: **Conexiones → Canva** → pega las dos claves → **Guardar claves** → **Conectar con Canva** y acepta en el navegador.

Aparecen tus 8 diseños más recientes en el tablero (y en la app del celular). Las claves se guardan cifradas.

## Spotify

Spotify también pide tu propia app (gratis, solo lectura; no hay secreto, solo Client ID):

1. Entra a <https://developer.spotify.com/dashboard> y crea una app. En **Redirect URIs** agrega `http://127.0.0.1:47824/spotify` y en **APIs** marca *Web API*.
2. Copia el **Client ID**.
3. En la app: **Conexiones → Spotify** → pega el Client ID → **Guardar** → **Conectar con Spotify** y acepta en el navegador.

Muestra lo que suena ahora y las últimas 8 canciones (en el tablero y en la app del celular). Spotify puede pedir que tu cuenta esté agregada a la app mientras está en modo desarrollo (**User Management** en el dashboard).

## WhatsApp (avisos)

Usa la API oficial de Meta (WhatsApp Cloud API), gratis para este uso. Solo manda avisos a tu número; no lee tus chats.

1. Entra a <https://developers.facebook.com>, crea una app de tipo **Business** y agrega el producto **WhatsApp**.
2. En **WhatsApp → Configuración de la API** verás un número de prueba: copia su **ID del número de teléfono** y agrega tu número en "Para" (te llega un código por WhatsApp).
3. Crea un **token permanente** (Configuración del negocio → Usuarios del sistema → generar token con el permiso `whatsapp_business_messaging`). El token temporal de la pantalla dura 24 h.
4. En la app: **Conexiones → WhatsApp** → pega token, ID y tu número con lada (ej. `523312345678`) → **Guardar** → **Enviar prueba**.

Importante: WhatsApp solo deja mandar texto libre durante 24 h después de que tú le escribes al número de la API. Para recibir avisos cada día, mándale un "hola" a ese número de vez en cuando (o aprueba una plantilla en Meta). La prueba usa la plantilla `hello_world` y siempre llega.

## Conectar la escuela (Moodle)

En **Conexiones** hay dos opciones:

1. **API oficial (recomendada).** Escribes tu usuario y contraseña en la app; se mandan directo a la escuela y solo se guarda el permiso (token) que devuelve, cifrado con el sistema operativo. Es la misma vía que usa la app móvil oficial de Moodle.
2. **Leer la página.** Si la escuela tiene apagada la opción 1, se abre su página real, inicias sesión como siempre y la app lee "Próximos eventos" en segundo plano con esa sesión.

## Actualizarse solo

La app instalada busca versiones nuevas en GitHub al arrancar y cada 6 horas, las descarga sola y las instala al cerrarla (o con **Reiniciar para actualizar** en Conexiones → Actualizaciones). Se apaga con el interruptor de esa tarjeta. Si la app se reinstala desde el instalador, tus datos y claves se conservan. Una cosa a mano: copia `credentials/google-credentials.json` a la carpeta de datos de la app (`%APPDATA%\asistente-vida` en Windows) para que la app instalada encuentre tus credenciales de Google.

Cuando estés trabajando desde el código (`npm start`) no hace nada.

Para publicar una versión nueva (lo hago yo, o tú):

1. Sube el número de `version` en `package.json` y haz commit.
2. Crea la etiqueta y súbela (`git tag v0.2.1 && git push origin v0.2.1`) o crea el release desde GitHub (Releases → Draft a new release, con esa etiqueta, **Publish release**).
3. GitHub Actions (`.github/workflows/release.yml`) arma el instalador de Windows y Mac y lo publica en **Releases**.

Requisito: el repositorio debe ser **público** (Settings → General → Danger Zone → Change visibility), porque las apps instaladas descargan sin ninguna clave. El repositorio no contiene claves ni secretos (`credentials/` está ignorado). Ojo: Windows mostrará el aviso de "SmartScreen" porque el instalador no está firmado, y en Mac las actualizaciones automáticas necesitan una app firmada por Apple (cuenta de desarrollador de pago).

## Seguridad

- Ninguna contraseña se guarda. Los tokens se cifran con DPAPI (Windows) o el Llavero (Mac).
- Todo se queda en tu PC, en la carpeta de datos de la app. No hay servidor.
- `credentials/` está en `.gitignore`; nunca subas ese archivo a GitHub.

## Próximas fases

- ~~**Fase 2:** asistente con Claude y Gemini; Google Sheets.~~ Listo.
- ~~**Fase 3:** avisos en el celular.~~ Listo.
- ~~**Fase 3b:** app del celular que se conecta a la PC.~~ Lista para probar (falta compilar el APK y probarla en un celular real).
- ~~**Fase 4:** Canva~~ Lista para probar (falta probarla con tu cuenta de Canva). Incluye la voz tipo Jarvis.
- **Fase 6:** actualización automática (ver abajo).
- **Fase 5:** Spotify y avisos por WhatsApp (oficial). Listas para probar con tus cuentas.
- **Más adelante:** más integraciones (dime cuáles).
