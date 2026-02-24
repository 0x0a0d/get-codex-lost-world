#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv = process.argv.slice(2)) {
  let sourceDmgPath = '';
  let outputDir = '';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') {
      sourceDmgPath = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg === '--output-dir') {
      outputDir = argv[i + 1] || '';
      i += 1;
      continue;
    }
  }

  if (!sourceDmgPath) {
    fail('--source is required');
  }

  if (!outputDir) {
    fail('--output-dir is required');
  }

  return {
    sourceDmgPath: path.resolve(sourceDmgPath),
    outputDir: path.resolve(outputDir),
  };
}

function run() {
  const { sourceDmgPath, outputDir } = parseArgs();
  fs.mkdirSync(outputDir, { recursive: true });

  const mountBase = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-payload-'));
  const mountPoint = path.join(mountBase, 'mount');
  fs.mkdirSync(mountPoint, { recursive: true });

  const attach = spawnSync('hdiutil', [
    'attach',
    '-readonly',
    '-nobrowse',
    '-mountpoint',
    mountPoint,
    sourceDmgPath,
  ], { stdio: 'pipe' });

  if (attach.status !== 0) {
    fail('unable to mount source dmg for payload extraction');
  }

  try {
    const infoPlist = path.join(mountPoint, 'Codex.app', 'Contents', 'Info.plist');
    const versionResult = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', infoPlist], { stdio: 'pipe' });
    const version = versionResult.status === 0 ? versionResult.stdout.toString().trim() : '';

    fs.writeFileSync(path.join(outputDir, 'payload-metadata.json'), JSON.stringify({
      sourceDmgPath,
      version,
      extractedAt: new Date().toISOString(),
    }, null, 2));
  } finally {
    spawnSync('hdiutil', ['detach', mountPoint], { stdio: 'pipe' });
    fs.rmSync(mountBase, { recursive: true, force: true });
  }

  process.stdout.write(`Payload extracted to ${outputDir}\n`);
}

run();
