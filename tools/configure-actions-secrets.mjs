import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { repository } from './release-state.mjs';

export function configureSecrets({ env = process.env, run = execFileSync } = {}) {
  const names = ['WEB_EXT_API_KEY', 'WEB_EXT_API_SECRET'];
  if (names.some(name => !env[name])) throw new Error('Signing credentials are missing');
  for (const name of names) {
    try { run('gh', ['secret', 'set', name, '--repo', repository], { input: env[name], stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { throw new Error(`Could not configure ${name}; check GitHub authentication and repository access`); }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    // File contents and subprocess output remain inside this process. Each value
    // reaches gh through stdin, never shell interpolation or command arguments.
    process.loadEnvFile(new URL('../rotblock.env', import.meta.url));
    configureSecrets();
    console.log('Configured both encrypted GitHub Actions signing secrets.');
  } catch { console.error('Could not configure signing secrets; verify the local credential file and GitHub access.'); process.exitCode = 1; }
}
