'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLocalBuilder } = require('../../lib/get-codex/local-builder');

test('local builder validates required inputs', async () => {
  const builder = createLocalBuilder({
    builderEntry: '/tmp/builder.js',
    fsApi: { existsSync: () => true, mkdirSync() {} },
    spawnSync: () => ({ status: 0 }),
    nodeExecPath: '/usr/bin/node',
  });

  await assert.rejects(() => builder.run({ location: '', downloadedPath: '/tmp/Codex.dmg', outputName: 'x.dmg' }), /location is required/);
  await assert.rejects(() => builder.run({ location: '/tmp', downloadedPath: '', outputName: 'x.dmg' }), /source Codex\.dmg path is required/);
  await assert.rejects(() => builder.run({ location: '/tmp', downloadedPath: '/tmp/Codex.dmg', outputName: '' }), /output filename is required/);
});

test('local builder fails when entrypoint is missing', async () => {
  const builder = createLocalBuilder({
    builderEntry: '/tmp/missing.js',
    fsApi: { existsSync: () => false, mkdirSync() {} },
    spawnSync: () => ({ status: 0 }),
  });

  await assert.rejects(
    () => builder.run({ location: '/tmp', downloadedPath: '/tmp/Codex.dmg', outputName: 'out.dmg' }),
    /entrypoint \(missing\.js\) was not found/
  );
});

test('local builder executes node with expected args', async () => {
  const spawnCalls = [];
  const mkdirCalls = [];
  const builder = createLocalBuilder({
    builderEntry: '/tmp/builder.js',
    fsApi: {
      existsSync: () => true,
      mkdirSync(dir, opts) {
        mkdirCalls.push({ dir, opts });
      },
    },
    spawnSync(execPath, args, opts) {
      spawnCalls.push({ execPath, args, opts });
      return { status: 0 };
    },
    nodeExecPath: '/usr/bin/node',
  });

  const result = await builder.run({
    location: '/tmp/output',
    downloadedPath: '/tmp/output/Codex.dmg',
    outputName: 'CodexIntelMac_1.2.3.dmg',
  });

  assert.equal(mkdirCalls.length, 1);
  assert.equal(spawnCalls.length, 1);
  assert.deepEqual(spawnCalls[0], {
    execPath: '/usr/bin/node',
    args: [
      '/tmp/builder.js',
      '--output',
      '/tmp/output/CodexIntelMac_1.2.3.dmg',
      '/tmp/output/Codex.dmg',
    ],
    opts: { stdio: 'inherit' },
  });
  assert.equal(result.outputPath, path.join('/tmp/output', 'CodexIntelMac_1.2.3.dmg'));
});

test('local builder selects windows entrypoint when target platform is windows', async () => {
  const spawnCalls = [];
  const builder = createLocalBuilder({
    builderEntry: '/tmp/mac-builder.js',
    windowsBuilderEntry: '/tmp/windows-builder.js',
    fsApi: {
      existsSync(filePath) {
        return filePath === '/tmp/windows-builder.js';
      },
      mkdirSync() {},
    },
    spawnSync(execPath, args) {
      spawnCalls.push({ execPath, args });
      return { status: 0 };
    },
    nodeExecPath: '/usr/bin/node',
  });

  await builder.run({
    location: '/tmp/output',
    downloadedPath: '/tmp/output/Codex.dmg',
    outputName: 'CodexWindows_x64_1.2.3.zip',
    target: { platform: 'windows', arch: 'x64', format: 'zip' },
  });

  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].args[0], '/tmp/windows-builder.js');
});
