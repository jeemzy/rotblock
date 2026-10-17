import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile, mkdtemp, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addonId, repository, hash, checkSignedArchive, publishVerifiedUpdate } from './release-lib.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const extension = JSON.parse(await readFile(path.join(root, 'extension/manifest.json'), 'utf8'));
const version = extension.version;
const command = process.argv[2];
const gh = args => execFileSync('gh', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const webExt = args => execFileSync(process.execPath,
  [path.join(root, 'node_modules/web-ext/bin/web-ext.js'), ...args], { cwd: root, stdio: 'inherit' });

try {
  if (command === 'sign') {
    for (const name of ['rotblock.env', '.env']) {
      if (process.env.WEB_EXT_API_KEY && process.env.WEB_EXT_API_SECRET) break;
      try { process.loadEnvFile(path.join(root, name)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!process.env.WEB_EXT_API_KEY || !process.env.WEB_EXT_API_SECRET) {
      throw new Error('Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET locally (or in ignored rotblock.env/.env). Obtain them at https://addons.mozilla.org/developers/addon/api/key/. Do not share them in chat or commit them.');
    }
    webExt(['lint', '--self-hosted', '--warnings-as-errors']);
    webExt(['sign', '--channel=unlisted']);
  } else if (command === 'publish') {
    if (!process.argv[3]) throw new Error('Usage: npm run publish -- path/to/signed.xpi');
    const input = path.resolve(process.argv[3]);
    if (path.extname(input).toLowerCase() !== '.xpi') throw new Error('Publish the signed .xpi returned by Mozilla');
    const bytes = await readFile(input);
    checkSignedArchive(bytes, version);
    const remoteSource = JSON.parse(Buffer.from(JSON.parse(gh(['api', `repos/${repository}/contents/extension/manifest.json?ref=main`])).content, 'base64').toString('utf8'));
    if (remoteSource.version !== version) throw new Error('Push this extension version to GitHub main before publishing');
    const currentFile = JSON.parse(gh(['api', `repos/${repository}/contents/updates.json?ref=main`]));
    const current = JSON.parse(Buffer.from(currentFile.content, 'base64').toString('utf8'));
    const entries = current.addons?.[addonId]?.updates ?? [];
    const compare = (a, b) => {
      const av = a.split('.').map(Number), bv = b.split('.').map(Number);
      for (let i = 0; i < 3; i++) { if (av[i] !== bv[i]) return av[i] - bv[i]; }
      return 0;
    };
    if (entries.some(entry => compare(entry.version, version) > 0)) throw new Error('A newer version is already published; refusing to downgrade updates');
    const same = entries.find(entry => entry.version === version);
    if (same && same.update_hash !== hash(bytes)) throw new Error('This version already has different signed bytes; increment the version');
    const directory = path.join(root, 'artifacts/release');
    await mkdir(directory, { recursive: true });
    const filename = path.join(directory, `rotblock-${version}.xpi`);
    if (input !== filename) await copyFile(input, filename);
    const tag = `v${version}`;
    await publishVerifiedUpdate({ version, bytes,
      upload: async () => {
        let existing;
        try { existing = JSON.parse(gh(['release', 'view', tag, '--repo', repository, '--json', 'assets'])); }
        catch (error) {
          if (!/release not found|not found|404/i.test(error.stderr?.toString() ?? error.message)) throw error;
        }
        if (existing) {
          if (!existing.assets.some(asset => asset.name === path.basename(filename))) throw new Error('Release exists without the expected asset; repair the release before retrying');
        } else {
          gh(['release', 'create', tag, filename, '--repo', repository, '--target', 'main', '--title', tag, '--notes', `Signed rotblock ${version} release.`]);
        }
      },
      download: async url => {
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`Cannot verify release download: HTTP ${response.status}. Retry publishing after the asset is available.`);
        return Buffer.from(await response.arrayBuffer());
      },
      update: async manifest => {
        const temporary = await mkdtemp(path.join(tmpdir(), 'rotblock-release-'));
        const request = path.join(temporary, 'update-request.json');
        await writeFile(request, JSON.stringify({
          message: `release: publish rotblock ${version} update`,
          branch: 'main', sha: currentFile.sha,
          content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`).toString('base64'),
        }));
        gh(['api', '--method', 'PUT', `repos/${repository}/contents/updates.json`, '--input', request]);
      },
    });
    console.log(`Published ${tag}; the signed download was verified before updating updates.json. Run git pull --ff-only to sync the remote update commit.`);
  } else {
    throw new Error('Choose sign or publish');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
