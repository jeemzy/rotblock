import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import seleniumManager from 'selenium-webdriver/common/seleniumManager.js';

export const zenBinary = process.env.ZEN_BINARY ?? 'G:\\apps2\\Zen Browser\\zen.exe';
export const profileDirectory = path.join(process.env.LOCALAPPDATA, 'rotblock', 'zen-profile');

/** Start a headed Zen session. Selenium Manager provisions geckodriver. */
export async function startZenSession({ extension = false } = {}) {
  await access(zenBinary);
  await mkdir(profileDirectory, { recursive: true });
  // Zen reports its own product version to --version. Driver selection needs Gecko's version.
  const platform = await readFile(path.join(path.dirname(zenBinary), 'platform.ini'), 'utf8');
  const geckoVersion = platform.match(/^Milestone=(\d+)/m)?.[1];
  if (!geckoVersion) throw new Error('Cannot read the Gecko version from Zen platform.ini');
  const { driverPath } = seleniumManager.binaryPaths([
    '--browser', 'firefox', '--browser-version', geckoVersion,
    '--avoid-browser-download', '--avoid-stats', '--output', 'json',
  ]);
  const options = new firefox.Options()
    .setBinary(zenBinary)
    .setPreference('zen.welcome-screen.seen', true)
    .addArguments('-no-remote', '-profile', profileDirectory);
  const driver = await new Builder().forBrowser('firefox')
    .setFirefoxOptions(options)
    .setFirefoxService(new firefox.ServiceBuilder(driverPath))
    .build();
  try {
    await driver.manage().setTimeouts({ pageLoad: 45_000, script: 15_000 });
    if (extension) await driver.installWebExtension(fileURLToPath(new URL('../extension/', import.meta.url)), { permanent: false });
  } catch (error) {
    await driver.quit().catch(() => {});
    throw error;
  }
  return driver;
}
