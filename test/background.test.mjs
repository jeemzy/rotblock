import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStatsService } from '../extension/background.js';

function fixture() {
  let stored = {};
  const api = {
    runtime: { id: 'rotblock@test', getURL: path => `moz-extension://local/${path}`, getManifest: () => ({ host_permissions: ['*://www.youtube.com/*'] }) },
    storage: { local: {
      get: async () => structuredClone(stored),
      set: async value => { await new Promise(resolve => setTimeout(resolve, 2)); stored = structuredClone(value); },
    } },
    permissions: { contains: async () => true },
    declarativeNetRequest: { getEnabledRulesets: async () => ['shorts'] },
  };
  const handle = createStatsService(api, () => new Date(2026, 9, 17));
  const content = { id: api.runtime.id, url: 'https://www.youtube.com/', tab: { id: 1 }, frameId: 0 };
  const popup = { id: api.runtime.id, url: api.runtime.getURL('popup.html') };
  return { api, handle, content, popup, stored: () => stored };
}

test('simultaneous tab reports are serialized, persist across background restarts, and contain only aggregates', async () => {
  const f = fixture();
  await Promise.all([f.handle({ type: 'stats:add', count: 3 }, f.content), f.handle({ type: 'stats:add', count: 7 }, { ...f.content, tab: { id: 2 } })]);
  const restarted = createStatsService(f.api, () => new Date(2026, 9, 17));
  const result = await restarted({ type: 'stats:get' }, f.popup);
  assert.equal(result.total, 10);
  assert.equal(result.today, 10);
  assert.equal(result.blocking, true);
  assert.deepEqual(Object.keys(f.stored().stats).sort(), ['days', 'total', 'version']);
  assert.equal(JSON.stringify(f.stored()).includes('youtube'), false);
});

test('only top-level YouTube scripts can add, and only the popup can reset stats', async () => {
  const f = fixture();
  for (const sender of [{ ...f.content, url: 'https://evil.test/' }, { ...f.content, frameId: 1 }, { ...f.content, id: 'another-extension' }]) {
    assert.equal(f.handle({ type: 'stats:add', count: 100 }, sender), undefined);
  }
  await f.handle({ type: 'stats:add', count: 4 }, f.content);
  assert.equal(f.handle({ type: 'stats:reset' }, f.content), undefined);
  assert.equal((await f.handle({ type: 'stats:get' }, f.popup)).total, 4);
  assert.equal((await f.handle({ type: 'stats:reset' }, f.popup)).total, 0);
  await f.handle({ type: 'stats:add', count: 2 }, f.content);
  assert.equal((await f.handle({ type: 'stats:get' }, f.popup)).total, 2);
});

test('reports missing YouTube access honestly and recovers after a failed storage write', async () => {
  const f = fixture();
  f.api.permissions.contains = async () => false;
  assert.equal((await f.handle({ type: 'stats:get' }, f.popup)).blocking, false);
  const set = f.api.storage.local.set;
  f.api.storage.local.set = async () => { throw Error('disk unavailable'); };
  await assert.rejects(f.handle({ type: 'stats:add', count: 1 }, f.content));
  f.api.storage.local.set = set;
  await f.handle({ type: 'stats:add', count: 2 }, f.content);
  assert.equal((await f.handle({ type: 'stats:get' }, f.popup)).total, 2);
});
