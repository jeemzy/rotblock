import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startZenSession } from './zen.mjs';

export async function checkLiveExtension(driver) {
  const report = [];
  const visible = () => driver.executeScript(() => ({
    shorts: [...document.querySelectorAll('a[href*="/shorts/"]')].filter(a => a.getClientRects().length > 0).length,
    regular: [...document.querySelectorAll('a[href^="/watch?"]')].filter(a => a.getClientRects().length > 0).length,
  }));
  async function contentPage(name, url) {
    await driver.get(url);
    await driver.wait(async () => (await visible()).regular > 0, 25_000);
    await driver.wait(async () => (await visible()).shorts === 0, 10_000);
    const counts = await visible();
    report.push({ check: name, ...counts });
    console.log(`${name}: no visible Shorts; ${counts.regular} regular links remain`);
  }
  await contentPage('home', 'https://www.youtube.com/');
  await contentPage('subscriptions', 'https://www.youtube.com/feed/subscriptions');
  const ordinaryShelves = await driver.executeScript(() => [...document.querySelectorAll('ytd-rich-shelf-renderer:not([is-shorts])')]
    .filter(e => e.querySelector('a[href^="/watch?"]') && !e.hasAttribute('data-rotblock-hidden')).length);
  report.push({ check: 'ordinary subscription shelves preserved', count: ordinaryShelves });
  await contentPage('search', 'https://www.youtube.com/results?search_query=cooking');
  const watchUrl = await driver.executeScript(() => document.querySelector('ytd-video-renderer a#thumbnail[href^="/watch?"]')?.href);
  assert.ok(watchUrl, 'Search contains a regular video for playback testing');
  await contentPage('channel', 'https://www.youtube.com/@NickDiGiovanni');
  await driver.wait(async () => driver.executeScript(() => {
    const shorts = document.querySelector('yt-tab-shape[tab-title="Shorts"]');
    const videos = document.querySelector('yt-tab-shape[tab-title="Videos"]');
    return shorts && videos && shorts.getClientRects().length === 0 && videos.getClientRects().length > 0;
  }), 15_000);
  report.push({ check: 'Shorts channel tab hidden; Videos tab visible', passed: true });

  await driver.executeScript(() => {
    // Use a view-model container: ytd-video-renderer's Polymer constructor
    // replaces synthetic children with its own template when connected.
    const card = document.createElement('grid-shelf-view-model');
    card.id = 'rotblock-live-probe';
    const link = document.createElement('a');
    link.href = '/shorts/probe';
    link.textContent = 'Short';
    card.append(link);
    document.body.append(card);
  });
  await driver.wait(async () => driver.executeScript(() => getComputedStyle(document.getElementById('rotblock-live-probe')).display === 'none'), 5_000);
  await driver.executeScript(() => { document.querySelector('#rotblock-live-probe a').href = '/watch?v=recycled'; });
  await driver.wait(async () => driver.executeScript(() => !document.getElementById('rotblock-live-probe').hasAttribute('data-rotblock-hidden')), 5_000);
  await driver.executeScript(() => document.getElementById('rotblock-live-probe').remove());
  report.push({ check: 'dynamic Shorts hidden; recycled regular cards revealed', passed: true });

  await driver.get('https://www.youtube.com/shorts/rotblock-check?feature=share#test');
  await driver.wait(async () => (await driver.getCurrentUrl()) === 'https://www.youtube.com/', 15_000);
  report.push({ check: 'direct Shorts link redirects home', passed: true });
  await driver.executeScript(() => {
    history.pushState(null, '', '/shorts/rotblock-check');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await driver.wait(async () => (await driver.getCurrentUrl()) === 'https://www.youtube.com/', 15_000);
  report.push({ check: 'in-page Shorts navigation redirects home', passed: true });
  await driver.executeScript(() => { history.pushState(null, '', '/shorts/without-events'); });
  await driver.wait(async () => (await driver.getCurrentUrl()) === 'https://www.youtube.com/', 15_000);
  report.push({ check: 'History API navigation without custom events redirects home', passed: true });
  await driver.executeScript(() => {
    history.pushState(null, '', '/shorts/rotblock-history');
    history.pushState(null, '', '/results?search_query=cooking');
  });
  await driver.navigate().back();
  await driver.wait(async () => (await driver.getCurrentUrl()) === 'https://www.youtube.com/', 15_000);
  report.push({ check: 'history navigation to Shorts redirects home', passed: true });

  await driver.get(watchUrl);
  await driver.wait(async () => driver.executeScript(() => !!document.querySelector('video') && !!document.querySelector('.ytp-play-button')), 25_000);
  assert.equal(new URL(await driver.getCurrentUrl()).pathname, '/watch');
  await driver.executeScript(() => { document.querySelector('video').muted = true; });
  if (await driver.executeScript(() => document.querySelector('video').paused)) await driver.findElement({ css: '.ytp-play-button' }).click();
  await driver.wait(async () => driver.executeScript(() => document.querySelector('video').currentTime > 0), 25_000);
  if (!(await driver.executeScript(() => document.querySelector('video').paused))) await driver.findElement({ css: '.ytp-play-button' }).click();
  report.push({ check: 'regular video player plays and pauses', passed: true });

  await driver.get('https://example.com/');
  assert.equal(await driver.getTitle(), 'Example Domain');
  assert.equal(await driver.executeScript(() => document.querySelectorAll('[data-rotblock-hidden]').length), 0);
  const videoId = new URL(watchUrl).searchParams.get('v');
  await driver.executeScript(id => {
    const frame = document.createElement('iframe');
    frame.id = 'rotblock-embed';
    frame.src = `https://www.youtube.com/embed/${id}`;
    document.body.append(frame);
  }, videoId);
  await driver.switchTo().frame(await driver.findElement({ id: 'rotblock-embed' }));
  await driver.wait(async () => driver.executeScript(() => location.pathname.startsWith('/embed/')), 20_000);
  assert.equal(await driver.executeScript(() => document.querySelectorAll('[data-rotblock-hidden]').length), 0);
  await driver.switchTo().defaultContent();
  report.push({ check: 'unrelated website and embedded YouTube player preserved', passed: true });
  const directory = new URL('../artifacts/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('live-verification.json', directory), JSON.stringify({ date: new Date().toISOString(), report }, null, 2));
  console.log(`Passed ${report.length} live checks.`);
  return report;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const driver = await startZenSession({ extension: true });
  try {
    await checkLiveExtension(driver);
  } finally {
    await driver.quit();
  }
}
