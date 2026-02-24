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

  function runCommand(cmd, args, opts = {}) {
    const result = spawnSync(cmd, args, {
      stdio: 'pipe',
      ...opts,
    });
    if (result.status !== 0) {
      const stderr = result.stderr ? result.stderr.toString().trim() : '';
      fail(`${cmd} failed${stderr ? `: ${stderr}` : ''}`);
    }
    return result.stdout ? result.stdout.toString().trim() : '';
  }

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
    const codexApp = path.join(mountPoint, 'Codex.app');
    const infoPlist = path.join(codexApp, 'Contents', 'Info.plist');
    const frameworkInfo = path.join(
      codexApp,
      'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist'
    );

    const resourcesSrc = path.join(codexApp, 'Contents/Resources');
    if (!fs.existsSync(resourcesSrc)) {
      fail('Resources directory was not found in mounted Codex.app');
    }

    const payloadRoot = path.join(outputDir, 'payload');
    const resourcesDst = path.join(payloadRoot, 'Resources');
    fs.mkdirSync(payloadRoot, { recursive: true });
    fs.cpSync(resourcesSrc, resourcesDst, { recursive: true });

    let version = '';
    const shortVersion = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', infoPlist], { stdio: 'pipe' });
    if (shortVersion.status === 0) {
      version = shortVersion.stdout.toString().trim();
    }
    if (!version) {
      const fallbackVersion = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', infoPlist], { stdio: 'pipe' });
      version = fallbackVersion.status === 0 ? fallbackVersion.stdout.toString().trim() : '';
    }

    const electronVersion = runCommand('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', frameworkInfo]);

    const asarFile = path.join(resourcesSrc, 'app.asar');
    const asarMetaDir = path.join(outputDir, 'asar-meta');
    fs.mkdirSync(asarMetaDir, { recursive: true });

    runCommand('npx', ['--yes', '@electron/asar', 'extract-file', asarFile, 'node_modules/better-sqlite3/package.json'], { cwd: asarMetaDir });
    if (fs.existsSync(path.join(asarMetaDir, 'package.json'))) {
      fs.renameSync(path.join(asarMetaDir, 'package.json'), path.join(asarMetaDir, 'better-sqlite3.package.json'));
    }

    runCommand('npx', ['--yes', '@electron/asar', 'extract-file', asarFile, 'node_modules/node-pty/package.json'], { cwd: asarMetaDir });
    if (fs.existsSync(path.join(asarMetaDir, 'package.json'))) {
      fs.renameSync(path.join(asarMetaDir, 'package.json'), path.join(asarMetaDir, 'node-pty.package.json'));
    }

    const bsPkgPath = path.join(asarMetaDir, 'better-sqlite3.package.json');
    const npPkgPath = path.join(asarMetaDir, 'node-pty.package.json');
    const betterSqlite3Version = fs.existsSync(bsPkgPath)
      ? JSON.parse(fs.readFileSync(bsPkgPath, 'utf8')).version || ''
      : '';
    const nodePtyVersion = fs.existsSync(npPkgPath)
      ? JSON.parse(fs.readFileSync(npPkgPath, 'utf8')).version || ''
      : '';

    fs.writeFileSync(path.join(outputDir, 'payload-metadata.json'), JSON.stringify({
      sourceDmgPath,
      version,
      electronVersion,
      betterSqlite3Version,
      nodePtyVersion,
      extractedAt: new Date().toISOString(),
    }, null, 2));
  } finally {
    spawnSync('hdiutil', ['detach', mountPoint], { stdio: 'pipe' });
    fs.rmSync(mountBase, { recursive: true, force: true });
  }

  process.stdout.write(`Payload extracted to ${outputDir}\n`);
}

run();
