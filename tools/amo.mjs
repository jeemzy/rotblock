import { createHmac, randomUUID } from 'node:crypto';
import { addonId, PermanentError, versionParts } from './release-state.mjs';

export class AmoClient {
  #key; #secret; #fetch;
  constructor({ key = process.env.WEB_EXT_API_KEY, secret = process.env.WEB_EXT_API_SECRET, fetcher = fetch } = {}) {
    if (!key || !secret) throw new Error('Mozilla signing credentials are missing');
    this.#key = key; this.#secret = secret; this.#fetch = fetcher;
  }
  auth() {
    const iat = Math.floor(Date.now() / 1000);
    const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ iss: this.#key, jti: randomUUID(), iat, exp: iat + 60 })).toString('base64url');
    return `JWT ${head}.${body}.${createHmac('sha256', this.#secret).update(`${head}.${body}`).digest('base64url')}`;
  }
  async request(path, { method = 'GET', body, optional = false, binary = false } = {}) {
    const url = new URL(path, 'https://addons.mozilla.org/api/v5/');
    if (url.protocol !== 'https:' || !(url.hostname === 'addons.mozilla.org' || url.hostname.endsWith('.mozilla.net'))) throw new PermanentError('Download must use an approved Mozilla host');
    const headers = {};
    if (url.hostname === 'addons.mozilla.org') headers.Authorization = this.auth();
    if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    let response;
    try { response = await this.#fetch(url, { method, body, headers, signal: AbortSignal.timeout(30_000) }); }
    catch { throw new Error('Mozilla network request failed; retry later'); }
    if (optional && response.status === 404) return null;
    if (!response.ok) { const error = new Error(`Mozilla API request failed (HTTP ${response.status})`); error.status = response.status; throw error; }
    if (binary) return Buffer.from(await response.arrayBuffer());
    try { return await response.json(); } catch { throw new Error('Mozilla returned an invalid API response'); }
  }
  getVersion(version) { versionParts(version); return this.request(`addons/addon/${encodeURIComponent(addonId)}/versions/${version}/`, { optional: true }); }
  upload(bytes) {
    const body = new FormData();
    body.set('channel', 'unlisted');
    body.set('upload', new Blob([bytes], { type: 'application/zip' }), 'rotblock.zip');
    return this.request('addons/upload/', { method: 'POST', body });
  }
  getUpload(uuid) { return this.request(`addons/upload/${encodeURIComponent(uuid)}/`); }
  createVersion(uuid) { return this.request(`addons/addon/${encodeURIComponent(addonId)}/versions/`, { method: 'POST', body: { upload: uuid } }); }
  download(url) { return this.request(url, { binary: true }); }
}
