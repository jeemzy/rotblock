import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GitHubClient } from '../tools/github-release.mjs';

test('GitHub refuses to replace an existing asset with different bytes', async () => {
  let uploads = 0;
  const api = new GitHubClient({ token: 'not-a-real-token', fetcher: async (url, options) => {
    if (String(url).includes('/releases/assets/9')) return new Response('existing');
    uploads++; return Response.json({ id: 9 });
  } });
  const release = { assets: [{ id: 9, name: 'rotblock.xpi' }], upload_url: 'https://uploads.github.com/repos/jeemzy/rotblock/releases/1/assets{?name,label}' };
  assert.equal((await api.uploadAsset(release, 'rotblock.xpi', Buffer.from('existing'))).id, 9);
  await assert.rejects(api.uploadAsset(release, 'rotblock.xpi', Buffer.from('different')), /different/i);
  assert.equal(uploads, 0);
});

test('public download verification does not send GitHub credentials', async () => {
  let options;
  const api = new GitHubClient({ token: 'not-a-real-token', fetcher: async (url, args) => { options = args; return new Response('public'); } });
  assert.equal((await api.publicDownload('https://github.com/jeemzy/rotblock/releases/download/v0.2.1/rotblock-0.2.1.xpi')).toString(), 'public');
  assert.equal(options.headers?.Authorization, undefined);
});

test('a published-tag lookup returning 404 falls back to the authenticated draft list', async () => {
  const draft = { id: 12, tag_name: 'v0.2.1', draft: true };
  const api = new GitHubClient({ token: 'not-a-real-token', fetcher: async url => {
    if (String(url).includes('/releases/tags/')) return new Response('', { status: 404 });
    return Response.json([draft]);
  } });
  assert.equal((await api.getRelease('v0.2.1'))?.id, 12);
  assert.equal(await api.getRelease('v0.2.2'), null);
});
