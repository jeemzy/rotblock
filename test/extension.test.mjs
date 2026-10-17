import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const source = await readFile(new URL('../extension/core.js', import.meta.url), 'utf8');
const fixture = `
  <ytd-rich-section-renderer id="short-section"><ytd-rich-shelf-renderer is-shorts>
    <ytd-rich-item-renderer id="short-card"><ytm-shorts-lockup-view-model-v2>
      <a href="/shorts/abc">Short</a></ytm-shorts-lockup-view-model-v2></ytd-rich-item-renderer>
  </ytd-rich-shelf-renderer></ytd-rich-section-renderer>
  <ytd-rich-section-renderer id="regular-section"><ytd-rich-shelf-renderer>
    <ytd-rich-item-renderer id="regular-card"><a href="/watch?v=normal">Video</a></ytd-rich-item-renderer>
  </ytd-rich-shelf-renderer></ytd-rich-section-renderer>
  <ytd-item-section-renderer id="mixed-section">
    <ytd-video-renderer id="search-short"><a id="thumbnail" href="https://www.youtube.com/shorts/xyz">Short</a></ytd-video-renderer>
    <ytd-video-renderer id="search-video"><a id="thumbnail" href="/watch?v=other">Video</a></ytd-video-renderer>
  </ytd-item-section-renderer>
  <ytd-guide-entry-renderer id="short-nav"><a id="endpoint" title="Shorts" role="link">Shorts</a></ytd-guide-entry-renderer>
  <ytd-guide-entry-renderer id="home-nav"><a href="/">Home</a></ytd-guide-entry-renderer>
  <yt-tab-shape role="tab" tab-title="Shorts" id="short-tab">Shorts</yt-tab-shape>
  <yt-tab-shape role="tab" tab-title="Videos" id="video-tab">Videos</yt-tab-shape>`;

function page(html = fixture, url = 'https://www.youtube.com/') {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => { if (!error.message.includes('Not implemented: navigation')) throw error; });
  const dom = new JSDOM(html, { url, virtualConsole, runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.eval(source);
  return dom;
}

test('Shorts URL matching is confined to exact YouTube hosts and route boundaries', () => {
  const dom = page();
  const match = dom.window.rotblock.isShortsUrl;
  for (const url of ['https://www.youtube.com/shorts/abc?feature=share#x', 'http://youtube.com/shorts', 'https://m.youtube.com/shorts/?x=1']) assert.equal(match(url), true, url);
  for (const url of ['https://example.com/shorts/abc','https://youtube.com.evil.test/shorts/x','https://music.youtube.com/shorts/x','https://www.youtube.com/shortstuff','https://www.youtube.com/watch?v=shorts','https://www.youtube.com/embed/abc','javascript:alert(1)']) assert.equal(match(url), false, url);
  dom.window.close();
});

test('hides inspected Shorts containers while preserving regular cards and mixed ancestors', () => {
  const dom = page();
  dom.window.rotblock.scan(dom.window.document);
  for (const id of ['short-section','short-card','search-short','short-nav','short-tab']) assert.equal(dom.window.document.getElementById(id).getAttribute('data-rotblock-hidden'), 'true', id);
  for (const id of ['regular-section','regular-card','mixed-section','search-video','home-nav','video-tab']) assert.equal(dom.window.document.getElementById(id).hasAttribute('data-rotblock-hidden'), false, id);
  dom.window.close();
});

test('a Shorts search result with a watch-URL snippet is still a Shorts card', () => {
  const dom = page();
  dom.window.document.getElementById('search-short').insertAdjacentHTML('beforeend', '<a class="metadata-snippet-timestamp" href="/watch?v=xyz&t=0">Snippet timestamp</a>');
  dom.window.rotblock.scan(dom.window.document);
  assert.equal(dom.window.document.getElementById('search-short').getAttribute('data-rotblock-hidden'), 'true');
  assert.equal(dom.window.document.getElementById('mixed-section').hasAttribute('data-rotblock-hidden'), false);
  assert.equal(dom.window.document.getElementById('search-video').hasAttribute('data-rotblock-hidden'), false);
  dom.window.close();
});

test('mutation observation handles late cards and reveals recycled normal-video containers', async () => {
  const dom = page();
  const stop = dom.window.rotblock.start(dom.window);
  const doc = dom.window.document;
  doc.getElementById('mixed-section').insertAdjacentHTML('beforeend','<ytd-video-renderer id="late"><a href="/shorts/new">Short</a></ytd-video-renderer>');
  doc.querySelector('#search-short a').href = '/watch?v=recycled';
  await new Promise(resolve => dom.window.setTimeout(resolve, 80));
  assert.equal(doc.getElementById('late').getAttribute('data-rotblock-hidden'), 'true');
  assert.equal(doc.getElementById('search-short').hasAttribute('data-rotblock-hidden'), false);
  stop();
  dom.window.close();
});

test('does not modify other websites', () => {
  const dom = page(fixture, 'https://example.com/');
  dom.window.rotblock.start(dom.window);
  assert.equal(dom.window.document.querySelectorAll('[data-rotblock-hidden]').length, 0);
  dom.window.close();
});

test('late Shorts are hidden even when a background window has no animation frames', async () => {
  const dom = page();
  dom.window.requestAnimationFrame = () => 1;
  const stop = dom.window.rotblock.start(dom.window);
  dom.window.document.getElementById('mixed-section').insertAdjacentHTML('beforeend', '<ytd-video-renderer id="background-short"><a href="/shorts/background">Short</a></ytd-video-renderer>');
  await new Promise(resolve => dom.window.setTimeout(resolve, 20));
  try {
    assert.equal(dom.window.document.getElementById('background-short').getAttribute('data-rotblock-hidden'), 'true');
  } finally {
    stop();
    dom.window.close();
  }
});

test('detects pushState without relying on YouTube events or DOM mutations', async () => {
  const dom = page();
  const stop = dom.window.rotblock.start(dom.window);
  dom.window.history.pushState(null, '', '/shorts/without-events');
  await new Promise(resolve => dom.window.setTimeout(resolve, 350));
  try {
    assert.equal(dom.window.document.documentElement.hasAttribute('data-rotblock-redirecting'), true);
  } finally {
    stop();
    dom.window.close();
  }
});

test('network redirect rules match only Shorts and only main-frame navigations', async () => {
  const rules = JSON.parse(await readFile(new URL('../extension/rules.json', import.meta.url), 'utf8'));
  const rule = rules[0];
  assert.deepEqual(rule.condition.resourceTypes, ['main_frame']);
  const pattern = new RegExp(rule.condition.regexFilter);
  for (const url of ['https://www.youtube.com/shorts/abc','https://youtube.com/shorts?x=1','http://m.youtube.com/shorts/abc']) assert.ok(pattern.test(url));
  for (const url of ['https://example.com/shorts/abc','https://www.youtube.com/watch?v=abc','https://www.youtube.com/shortstuff','https://youtube.com.evil.test/shorts/abc']) assert.equal(pattern.test(url), false);
  assert.equal(rule.action.redirect.url, 'https://www.youtube.com/');
});

test('counts individual Shorts once per document across nested shelves, rescans, and recycled cards', async () => {
  const dom = page();
  const counts = [];
  const stop = dom.window.rotblock.start(dom.window, { onHidden: count => counts.push(count) });
  const doc = dom.window.document;
  try {
    assert.equal(counts.reduce((a, b) => a + b, 0), 2, 'two videos, not their nested containers or navigation');
    doc.querySelector('#short-card a').setAttribute('title', 'trigger a rescan');
    doc.querySelector('#mixed-section').insertAdjacentHTML('beforeend', '<ytd-video-renderer id="duplicate"><a href="/shorts/abc?feature=share">Repeated Short</a></ytd-video-renderer>');
    await new Promise(resolve => dom.window.setTimeout(resolve, 20));
    assert.equal(counts.reduce((a, b) => a + b, 0), 2);
    doc.querySelector('#search-short a').href = '/shorts/new-video';
    await new Promise(resolve => dom.window.setTimeout(resolve, 20));
    assert.equal(counts.reduce((a, b) => a + b, 0), 3, 'a reused card with a new video counts');
    doc.querySelector('#search-short a').href = '/watch?v=regular';
    await new Promise(resolve => dom.window.setTimeout(resolve, 20));
    assert.equal(counts.reduce((a, b) => a + b, 0), 3);
  } finally { stop(); dom.window.close(); }
});
