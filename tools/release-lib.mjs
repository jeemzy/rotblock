import AdmZip from 'adm-zip';
import { hash, addonId, repository, PermanentError, versionParts } from './release-state.mjs';

export { hash, addonId, repository };

const signatures = new Set(['META-INF/mozilla.rsa', 'META-INF/mozilla.sf', 'META-INF/manifest.mf', 'META-INF/cose.manifest', 'META-INF/cose.sig']);
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export function payloadHash(bytes) {
  const names = new Set();
  const files = [];
  for (const entry of new AdmZip(bytes).getEntries()) {
    const name = entry.entryName;
    if (names.has(name) || name.includes('\\') || name.startsWith('/') || name.split('/').some(p => p === '..' || p === '.')) throw new PermanentError('Invalid or duplicate ZIP entry');
    names.add(name);
    if (!entry.isDirectory && !signatures.has(name)) {
      // AMO parses and reserializes manifest.json (indentation, escapes, newline).
      // Only its JSON representation may change; every value must remain equal.
      const bytes = name === 'manifest.json' ? Buffer.from(JSON.stringify(canonical(JSON.parse(entry.getData().toString('utf8'))))) : entry.getData();
      files.push([name, hash(bytes)]);
    }
  }
  files.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return hash(Buffer.from(JSON.stringify(files)));
}
export function validateVersions(tag, versions) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new PermanentError('Invalid release tag; use vX.Y.Z');
  const version = tag.slice(1);
  versionParts(version);
  if (versions.length < 2 || versions.some(value => value !== version)) throw new PermanentError('Tag and package versions do not match');
  return version;
}
export function packageManifest(bytes) {
  const entry = new AdmZip(bytes).getEntry('manifest.json');
  if (!entry) throw new PermanentError('Package has no manifest');
  const manifest = JSON.parse(entry.getData().toString('utf8'));
  if (manifest.browser_specific_settings?.gecko?.id !== addonId) throw new PermanentError('Package add-on ID does not match rotblock');
  versionParts(manifest.version);
  return manifest;
}

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
    applications: { gecko: { strict_min_version: packageManifest(bytes).browser_specific_settings.gecko.strict_min_version ?? '140.0' } },
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
