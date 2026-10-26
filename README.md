# Asistente de Vida

App de escritorio (Windows y Mac) que vive en la bandeja del sistema y junta en un tablero:

- **Tareas de la escuela** de Google Classroom y de Moodle (ej. `tonala-virtual.ceti.mx`), ordenadas por fecha de entrega.
- **Calendario** de hoy y mañana, **pendientes** de Google Tasks, **correos sin leer** y **archivos recientes** de Drive.
- **Hoja de pendientes** de Google Sheets (por ejemplo, pendientes del trabajo).
- **Asistente con IA** (Claude o Gemini): te arma un resumen cada mañana y le puedes preguntar cosas como "¿qué entrego esta semana?".
- **Recordatorios diarios** como notificación del sistema (por defecto 7:00 y 20:00) y un aviso cuando una tarea vence en menos de 24 horas.
- **Avisos en el celular** (Android o iPhone): los mismos recordatorios llegan a tu teléfono.

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

## Conectar la escuela (Moodle)

En **Conexiones** hay dos opciones:

1. **API oficial (recomendada).** Escribes tu usuario y contraseña en la app; se mandan directo a la escuela y solo se guarda el permiso (token) que devuelve, cifrado con el sistema operativo. Es la misma vía que usa la app móvil oficial de Moodle.
2. **Leer la página.** Si la escuela tiene apagada la opción 1, se abre su página real, inicias sesión como siempre y la app lee "Próximos eventos" en segundo plano con esa sesión.

## Seguridad

- Ninguna contraseña se guarda. Los tokens se cifran con DPAPI (Windows) o el Llavero (Mac).
- Todo se queda en tu PC, en la carpeta de datos de la app. No hay servidor.
- `credentials/` está en `.gitignore`; nunca subas ese archivo a GitHub.

## Próximas fases

- ~~**Fase 2:** asistente con Claude y Gemini; Google Sheets.~~ Listo.
- ~~**Fase 3:** avisos en el celular.~~ Listo.
- **Fase 3b:** app móvil que se sincronice con la de la PC (ver el tablero y preguntarle al asistente desde el celular).
- **Fase 4:** Canva y más integraciones.
