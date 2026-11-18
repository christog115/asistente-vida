const f = window.forzar;
const $ = (id) => document.getElementById(id);

function show(s) {
  if (!s) return;
  $('remaining').textContent = s.remaining;
  $('worked').textContent = s.worked;
  $('goal').textContent = s.goal;
  $('day-end').textContent = s.dayEnd;
  $('phrase').textContent = s.phrase;
  // Si la frase ya trae tu porqué no se repite abajo.
  $('why').textContent = s.why && !s.phrase.toLowerCase().includes(s.why.toLowerCase().replace(/[.\s]+$/, '')) ? `Tu porqué: ${s.why}` : '';
  $('snooze-min').textContent = s.snoozeMin;
  $('snooze-left').textContent = s.snoozesLeft;
  $('snooze').disabled = !s.snoozesLeft;
  if (!s.snoozesLeft) $('snooze').textContent = 'Ya usaste tus pausas de emergencia de hoy';
}

f.state().then(show);
f.onState(show);
$('work').onclick = () => f.action('work');
$('stopwatch').onclick = () => f.action('stopwatch');
$('snooze').onclick = () => f.action('snooze');
// Esc y Alt+F4 no cierran esta ventana.
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.preventDefault(); });
