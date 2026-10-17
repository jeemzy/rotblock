import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir } from 'node:fs/promises';
import { profileDirectory, zenBinary } from './zen.mjs';

// Open the testing profile as an ordinary browser, with no WebDriver session.
await access(zenBinary);
await mkdir(profileDirectory, { recursive: true });
const browser = spawn(zenBinary, [
  '-no-remote', '-profile', profileDirectory, 'https://www.youtube.com/',
], { detached: true, stdio: 'ignore', windowsHide: false });
await once(browser, 'spawn');
browser.unref();
console.log(`Opened normal Zen with testing profile: ${profileDirectory}`);
console.log('Sign in manually, close this testing window, then run npm run browser.');
