const api = window.asistente;
const $ = (id) => document.getElementById(id);
// El aviso se muestra en Conexiones y también en el tablero (para acciones como "Guardar en Drive").
let boardTimer = null;
const msg = {
  set textContent(t) {
    $('message').textContent = t;
    $('board-message').textContent = t;
    clearTimeout(boardTimer);
    if (t && !/…$/.test(t)) boardTimer = setTimeout(() => { $('board-message').textContent = ''; }, 8000);
  }
};

const STATUS_TEXT = {
  conectado: 'Conectado',
  desconectado: 'Sin conectar',
  'sin-credenciales': 'Falta el archivo de credenciales (ver README)'
};

function fmtDate(iso, allDay) {
  const d = new Date(iso);
  const opts = allDay ? { weekday: 'short', day: 'numeric', month: 'short' }
    : { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
  return d.toLocaleString('es-MX', opts);
}

function dueClass(iso) {
  if (!iso) return '';
  const left = new Date(iso) - Date.now();
  if (left < 0) return 'overdue';
  if (left < 2 * 24 * 3600 * 1000) return 'soon';
  return '';
}

function renderList(el, items, row, empty) {
  el.replaceChildren();
  if (items && items.error) {
    el.append(li('No se pudo cargar: ' + items.error, 'muted'));
    return;
  }
  if (!items) {
    el.append(li('Conecta esta fuente en "Conexiones".', 'muted'));
    return;
  }
  if (!items.length) {
    el.append(li(empty, 'muted'));
    return;
  }
  for (const it of items) el.append(row(it));
}

function li(text, cls) {
  const e = document.createElement('li');
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function item({ title, meta, url, cls }) {
  const e = document.createElement('li');
  if (cls) e.className = cls;
  const a = document.createElement(url ? 'a' : 'span');
  a.textContent = title;
  if (url) { a.href = url; a.target = '_blank'; }
  const m = document.createElement('small');
  m.textContent = meta;
  e.append(a, m);
  return e;
}

let fresh = false;
function render(data) {
  // La copia guardada nunca reemplaza datos nuevos que ya hayan llegado.
  if (data.cached && fresh) return;
  if (!data.cached) fresh = true;
  const h = new Date().getHours();
  const name = data.userName || 'Christopher';
  $('greeting').textContent = (h < 12 ? 'Buenos días, ' : h < 19 ? 'Buenas tardes, ' : 'Buenas noches, ') + name;
  document.body.dataset.perfil = data.profile || 'personal';
  const school = data.school || [];
  const soon = school.filter((t) => dueClass(t.due) === 'soon').length;
  const updated = data.cached ? `guardado el ${fmtDate(data.updatedAt)}, actualizando…` : `actualizado ${fmtDate(data.updatedAt)}`;
  if (data.profile === 'contador') {
    const open = (data.fiscal || []).filter((f) => !f.done);
    const late = open.filter((f) => new Date(f.due) < Date.now()).length;
    const week = open.filter((f) => new Date(f.due) >= Date.now() && new Date(f.due) - Date.now() < 7 * 24 * 3600 * 1000).length;
    $('summary').textContent = `${late ? late + ' vencidas sin marcar · ' : ''}${week} vencen en 7 días · ${(data.clients || []).length} clientes · ${updated}`;
    renderWork(data);
  } else {
    $('summary').textContent = `${school.length} tareas de la escuela · ${soon} vencen pronto · ${updated}`;
  }

  const schoolErr = [data.errors?.classroom, data.errors?.moodle].filter(Boolean).join(' · ');
  renderList($('school'), schoolErr && !school.length ? { error: schoolErr } : school,
    (t) => item({
      title: t.title,
      meta: `${t.source} · ${t.course || ''} · ${t.due ? 'entrega ' + fmtDate(t.due) : (t.dueText || 'sin fecha')}`,
      url: t.url, cls: dueClass(t.due)
    }), 'Sin tareas pendientes 🎉');

  renderList($('events'), data.events,
    (e) => item({ title: e.title, meta: fmtDate(e.start, e.allDay), url: e.url }), 'Nada en el calendario.');
  renderList($('tasks'), data.tasks,
    (t) => item({ title: t.title, meta: t.list + (t.due ? ' · ' + fmtDate(t.due, true) : ''), cls: dueClass(t.due) }),
    'Sin pendientes.');
  const b = data.briefing;
  $('briefing').textContent = b && b.date === new Date().toDateString()
    ? b.text
    : 'Conecta Claude, Gemini u OpenJarvis en "Conexiones" y aquí verás tu resumen cada mañana.';
  renderList($('sheet'), data.sheet,
    (t) => item({ title: t.title, meta: t.due ? 'para ' + t.due : 'sin fecha', url: t.url }),
    'Todo hecho en tu hoja.');
  renderList($('emails'), data.emails,
    (m) => item({ title: m.subject, meta: m.from, url: m.url }), 'Bandeja al día.');
  renderList($('files'), data.files,
    (f) => item({ title: f.name, meta: '', url: f.url }), 'Sin archivos recientes.');
  renderList($('designs'), data.designs || (data.errors?.canva ? { error: data.errors.canva } : null),
    (d) => item({ title: d.title, meta: d.updatedAt ? 'editado ' + fmtDate(d.updatedAt) : '', url: d.url }),
    'Aún no tienes diseños.');
  const wx = data.weather;
  $('weather-now').textContent = wx && !wx.error ? `Ahora en ${wx.place}: ${wx.desc}, ${wx.temp}° (máx ${wx.max}°, mín ${wx.min}°, lluvia ${wx.rain}%).` : '';
  const nt = data.notion;
  $('notion-card').classList.toggle('hidden', !nt);
  renderList($('notion-recent'), nt && nt.error ? { error: nt.error } : nt,
    (p) => item({ title: p.title, meta: p.edited ? 'editado ' + fmtDate(p.edited) : '', url: p.url }), 'Sin páginas compartidas con la integración.');
  const sp = data.spotify;
  $('spotify-now').textContent = sp && !sp.error
    ? (sp.nowPlaying ? `Suena ahora: ${sp.nowPlaying.title} · ${sp.nowPlaying.artist}` : 'Nada suena ahora.')
    : '';
  renderList($('spotify-recent'), sp && !sp.error ? sp.recent : (sp ? { error: sp.error } : (data.errors?.spotify ? { error: data.errors.spotify } : null)),
    (t) => item({ title: t.title, meta: t.artist + ' · ' + fmtDate(t.playedAt), url: t.url }), 'Sin canciones recientes.');
}

// --- Perfil Contador ---
const money = (n, cur) => (n == null ? '' : Number(n).toLocaleString('es-MX', { style: 'currency', currency: /^[A-Z]{3}$/.test(cur || '') ? cur : 'MXN' }));

function button(text, onclick, ghost = true) {
  const b = document.createElement('button');
  b.textContent = text;
  if (ghost) b.className = 'ghost';
  b.onclick = onclick;
  return b;
}

function actionRow({ title, meta, url, cls }, buttons) {
  const e = li('', 'devices-row' + (cls ? ' ' + cls : ''));
  const main = item({ title, meta, url });
  main.className = 'row-main';
  const box = document.createElement('div');
  box.className = 'row-actions';
  box.append(...buttons);
  e.append(main, box);
  return e;
}

function renderWork(data) {
  const clientsList = data.clients || [];
  // En pantalla: lo atrasado y lo del próximo mes (el asistente ve hasta 60 días).
  const fiscalShown = Array.isArray(data.fiscal) ? data.fiscal.filter((f) => new Date(f.due) - Date.now() < 31 * 24 * 3600 * 1000) : data.fiscal;
  renderList($('fiscal'), clientsList.length ? fiscalShown : [],
    (f) => actionRow({
      title: f.title,
      meta: `${f.client} · límite ${fmtDate(f.due, true)}${f.done ? ' · presentada' : ''}`,
      cls: f.done ? 'done' : dueClass(f.due)
    }, [button(f.done ? 'Desmarcar' : 'Presentada', () => run(() => api.fiscalToggle(f.id), f.done ? 'Desmarcada.' : 'Marcada como presentada.'))]),
    clientsList.length ? 'Nada vence en los próximos 30 días.' : 'Agrega tus clientes en Conexiones → Clientes.');

  const box = $('client-pending');
  box.replaceChildren();
  if (!clientsList.length) box.append(li('Sin clientes todavía.', 'muted'));
  for (const c of clientsList) {
    const block = document.createElement('li');
    block.className = 'client-block';
    const head = document.createElement('strong');
    head.textContent = c.name;
    const ul = document.createElement('ul');
    for (const p of c.pending || []) {
      const row = document.createElement('li');
      const t = document.createElement('span');
      t.textContent = p.text;
      row.append(t, button('Listo', () => run(() => api.clientPendingDone(c.id, p.id), 'Quitado de pendientes.')));
      ul.append(row);
    }
    if (!(c.pending || []).length) ul.append(li('Nada pendiente.', 'muted'));
    block.append(head, ul);
    box.append(block);
  }
  const sel = $('pending-client');
  const keep = sel.value;
  sel.replaceChildren(...clientsList.map((c) => new Option(c.name, c.id)));
  if (keep) sel.value = keep;
  $('pending-form').classList.toggle('hidden', !clientsList.length);

  const inv = data.invoices || (data.errors?.cfdi ? { error: data.errors.cfdi } : null);
  renderList($('invoices'), inv,
    (x) => actionRow({
      title: `${x.emisor.nombre || x.emisor.rfc} → ${x.receptor.nombre || x.receptor.rfc}`,
      meta: [x.fecha ? fmtDate(x.fecha, true) : '', x.tipo, money(x.total, x.moneda), x.client ? `cliente: ${x.client} (${x.direccion})` : 'sin cliente'].filter(Boolean).join(' · '),
      url: x.url
    }, [x.savedUrl ? Object.assign(document.createElement('a'), { href: x.savedUrl, target: '_blank', textContent: 'En Drive' })
      : button('Guardar en Drive', () => run(() => api.cfdiSave(x.key), 'Factura guardada en Drive.'))]),
    'No llegaron facturas en los últimos 60 días.');
  $('cfdi-save-all').classList.toggle('hidden', !(Array.isArray(inv) && inv.some((x) => x.clientId && !x.savedUrl)));
}

$('pending-form').onsubmit = (e) => {
  e.preventDefault();
  const text = $('pending-text').value;
  run(async () => { const d = await api.clientPendingAdd($('pending-client').value, text); $('pending-text').value = ''; return d; }, 'Anotado.');
};
$('cfdi-save-all').onclick = async () => {
  msg.textContent = 'Guardando en Drive…';
  try {
    const n = await api.cfdiSaveAll();
    msg.textContent = `Listo: ${n} factura${n === 1 ? '' : 's'} guardada${n === 1 ? '' : 's'} en Drive.`;
  } catch (err) {
    msg.textContent = 'Error: ' + cleanError(err);
  }
};

let obligationDefaults = {};
function renderObligationChecks(labels) {
  const box = $('client-obligations');
  if (box.childElementCount) return;
  for (const [k, label] of Object.entries(labels)) {
    const l = document.createElement('label');
    l.className = 'row';
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.value = k;
    l.append(c, ' ' + label);
    box.append(l);
  }
  applyDefaults();
}
function applyDefaults() {
  const on = obligationDefaults[$('client-regimen').value] || [];
  $('client-obligations').querySelectorAll('input').forEach((c) => { c.checked = on.includes(c.value); });
}
$('client-regimen').onchange = applyDefaults;

function renderClients(list, labels) {
  const ul = $('clients');
  ul.replaceChildren();
  if (!list.length) ul.append(li('Sin clientes.', 'muted'));
  const REG = { moral: 'persona moral', fisica: 'persona física', resico: 'RESICO' };
  for (const c of list) {
    ul.append(actionRow({
      title: c.name,
      meta: [c.rfc, REG[c.regimen], (c.obligations || []).map((o) => labels[o] || o).join(', ')].filter(Boolean).join(' · ')
    }, [
      button('Editar', () => {
        $('client-name').value = c.name;
        $('client-rfc').value = c.rfc || '';
        $('client-regimen').value = c.regimen;
        $('client-obligations').querySelectorAll('input').forEach((x) => { x.checked = (c.obligations || []).includes(x.value); });
        $('client-name').focus();
      }),
      button('Quitar', () => { if (confirm(`¿Quitar a ${c.name}?`)) run(() => api.clientsRemove(c.id), 'Cliente quitado.'); })
    ]));
  }
}

$('client-form').onsubmit = (e) => {
  e.preventDefault();
  const c = {
    name: $('client-name').value, rfc: $('client-rfc').value, regimen: $('client-regimen').value,
    obligations: [...$('client-obligations').querySelectorAll('input:checked')].map((x) => x.value)
  };
  run(async () => {
    const d = await api.clientsSave(c);
    $('client-name').value = ''; $('client-rfc').value = '';
    applyDefaults();
    return d;
  }, 'Cliente guardado.');
};

$('profile-form').onsubmit = (e) => {
  e.preventDefault();
  run(() => api.profileSet($('profile').value, $('user-name').value), 'Perfil guardado.');
};

async function renderStatus() {
  const s = await api.getStatus();
  document.body.dataset.perfil = s.profile;
  if (document.activeElement !== $('user-name')) $('user-name').value = s.userName;
  $('profile').value = s.profile;
  obligationDefaults = s.obligationDefaults;
  renderObligationChecks(s.obligations);
  renderClients(s.clients, s.obligations);
  $('google-status').textContent = STATUS_TEXT[s.google];
  $('moodle-status').textContent = STATUS_TEXT[s.moodle];
  $('notion-status').textContent = STATUS_TEXT[s.notion];
  $('notion-disconnect').classList.toggle('hidden', s.notion !== 'conectado');
  $('canva-status').textContent = s.canva === 'sin-credenciales' ? 'Faltan las claves de Canva' : STATUS_TEXT[s.canva];
  $('canva-connect').classList.toggle('hidden', s.canva !== 'desconectado');
  $('canva-disconnect').classList.toggle('hidden', s.canva === 'sin-credenciales');
  $('spotify-status').textContent = s.spotify === 'sin-credenciales' ? 'Falta el Client ID de Spotify' : STATUS_TEXT[s.spotify];
  $('spotify-connect').classList.toggle('hidden', s.spotify !== 'desconectado');
  $('spotify-disconnect').classList.toggle('hidden', s.spotify === 'sin-credenciales');
  renderWhatsapp(s.whatsapp);
  renderUpdate(s.update);
  renderAlarms(s.alarms); renderPlaces(s.places || []); renderStudy(s.study);
  renderApps(s.apps);
  $('moodle-url').value = s.moodleUrl;
  $('reminder-times').value = s.reminderTimes.join(', ');
  $('autostart').checked = s.autoStart;
  $('morning-speech').checked = s.morningSpeech;
  $('sheet-url').value = s.sheetUrl;
  renderMobile(s.mobile);
  hasPhoneTopic = s.phone.hasTopic;
  $('phone-status').textContent = s.phone.enabled ? 'Conectado' : s.phone.hasTopic ? 'Pausado' : 'Sin conectar';
  if (!s.phone.hasTopic) $('phone-qr').classList.add('hidden');
  $('claude-status').textContent = STATUS_TEXT[s.ai.claude];
  $('gemini-status').textContent = STATUS_TEXT[s.ai.gemini];
  $('openjarvis-status').textContent = s.ai.openjarvis === 'conectado' ? 'Configurado' : 'Sin configurar';
  if (document.activeElement !== $('openjarvis-url')) $('openjarvis-url').value = s.ai.openjarvisUrl;
  if (document.activeElement !== $('openjarvis-model')) $('openjarvis-model').value = s.ai.openjarvisModel;
  $('openjarvis-offline').checked = s.ai.openjarvisOffline;
  document.querySelectorAll('input[name=provider]').forEach((r) => { r.checked = r.value === s.ai.provider; });
}

// --- Chat con el asistente ---
const chatHistory = [];

function addMsg(role, text) {
  const e = document.createElement('div');
  e.className = 'msg ' + role;
  e.textContent = text;
  $('chat-log').append(e);
  e.scrollIntoView({ block: 'end' });
  return e;
}

function cleanError(err) {
  return err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

$('chat-form').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('chat-input').value.trim();
  if (!text) return;
  $('chat-input').value = '';
  addMsg('user', text);
  chatHistory.push({ role: 'user', content: text });
  const pending = addMsg('assistant', 'Pensando…');
  try {
    const answer = await api.aiChat(chatHistory);
    pending.textContent = answer;
    chatHistory.push({ role: 'assistant', content: answer });
  } catch (err) {
    pending.textContent = 'Error: ' + cleanError(err);
    chatHistory.pop();
  }
};

$('new-briefing').onclick = async () => {
  const pending = addMsg('assistant', 'Armando tu resumen…');
  try {
    const data = await api.aiBriefing();
    pending.textContent = data.briefing.text;
    render(data);
  } catch (err) {
    pending.textContent = 'Error: ' + cleanError(err);
  }
};

let hasPhoneTopic = false;
let mobileEnabled = false;
let pairTimer = null;

function renderMobile(m) {
  mobileEnabled = m.enabled;
  $('mobile-status').textContent = !m.enabled ? 'Apagado' : m.running ? 'Listo para emparejar' : 'Iniciando…';
  $('mobile-error').textContent = m.error || '';
  $('mobile-toggle').textContent = m.enabled ? 'Apagar' : 'Activar';
  $('mobile-toggle').classList.toggle('ghost', m.enabled);
  $('mobile-pair').classList.toggle('hidden', !m.enabled);
  const addr = $('mobile-addresses');
  addr.classList.toggle('hidden', !m.enabled || !m.addresses.length);
  addr.textContent = 'Direcciones de esta PC: ' + m.addresses.map((a) => a.url + (a.tailscale ? ' (Tailscale)' : '')).join(' · ');
  if (!m.enabled || !m.pairing) $('mobile-pairing').classList.add('hidden');
  document.querySelector('.mobile-devices-title').classList.toggle('hidden', !m.devices.length);
  const list = $('mobile-devices');
  list.replaceChildren();
  for (const d of m.devices) {
    const e = li('', 'devices-row');
    const name = document.createElement('span');
    name.textContent = d.name + (d.lastSeen ? ' · visto ' + fmtDate(d.lastSeen) : ' · aún sin usar');
    const del = document.createElement('button');
    del.className = 'ghost';
    del.textContent = 'Quitar';
    del.onclick = () => run(() => api.mobileRevoke(d.id), 'Celular quitado.');
    e.append(name, del);
    list.append(e);
  }
  // Mientras hay un código vigente se revisa seguido para ver cuándo se empareja.
  if (m.pairing && !pairTimer) pairTimer = setInterval(renderStatus, 3000);
  if (!m.pairing && pairTimer) { clearInterval(pairTimer); pairTimer = null; }
}

$('mobile-toggle').onclick = () => run(() => api.mobileSetEnabled(!mobileEnabled), 'Listo.');
$('mobile-pair').onclick = () => run(async () => {
  const p = await api.mobileStartPairing();
  $('mobile-code').textContent = p.code;
  $('mobile-urls').textContent = 'Dirección: ' + (p.urls.join(' o ') || 'sin red');
  $('mobile-qr-img').src = p.image;
  $('mobile-pairing').classList.remove('hidden');
}, 'Abre la app del celular y empareja.');

function showQr(qr) {
  if (!qr) return;
  $('phone-topic').textContent = qr.topic;
  $('phone-qr-img').src = qr.image;
  $('phone-qr').classList.remove('hidden');
}
// Si ya hay un tema, se vuelve a mostrar el mismo código; uno nuevo se crea tras Desconectar.
$('phone-create').onclick = () => run(async () => {
  showQr(await (hasPhoneTopic ? api.phoneQr() : api.phoneCreate()));
}, 'Escribe el nombre del tema en la app ntfy.');
$('phone-copy').onclick = async () => {
  await navigator.clipboard.writeText($('phone-topic').textContent);
  msg.textContent = 'Nombre copiado.';
};
$('phone-test').onclick = () => run(() => api.phoneTest(), 'Prueba enviada: revisa tu celular.');
$('phone-disable').onclick = () => run(() => api.phoneDisable(), 'Celular desconectado.');

$('sheet-url').onchange = (e) => run(() => api.setSheetUrl(e.target.value.trim()), 'Hoja guardada.');
document.querySelectorAll('input[name=provider]').forEach((r) => {
  r.onchange = () => run(() => api.aiSetProvider(r.value), 'Asistente: ' + ({ gemini: 'Gemini', openjarvis: 'OpenJarvis' }[r.value] || 'Claude'));
});
$('openjarvis-form').onsubmit = (e) => {
  e.preventDefault();
  const key = $('openjarvis-key').value;
  $('openjarvis-key').value = '';
  run(async () => {
    const s = await api.openJarvisSet({ url: $('openjarvis-url').value, model: $('openjarvis-model').value, key });
    $('openjarvis-status').textContent = 'Configurado';
    $('openjarvis-url').value = s.openjarvisUrl;
  }, 'OpenJarvis guardado. Usa "Probar" para revisar que conteste.');
};
$('openjarvis-test').onclick = async () => {
  $('message').textContent = 'Probando OpenJarvis… (la primera vez puede tardar)';
  try {
    const r = await api.openJarvisTest();
    $('message').textContent = `OpenJarvis contestó con ${r.model}: "${r.reply}"`;
  } catch (err) {
    $('message').textContent = 'Error: ' + cleanError(err);
  }
};
$('openjarvis-offline').onchange = (e) => run(() => api.openJarvisSet({ offline: e.target.checked }),
  e.target.checked ? 'Sin internet contestará OpenJarvis.' : 'Sin internet ya no se usará OpenJarvis.');
for (const which of ['claude', 'gemini']) {
  $(which + '-form').onsubmit = (e) => {
    e.preventDefault();
    const key = $(which + '-key').value;
    $(which + '-key').value = '';
    run(() => api.aiSetKey(which, key), 'Clave guardada.');
  };
}

async function run(fn, okText) {
  msg.textContent = 'Trabajando…';
  try {
    const data = await fn();
    if (data && data.updatedAt) render(data);
    msg.textContent = okText;
  } catch (err) {
    msg.textContent = 'Error: ' + cleanError(err);
  }
  renderStatus();
}

document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== b.dataset.view));
}));

$('refresh').onclick = () => run(api.refresh, 'Actualizado.');
$('google-connect').onclick = () => run(api.googleConnect, 'Google conectado.');
$('google-disconnect').onclick = () => run(api.googleDisconnect, 'Google desconectado.');
$('moodle-url').onchange = (e) => api.moodleSetUrl(e.target.value);
$('moodle-form').onsubmit = (e) => {
  e.preventDefault();
  const user = $('moodle-user').value;
  const pass = $('moodle-pass').value;
  $('moodle-pass').value = '';
  run(() => api.moodleConnectPassword(user, pass), 'Escuela conectada.');
};
$('canva-form').onsubmit = (e) => {
  e.preventDefault();
  const id = $('canva-id').value;
  const secret = $('canva-secret').value;
  $('canva-secret').value = '';
  run(() => api.canvaSetApp(id, secret), 'Claves guardadas. Ahora toca "Conectar con Canva".');
};
$('notion-form').onsubmit = (e) => {
  e.preventDefault();
  const token = $('notion-token').value;
  $('notion-token').value = '';
  run(() => api.notionConnect(token, $('notion-db').value), 'Notion conectado.');
};
$('notion-disconnect').onclick = () => run(api.notionDisconnect, 'Notion desconectado.');
$('canva-connect').onclick = () => run(api.canvaConnect, 'Canva conectado.');
$('canva-disconnect').onclick = () => run(api.canvaDisconnect, 'Canva desconectado.');
$('spotify-form').onsubmit = (e) => {
  e.preventDefault();
  run(() => api.spotifySetApp($('spotify-id').value), 'Client ID guardado. Ahora toca "Conectar con Spotify".');
};
$('spotify-connect').onclick = () => run(api.spotifyConnect, 'Spotify conectado.');
$('spotify-disconnect').onclick = () => run(api.spotifyDisconnect, 'Spotify desconectado.');
$('whatsapp-form').onsubmit = (e) => {
  e.preventDefault();
  const cfg = { token: $('wa-token').value, phoneId: $('wa-phone-id').value, to: $('wa-to').value };
  $('wa-token').value = '';
  run(async () => { await api.whatsappSave(cfg); }, 'WhatsApp guardado. Toca "Enviar prueba".');
};
$('whatsapp-test').onclick = () => run(() => api.whatsappTest(), 'Prueba enviada: revisa tu WhatsApp.');
$('wa-test').onclick = () => run(() => api.whatsappTest(), 'Prueba enviada: revisa tu chat "Tú" en WhatsApp.');

// WhatsApp vinculado: el QR se renueva solo; se consulta cada 2 s mientras no esté listo.
let waTimer = null;
function renderWhatsapp(w) {
  const l = w.linked;
  const open = l.state === 'open';
  $('whatsapp-status').textContent = open ? 'Conectado (número vinculado)'
    : l.state === 'qr' ? 'Esperando que escanees el código'
    : l.state === 'connecting' ? (l.number ? 'Reconectando…' : 'Conectando…')
    : { conectado: 'Conectado (API oficial)', pausado: 'Pausado', desconectado: 'Sin conectar' }[w.cloud];
  $('wa-cloud-status').textContent = { conectado: 'Conectado', pausado: 'Pausado', desconectado: 'Sin conectar' }[w.cloud];
  $('wa-link').classList.toggle('hidden', open || l.state === 'qr');
  $('wa-qr').classList.toggle('hidden', l.state !== 'qr');
  if (l.qr) $('wa-qr-img').src = l.qr;
  $('wa-link-note').textContent = l.error || '';
  $('wa-tools').classList.toggle('hidden', !open);
  $('wa-number').textContent = l.number ? '+' + l.number : '';
  $('wa-ip').checked = !!w.locationIp;
  renderWaContacts(w.contacts || []);
  $('wa-remote').checked = w.remote !== false;
  clearTimeout(waTimer);
  if (l.state === 'qr' || (l.state === 'connecting' && !l.number)) waTimer = setTimeout(pollWhatsapp, 2000);
}
async function pollWhatsapp() {
  try { renderWhatsapp({ ...(await api.getStatus()).whatsapp }); } catch {}
}
$('wa-link').onclick = async () => {
  try { await api.whatsappLinkStart(); } catch (err) { msg.textContent = 'Error: ' + cleanError(err); }
  pollWhatsapp();
};
$('wa-link-cancel').onclick = async () => { await api.whatsappLinkCancel(); pollWhatsapp(); };
$('wa-unlink').onclick = async () => {
  if (!confirm('¿Desvincular tu WhatsApp de esta app? Dejarás de recibir avisos y no podrás mandar archivos hasta vincular otra vez.')) return;
  await run(() => api.whatsappUnlink(), 'WhatsApp desvinculado.');
};
$('wa-send-file').onclick = async () => {
  msg.textContent = 'Eligiendo archivo…';
  try {
    const name = await api.whatsappSendFile();
    msg.textContent = name ? `Te mandé "${name}" a tu WhatsApp.` : 'Cancelado.';
  } catch (err) { msg.textContent = 'Error: ' + cleanError(err); }
};
$('wa-send-location').onclick = async () => {
  msg.textContent = 'Buscando la ubicación de la PC…';
  try { await api.whatsappSendLocation(); msg.textContent = 'Te mandé la ubicación de tu PC.'; } catch (err) { msg.textContent = 'Error: ' + cleanError(err); }
};
function renderWaContacts(list) {
  const ul = $('wa-contacts');
  ul.replaceChildren();
  if (!list.length) ul.append(li('Sin contactos guardados.', 'muted'));
  for (const c of list) {
    const row = li('', 'devices-row');
    row.append(Object.assign(document.createElement('span'), { textContent: `${c.name} · +${c.number}` }));
    const btns = document.createElement('span');
    btns.className = 'pv-row';
    btns.append(
      button('Mandar mi ubicación', async () => {
        if (!confirm(`¿Mandarle a ${c.name} la ubicación actual de tu PC? Se envía un solo pin.`)) return;
        msg.textContent = 'Buscando la ubicación de la PC…';
        try { await api.whatsappSendLocationTo(c.name); msg.textContent = `Le mandé a ${c.name} la ubicación de tu PC.`; } catch (err) { msg.textContent = 'Error: ' + cleanError(err); }
      }, false),
      button('Quitar', () => run(() => api.whatsappContactRemove(c.name), 'Contacto quitado.'))
    );
    row.append(btns);
    ul.append(row);
  }
}
$('wa-contact-form').onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    await api.whatsappContactAdd($('wa-contact-name').value, $('wa-contact-number').value);
    $('wa-contact-name').value = '';
    $('wa-contact-number').value = '';
  }, 'Contacto guardado.');
};
$('wa-remote').onchange = (e) => api.whatsappRemoteSet(e.target.checked);
$('wa-ip').onchange = (e) => api.whatsappLocationIp(e.target.checked);
$('whatsapp-disconnect').onclick = () => run(() => api.whatsappDisconnect(), 'WhatsApp desconectado.');
function describeRepeat(ms) {
  const min = Math.round(ms / 60000);
  return min % 60 === 0 ? `cada ${min / 60 === 1 ? 'hora' : min / 60 + ' horas'}` : `cada ${min} minutos`;
}
function renderStudy(st) {
  $('study-state').textContent = st && st.active
    ? `Activo: quedan ${st.minutesLeft} min${st.music ? ' · con música' : ''}.`
    : 'Apagado.';
  $('study-start').classList.toggle('hidden', !!(st && st.active));
  $('study-stop').classList.toggle('hidden', !(st && st.active));
}
$('study-start').onclick = () => run(() => api.studyStart(Number($('study-minutes').value)), 'Modo estudio activado.');
$('study-stop').onclick = () => run(api.studyStop, 'Modo estudio terminado.');
function renderPlaces(list) {
  const ul = $('places');
  ul.replaceChildren();
  if (!list.length) ul.append(li('Sin lugares guardados.', 'muted'));
  for (const p of list) {
    const row = li('', 'devices-row');
    const label = document.createElement('span');
    label.textContent = `${p.name} · ${p.label}`;
    const del = document.createElement('button');
    del.className = 'ghost';
    del.textContent = 'Quitar';
    del.onclick = () => run(() => api.placeRemove(p.name), 'Lugar quitado.');
    row.append(label, del);
    ul.append(row);
  }
}
$('place-form').onsubmit = (e) => {
  e.preventDefault();
  run(() => api.placeSet($('place-name').value, $('place-address').value), 'Lugar guardado.');
};

function renderAlarms(list) {
  const ul = $('alarms');
  ul.replaceChildren();
  $('alarms-clear').classList.toggle('hidden', !list.length);
  if (!list.length) ul.append(li('Sin recordatorios.', 'muted'));
  for (const a of list) {
    const row = li('', 'devices-row');
    const label = document.createElement('span');
    label.textContent = `${a.text} · ${fmtDate(new Date(a.at).toISOString())}${a.every ? ' · ' + describeRepeat(a.every) : ''}`;
    const del = document.createElement('button');
    del.className = 'ghost';
    del.textContent = 'Borrar';
    del.onclick = () => run(() => api.alarmsRemove(a.id), 'Recordatorio borrado.');
    row.append(label, del);
    ul.append(row);
  }
}
$('alarms-clear').onclick = () => run(() => api.alarmsClear(), 'Recordatorios borrados.');

function renderApps(list) {
  const ul = $('apps');
  ul.replaceChildren();
  for (const a of list) {
    const row = li('', 'devices-row');
    const label = document.createElement('span');
    label.textContent = a.name + (a.custom ? ' · ' + a.target : '');
    row.append(label);
    if (a.custom) {
      const del = document.createElement('button');
      del.className = 'ghost';
      del.textContent = 'Quitar';
      del.onclick = () => run(() => api.appsRemove(a.name), 'Programa quitado.');
      row.append(del);
    }
    ul.append(row);
  }
}
$('apps-form').onsubmit = (e) => {
  e.preventDefault();
  const name = $('app-name').value;
  const target = $('app-target').value;
  run(async () => {
    await api.appsAdd(name, target);
    $('app-name').value = '';
    $('app-target').value = '';
  }, 'Programa agregado.');
};

const UPDATE_TEXT = {
  inactivo: 'sin revisar aún', buscando: 'buscando…', 'al-dia': 'estás al día',
  descargando: 'descargando la nueva…', lista: 'lista para instalar', error: 'no se pudo revisar',
  desarrollo: 'solo funciona en la app instalada'
};
function renderUpdate(u) {
  $('auto-update').checked = u.enabled;
  $('update-version').textContent = u.current;
  $('update-state').textContent = (UPDATE_TEXT[u.state] || u.state) + (u.version && u.state !== 'al-dia' ? ` (${u.version})` : '')
    + (u.error ? ': ' + u.error : '');
  $('update-install').classList.toggle('hidden', u.state !== 'lista');
  if (u.state === 'buscando' || u.state === 'descargando') setTimeout(renderStatus, 3000);
}
$('auto-update').onchange = (e) => run(() => api.updateSetEnabled(e.target.checked), 'Listo.');
$('update-check').onclick = async () => { await api.updateCheck(); setTimeout(renderStatus, 1500); };
$('backup-export').onclick = async () => {
  try {
    const file = await api.backupExport($('backup-password').value);
    msg.textContent = file ? 'Copia guardada en ' + file : 'Cancelado.';
  } catch (err) {
    msg.textContent = 'Error: ' + cleanError(err);
  }
};
$('backup-import').onclick = async () => {
  if (!confirm('Restaurar reemplaza la configuración actual con la de la copia. ¿Continuar?')) return;
  try {
    const data = await api.backupImport($('backup-password').value);
    msg.textContent = data ? 'Copia restaurada.' : 'Cancelado.';
    renderStatus();
  } catch (err) {
    msg.textContent = 'Error: ' + cleanError(err);
  }
};
$('update-install').onclick = () => api.updateInstall();
$('moodle-browser').onclick = () => run(api.moodleConnectBrowser, 'Listo.');
$('moodle-disconnect').onclick = () => run(api.moodleDisconnect, 'Escuela desconectada.');
$('save-reminders').onclick = async () => {
  const times = $('reminder-times').value.split(',').map((x) => x.trim()).filter((x) => /^\d{2}:\d{2}$/.test(x));
  await api.setReminders(times);
  await api.setAutostart($('autostart').checked);
  await api.setMorningSpeech($('morning-speech').checked);
  msg.textContent = 'Guardado.';
  renderStatus();
};

// Mientras llegan los primeros datos cada tarjeta dice "Cargando…" (y no "Conecta esta fuente").
for (const id of ['school', 'events', 'tasks', 'sheet', 'emails', 'files', 'designs', 'spotify-recent', 'notion-recent']) {
  $(id).replaceChildren(li('Cargando…', 'muted loading'));
}
api.onData(render);
api.getData().then(render);
renderStatus();
