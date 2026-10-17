import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { AmoClient } from '../tools/amo.mjs';
import { configureSecrets } from '../tools/configure-actions-secrets.mjs';

test('AMO authenticates with short-lived HS256 JWTs and looks up the exact version', async () => {
  const requests = [];
  const fetcher = async (url, options) => { requests.push({ url: String(url), options }); return Response.json({ id: 42, version: '0.2.1' }); };
  const api = new AmoClient({ key: 'test-key', secret: 'test-secret', fetcher });
  await api.getVersion('0.2.1');
  assert.match(requests[0].url, /versions\/0\.2\.1\/$/);
  const token = requests[0].options.headers.Authorization.slice(4);
  const [head, body, signature] = token.split('.');
  const claims = JSON.parse(Buffer.from(body, 'base64url'));
  assert.equal(claims.iss, 'test-key');
  assert.ok(claims.jti);
  assert.equal(claims.exp - claims.iat, 60);
  assert.equal(signature, createHmac('sha256', 'test-secret').update(`${head}.${body}`).digest('base64url'));
});

test('AMO uploads the original ZIP as unlisted, distinguishes 404, and sanitizes API errors', async () => {
  let response = Response.json({ uuid: 'uuid' });
  let request;
  const api = new AmoClient({ key: 'key', secret: 'sensitive-value', fetcher: async (url, options) => { request = options; return response; } });
  await api.upload(Buffer.from('exact ZIP bytes'));
  assert.equal(request.body.get('channel'), 'unlisted');
  assert.equal(await request.body.get('upload').text(), 'exact ZIP bytes');
  response = new Response('', { status: 404 });
  assert.equal(await api.getVersion('0.2.1'), null);
  response = new Response('sensitive-value', { status: 429 });
  await assert.rejects(api.getVersion('0.2.1'), error => error.status === 429 && !error.message.includes('sensitive-value'));
  await assert.rejects(api.download('https://evil.example/package.xpi'), /Mozilla/);
});

test('secret configuration pipes values to stdin, never arguments or returned output', () => {
  const calls = [];
  configureSecrets({ env: { WEB_EXT_API_KEY: 'issuer-value', WEB_EXT_API_SECRET: 'secret-value' },
    run: (command, args, options) => calls.push({ command, args, options }) });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.input, 'issuer-value');
  assert.equal(calls[1].options.input, 'secret-value');
  assert.equal(JSON.stringify(calls.map(c => c.args)).includes('secret-value'), false);
  assert.deepEqual(calls[0].options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.throws(() => configureSecrets({ env: {}, run: () => assert.fail('must not run') }), /credentials/i);
});
