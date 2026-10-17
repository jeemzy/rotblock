import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Builder } from 'selenium-webdriver';
import seleniumManager from 'selenium-webdriver/common/seleniumManager.js';
import { startZenSession } from '../tools/zen.mjs';

test('a failed session configuration closes Zen and releases its profile', async context => {
  const error = new Error('The browser disconnected during timeout configuration');
  let closed = false;
  context.mock.method(seleniumManager, 'binaryPaths', () => ({ driverPath: 'unused-by-test' }));
  context.mock.method(Builder.prototype, 'build', async () => ({
    manage: () => ({ setTimeouts: async () => { throw error; } }),
    quit: async () => { closed = true; },
  }));
  await assert.rejects(startZenSession(), error);
  assert.equal(closed, true, 'Never leave an unreachable driver holding the persistent profile');
});

test('a rejected extension install closes the launched browser', async context => {
  let closed = false;
  const error = new Error('Extension installation failed');
  context.mock.method(seleniumManager, 'binaryPaths', () => ({ driverPath: 'unused-by-test' }));
  context.mock.method(Builder.prototype, 'build', async () => ({
    manage: () => ({ setTimeouts: async () => {} }),
    installWebExtension: async () => { throw error; },
    quit: async () => { closed = true; },
  }));
  await assert.rejects(startZenSession({ extension: true }), error);
  assert.equal(closed, true);
});
