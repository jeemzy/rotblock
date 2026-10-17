import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { mountPopup } from '../extension/popup.js';

const html = await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8');
async function fixture({ error = false, initialCount = 12 } = {}) {
  const dom = new JSDOM(html);
  let reset = 0;
  let listener;
  let count = initialCount;
  const api = {
    runtime: {
      getManifest: () => ({ version: '0.2.0', host_permissions: [] }),
      sendMessage: async message => {
        if (error) throw Error('unavailable');
        if (message.type === 'stats:reset') { reset++; count = 0; }
        return { today: count, total: count, blocking: true, hasAccess: true, week: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${11+i}`, count: i === 6 ? count : 0 })) };
      },
    },
    storage: { onChanged: { addListener: fn => { listener = fn; }, removeListener: () => {} } },
  };
  const ui = mountPopup(dom.window.document, api);
  await ui.ready;
  return { dom, ui, reset: () => reset, update: () => { count = 20; listener({ stats: {} }, 'local'); } };
}

test('popup renders real counts and seven accessible days, and confirms before resetting', async () => {
  const f = await fixture();
  const doc = f.dom.window.document;
  try {
    assert.equal(doc.querySelector('#today').textContent, '12');
    assert.equal(doc.querySelectorAll('#chart li').length, 7);
    assert.match(doc.querySelector('#chart li:last-child').getAttribute('aria-label'), /12/);
    doc.querySelector('#reset').click();
    assert.equal(f.reset(), 0);
    assert.equal(doc.querySelector('#reset-confirm').hidden, false);
    doc.querySelector('#reset-cancel').click();
    assert.equal(doc.querySelector('#reset-confirm').hidden, true);
    doc.querySelector('#reset').click();
    doc.querySelector('#reset-accept').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(f.reset(), 1);
    assert.equal(doc.querySelector('#today').textContent, '0');
  } finally { f.ui.stop(); f.dom.window.close(); }
});

test('an open popup refreshes when stats change', async () => {
  const f = await fixture();
  try {
    f.update();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(f.dom.window.document.querySelector('#today').textContent, '20');
  } finally { f.ui.stop(); f.dom.window.close(); }
});

test('a storage error is shown instead of invented zero statistics', async () => {
  const f = await fixture({ error: true });
  try {
    assert.equal(f.dom.window.document.querySelector('#today').textContent, '—');
    assert.match(f.dom.window.document.querySelector('#feedback').textContent, /load stats/i);
  } finally { f.ui.stop(); f.dom.window.close(); }
});

test('large totals stay compact with the exact count available to assistive technology', async () => {
  const f = await fixture({ initialCount: 1_234_567 });
  try {
    const today = f.dom.window.document.querySelector('#today');
    assert.ok(today.textContent.length <= 6);
    assert.equal(today.getAttribute('aria-label'), `${(1_234_567).toLocaleString()} Shorts hidden today`);
  } finally { f.ui.stop(); f.dom.window.close(); }
});
