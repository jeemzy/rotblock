import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Local development signing remains available. Production publication is handled
// exclusively by the durable release pipeline, including npm run publish.
const root = fileURLToPath(new URL('../', import.meta.url));
try {
  if (process.argv[2] !== 'sign') throw new Error('Use npm run sign for local signing, or npm run release:resume for pipeline recovery');
  for (const name of ['rotblock.env', '.env']) {
    if (process.env.WEB_EXT_API_KEY && process.env.WEB_EXT_API_SECRET) break;
    try { process.loadEnvFile(path.join(root, name)); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Could not load local signing credentials'); }
  }
  if (!process.env.WEB_EXT_API_KEY || !process.env.WEB_EXT_API_SECRET) throw new Error('Local signing credentials are missing');
  const webExt = args => execFileSync(process.execPath,
    [path.join(root, 'node_modules/web-ext/bin/web-ext.js'), ...args], { cwd: root, stdio: 'inherit' });
  webExt(['lint', '--self-hosted', '--warnings-as-errors']);
  webExt(['sign', '--channel=unlisted']);
} catch (error) { console.error(error.message); process.exitCode = 1; }
