// Pestaña Productividad: lo de hoy, el tablero semanal, el reporte con IA y los ajustes.
(() => {
  const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const CAT_NAME = { trabajo: 'Trabajo', entretenimiento: 'Entretenimiento', escuela: 'Escuela', neutral: 'No cuenta', otro: 'Sin clasificar' };
  const KIND_NAME = { investigacion: 'Investigación', produccion: 'Producción' };
  let week = null; // lunes de la semana que se está viendo (null = la actual)
  let visible = false;

  const say = (t) => { $('pv-message').textContent = t; msg.textContent = t; };
  const fmt = (m) => {
    m = Math.round(m || 0);
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`;
  };
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const dateLabel = (key, opts = { day: 'numeric', month: 'short' }) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-MX', opts);
  };
  async function go(fn, ok) {
    try {
      const r = await fn();
      if (ok) say(ok);
      return r;
    } catch (err) {
      say('Error: ' + cleanError(err));
      return null;
    }
  }

  // ---------- Hoy ----------
  async function renderToday() {
    const t = await api.focusToday();
    const done = t.work >= t.goal;
    $('pv-today-text').textContent = done
      ? `Meta cumplida: ${fmt(t.work)} de ${fmt(t.goal)}.`
      : `Llevas ${fmt(t.work)} de ${fmt(t.goal)}. Te faltan ${fmt(t.remaining)}.`;
    $('pv-today-fill').style.width = Math.min(100, t.goal ? (t.work / t.goal) * 100 : 100) + '%';
    $('pv-today-fill').classList.toggle('done', done);
    const parts = [`Entretenimiento ${fmt(t.fun)}`, `investigación ${fmt(t.research)}`, `producción ${fmt(t.production)}`];
    if (t.manual) parts.push(`papel ${fmt(t.manual)}`);
    if (t.school.active) parts.push(`escuela ${fmt(t.school.min)} de ${fmt(t.school.goalMin)}–${fmt(t.school.goalMaxMin)}`);
    if (!done) parts.push(`ventana forzada a las ${t.forceAt}`);
    $('pv-today-meta').textContent = parts.join(' · ');
    const c = t.current || {};
    const now = $('pv-now');
    now.className = 'pv-chip ' + (c.afk && (c.cat === 'trabajo' || c.cat === 'escuela') ? 'afk' : c.cat || '');
    now.textContent = c.locked ? 'Pantalla bloqueada'
      : c.afk && (c.cat === 'trabajo' || c.cat === 'escuela') ? `AFK en ${c.label} · reloj en pausa`
      : `Ahora: ${c.label || '—'} · ${CAT_NAME[c.cat] || ''}`;
    const sw = t.stopwatch;
    $('pv-sw-start').classList.toggle('hidden', !!sw);
    $('pv-sw-note').classList.toggle('hidden', !!sw);
    $('pv-sw-stop').classList.toggle('hidden', !sw);
    $('pv-sw-state').textContent = sw ? `Cronómetro corriendo: ${fmt(sw.min)}${sw.note ? ' · ' + sw.note : ''}` : '';
    $('pv-monitor').textContent = t.monitor.ok ? '' : `Detección de ventanas: ${t.monitor.error}. El cronómetro funciona igual.`;
  }

  // ---------- Semana ----------
  function kpi(label, value, sub, cls) {
    const k = el('div', 'pv-kpi' + (cls ? ' ' + cls : ''));
    k.append(el('small', null, label), el('strong', null, value));
    if (sub) k.append(el('span', 'muted', sub));
    return k;
  }
  function change(p, goodUp) {
    if (p == null) return 'sin datos de la semana pasada';
    if (p === 0) return 'igual que la semana pasada';
    const up = p > 0;
    return `${up ? '▲' : '▼'} ${Math.abs(p)}% contra la semana pasada${(up === goodUp) ? '' : ' (mal)'}`;
  }

  function renderDays(w) {
    const box = $('pv-days');
    box.replaceChildren();
    const max = Math.max(60, ...w.days.map((d) => Math.max(d.goal, d.work + d.fun + d.school)));
    for (const d of w.days) {
      const row = el('div', 'pv-day ' + d.state);
      const name = el('div', 'pv-day-name');
      name.append(el('strong', null, DAYS[new Date(d.date + 'T12:00').getDay()]), el('small', 'muted', dateLabel(d.date)));
      const bar = el('div', 'pv-bar');
      for (const [cat, v] of [['trabajo', d.work], ['escuela', d.school], ['entretenimiento', d.fun]]) {
        if (!v) continue;
        const f = el('div', 'pv-fill ' + cat);
        f.style.width = (v / max) * 100 + '%';
        f.title = `${CAT_NAME[cat]}: ${fmt(v)}`;
        bar.append(f);
      }
      const goal = el('div', 'pv-goal-mark');
      goal.style.left = (d.goal / max) * 100 + '%';
      goal.title = 'Meta: ' + fmt(d.goal);
      bar.append(goal);
      const icon = { cumplido: '✓', fallado: '✗', hoy: '…' }[d.state] || '';
      const info = el('div', 'pv-day-info');
      const text = d.state === 'futuro' ? `meta ${fmt(d.goal)}` : d.state === 'sin-datos' ? 'sin datos' : `${fmt(d.work)} / ${fmt(d.goal)}`;
      info.append(el('span', 'pv-state', icon), el('span', null, text));
      if (d.fun) info.append(el('small', 'muted', `jugando/viendo ${fmt(d.fun)}`));
      if (d.forced && d.forced.shown) info.append(el('small', 'pv-warn', `forzado ${d.forced.shown}×`));
      row.append(name, bar, info);
      box.append(row);
    }
  }

  function renderTop(id, list, empty) {
    const ul = $(id);
    ul.replaceChildren();
    if (!list.length) { ul.append(li(empty, 'muted')); return; }
    const max = list[0].min || 1;
    for (const a of list) {
      const row = el('li', 'pv-top');
      const top = el('div', 'pv-top-line');
      top.append(el('span', null, a.label), el('small', null, fmt(a.min)));
      const bar = el('div', 'pv-bar pv-bar-thin');
      const f = el('div', 'pv-fill ' + (id.endsWith('trabajo') ? 'trabajo' : 'entretenimiento'));
      f.style.width = (a.min / max) * 100 + '%';
      bar.append(f);
      row.append(top, bar);
      ul.append(row);
    }
  }

  function renderUnknown(list) {
    const ul = $('pv-unknown');
    ul.replaceChildren();
    if (!list.length) { ul.append(li('Todo está clasificado.', 'muted')); return; }
    for (const a of list) {
      const row = li('', 'devices-row');
      row.append(el('span', null, `${a.label} · ${fmt(a.min)}`));
      const btns = el('span', 'pv-row');
      for (const [cat, kind, text] of [['trabajo', 'produccion', 'Trabajo'], ['entretenimiento', '', 'Entretenimiento'], ['neutral', '', 'No contar']]) {
        const b = button(text, () => go(() => api.focusQuickRule(a.label, cat, kind), `${a.label}: ${CAT_NAME[cat]}.`).then(() => { renderWeek(); renderRules(); }));
        btns.append(b);
      }
      row.append(btns);
      ul.append(row);
    }
  }

  // Texto del reporte (la IA puede usar **negritas** y viñetas); se arma sin HTML para no inyectar nada.
  function renderReportText(box, text) {
    box.replaceChildren();
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const p = el(/^#+\s/.test(line) ? 'h3' : 'p');
      const clean = line.replace(/^#+\s*/, '').replace(/^[-*•]\s+/, '• ');
      clean.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
        if (/^\*\*[^*]+\*\*$/.test(part)) p.append(el('strong', null, part.slice(2, -2)));
        else if (part) p.append(document.createTextNode(part.replace(/[*_`]/g, '')));
      });
      box.append(p);
    }
  }

  function weekOptions(w) {
    const sel = $('pv-week-pick');
    sel.replaceChildren();
    const first = w.firstDay ? mondayOf(w.firstDay) : w.current;
    let k = w.current;
    for (let i = 0; i < 104 && k >= first; i++) {
      const o = el('option', null, `${dateLabel(k)} – ${dateLabel(addDays(k, 6))}${k === w.current ? ' (esta)' : ''}`);
      o.value = k;
      if (k === w.from) o.selected = true;
      sel.append(o);
      k = addDays(k, -7);
    }
  }
  function addDays(key, n) {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  function mondayOf(key) {
    const [y, m, d] = key.split('-').map(Number);
    const dow = (new Date(y, m - 1, d).getDay() + 6) % 7;
    return addDays(key, -dow);
  }

  async function renderWeek() {
    const w = await api.focusWeek(week);
    const t = w.totals;
    const isCurrent = w.from === w.current;
    $('pv-week-title').textContent = `${isCurrent ? 'Esta semana' : 'Semana'} · ${dateLabel(w.from)} – ${dateLabel(w.to)}`;
    $('pv-next').disabled = isCurrent;
    $('pv-prev').disabled = !!w.firstDay && w.from <= w.firstDay;
    weekOptions(w);
    const k = $('pv-kpis');
    k.replaceChildren(
      kpi('Trabajo', fmt(t.work), `meta ${fmt(t.goal)} · ${change(w.change.work, true)}`, t.work >= t.goal && t.elapsed ? 'good' : ''),
      kpi('Entretenimiento', fmt(t.fun), change(w.change.fun, false), t.fun > t.work ? 'bad' : ''),
      kpi('Días cumplidos', `${t.met} de ${t.elapsed || 0}`, `semana pasada: ${w.previous.met} de 7`),
      kpi('Racha', w.streak ? `${w.streak.current} ${w.streak.current === 1 ? 'día' : 'días'}` : '—', w.streak ? `mejor: ${w.streak.best}` : ''),
      kpi('Trabajo por hora de diversión', w.ratio != null ? `${w.ratio} h` : '—', w.ratio != null && w.ratio < 1 ? 'juegas más de lo que trabajas' : ''),
      kpi('En papel', fmt(t.manual), t.afk ? `${t.afk} pausas por AFK` : '')
    );
    if (t.school || (w.top.escuela && w.top.escuela.length)) k.append(kpi('Escuela', fmt(t.school), ''));
    renderDays(w);
    renderTop('pv-top-trabajo', w.top.trabajo, 'Sin trabajo registrado esta semana.');
    renderTop('pv-top-entretenimiento', w.top.entretenimiento, 'Nada de entretenimiento registrado.');
    const kinds = t.research + t.production;
    $('pv-research').style.width = (kinds ? (t.research / kinds) * 100 : 0) + '%';
    $('pv-production').style.width = (kinds ? (t.production / kinds) * 100 : 0) + '%';
    $('pv-kinds').textContent = kinds
      ? `Investigación ${fmt(t.research)} (${Math.round((t.research / kinds) * 100)}%) · Producción ${fmt(t.production)} (${Math.round((t.production / kinds) * 100)}%)`
      : 'Todavía no hay trabajo esta semana.';
    const h = w.hours;
    $('pv-hours').textContent = [h.work != null ? `Trabajas más a las ${h.work}:00` : '', h.fun != null ? `te distraes más a las ${h.fun}:00` : ''].filter(Boolean).join(' · ');
    renderUnknown(w.unknown || []);
    const r = w.report;
    $('pv-report-meta').textContent = r
      ? `Generado el ${new Date(r.at).toLocaleString('es-MX', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}${r.byAi ? ' con IA' : ' sin IA'}.`
      : 'Se genera solo el domingo en la noche (puedes cambiar el día y la hora en ajustes).';
    renderReportText($('pv-report'), r ? r.text : '');
  }

  // ---------- Ajustes ----------
  async function renderSettings() {
    const s = await api.focusSettings();
    $('pv-why').value = s.why || '';
    const g = $('pv-goals');
    g.replaceChildren();
    for (const i of [1, 2, 3, 4, 5, 6, 0]) {
      const l = el('label', null, DAYS[i].slice(0, 3));
      const inp = el('input');
      inp.type = 'number'; inp.min = 0; inp.max = 960; inp.step = 5; inp.value = s.goals[i]; inp.dataset.day = i;
      l.append(inp);
      g.append(l);
    }
    $('pv-afk').value = s.afkMin;
    $('pv-nag-every').value = s.nagEveryMin;
    $('pv-nag').checked = s.nagEnabled;
    $('pv-nag-speak').checked = s.nagSpeak;
    $('pv-ai-phrases').checked = s.aiPhrases;
    $('pv-force').checked = s.forceEnabled;
    $('pv-force-from').value = s.forceFrom;
    $('pv-day-end').value = s.dayEnd;
    $('pv-day-start').value = s.dayStart;
    $('pv-snoozes').value = s.snoozesPerDay;
    $('pv-snooze-min').value = s.snoozeMin;
    const rd = $('pv-report-day');
    if (!rd.options.length) DAYS.forEach((d, i) => { const o = el('option', null, d); o.value = i; rd.append(o); });
    rd.value = s.reportDay;
    $('pv-report-time').value = s.reportTime;
    $('pv-school').checked = s.school.enabled;
    $('pv-school-start').value = s.school.startDate;
    $('pv-school-goal').value = s.school.goalMin;
    $('pv-enabled').checked = s.enabled;
    renderRules(s);
  }

  async function renderRules(s) {
    s = s || await api.focusSettings();
    const box = $('pv-rules');
    box.replaceChildren();
    $('pv-rules-count').textContent = `Ver las ${s.rules.length} reglas${s.customRules ? ' (con tus cambios)' : ''}`;
    for (const cat of ['trabajo', 'entretenimiento', 'escuela', 'neutral']) {
      const list = s.rules.filter((r) => r.cat === cat);
      if (!list.length) continue;
      box.append(el('h3', null, CAT_NAME[cat]));
      const ul = el('ul', 'list');
      for (const r of list) {
        const row = li('', 'devices-row');
        const what = [...r.procs, ...r.titles.map((t) => `“${t}”`), ...r.paths.map((p) => `📁 ${p}`)].join(', ');
        const text = el('span');
        text.append(el('strong', null, r.label + (r.kind ? ` · ${KIND_NAME[r.kind]}` : '')), el('small', 'muted', ' ' + what));
        const edit = button('Editar', () => {
          $('pv-rule-label').value = r.label;
          $('pv-rule-cat').value = r.cat;
          $('pv-rule-kind').value = r.kind || 'produccion';
          $('pv-rule-procs').value = r.procs.join(', ');
          $('pv-rule-titles').value = r.titles.join(', ');
          $('pv-rule-paths').value = r.paths.join(', ');
          $('pv-rule-kind').disabled = r.cat !== 'trabajo';
          $('pv-rule-label').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        const del = button('Quitar', () => go(() => api.focusRuleRemove(r.label), 'Regla quitada.').then((ns) => ns && renderRules(ns)));
        const btns = el('span', 'pv-row');
        btns.append(edit, del);
        row.append(text, btns);
        ul.append(row);
      }
      box.append(ul);
    }
  }

  $('pv-settings').onsubmit = (e) => {
    e.preventDefault();
    const goals = {};
    document.querySelectorAll('#pv-goals input').forEach((i) => { goals[i.dataset.day] = i.value; });
    const changes = {
      why: $('pv-why').value, goals,
      afkMin: $('pv-afk').value, nagEveryMin: $('pv-nag-every').value,
      nagEnabled: $('pv-nag').checked, nagSpeak: $('pv-nag-speak').checked, aiPhrases: $('pv-ai-phrases').checked,
      forceEnabled: $('pv-force').checked, forceFrom: $('pv-force-from').value.trim(), dayEnd: $('pv-day-end').value.trim(), dayStart: $('pv-day-start').value.trim(),
      snoozesPerDay: $('pv-snoozes').value, snoozeMin: $('pv-snooze-min').value,
      reportDay: $('pv-report-day').value, reportTime: $('pv-report-time').value.trim(),
      school: { enabled: $('pv-school').checked, startDate: $('pv-school-start').value, goalMin: $('pv-school-goal').value },
      enabled: $('pv-enabled').checked
    };
    go(() => api.focusSaveSettings(changes), 'Ajustes de productividad guardados.').then((s) => { if (s) { renderSettings(); renderAll(); } });
  };
  $('pv-rule-cat').onchange = () => { $('pv-rule-kind').disabled = $('pv-rule-cat').value !== 'trabajo'; };
  $('pv-rule-form').onsubmit = (e) => {
    e.preventDefault();
    const rule = {
      label: $('pv-rule-label').value, cat: $('pv-rule-cat').value, kind: $('pv-rule-kind').value,
      procs: $('pv-rule-procs').value, titles: $('pv-rule-titles').value, paths: $('pv-rule-paths').value
    };
    go(() => api.focusRuleSave(rule), 'Regla guardada.').then((s) => {
      if (!s) return;
      for (const id of ['pv-rule-label', 'pv-rule-procs', 'pv-rule-titles', 'pv-rule-paths']) $(id).value = '';
      renderRules(s);
    });
  };
  $('pv-rules-reset').onclick = () => {
    if (!confirm('¿Volver a las categorías de fábrica? Se quitan las reglas que agregaste (tu historial no cambia).')) return;
    go(() => api.focusRulesReset(), 'Categorías de fábrica restauradas.').then((s) => s && renderRules(s));
  };
  $('pv-test-nag').onclick = () => go(() => api.focusTestNag(), 'Recordatorio de prueba enviado.');
  $('pv-test-force').onclick = () => go(() => api.focusTestForce(), 'Ventana forzada de prueba (se quita con cualquiera de sus botones).');
  $('pv-sw-start').onclick = () => go(() => api.focusStopwatchStart($('pv-sw-note').value), 'Cronómetro iniciado.').then(() => { $('pv-sw-note').value = ''; renderToday(); });
  $('pv-sw-stop').onclick = () => go(() => api.focusStopwatchStop()).then((r) => { if (r) say(`Cronómetro detenido: ${fmt(r.min)} de trabajo en papel.`); renderAll(); });
  $('pv-prev').onclick = async () => { const w = await api.focusWeek(week); week = w.prevWeek; renderWeek(); };
  $('pv-next').onclick = async () => { const w = await api.focusWeek(week); week = w.nextWeek > w.current ? null : w.nextWeek; renderWeek(); };
  $('pv-week-pick').onchange = (e) => { week = e.target.value; renderWeek(); };
  $('pv-report-make').onclick = async () => {
    $('pv-report-make').disabled = true;
    say('Generando el reporte…');
    await go(() => api.focusReport(week || undefined), 'Reporte listo.');
    $('pv-report-make').disabled = false;
    renderWeek();
  };

  function renderAll() {
    renderToday().catch(() => {});
    renderWeek().catch(() => {});
  }

  // Se actualiza cada 10 s mientras la pestaña está a la vista.
  const view = $('productividad');
  new MutationObserver(() => {
    const now = !view.classList.contains('hidden');
    if (now && !visible) { renderAll(); renderSettings(); }
    visible = now;
  }).observe(view, { attributes: true, attributeFilter: ['class'] });
  setInterval(() => { if (visible) renderToday().catch(() => {}); }, 10000);
  setInterval(() => { if (visible) renderWeek().catch(() => {}); }, 60000);

  api.onOpenView((v) => {
    const tab = document.querySelector(`.tab[data-view="${v}"]`);
    if (tab) tab.click();
  });
})();
