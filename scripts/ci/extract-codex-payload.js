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

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'pipe',
    ...options,
  });

  if (result.status !== 0) {
    const stderr = result.stderr ? result.stderr.toString().trim() : '';
    fail(`${command} failed${stderr ? `: ${stderr}` : ''}`);
  }

  return result.stdout ? result.stdout.toString().trim() : '';
}

function readPlistValue(infoPlistPath, key) {
  const result = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, infoPlistPath], { stdio: 'pipe' });
  if (result.status !== 0) {
    return '';
  }
  return result.stdout.toString().trim();
}

function resolveSourceIconPath(resourcesDir) {
  const iconCandidates = fs.readdirSync(resourcesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.icns$/i.test(entry.name))
    .map((entry) => path.join(resourcesDir, entry.name));

  if (iconCandidates.length === 0) {
    return '';
  }

  const preferredIcon = iconCandidates.find((filePath) => /codex|appicon|icon/i.test(path.basename(filePath)));
  return preferredIcon || iconCandidates[0];
}

function extractWindowsIconAssets(resourcesDir, payloadRoot) {
  const sourceIconPath = resolveSourceIconPath(resourcesDir);
  if (!sourceIconPath) {
    return { pngPath: '', icoPath: '' };
  }

  const pngPath = path.join(payloadRoot, 'codex-icon.png');
  const pngResult = spawnSync('sips', ['-s', 'format', 'png', sourceIconPath, '--out', pngPath], { stdio: 'pipe' });
  if (pngResult.status !== 0 || !fs.existsSync(pngPath)) {
    return { pngPath: '', icoPath: '' };
  }

  const icoPath = path.join(payloadRoot, 'codex-icon.ico');
  const icoResult = spawnSync('bash', ['-lc', `npx --yes png-to-ico "${pngPath}" > "${icoPath}"`], { stdio: 'pipe' });
  const hasIco = icoResult.status === 0 && fs.existsSync(icoPath);

  return {
    pngPath,
    icoPath: hasIco ? icoPath : '',
  };
}

function extractModuleVersionFromAsar(asarPath, moduleName, metadataDir) {
  const tempPackagePath = path.join(metadataDir, 'package.json');
  const extractedPackagePath = path.join(metadataDir, `${moduleName}.package.json`);

  runCommand('npx', ['--yes', '@electron/asar', 'extract-file', asarPath, `node_modules/${moduleName}/package.json`], {
    cwd: metadataDir,
  });

  if (!fs.existsSync(tempPackagePath)) {
    return '';
  }

  fs.renameSync(tempPackagePath, extractedPackagePath);
  const packageJson = JSON.parse(fs.readFileSync(extractedPackagePath, 'utf8'));
  return String(packageJson.version || '').trim();
}

function toMetadataRelativePath(baseDir, absolutePath) {
  if (!absolutePath) {
    return '';
  }
  return path.relative(baseDir, absolutePath).split(path.sep).join('/');
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

    const version = readPlistValue(infoPlist, 'CFBundleShortVersionString') || readPlistValue(infoPlist, 'CFBundleVersion');
    const electronVersion = readPlistValue(frameworkInfo, 'CFBundleVersion');
    if (!electronVersion) {
      fail('CFBundleVersion is missing from Electron Framework Info.plist');
    }

    const asarPath = path.join(resourcesSrc, 'app.asar');
    const metadataDir = path.join(outputDir, 'asar-meta');
    fs.mkdirSync(metadataDir, { recursive: true });

    const betterSqlite3Version = extractModuleVersionFromAsar(asarPath, 'better-sqlite3', metadataDir);
    const nodePtyVersion = extractModuleVersionFromAsar(asarPath, 'node-pty', metadataDir);
    const iconAssets = extractWindowsIconAssets(resourcesSrc, payloadRoot);

    const metadata = {
      sourceDmgPath,
      version,
      electronVersion,
      betterSqlite3Version,
      nodePtyVersion,
      windowsIconPngPath: toMetadataRelativePath(outputDir, iconAssets.pngPath),
      windowsIconIcoPath: toMetadataRelativePath(outputDir, iconAssets.icoPath),
      extractedAt: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(outputDir, 'payload-metadata.json'), JSON.stringify(metadata, null, 2));
  } finally {
    spawnSync('hdiutil', ['detach', mountPoint], { stdio: 'pipe' });
    fs.rmSync(mountBase, { recursive: true, force: true });
  }

  process.stdout.write(`Payload extracted to ${outputDir}\n`);
}

run();
