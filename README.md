# Asistente de Vida

App de escritorio (Windows y Mac) que vive en la bandeja del sistema y junta en un tablero:

- **Tareas de la escuela** de Google Classroom y de Moodle (ej. `tonala-virtual.ceti.mx`), ordenadas por fecha de entrega.
- **Calendario** de hoy y mañana, **pendientes** de Google Tasks, **correos sin leer** y **archivos recientes** de Drive.
- **Recordatorios diarios** como notificación del sistema (por defecto 7:00 y 20:00) y un aviso cuando una tarea vence en menos de 24 horas.

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
2. En **APIs y servicios → Biblioteca**, habilita: Gmail API, Google Calendar API, Google Tasks API, Google Drive API y Google Classroom API.
3. En **Pantalla de consentimiento de OAuth**, elige "Externo", llena el nombre y agrega tu correo como **usuario de prueba**.
4. En **Credenciales → Crear credenciales → ID de cliente de OAuth**, elige **App de escritorio**.
5. Descarga el JSON y guárdalo como `credentials/google-credentials.json` dentro de esta carpeta.
6. Abre la app → **Conexiones → Conectar con Google** y acepta los permisos en tu navegador.

Si tu Classroom es de una cuenta de la escuela, conéctate con esa cuenta (o agrégala como usuario de prueba).

## Conectar la escuela (Moodle)

En **Conexiones** hay dos opciones:

1. **API oficial (recomendada).** Escribes tu usuario y contraseña en la app; se mandan directo a la escuela y solo se guarda el permiso (token) que devuelve, cifrado con el sistema operativo. Es la misma vía que usa la app móvil oficial de Moodle.
2. **Leer la página.** Si la escuela tiene apagada la opción 1, se abre su página real, inicias sesión como siempre y la app lee "Próximos eventos" en segundo plano con esa sesión.

## Seguridad

- Ninguna contraseña se guarda. Los tokens se cifran con DPAPI (Windows) o el Llavero (Mac).
- Todo se queda en tu PC, en la carpeta de datos de la app. No hay servidor.
- `credentials/` está en `.gitignore`; nunca subas ese archivo a GitHub.

## Próximas fases

- **Fase 2:** asistente con Claude (resumen de la mañana y preguntas en lenguaje natural) y Gemini; Google Sheets.
- **Fase 3:** notificaciones en el celular (Android ahora, iPhone después) y luego una app móvil sincronizada.
- **Fase 4:** Canva y más integraciones.
