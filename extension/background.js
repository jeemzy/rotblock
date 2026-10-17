import { recordCards, summarizeStats } from './stats.js';

export function createStatsService(api, now = () => new Date()) {
  let pending = Promise.resolve();
  const popupURL = api.runtime.getURL('popup.html');
  function isYouTube(sender) {
    if (!Number.isInteger(sender.tab?.id) || sender.frameId !== 0) return false;
    try {
      const url = new URL(sender.url);
      return ['http:', 'https:'].includes(url.protocol)
        && ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname);
    } catch { return false; }
  }
  return (message, sender) => {
    if (sender.id !== api.runtime.id) return;
    const fromPopup = sender.url === popupURL;
    const add = message?.type === 'stats:add' && isYouTube(sender)
      && Number.isSafeInteger(message.count) && message.count > 0 && message.count <= 50_000;
    if (!add && !(fromPopup && ['stats:get', 'stats:reset'].includes(message?.type))) return;
    // Each event keeps this MV3 event page awake until its storage write completes.
    // Serial reads/writes prevent two tabs from overwriting one another's counts.
    const next = pending.then(async () => {
      const { stats } = await api.storage.local.get('stats');
      const date = now();
      let state = stats;
      if (add) state = recordCards(state, message.count, date);
      if (message.type === 'stats:reset') state = recordCards(null, 0, date);
      if (add || message.type === 'stats:reset') await api.storage.local.set({ stats: state });
      if (add) return { ok: true };
      const [hasAccess, rules] = await Promise.all([
        api.permissions.contains({ origins: api.runtime.getManifest().host_permissions }),
        api.declarativeNetRequest.getEnabledRulesets(),
      ]);
      return { ...summarizeStats(state, date), hasAccess, blocking: hasAccess && rules.includes('shorts') };
    });
    pending = next.catch(() => {});
    return next;
  };
}

if (typeof browser !== 'undefined') browser.runtime.onMessage.addListener(createStatsService(browser));
