globalThis.rotblock.start(window, {
  onHidden: count => {
    // Counting must never interrupt hiding or redirects if storage is unavailable.
    browser.runtime.sendMessage({ type: 'stats:add', count }).catch(() => {});
  },
});
