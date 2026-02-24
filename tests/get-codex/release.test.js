'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeRelease, pickLatestDmgAsset, pickLatestAssetForTarget } = require('../../lib/get-codex/release');

test('summarizeRelease returns version, datetime, notes', () => {
  const release = {
    tag_name: 'v1.2.3',
    published_at: '2026-01-01T00:00:00Z',
    body: 'Release notes',
  };

  assert.deepEqual(summarizeRelease(release), {
    version: 'v1.2.3',
    datetime: '2026-01-01T00:00:00Z',
    notes: 'Release notes',
  });
});

test('pickLatestDmgAsset prefers CodexIntelMac_*.dmg', () => {
  const release = {
    assets: [
      { name: 'Codex.dmg', browser_download_url: 'https://example.com/1' },
      { name: 'CodexIntelMac_1.2.3.dmg', browser_download_url: 'https://example.com/2' },
    ],
  };

  assert.equal(
    pickLatestDmgAsset(release).name,
    'CodexIntelMac_1.2.3.dmg'
  );
});

test('pickLatestDmgAsset falls back to first dmg', () => {
  const release = {
    assets: [
      { name: 'SomethingElse.dmg', browser_download_url: 'https://example.com/1' },
      { name: 'AnotherAsset.zip', browser_download_url: 'https://example.com/2' },
    ],
  };

  assert.equal(
    pickLatestDmgAsset(release).name,
    'SomethingElse.dmg'
  );
});

test('pickLatestDmgAsset throws when no dmg asset exists', () => {
  const release = {
    assets: [
      { name: 'artifact.zip', browser_download_url: 'https://example.com/1' },
    ],
  };

  assert.throws(() => pickLatestDmgAsset(release), /No \.dmg asset found/);
});

test('pickLatestDmgAsset throws when selected dmg lacks browser_download_url', () => {
  const release = {
    assets: [
      { name: 'CodexIntelMac_1.2.3.dmg', browser_download_url: '   ' },
    ],
  };

  assert.throws(
    () => pickLatestDmgAsset(release),
    /missing browser_download_url/
  );
});

test('pickLatestAssetForTarget selects windows x64 zip', () => {
  const release = {
    assets: [
      { name: 'CodexWindows_arm64_1.2.3.zip', browser_download_url: 'https://example.com/arm64.zip' },
      { name: 'CodexWindows_x64_1.2.3.zip', browser_download_url: 'https://example.com/x64.zip' },
    ],
  };

  assert.equal(
    pickLatestAssetForTarget(release, { platform: 'windows', arch: 'x64', format: 'zip' }).name,
    'CodexWindows_x64_1.2.3.zip'
  );
});

test('pickLatestAssetForTarget throws when windows arch is unavailable', () => {
  const release = {
    assets: [
      { name: 'CodexWindows_x64_1.2.3.zip', browser_download_url: 'https://example.com/x64.zip' },
    ],
  };

  assert.throws(
    () => pickLatestAssetForTarget(release, { platform: 'windows', arch: 'arm64', format: 'zip' }),
    /No \.zip asset found for windows\/arm64/
  );
});
