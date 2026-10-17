import assert from 'node:assert/strict';
import { test } from 'node:test';
import AdmZip from 'adm-zip';
import { payloadHash, validateVersions } from '../tools/release-lib.mjs';
import { readState, writeState, hash } from '../tools/release-state.mjs';
import { queueRelease, resumeRelease } from '../tools/release-engine.mjs';

const sha = 'a'.repeat(40);
function zip(version = '0.2.1', { signed = false, code = 'same code' } = {}) {
  const archive = new AdmZip();
  archive.addFile('manifest.json', Buffer.from(JSON.stringify({ version, browser_specific_settings: { gecko: { id: 'rotblock@jeemzy.github.io', strict_min_version: '140.0' } } })));
  archive.addFile('core.js', Buffer.from(code));
  if (signed) archive.addFile('META-INF/mozilla.rsa', Buffer.from('signature fixture'));
  return archive.toBuffer();
}
function fixture(version = '0.2.1') {
  const unsigned = zip(version), signed = zip(version, { signed: true });
  const events = [];
  const releases = [];
  let metadata = { addons: { 'rotblock@jeemzy.github.io': { updates: [] } } };
  let revision = 0;
  let tagSha = sha;
  let uploadReady = false;
  let approved = false;
  let created = false;
  let uploads = 0;
  let versions = 0;
  let badPublic = false;
  let failCreateResponse = false;
  let failAfterPublish = false;
  let conflict = false;
  const gh = {
    tagCommit: async () => tagSha,
    isOnMain: async () => true,
    sourceVersions: async () => [version, version, version, version],
    getRelease: async tag => releases.find(r => r.tag_name === tag) ?? null,
    listReleases: async () => releases,
    createDraft: async (tag, source, body) => { const r = { id: releases.length + 1, tag_name: tag, draft: true, body, assets: [] }; releases.push(r); return r; },
    patchRelease: async (r, fields) => { Object.assign(r, fields); if (fields.draft === false) { events.push('publish'); if (failAfterPublish) { failAfterPublish = false; throw Error('connection lost after publish'); } } return r; },
    uploadAsset: async (r, name, bytes) => { const existing = r.assets.find(a => a.name === name); if (existing) { assert.equal(hash(existing.bytes), hash(bytes)); return existing; } const a = { id: r.assets.length + 1, name, bytes }; r.assets.push(a); events.push(`asset:${name}`); return a; },
    downloadAsset: async a => a.bytes,
    deleteAsset: async (r, a) => { r.assets = r.assets.filter(x => x !== a); },
    publicDownload: async () => { events.push('download'); return badPublic ? Buffer.from('wrong') : signed; },
    readUpdates: async () => ({ sha: String(revision), manifest: structuredClone(metadata) }),
    writeUpdates: async (expected, manifest) => { if (conflict) { conflict = false; const e = Error('conflict'); e.status = 409; throw e; } assert.equal(expected, String(revision)); metadata = manifest; revision++; events.push('metadata'); },
  };
  const amo = {
    getVersion: async () => created ? { id: 123, version, channel: 'unlisted', file: { status: approved ? 'public' : 'unreviewed', url: 'https://addons.mozilla.org/file.xpi', hash: hash(signed) } } : null,
    upload: async () => { uploads++; return { uuid: 'upload-uuid' }; },
    getUpload: async () => ({ processed: uploadReady, valid: true }),
    createVersion: async () => { created = true; versions++; if (failCreateResponse) { failCreateResponse = false; throw Error('connection lost after creation'); } return { id: 123 }; },
    download: async () => signed,
  };
  return { version, unsigned, signed, events, gh, amo, releases,
    queue: () => queueRelease({ gh, tag: `v${version}`, sourceSha: sha, bytes: unsigned }),
    resume: () => resumeRelease({ gh, amo, release: releases[0] }),
    ready: () => { uploadReady = true; }, approve: () => { approved = true; },
    counters: () => ({ uploads, versions }),
    metadata: () => metadata,
    moveTag: () => { tagSha = 'b'.repeat(40); },
    badDownload: value => { badPublic = value; },
    loseCreate: () => { failCreateResponse = true; },
    losePublish: () => { failAfterPublish = true; },
    conflict: () => { conflict = true; },
  };
}

test('tag versions must match every package version; payload identity ignores only Mozilla signature files', () => {
  assert.equal(validateVersions('v0.2.1', ['0.2.1', '0.2.1', '0.2.1', '0.2.1']), '0.2.1');
  assert.throws(() => validateVersions('v0.2.1', ['0.2.1', '0.2.0']), /version/i);
  assert.throws(() => validateVersions('v0.2.1-rc1', ['0.2.1-rc1']), /tag/i);
  assert.equal(payloadHash(zip()), payloadHash(zip('0.2.1', { signed: true })));
  assert.notEqual(payloadHash(zip()), payloadHash(zip('0.2.1', { signed: true, code: 'different' })));
});

test('Mozilla manifest JSON formatting is allowed, but semantic changes are rejected', () => {
  const original = zip();
  const signed = new AdmZip(zip('0.2.1', { signed: true }));
  const manifest = JSON.parse(signed.getEntry('manifest.json').getData().toString());
  signed.updateFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  assert.equal(payloadHash(original), payloadHash(signed.toBuffer()));
  manifest.permissions = ['tabs'];
  signed.updateFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  assert.notEqual(payloadHash(original), payloadHash(signed.toBuffer()));
});

test('durable state round trips and refuses secret-shaped extra fields', async () => {
  const f = fixture(); await f.queue();
  const state = readState(f.releases[0].body);
  assert.equal(state.sourceSha, sha);
  assert.equal(state.phase, 'queued');
  assert.equal(readState(writeState('Human notes', state)).zipHash, hash(f.unsigned));
  assert.throws(() => writeState('', { ...state, WEB_EXT_API_SECRET: 'never serialize this' }), /state/i);
});

test('validation and approval pending exit successfully, then publish only verified bytes and metadata', async () => {
  const f = fixture(); await f.queue();
  assert.equal(await f.resume(), 'validation-pending');
  f.ready(); assert.equal(await f.resume(), 'approval-pending');
  assert.equal(await f.resume(), 'approval-pending');
  assert.deepEqual(f.counters(), { uploads: 1, versions: 1 });
  f.approve(); assert.equal(await f.resume(), 'complete');
  assert.equal(f.releases[0].draft, false);
  assert.deepEqual(f.releases[0].assets.map(a => a.name), ['rotblock-0.2.1.xpi']);
  assert.ok(f.events.indexOf('download') < f.events.indexOf('metadata'));
  assert.equal(f.metadata().addons['rotblock@jeemzy.github.io'].updates[0].version, '0.2.1');
  const eventCount = f.events.length; assert.equal(await f.resume(), 'complete'); assert.equal(f.events.length, eventCount);
});

test('lost create response recovers by exact version lookup without a duplicate submission', async () => {
  const f = fixture(); await f.queue(); f.ready(); f.loseCreate();
  await assert.rejects(f.resume(), /connection lost/);
  assert.equal(await f.resume(), 'approval-pending');
  assert.equal(f.counters().versions, 1);
});

test('a moved tag and a mismatched signed payload are blocked', async () => {
  const f = fixture(); await f.queue(); f.moveTag();
  assert.equal(await f.resume(), 'blocked');
  assert.equal(f.counters().uploads, 0);
  const g = fixture(); await g.queue(); g.ready(); await g.resume(); g.approve();
  const wrong = zip('0.2.1', { signed: true, code: 'wrong source' });
  const originalGet = g.amo.getVersion;
  g.amo.getVersion = async () => { const v = await originalGet(); v.file.hash = hash(wrong); return v; };
  g.amo.download = async () => wrong;
  assert.equal(await g.resume(), 'blocked');
  assert.match(readState(g.releases[0].body).error, /contents/);
  assert.equal(g.releases[0].draft, true);
});

test('invalid uploads and disabled versions stop publication, transient errors preserve progress', async () => {
  const f = fixture(); await f.queue(); f.amo.getUpload = async () => ({ processed: true, valid: false });
  assert.equal(await f.resume(), 'blocked');
  assert.equal(f.releases[0].draft, true);
  const g = fixture(); await g.queue(); g.amo.getVersion = async () => ({ id: 123, version: g.version, channel: 'unlisted', file: { status: 'disabled' } });
  assert.equal(await g.resume(), 'blocked');
  const h = fixture(); await h.queue(); h.amo.getUpload = async () => { throw Error('API unavailable'); };
  await assert.rejects(h.resume(), /unavailable/);
  assert.equal(readState(h.releases[0].body).phase, 'validating');
});

test('public-download failures leave metadata unchanged and resume without overwriting signed assets', async () => {
  const f = fixture(); await f.queue(); f.ready(); await f.resume(); f.approve(); f.badDownload(true);
  await assert.rejects(f.resume(), /download/i);
  assert.equal(f.events.includes('metadata'), false);
  f.badDownload(false); assert.equal(await f.resume(), 'complete');
  assert.equal(f.events.filter(e => e === 'asset:rotblock-0.2.1.xpi').length, 1);
});

test('publication recovers after publishing succeeded but its response was lost, and retries file conflicts', async () => {
  const f = fixture(); await f.queue(); f.ready(); await f.resume(); f.approve(); f.losePublish();
  await assert.rejects(f.resume(), /connection lost/);
  f.conflict(); assert.equal(await f.resume(), 'complete');
  assert.equal(f.events.filter(e => e === 'metadata').length, 1);
});

test('an older approved version never downgrades updates or becomes latest', async () => {
  const f = fixture('0.2.1'); await f.queue(); f.ready(); await f.resume(); f.approve();
  const newer = { addons: { 'rotblock@jeemzy.github.io': { updates: [{ version: '0.3.0', update_hash: 'sha256:newer' }] } } };
  f.gh.readUpdates = async () => ({ sha: 'newer', manifest: newer });
  f.gh.listReleases = async () => [...f.releases, { tag_name: 'v0.3.0', draft: false }];
  assert.equal(await f.resume(), 'complete');
  assert.equal(f.events.includes('metadata'), false);
  assert.notEqual(f.releases[0].make_latest, 'true');
});

test('a duplicate queue run uses the saved ZIP, while changed payloads and source versions are refused', async () => {
  const f = fixture(); await f.queue();
  await f.queue();
  assert.equal(f.releases.length, 1);
  assert.equal(f.releases[0].assets.length, 1);
  await assert.rejects(queueRelease({ gh: f.gh, tag: 'v0.2.1', sourceSha: sha, bytes: zip('0.2.1', { code: 'changed' }) }), /contents/);
  f.gh.sourceVersions = async () => ['0.2.1', '0.2.0'];
  await assert.rejects(f.queue(), /version/i);
});

test('published metadata with conflicting bytes is blocked instead of overwritten', async () => {
  const f = fixture(); await f.queue(); f.ready(); await f.resume(); f.approve();
  f.gh.readUpdates = async () => ({ sha: 'current', manifest: { addons: { 'rotblock@jeemzy.github.io': { updates: [{ version: '0.2.1', update_hash: 'sha256:other' }] } } } });
  assert.equal(await f.resume(), 'blocked');
  assert.equal(f.events.includes('metadata'), false);
});
