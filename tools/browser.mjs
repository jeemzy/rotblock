import repl from 'node:repl';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startZenSession, profileDirectory } from './zen.mjs';
import { inspectYouTube } from './youtube-dom.mjs';

const driver = await startZenSession();
try {
  await driver.get('https://www.youtube.com/');
} catch (error) {
  console.error(`YouTube did not finish loading: ${error.message}. The driver is still available below.`);
}
console.log(`Zen testing profile: ${profileDirectory}`);
console.log('Use await driver.getCurrentUrl(), await driver.executeScript(...), or await screenshot().');
console.log('Use await inspect() to read YouTube Shorts and regular-video DOM structures.');
console.log('Use .exit to close this testing browser. Your everyday profile is separate.');
const terminal = repl.start({ prompt: 'rotblock> ' });
terminal.context.driver = driver;
terminal.context.inspect = () => inspectYouTube(driver);
terminal.context.screenshot = async () => {
  const directory = new URL('../artifacts/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const file = new URL(`zen-${Date.now()}.png`, directory);
  await writeFile(file, Buffer.from(await driver.takeScreenshot(), 'base64'));
  return fileURLToPath(file);
};
terminal.on('exit', () => { driver.quit().catch(console.error); });
