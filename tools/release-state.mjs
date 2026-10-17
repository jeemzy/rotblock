import { createHash } from 'node:crypto';

export const repository = 'jeemzy/rotblock';
export const addonId = 'rotblock@jeemzy.github.io';
export const marker = 'rotblock-release-state:v1';
export const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export class PermanentError extends Error {}

export function versionParts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new PermanentError('Invalid stable version');
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new PermanentError('Invalid stable version');
  return parts;
}
export function compareVersions(a, b) {
  const av = versionParts(a), bv = versionParts(b);
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] - bv[i];
  return 0;
}

const fields = ['schema', 'tag', 'version', 'sourceSha', 'zipHash', 'payloadHash', 'phase', 'uploadId', 'amoVersionId', 'signedHash', 'error'];
const phases = ['queued', 'validating', 'submitted', 'approved', 'publishing', 'complete', 'blocked'];
const digest = value => /^sha256:[a-f0-9]{64}$/.test(value);
export function validateState(state) {
  if (!state || Object.keys(state).some(key => !fields.includes(key)) || fields.some(key => !(key in state))) throw new PermanentError('Invalid release state fields');
  versionParts(state.version);
  if (state.schema !== 1 || state.tag !== `v${state.version}` || !/^[a-f0-9]{40}$/.test(state.sourceSha)
    || !digest(state.zipHash) || !digest(state.payloadHash) || !phases.includes(state.phase)
    || !(state.uploadId === null || /^[a-zA-Z0-9-]{1,100}$/.test(state.uploadId))
    || !(state.amoVersionId === null || (Number.isSafeInteger(state.amoVersionId) && state.amoVersionId > 0))
    || !(state.signedHash === null || digest(state.signedHash))
    || !(state.error === null || (typeof state.error === 'string' && state.error.length <= 300))) throw new PermanentError('Invalid release state');
  return state;
}
const expression = /<!-- rotblock-release-state:v1\n([\s\S]*?)\n-->/;
export function readState(body = '') {
  const match = body?.match(expression);
  if (!match) return null;
  let state;
  try { state = JSON.parse(match[1]); } catch { throw new PermanentError('Invalid release state JSON'); }
  return validateState(state);
}
export function writeState(body, state) {
  validateState(state);
  const notes = (body ?? '').replace(expression, '').trim();
  return `${notes}\n\n<!-- ${marker}\n${JSON.stringify(state).replaceAll('<', '\\u003c')}\n-->`;
}
