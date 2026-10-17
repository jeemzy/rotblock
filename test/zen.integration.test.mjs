import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { startZenSession } from '../tools/zen.mjs';
import { inspectYouTube } from '../tools/youtube-dom.mjs';

test('Zen DOM, screenshots, and profile storage survive a browser restart', { timeout: 180_000 }, async () => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><title>rotblock browser check</title>
      <h1 id="probe">Zen inspection works</h1>
      <section id="results">
        <ytd-video-renderer><a href="https://www.youtube.com/shorts/example">Short</a></ytd-video-renderer>
        <ytd-video-renderer><a href="https://www.youtube.com/watch?v=example">Regular video</a></ytd-video-renderer>
      </section>
      <yt-tab-shape role="tab" tab-title="Shorts">Shorts</yt-tab-shape>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const marker = `verified-${Date.now()}`;
  let driver;
  try {
    driver = await startZenSession();
    await driver.get(url);
    assert.equal(await driver.getTitle(), 'rotblock browser check');
    assert.equal(await driver.getCurrentUrl(), url);
    assert.equal(await driver.executeScript('return document.querySelector("#probe").textContent'), 'Zen inspection works');
    const structure = await inspectYouTube(driver);
    assert.deepEqual(structure.counts, { shortsLinks: 1, regularVideoLinks: 1 });
    assert.equal(structure.shorts[0].ancestors[0].tag, 'ytd-video-renderer');
    assert.ok(structure.channelTabs.some(tab => tab.tag === 'yt-tab-shape'), 'Record modern channel tabs that have no href');
    assert.equal(await driver.executeScript('return document.querySelectorAll("#results a").length'), 2, 'Inspection leaves both video cards intact');
    const screenshot = Buffer.from(await driver.takeScreenshot(), 'base64');
    assert.equal(screenshot.subarray(1, 4).toString(), 'PNG');
    await driver.executeScript('localStorage.setItem("rotblock-profile-check", arguments[0])', marker);
    await driver.quit();
    driver = undefined;
    driver = await startZenSession();
    await driver.get(url);
    assert.equal(await driver.executeScript('return localStorage.getItem("rotblock-profile-check")'), marker);
    await driver.executeScript('localStorage.removeItem("rotblock-profile-check")');
  } finally {
    try {
      if (driver) await driver.quit();
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }
});
