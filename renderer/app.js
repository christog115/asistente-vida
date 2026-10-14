const api = window.asistente;
const $ = (id) => document.getElementById(id);

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

function render(data) {
  const h = new Date().getHours();
  $('greeting').textContent = h < 12 ? 'Buenos días, Christopher' : h < 19 ? 'Buenas tardes, Christopher' : 'Buenas noches, Christopher';
  const school = data.school || [];
  const soon = school.filter((t) => dueClass(t.due) === 'soon').length;
  $('summary').textContent = `${school.length} tareas de la escuela · ${soon} vencen pronto · actualizado ${fmtDate(data.updatedAt)}`;

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
  renderList($('emails'), data.emails,
    (m) => item({ title: m.subject, meta: m.from, url: m.url }), 'Bandeja al día.');
  renderList($('files'), data.files,
    (f) => item({ title: f.name, meta: '', url: f.url }), 'Sin archivos recientes.');
}

async function renderStatus() {
  const s = await api.getStatus();
  $('google-status').textContent = STATUS_TEXT[s.google];
  $('moodle-status').textContent = STATUS_TEXT[s.moodle];
  $('moodle-url').value = s.moodleUrl;
  $('reminder-times').value = s.reminderTimes.join(', ');
  $('autostart').checked = s.autoStart;
}

async function run(fn, okText) {
  $('message').textContent = 'Trabajando…';
  try {
    const data = await fn();
    if (data && data.updatedAt) render(data);
    $('message').textContent = okText;
  } catch (err) {
    $('message').textContent = 'Error: ' + err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
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
$('moodle-browser').onclick = () => run(api.moodleConnectBrowser, 'Listo.');
$('moodle-disconnect').onclick = () => run(api.moodleDisconnect, 'Escuela desconectada.');
$('save-reminders').onclick = async () => {
  const times = $('reminder-times').value.split(',').map((x) => x.trim()).filter((x) => /^\d{2}:\d{2}$/.test(x));
  await api.setReminders(times);
  await api.setAutostart($('autostart').checked);
  $('message').textContent = 'Guardado.';
  renderStatus();
};

api.onData(render);
api.getData().then(render);
renderStatus();
