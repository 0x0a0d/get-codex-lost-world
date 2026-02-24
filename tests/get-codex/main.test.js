'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { runMain, parseGithubRepoFromUrl, resolveGithubRepo } = require('../../lib/get-codex/main');


test('cache mode logs version', async () => {
  const logs = [];
  const deps = {
    env: { HOME: '/home/tester' },
    releaseApi: {
      async getLatest() {
        return {
          tag_name: 'v1.2.3',
          published_at: '2026-02-20T00:00:00Z',
          body: 'Release note body',
          assets: [
            { name: 'CodexIntelMac_1.2.3.dmg', browser_download_url: 'https://example.com/CodexIntelMac_1.2.3.dmg' },
          ],
        };
      },
    },
    io: {
      log(message) {
        logs.push(message);
      },
      async prompt() {
        return '';
      },
    },
    downloader: {
      async download() {
        throw new Error('should not download');
      },
    },
    signer: {
      async sign() {
        throw new Error('should not sign');
      },
    },
  };

  await runMain(['--cache'], deps);

  assert.ok(logs.some((line) => line.includes('Version: v1.2.3')));
});

test('cache mode with empty input does not download', async () => {
  let downloadCalls = 0;

  const result = await runMain(['--cache'], {
    env: { HOME: '/home/tester' },
    releaseApi: {
      async getLatest() {
        return {
          tag_name: 'v1.2.3',
          published_at: '2026-02-20T00:00:00Z',
          body: 'Release note body',
          assets: [
            { name: 'CodexIntelMac_1.2.3.dmg', browser_download_url: 'https://example.com/CodexIntelMac_1.2.3.dmg' },
          ],
        };
      },
    },
    io: {
      log() {},
      async prompt() {
        return '';
      },
    },
    downloader: {
      async download() {
        downloadCalls += 1;
      },
    },
    signer: {
      async sign() {},
    },
  });

  assert.equal(downloadCalls, 0);
  assert.equal(result.downloaded, false);
});

test('cache mode with location input triggers download', async () => {
  const calls = [];

  await runMain(['--cache'], {
    env: { HOME: '/home/tester' },
    releaseApi: {
      async getLatest() {
        return {
          tag_name: 'v1.2.3',
          published_at: '2026-02-20T00:00:00Z',
          body: 'Release note body',
          assets: [
            { name: 'CodexIntelMac_1.2.3.dmg', browser_download_url: 'https://example.com/CodexIntelMac_1.2.3.dmg' },
          ],
        };
      },
    },
    io: {
      log() {},
      async prompt(question) {
        if (question.includes('Download location')) {
          return '/tmp/downloads';
        }
        return 'n';
      },
    },
    downloader: {
      async download(url, location, filename) {
        calls.push({ url, location, filename });
        return path.join(location, filename);
      },
    },
    signer: {
      async sign() {},
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.com/CodexIntelMac_1.2.3.dmg');
  assert.equal(calls[0].location, '/tmp/downloads');
  assert.equal(calls[0].filename, 'CodexIntelMac_1.2.3.dmg');
});

test('cache mode honors --workdir and skips download location prompt', async () => {
  const calls = [];
  let promptCount = 0;

  await runMain(['--cache', '--workdir', '/tmp/cache-out'], {
    env: { HOME: '/home/tester' },
    releaseApi: {
      async getLatest() {
        return {
          tag_name: 'v1.2.3',
          published_at: '2026-02-20T00:00:00Z',
          body: 'Release note body',
          assets: [
            { name: 'CodexIntelMac_1.2.3.dmg', browser_download_url: 'https://example.com/CodexIntelMac_1.2.3.dmg' },
          ],
        };
      },
    },
    io: {
      log() {},
      async prompt(question) {
        promptCount += 1;
        if (question.includes('Sign downloaded file')) {
          return 'n';
        }
        throw new Error('Download location prompt should be skipped when --workdir is provided');
      },
    },
    downloader: {
      async download(url, location, filename) {
        calls.push({ url, location, filename });
        return path.join(location, filename);
      },
    },
    signer: {
      async sign() {},
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].location, '/tmp/cache-out');
  assert.equal(promptCount, 1);
});

test('cache mode prompts sign and yes triggers signer', async () => {
  const signed = [];

  await runMain(['--cache'], {
    env: { HOME: '/home/tester' },
    releaseApi: {
      async getLatest() {
        return {
          tag_name: 'v1.2.3',
          published_at: '2026-02-20T00:00:00Z',
          body: 'Release note body',
          assets: [
            { name: 'CodexIntelMac_1.2.3.dmg', browser_download_url: 'https://example.com/CodexIntelMac_1.2.3.dmg' },
          ],
        };
      },
    },
    io: {
      log() {},
      async prompt(question) {
        if (question.includes('Download location')) {
          return '/tmp/downloads';
        }
        return 'yes';
      },
    },
    downloader: {
      async download(url, location, filename) {
        return path.join(location, filename);
      },
    },
    signer: {
      async sign(targetPath) {
        signed.push(targetPath);
      },
    },
  });

  assert.equal(signed.length, 1);
  assert.equal(signed[0], '/tmp/downloads/CodexIntelMac_1.2.3.dmg');
});

test('cache mode on windows target skips sign prompt', async () => {
  let promptCount = 0;
  let signCalls = 0;

  const result = await runMain(['--cache', '--platform', 'windows', '--arch', 'x64', '--format', 'zip'], {
    env: { HOME: '/home/tester' },
    releaseApi: {
      async getLatest() {
        return {
          tag_name: 'v1.2.3',
          published_at: '2026-02-20T00:00:00Z',
          body: 'Release note body',
          assets: [
            { name: 'CodexWindows_x64_1.2.3.zip', browser_download_url: 'https://example.com/CodexWindows_x64_1.2.3.zip' },
          ],
        };
      },
    },
    io: {
      log() {},
      async prompt(question) {
        promptCount += 1;
        if (question.includes('Download location')) {
          return '/tmp/downloads';
        }
        throw new Error('sign prompt should not run for windows target');
      },
    },
    downloader: {
      async download(url, location, filename) {
        return path.join(location, filename);
      },
    },
    signer: {
      async sign() {
        signCalls += 1;
      },
    },
  });

  assert.equal(promptCount, 1);
  assert.equal(signCalls, 0);
  assert.equal(result.signed, false);
});

test('sign mode calls signer with provided path', async () => {
  const signed = [];

  const result = await runMain(['--sign', '/tmp/Codex.app'], {
    io: { log() {}, async prompt() { return ''; } },
    signer: {
      async sign(targetPath) {
        signed.push(targetPath);
      },
    },
    downloader: { async download() {} },
    releaseApi: { async getLatest() { return {}; } },
    env: { HOME: '/home/tester' },
  });

  assert.equal(signed.length, 1);
  assert.equal(signed[0], '/tmp/Codex.app');
  assert.equal(result.mode, 'sign');
});

test('default build mode runs build skeleton and downloader', async () => {
  const calls = [];
  const builderCalls = [];

  const result = await runMain([], {
    env: { HOME: '/home/tester', PWD: '/tmp/current-dir' },
    io: {
      log() {},
      async prompt() { return ''; },
    },
    downloader: {
      async download(url, location, filename) {
        calls.push({ url, location, filename });
        return path.join(location, filename);
      },
    },
    signer: { async sign() {} },
    releaseApi: {
      async getLatest() {
        return { tag_name: 'v1.2.3', assets: [] };
      },
    },
    builder: {
      async run(payload) {
        builderCalls.push(payload);
      },
    },
    versionResolver: {
      async resolveFromDmg() {
        return '1.2.3';
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].location, '/tmp/current-dir');
  assert.equal(calls[0].filename, 'Codex.dmg');
  assert.equal(builderCalls.length, 1);
  assert.equal(builderCalls[0].location, '/tmp/current-dir');
  assert.equal(builderCalls[0].outputName, 'CodexIntelMac_1.2.3.dmg');
  assert.equal(result.mode, 'build');
  assert.equal(result.downloaded, true);
  assert.equal(result.outputName, 'CodexIntelMac_1.2.3.dmg');
});

test('cache mode uses absolute default prompt when HOME is missing', async () => {
  let capturedDefaultValue = '';

  await runMain(['--cache'], {
    env: {},
    releaseApi: {
      async getLatest() {
        return {
          tag_name: 'v1.2.3',
          published_at: '2026-02-20T00:00:00Z',
          body: 'Release note body',
          assets: [
            { name: 'CodexIntelMac_1.2.3.dmg', browser_download_url: 'https://example.com/CodexIntelMac_1.2.3.dmg' },
          ],
        };
      },
    },
    io: {
      log() {},
      async prompt(_question, defaultValue) {
        capturedDefaultValue = defaultValue;
        return '';
      },
    },
    downloader: { async download() {} },
    signer: { async sign() {} },
  });

  assert.ok(path.isAbsolute(capturedDefaultValue));
  assert.equal(path.basename(capturedDefaultValue), 'Downloads');
});

test('build mode defaults to process cwd when PWD is missing', async () => {
  const calls = [];

  await runMain([], {
    env: {},
    io: {
      log() {},
      async prompt() { return ''; },
    },
    downloader: {
      async download(_url, location) {
        calls.push(location);
        return path.join(location, 'Codex.dmg');
      },
    },
    signer: { async sign() {} },
    releaseApi: { async getLatest() { return {}; } },
    builder: {},
    versionResolver: {
      async resolveFromDmg() {
        return '1.2.3';
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0], process.cwd());
});

test('build mode honors --workdir for download and builder output', async () => {
  const calls = [];
  const builderCalls = [];

  await runMain(['--workdir', '/tmp/build-out'], {
    env: { PWD: '/tmp/current-dir' },
    io: { log() {}, async prompt() { return ''; } },
    downloader: {
      async download(url, location, filename) {
        calls.push({ url, location, filename });
        return path.join(location, filename);
      },
    },
    signer: { async sign() {} },
    releaseApi: { async getLatest() { return { tag_name: 'v2.0.0' }; } },
    builder: {
      async run(payload) {
        builderCalls.push(payload);
      },
    },
    versionResolver: {
      async resolveFromDmg() {
        return '2.0.0';
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].location, '/tmp/build-out');
  assert.equal(builderCalls.length, 1);
  assert.equal(builderCalls[0].location, '/tmp/build-out');
  assert.equal(builderCalls[0].outputName, 'CodexIntelMac_2.0.0.dmg');
});

test('build mode supports windows output naming and target propagation', async () => {
  const builderCalls = [];

  const result = await runMain(['--workdir', '/tmp/build-out', '--platform', 'windows', '--arch', 'arm64', '--format', 'zip'], {
    env: { PWD: '/tmp/current-dir' },
    io: { log() {}, async prompt() { return ''; } },
    downloader: {
      async download(url, location, filename) {
        return path.join(location, filename);
      },
    },
    signer: { async sign() {} },
    releaseApi: { async getLatest() { return { tag_name: 'v2.0.0' }; } },
    builder: {
      async run(payload) {
        builderCalls.push(payload);
      },
    },
    versionResolver: {
      async resolveFromDmg() {
        return '2.0.0';
      },
    },
  });

  assert.equal(builderCalls.length, 1);
  assert.equal(builderCalls[0].outputName, 'CodexWindows_arm64_2.0.0.zip');
  assert.equal(builderCalls[0].target.platform, 'windows');
  assert.equal(result.outputName, 'CodexWindows_arm64_2.0.0.zip');
});

test('help mode prints usage and exits early', async () => {
  const logs = [];

  const result = await runMain(['--help'], {
    env: {},
    io: {
      log(message) {
        logs.push(message);
      },
      async prompt() {
        throw new Error('should not prompt in help mode');
      },
    },
  });

  assert.equal(result.mode, 'help');
  assert.ok(logs[0].includes('Usage:'));
});

test('parseGithubRepoFromUrl supports common GitHub repository URL formats', () => {
  assert.equal(
    parseGithubRepoFromUrl('https://github.com/octocat/hello-world'),
    'octocat/hello-world'
  );
  assert.equal(
    parseGithubRepoFromUrl('https://github.com/octocat/hello-world.git'),
    'octocat/hello-world'
  );
  assert.equal(
    parseGithubRepoFromUrl('git@github.com:octocat/hello-world.git'),
    'octocat/hello-world'
  );
  assert.equal(parseGithubRepoFromUrl('https://example.com/not-github/repo'), '');
});

test('resolveGithubRepo falls back to package.json repository URL', () => {
  assert.equal(resolveGithubRepo(), '0x0a0d/get-codex-mac-intel');
});
