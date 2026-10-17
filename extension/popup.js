export function mountPopup(doc, api) {
  const $ = id => doc.getElementById(id);
  const exact = value => value.toLocaleString();
  const format = value => value.toLocaleString(undefined, value >= 10_000
    ? { notation: 'compact', maximumFractionDigits: 1 } : {});
  let request = 0;
  let stopped = false;
  function render(stats) {
    $('today').textContent = format(stats.today);
    $('total').textContent = format(stats.total);
    $('today').setAttribute('aria-label', `${exact(stats.today)} Shorts hidden today`);
    $('total').setAttribute('aria-label', `${exact(stats.total)} Shorts hidden all time`);
    $('today').title = exact(stats.today);
    $('total').title = exact(stats.total);
    $('today').dataset.long = String(format(stats.today).length > 5);
    $('status').textContent = stats.blocking ? 'Blocking on' : stats.hasAccess ? 'Blocking off' : 'Access needed';
    $('status').dataset.active = String(stats.blocking);
    $('grant-access').hidden = stats.hasAccess;
    const sum = stats.week.reduce((total, day) => total + day.count, 0);
    $('week-total').textContent = `${format(sum)} hidden`;
    $('empty').hidden = sum > 0;
    const max = Math.max(...stats.week.map(day => day.count), 1);
    $('chart').replaceChildren(...stats.week.map(({ date, count }, index) => {
      const day = new Date(`${date}T12:00:00`);
      const label = day.toLocaleDateString(undefined, { weekday: 'short' });
      const item = doc.createElement('li');
      item.dataset.zero = String(count === 0);
      item.setAttribute('aria-label', `${day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${exact(count)} Shorts hidden`);
      item.title = item.getAttribute('aria-label');
      const track = doc.createElement('span'); track.className = 'track'; track.setAttribute('aria-hidden', 'true');
      const bar = doc.createElement('span'); bar.className = 'bar'; bar.style.height = `${count / max * 100}%`;
      track.append(bar);
      const text = doc.createElement('span'); text.className = 'day'; text.textContent = index === 6 ? 'Today' : label; text.setAttribute('aria-hidden', 'true');
      item.append(track, text);
      return item;
    }));
    $('reset').disabled = false;
  }
  async function refresh() {
    const current = ++request;
    try {
      const stats = await api.runtime.sendMessage({ type: 'stats:get' });
      if (stopped || current !== request) return;
      render(stats);
      $('feedback').textContent = '';
    } catch {
      if (stopped || current !== request) return;
      $('feedback').textContent = 'Could not load stats. Reopen to retry.';
    }
  }
  $('version').textContent = `v${api.runtime.getManifest().version}`;
  $('reset').addEventListener('click', () => { $('reset-confirm').hidden = false; $('reset-cancel').focus(); });
  $('reset-cancel').addEventListener('click', () => { $('reset-confirm').hidden = true; $('reset').focus(); });
  $('reset-accept').addEventListener('click', async () => {
    $('reset-accept').disabled = true;
    try {
      await api.runtime.sendMessage({ type: 'stats:reset' });
      $('reset-confirm').hidden = true;
      await refresh();
      $('reset').focus();
    } catch { $('feedback').textContent = 'Could not reset stats. Try again.'; }
    finally { $('reset-accept').disabled = false; }
  });
  $('grant-access').addEventListener('click', async () => {
    try {
      await api.permissions.request({ origins: api.runtime.getManifest().host_permissions });
      await refresh();
    } catch { $('feedback').textContent = 'Could not request YouTube access. Try again.'; }
  });
  const changed = (changes, area) => { if (area === 'local' && changes.stats) void refresh(); };
  api.storage.onChanged.addListener(changed);
  const timer = doc.defaultView.setInterval(refresh, 60_000);
  const stop = () => { stopped = true; doc.defaultView.clearInterval(timer); api.storage.onChanged.removeListener(changed); };
  doc.defaultView.addEventListener('unload', stop, { once: true });
  return { ready: refresh(), stop };
}

if (typeof browser !== 'undefined' && typeof document !== 'undefined') mountPopup(document, browser);
