/* Runs in the extension's isolated content-script world. */
(() => {
  'use strict';
  const hosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
  const home = 'https://www.youtube.com/';
  const hidden = 'data-rotblock-hidden';
  const sessions = new WeakMap();
  const containers = [
    'ytd-rich-section-renderer', 'ytd-rich-shelf-renderer', 'ytd-reel-shelf-renderer',
    'grid-shelf-view-model', 'ytd-rich-item-renderer', 'ytd-video-renderer',
    'ytd-grid-video-renderer', 'yt-lockup-view-model', 'ytd-reel-item-renderer',
    'ytm-shorts-lockup-view-model', 'ytm-shorts-lockup-view-model-v2',
    'ytd-mini-guide-entry-renderer', 'ytd-guide-entry-renderer', 'yt-tab-shape',
  ].join(',');

  function youtubeUrl(value, base) {
    try {
      const url = new URL(value, base);
      return /^(https?:)$/.test(url.protocol) && hosts.has(url.hostname) ? url : null;
    } catch {
      return null;
    }
  }

  function isShortsUrl(value, base) {
    const url = youtubeUrl(value, base);
    return !!url && /^\/shorts(?:\/|$)/.test(url.pathname);
  }

  function shouldHide(element) {
    // A search result's snippet can link to /watch even when its primary video is a Short.
    if (element.matches('ytd-video-renderer,ytd-grid-video-renderer')) {
      const thumbnail = element.querySelector('a#thumbnail[href]');
      if (thumbnail && isShortsUrl(thumbnail.href, element.baseURI)) return true;
    }
    const links = [...element.querySelectorAll('a[href]')];
    // Preserve mixed shelves and sections, including containers YouTube has recycled.
    if (links.some(link => youtubeUrl(link.href, element.baseURI)?.pathname === '/watch')) return false;
    if (element.matches('yt-tab-shape[role="tab"][tab-title="Shorts"]')) return true;
    if (element.matches('ytd-guide-entry-renderer,ytd-mini-guide-entry-renderer')
      && element.querySelector('a#endpoint[title="Shorts"]')) return true;
    if (element.matches('ytd-rich-shelf-renderer[is-shorts],ytd-reel-shelf-renderer,ytm-shorts-lockup-view-model,ytm-shorts-lockup-view-model-v2,ytd-reel-item-renderer')) return true;
    return links.some(link => isShortsUrl(link.href, element.baseURI));
  }

  function scan(root, onHidden = () => {}) {
    const candidates = new Set(root.querySelectorAll?.(containers) ?? []);
    for (let element = root.nodeType === 1 ? root : root.parentElement; element; element = element.parentElement) {
      if (element.matches(containers)) candidates.add(element);
    }
    for (const element of candidates) {
      if (shouldHide(element)) {
        if (element.getAttribute(hidden) !== 'true') element.setAttribute(hidden, 'true');
        onHidden(element);
      } else {
        element.removeAttribute(hidden);
      }
    }
  }

  function start(win, { onHidden = () => {} } = {}) {
    if (win.top !== win || !youtubeUrl(win.location.href)) return;
    if (sessions.has(win)) return sessions.get(win);
    const doc = win.document;
    // Video IDs stay in this document's memory; only aggregate increments leave it.
    const seen = new Set();
    let newCards = 0;
    const capture = element => {
      for (const link of element.querySelectorAll('a[href]')) {
        const url = youtubeUrl(link.href, doc.baseURI);
        const id = url?.pathname.match(/^\/shorts\/([^/]+)\/?$/)?.[1];
        if (id && !seen.has(id)) { seen.add(id); newCards++; }
      }
    };
    const report = () => {
      if (!newCards) return;
      const count = newCards;
      newCards = 0;
      onHidden(count);
    };
    let scheduled = false;
    let stopped = false;
    let redirecting = false;
    const pending = new Set();
    function guard() {
      if (!isShortsUrl(win.location.href)) return false;
      if (!redirecting) {
        redirecting = true;
        doc.documentElement?.setAttribute('data-rotblock-redirecting', '');
        win.location.replace(home);
      }
      return true;
    }
    function queue(root = doc) {
      if (guard()) return;
      pending.add(root);
      if (scheduled) return;
      scheduled = true;
      // Background tabs may suspend animation frames. DOM work must still run.
      win.queueMicrotask(() => {
        scheduled = false;
        if (stopped || guard()) return;
        const roots = [...pending];
        pending.clear();
        for (const root of roots) {
          if (root !== doc && !root.isConnected) continue;
          if (!roots.some(other => other !== root && other.contains(root))) scan(root, capture);
        }
        report();
      });
    }
    const observer = new win.MutationObserver(records => {
      if (guard()) return;
      for (const record of records) queue(record.target);
    });
    observer.observe(doc, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['href', 'title', 'tab-title', 'is-shorts'] });
    const navigate = () => queue(doc);
    const click = event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest?.('a[href]');
      if (!link || (link.target && link.target !== '_self') || !isShortsUrl(link.href, doc.baseURI)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      win.location.replace(home);
    };
    for (const name of ['yt-navigate-start', 'yt-navigate-finish', 'yt-page-data-updated']) doc.addEventListener(name, navigate);
    for (const name of ['popstate', 'pageshow', 'focus']) win.addEventListener(name, navigate);
    doc.addEventListener('visibilitychange', navigate);
    // History API calls do not emit popstate. A tiny URL-only fallback avoids
    // patching YouTube's history functions or requesting broad navigation access.
    const routeCheck = win.setInterval(guard, 250);
    doc.addEventListener('click', click, true);
    const stop = () => {
      stopped = true;
      observer.disconnect();
      pending.clear();
      win.clearInterval(routeCheck);
      for (const name of ['yt-navigate-start', 'yt-navigate-finish', 'yt-page-data-updated']) doc.removeEventListener(name, navigate);
      for (const name of ['popstate', 'pageshow', 'focus']) win.removeEventListener(name, navigate);
      doc.removeEventListener('visibilitychange', navigate);
      doc.removeEventListener('click', click, true);
      for (const element of doc.querySelectorAll(`[${hidden}]`)) element.removeAttribute(hidden);
      sessions.delete(win);
    };
    sessions.set(win, stop);
    if (!guard()) { scan(doc, capture); report(); }
    return stop;
  }

  globalThis.rotblock = Object.freeze({ isShortsUrl, scan, start });
})();
