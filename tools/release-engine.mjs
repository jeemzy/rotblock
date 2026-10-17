import { addonId, repository, hash, PermanentError, compareVersions, readState, writeState } from './release-state.mjs';
import { packageManifest, payloadHash, validateVersions, checkSignedArchive, createUpdateManifest } from './release-lib.mjs';

const unsignedName = state => `rotblock-${state.version}.unsigned.zip`;
const signedName = state => `rotblock-${state.version}.xpi`;
async function checkSource(gh, state) {
  if (await gh.tagCommit(state.tag) !== state.sourceSha) throw new PermanentError('Release tag target changed');
  if (!await gh.isOnMain(state.sourceSha)) throw new PermanentError('Release commit is not on main');
}

export async function queueRelease({ gh, tag, sourceSha, bytes }) {
  const manifest = packageManifest(bytes);
  const version = validateVersions(tag, [manifest.version, ...await gh.sourceVersions(sourceSha)]);
  const contentHash = payloadHash(bytes);
  let release = await gh.getRelease(tag);
  let state = release ? readState(release.body) : null;
  if (release && !state) throw new PermanentError('Release already exists outside this pipeline');
  if (state && (state.tag !== tag || state.version !== version)) throw new PermanentError('Release state does not match its tag');
  if (state && (state.sourceSha !== sourceSha || state.payloadHash !== contentHash)) throw new PermanentError('Release source or package contents changed');
  state ??= { schema: 1, tag, version, sourceSha, zipHash: hash(bytes), payloadHash: contentHash,
    phase: 'queued', uploadId: null, amoVersionId: null, signedHash: null, error: null };
  await checkSource(gh, state);
  release ??= await gh.createDraft(tag, sourceSha, writeState(`Signed rotblock ${version}.\n\nSource: https://github.com/${repository}/commit/${sourceSha}`, state));
  if (state.phase !== 'queued') return release;
  const existing = release.assets.find(a => a.name === unsignedName(state));
  if (existing) {
    if (hash(await gh.downloadAsset(existing)) !== state.zipHash) throw new PermanentError('Stored unsigned ZIP changed');
  } else {
    // Rebuilt ZIP timestamps may differ after a runner failure. Its file payload
    // must still match the original; persist the new ZIP hash before uploading.
    state.zipHash = hash(bytes);
    release = await gh.patchRelease(release, { body: writeState(release.body, state) });
    await gh.uploadAsset(release, unsignedName(state), bytes, 'application/zip');
  }
  return release;
}

async function updateManifest(gh, state, bytes) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await gh.readUpdates();
    const entries = current.manifest.addons?.[addonId]?.updates ?? [];
    if (entries.some(e => compareVersions(e.version, state.version) > 0)) return false;
    const same = entries.find(e => e.version === state.version);
    if (same) {
      if (same.update_hash !== state.signedHash) throw new PermanentError('Published version has different signed bytes');
      return true;
    }
    try { await gh.writeUpdates(current.sha, createUpdateManifest(state.version, bytes), state.version); return true; }
    catch (error) { if (![409, 422].includes(error.status) || attempt === 3) throw error; }
  }
}

export async function resumeRelease({ gh, amo, release, retry = false }) {
  let state = readState(release.body);
  if (!state) throw new PermanentError('Release is not managed by this pipeline');
  const syntheticDraft = release.draft && release.tag_name.startsWith('untagged-') && release.target_commitish === state.sourceSha;
  if (state.tag !== release.tag_name && !syntheticDraft) throw new PermanentError('Release state does not match its tag');
  if (state.phase === 'complete') return 'complete';
  if (state.phase === 'blocked' && !retry) return 'blocked';
  const save = async (phase, changes = {}) => {
    state = { ...state, ...changes, phase, error: null };
    release = await gh.patchRelease(release, { body: writeState(release.body, state) });
  };
  try {
    await checkSource(gh, state);
    const version = await amo.getVersion(state.version);
    if (!version) {
      if (state.amoVersionId || state.signedHash) throw new PermanentError('Mozilla version disappeared; refusing to resubmit');
      let asset = release.assets.find(a => a.name === unsignedName(state));
      if (!asset) throw new Error('Unsigned build asset missing; rerun the tag workflow');
      const bytes = await gh.downloadAsset(asset);
      if (hash(bytes) !== state.zipHash || payloadHash(bytes) !== state.payloadHash) throw new PermanentError('Unsigned build asset failed verification');
      if (!state.uploadId) {
        const upload = await amo.upload(bytes);
        await save('validating', { uploadId: upload.uuid });
      }
      const upload = await amo.getUpload(state.uploadId);
      if (!upload.processed) return 'validation-pending';
      if (!upload.valid) throw new PermanentError('Mozilla validation failed; inspect the AMO developer dashboard');
      const created = await amo.createVersion(state.uploadId);
      await save('submitted', { amoVersionId: created.id });
      return 'approval-pending';
    }
    if (version.version !== state.version || version.channel !== 'unlisted'
      || (state.amoVersionId && state.amoVersionId !== version.id)) throw new PermanentError('Mozilla version identity changed');
    if (!state.amoVersionId) await save('submitted', { amoVersionId: version.id });
    if (['disabled', 'deleted', 'rejected'].includes(version.file?.status)) throw new PermanentError('Mozilla version is disabled or rejected; manual attention required');
    if (version.file?.status !== 'public') return 'approval-pending';
    const bytes = await amo.download(version.file.url);
    if (hash(bytes) !== version.file.hash) throw new PermanentError('Mozilla signed download hash mismatch');
    try { checkSignedArchive(bytes, state.version); }
    catch { throw new PermanentError('Mozilla package signature metadata or identity is invalid'); }
    if (payloadHash(bytes) !== state.payloadHash) throw new PermanentError('Signed package contents do not match the original build');
    if (state.signedHash && state.signedHash !== hash(bytes)) throw new PermanentError('Signed bytes changed for an existing release');
    await save('approved', { signedHash: hash(bytes) });
    release = await gh.getRelease(state.tag);
    const asset = await gh.uploadAsset(release, signedName(state), bytes, 'application/x-xpinstall');
    if (hash(await gh.downloadAsset(asset)) !== state.signedHash) throw new PermanentError('GitHub signed asset mismatch');
    for (const temporary of release.assets.filter(a => a.name === unsignedName(state))) await gh.deleteAsset(release, temporary);
    await save('publishing');
    if (release.draft) release = await gh.patchRelease(release, { tag_name: state.tag, target_commitish: state.sourceSha, draft: false, make_latest: 'false' });
    const publicBytes = await gh.publicDownload(`https://github.com/${repository}/releases/download/${state.tag}/${signedName(state)}`);
    if (hash(publicBytes) !== state.signedHash) throw new Error('Public release download does not match; update metadata unchanged');
    const current = await updateManifest(gh, state, bytes);
    const newerRelease = (await gh.listReleases()).some(r => !r.draft && /^v\d+\.\d+\.\d+$/.test(r.tag_name) && compareVersions(r.tag_name.slice(1), state.version) > 0);
    if (current && !newerRelease) release = await gh.patchRelease(release, { make_latest: 'true' });
    await save('complete');
    return 'complete';
  } catch (error) {
    if (!(error instanceof PermanentError)) throw error;
    state = { ...state, phase: 'blocked', error: error.message };
    await gh.patchRelease(release, { body: writeState(release.body, state) });
    return 'blocked';
  }
}
