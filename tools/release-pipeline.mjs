import { appendFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { GitHubClient } from './github-release.mjs';
import { readState, versionParts } from './release-state.mjs';

const command = process.argv[2];
const output = async (name, value) => {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
};
const summary = async text => {
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${text}\n\n`);
};
try {
  if (process.argv.length > 3) throw new Error('Set TAG, SOURCE_SHA, ZIP_PATH, or RETRY_TAG as environment variables; XPI path arguments are no longer accepted');
  if (command === 'verify') {
    const { validateVersions } = await import('./release-lib.mjs');
    const read = async file => JSON.parse(await readFile(file, 'utf8'));
    const [manifest, pkg, lock] = await Promise.all([read('extension/manifest.json'), read('package.json'), read('package-lock.json')]);
    const tag = process.env.TAG;
    const version = validateVersions(tag, [manifest.version, pkg.version, lock.version, lock.packages[''].version]);
    const git = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const sha = git(['rev-parse', 'HEAD']);
    if (git(['rev-parse', `${tag}^{commit}`]) !== sha) throw new Error('Checkout does not match the release tag');
    try { git(['merge-base', '--is-ancestor', sha, 'origin/main']); }
    catch { throw new Error('Release commit must belong to origin/main'); }
    await output('version', version); await output('sha', sha);
    await summary(`Validated ${tag} at ${sha}.`);
  } else if (command === 'pending' || command === 'resume') {
    const gh = new GitHubClient();
    const retryTag = process.env.RETRY_TAG ?? '';
    if (retryTag) { if (!retryTag.startsWith('v')) throw new Error('Invalid retry tag'); versionParts(retryTag.slice(1)); }
    const releases = (await gh.listReleases()).filter(release => {
      const state = readState(release.body);
      return state && state.phase !== 'complete' && (retryTag ? state.tag === retryTag : state.phase !== 'blocked');
    });
    await output('has_pending', releases.length ? 'true' : 'false');
    if (command === 'pending' || !releases.length) await summary(`Pending releases: ${releases.length}.`);
    else {
      if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Use npm run publish to dispatch the serialized Actions finalizer');
      const { AmoClient } = await import('./amo.mjs');
      const { resumeRelease } = await import('./release-engine.mjs');
      const amo = new AmoClient();
      for (const release of releases) {
        const state = readState(release.body);
        try {
          const result = await resumeRelease({ gh, amo, release, retry: !!retryTag });
          await summary(`${state.tag}: ${result}.${result === 'blocked' ? ` ${readState((await gh.getRelease(state.tag)).body).error}` : ''}`);
          if (result === 'blocked') process.exitCode = 1;
        } catch (error) {
          // Client errors deliberately exclude response bodies and auth headers.
          await summary(`${state.tag}: retryable failure — ${error.message}`);
          process.exitCode = 1;
        }
      }
    }
  } else if (command === 'queue') {
    const { queueRelease } = await import('./release-engine.mjs');
    const release = await queueRelease({ gh: new GitHubClient(), tag: process.env.TAG,
      sourceSha: process.env.SOURCE_SHA, bytes: await readFile(process.env.ZIP_PATH) });
    await summary(`${readState(release.body).tag}: build durably queued for signing.`);
  } else throw new Error('Use verify, queue, pending, or resume');
} catch (error) { console.error(error.message); process.exitCode = 1; }
