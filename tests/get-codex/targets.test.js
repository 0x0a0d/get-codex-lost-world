'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTarget } = require('../../lib/get-codex/targets');

test('normalizeTarget defaults to mac x64 dmg', () => {
  assert.deepEqual(normalizeTarget({}), {
    platform: 'mac',
    arch: 'x64',
    format: 'dmg',
  });
});

test('normalizeTarget supports windows arm64 zip', () => {
  assert.deepEqual(normalizeTarget({ platform: 'windows', arch: 'arm64', format: 'zip' }), {
    platform: 'windows',
    arch: 'arm64',
    format: 'zip',
  });
});

test('normalizeTarget rejects unsupported combinations', () => {
  assert.throws(() => normalizeTarget({ platform: 'windows', arch: 'ppc64', format: 'zip' }), /Unsupported arch/);
  assert.throws(() => normalizeTarget({ platform: 'windows', arch: 'x64', format: 'dmg' }), /Unsupported format/);
});
