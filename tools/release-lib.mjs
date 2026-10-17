import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';

export const addonId = 'rotblock@jeemzy.github.io';
export const repository = 'jeemzy/rotblock';
export const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export function checkSignedArchive(bytes, version) {
  const zip = new AdmZip(bytes);
  const entry = zip.getEntry('manifest.json');
  if (!entry) throw new Error('XPI has no manifest');
  const manifest = JSON.parse(entry.getData().toString('utf8'));
  if (manifest.browser_specific_settings?.gecko?.id !== addonId) throw new Error('XPI add-on ID does not match rotblock');
  if (manifest.version !== version) throw new Error('XPI version does not match extension/manifest.json');
  if (!zip.getEntry('META-INF/mozilla.rsa') && !zip.getEntry('META-INF/cose.sig')) throw new Error('XPI has no Mozilla signature metadata; sign it first');
  // Structural check only. Firefox verifies the cryptographic signature on installation.
}

export function createUpdateManifest(version, bytes) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Use a three-part numeric release version');
  return { addons: { [addonId]: { updates: [{
    version,
    update_link: `https://github.com/${repository}/releases/download/v${version}/rotblock-${version}.xpi`,
    update_hash: hash(bytes),
    applications: { gecko: { strict_min_version: '140.0' } },
  }] } } };
}

export async function publishVerifiedUpdate({ version, bytes, upload, download, update }) {
  checkSignedArchive(bytes, version);
  const manifest = createUpdateManifest(version, bytes);
  const entry = manifest.addons[addonId].updates[0];
  await upload();
  const downloaded = await download(entry.update_link);
  if (hash(downloaded) !== entry.update_hash) throw new Error('Release download does not match the signed XPI; update manifest was not changed');
  await update(manifest);
  return manifest;
}
