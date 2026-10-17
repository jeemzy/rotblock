import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import AdmZip from 'adm-zip';
import { checkSignedArchive, createUpdateManifest, publishVerifiedUpdate } from '../tools/release-lib.mjs';

function archive({ signed = true, id = 'rotblock@jeemzy.github.io', version = '0.1.0' } = {}) {
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({ version, browser_specific_settings: { gecko: { id } } })));
  if (signed) zip.addFile('META-INF/mozilla.rsa', Buffer.from('signature metadata fixture'));
  return zip.toBuffer();
}

test('release validation rejects unsigned or mismatched archives', () => {
  assert.throws(() => checkSignedArchive(archive({ signed: false }), '0.1.0'), /signature/);
  assert.throws(() => checkSignedArchive(archive({ id: 'other@example.com' }), '0.1.0'), /ID/);
  assert.throws(() => checkSignedArchive(archive({ version: '0.2.0' }), '0.1.0'), /version/);
  checkSignedArchive(archive(), '0.1.0');
});

test('update metadata points to the versioned release and hashes its actual signed bytes', () => {
  const bytes = archive();
  const entry = createUpdateManifest('0.1.0', bytes).addons['rotblock@jeemzy.github.io'].updates[0];
  assert.equal(entry.update_link, 'https://github.com/jeemzy/rotblock/releases/download/v0.1.0/rotblock-0.1.0.xpi');
  assert.equal(entry.update_hash, `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
});

test('never publishes update metadata until the downloaded artifact matches', async () => {
  const events = [];
  const bytes = archive();
  await assert.rejects(publishVerifiedUpdate({ version: '0.1.0', bytes,
    upload: async () => events.push('upload'),
    download: async () => { events.push('download'); return Buffer.from('wrong artifact'); },
    update: async () => events.push('update'),
  }), /download/);
  assert.deepEqual(events, ['upload','download']);
  events.length = 0;
  await publishVerifiedUpdate({ version: '0.1.0', bytes,
    upload: async () => events.push('upload'),
    download: async () => { events.push('download'); return bytes; },
    update: async () => events.push('update'),
  });
  assert.deepEqual(events, ['upload','download','update']);
});
