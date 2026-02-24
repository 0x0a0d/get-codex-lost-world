'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeVersion, makeOutputName, makeOutputNameForTarget } = require('../../lib/get-codex/build');

test('sanitizeVersion converts spaces to dashes', () => {
  assert.equal(sanitizeVersion('1.2.3 beta'), '1.2.3-beta');
});

test('makeOutputName returns CodexIntelMac_<version>.dmg', () => {
  assert.equal(makeOutputName('1.2.3'), 'CodexIntelMac_1.2.3.dmg');
});

test('sanitizeVersion replaces disallowed characters with dashes', () => {
  assert.equal(sanitizeVersion('1/2:3'), '1-2-3');
});

test('makeOutputNameForTarget returns windows x64 zip naming', () => {
  assert.equal(
    makeOutputNameForTarget({ version: '1.2.3', platform: 'windows', arch: 'x64', format: 'zip' }),
    'CodexWindows_x64_1.2.3.zip'
  );
});

test('makeOutputNameForTarget returns windows arm64 zip naming', () => {
  assert.equal(
    makeOutputNameForTarget({ version: '1.2.3 beta', platform: 'windows', arch: 'arm64', format: 'zip' }),
    'CodexWindows_arm64_1.2.3-beta.zip'
  );
});
