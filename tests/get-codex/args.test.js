'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../../lib/get-codex/args');

test('parseArgs defaults to build mode', () => {
  assert.deepEqual(parseArgs([]), { mode: 'build' });
});

test('parseArgs sets cache mode for --cache and -c', () => {
  assert.deepEqual(parseArgs(['--cache']), { mode: 'cache' });
  assert.deepEqual(parseArgs(['-c']), { mode: 'cache' });
});

test('parseArgs sets build mode for --build and -b', () => {
  assert.deepEqual(parseArgs(['--build']), { mode: 'build' });
  assert.deepEqual(parseArgs(['-b']), { mode: 'build' });
});

test('parseArgs sets sign mode and signPath for --sign/-s', () => {
  assert.deepEqual(parseArgs(['--sign', '/tmp/app']), { mode: 'sign', signPath: '/tmp/app' });
  assert.deepEqual(parseArgs(['-s', '/tmp/app']), { mode: 'sign', signPath: '/tmp/app' });
});

test('parseArgs accepts --workdir/-w', () => {
  assert.deepEqual(parseArgs(['--workdir', '/tmp/w']), { mode: 'build', workdir: '/tmp/w' });
  assert.deepEqual(parseArgs(['-w', '/tmp/w', '--cache']), { mode: 'cache', workdir: '/tmp/w' });
  assert.deepEqual(parseArgs(['--sign', '/tmp/app', '--workdir', '/tmp/w']), {
    mode: 'sign',
    signPath: '/tmp/app',
    workdir: '/tmp/w',
  });
});

test('parseArgs accepts --platform/--arch/--format', () => {
  assert.deepEqual(parseArgs(['--platform', 'windows', '--arch', 'arm64', '--format', 'zip']), {
    mode: 'build',
    platform: 'windows',
    arch: 'arm64',
    format: 'zip',
  });
});

test('parseArgs throws when --platform/--arch/--format value is missing', () => {
  assert.throws(() => parseArgs(['--platform']), /requires a value/);
  assert.throws(() => parseArgs(['--arch']), /requires a value/);
  assert.throws(() => parseArgs(['--format']), /requires a value/);
});

test('parseArgs throws conflict error on mixed mode flags', () => {
  assert.throws(() => parseArgs(['--cache', '--build']), /conflict/);
  assert.throws(() => parseArgs(['-s', '/tmp/a', '--cache']), /conflict/);
});

test('parseArgs throws when --sign is missing path', () => {
  assert.throws(() => parseArgs(['--sign']), /requires a path/);
  assert.throws(() => parseArgs(['-s', '   ']), /requires a path/);
  assert.throws(() => parseArgs(['-s', '--cache']), /requires a path/);
});

test('parseArgs throws when --workdir is missing path', () => {
  assert.throws(() => parseArgs(['--workdir']), /requires a path/);
  assert.throws(() => parseArgs(['-w', '   ']), /requires a path/);
  assert.throws(() => parseArgs(['-w', '--build']), /requires a path/);
});

test('parseArgs returns help mode for --help/-h', () => {
  assert.deepEqual(parseArgs(['--help']), { mode: 'help' });
  assert.deepEqual(parseArgs(['-h']), { mode: 'help' });
});

test('parseArgs throws on unknown options', () => {
  assert.throws(() => parseArgs(['--wat']), /Unknown option/);
});
