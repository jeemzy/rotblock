import { execFileSync } from 'node:child_process';
import { repository, hash, PermanentError } from './release-state.mjs';

export class GitHubClient {
  #token; #fetch;
  constructor({ token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN, fetcher = fetch } = {}) {
    if (!token) {
      try { token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
      catch { throw new Error('GitHub authentication is unavailable'); }
    }
    this.#token = token; this.#fetch = fetcher;
  }
  async request(path, { method = 'GET', body, optional = false, binary = false, contentType } = {}) {
    const url = new URL(path, `https://api.github.com/repos/${repository}/`);
    if (!['api.github.com', 'uploads.github.com'].includes(url.hostname) || url.protocol !== 'https:') throw new PermanentError('Invalid GitHub API URL');
    const headers = { Authorization: `Bearer ${this.#token}`, Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (body !== undefined) {
      headers['Content-Type'] = contentType ?? 'application/json';
      if (!contentType) body = JSON.stringify(body);
    }
    let response;
    try { response = await this.#fetch(url, { method, body, headers, signal: AbortSignal.timeout(30_000) }); }
    catch { throw new Error('GitHub network request failed; retry later'); }
    if (optional && response.status === 404) return null;
    if (!response.ok) { const error = new Error(`GitHub API request failed (HTTP ${response.status})`); error.status = response.status; throw error; }
    if (response.status === 204) return null;
    if (binary) return Buffer.from(await response.arrayBuffer());
    try { return await response.json(); } catch { throw new Error('GitHub returned an invalid API response'); }
  }
  async getRelease(tag) {
    // GitHub's tag endpoint describes published releases. Drafts require the
    // authenticated list API, including recovery after an unknown create result.
    return await this.request(`releases/tags/${encodeURIComponent(tag)}`, { optional: true })
      ?? (await this.listReleases()).find(release => release.tag_name === tag) ?? null;
  }
  async listReleases() {
    const releases = [];
    for (let page = 1; ; page++) {
      const entries = await this.request(`releases?per_page=100&page=${page}`);
      releases.push(...entries);
      if (entries.length < 100) return releases;
    }
  }
  createDraft(tag, sha, body) { return this.request('releases', { method: 'POST', body: { tag_name: tag, target_commitish: sha, name: tag, body, draft: true } }); }
  patchRelease(release, body) { return this.request(`releases/${release.id}`, { method: 'PATCH', body }); }
  downloadAsset(asset) { return this.request(`releases/assets/${asset.id}`, { binary: true }); }
  async uploadAsset(release, name, bytes, contentType = 'application/octet-stream') {
    const existing = release.assets.find(a => a.name === name);
    if (existing) {
      if (hash(await this.downloadAsset(existing)) !== hash(bytes)) throw new PermanentError('An existing release asset has different bytes; refusing to overwrite it');
      return existing;
    }
    const url = new URL(release.upload_url.split('{')[0]);
    url.searchParams.set('name', name);
    const asset = await this.request(url, { method: 'POST', body: bytes, contentType });
    release.assets.push(asset);
    return asset;
  }
  async deleteAsset(release, asset) {
    await this.request(`releases/assets/${asset.id}`, { method: 'DELETE', optional: true });
    release.assets = release.assets.filter(a => a.id !== asset.id);
  }
  async publicDownload(url) {
    if (!url.startsWith(`https://github.com/${repository}/releases/download/`)) throw new PermanentError('Invalid public release URL');
    let response;
    try { response = await this.#fetch(url, { signal: AbortSignal.timeout(30_000) }); }
    catch { throw new Error('Public release download unavailable; retry later'); }
    if (!response.ok) throw new Error(`Public release download unavailable (HTTP ${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }
  async tagCommit(tag) {
    let object = (await this.request(`git/ref/tags/${encodeURIComponent(tag)}`)).object;
    for (let depth = 0; object.type === 'tag' && depth < 5; depth++) object = (await this.request(`git/tags/${object.sha}`)).object;
    if (object.type !== 'commit') throw new PermanentError('Tag does not resolve to a commit');
    return object.sha;
  }
  async isOnMain(sha) {
    const comparison = await this.request(`compare/${sha}...main`);
    return ['ahead', 'identical'].includes(comparison.status);
  }
  async sourceVersions(sha) {
    const read = async name => JSON.parse(Buffer.from((await this.request(`contents/${name}?ref=${sha}`)).content, 'base64'));
    const [manifest, pkg, lock] = await Promise.all([read('extension/manifest.json'), read('package.json'), read('package-lock.json')]);
    return [manifest.version, pkg.version, lock.version, lock.packages[''].version];
  }
  async readUpdates() {
    const file = await this.request('contents/updates.json?ref=main');
    return { sha: file.sha, manifest: JSON.parse(Buffer.from(file.content, 'base64')) };
  }
  writeUpdates(sha, manifest, version) {
    return this.request('contents/updates.json', { method: 'PUT', body: {
      branch: 'main', sha, message: `release: publish rotblock ${version} update`,
      content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`).toString('base64'),
    } });
  }
}
