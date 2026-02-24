#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv = process.argv.slice(2)) {
  let outputPath = '';
  let arch = process.env.BUILD_ARCH || 'x64';
  let payloadDir = '';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output' || arg === '-o') {
      const candidate = argv[i + 1];
      if (!candidate || candidate.startsWith('-')) {
        die('--output requires a file path');
      }
      outputPath = candidate;
      i += 1;
      continue;
    }

    if (arg === '--arch') {
      const candidate = argv[i + 1];
      if (!candidate || candidate.startsWith('-')) {
        die('--arch requires a value');
      }
      arch = candidate;
      i += 1;
      continue;
    }

    if (arg === '--payload-dir') {
      const candidate = argv[i + 1];
      if (!candidate || candidate.startsWith('-')) {
        die('--payload-dir requires a path');
      }
      payloadDir = candidate;
      i += 1;
      continue;
    }

    if (arg.startsWith('-')) {
      die(`Unknown option: ${arg}`);
    }
  }

  if (!outputPath) {
    die('--output is required');
  }

  if (!payloadDir) {
    die('--payload-dir is required');
  }

  return {
    outputPath: path.resolve(outputPath),
    payloadDir: path.resolve(payloadDir),
    arch: String(arch).trim().toLowerCase(),
  };
}

function build() {
  const { outputPath, payloadDir, arch } = parseArgs();
  const outputDir = path.dirname(outputPath);
  fs.mkdirSync(outputDir, { recursive: true });

  const metadataPath = path.join(payloadDir, 'payload-metadata.json');
  const resourcesPath = path.join(payloadDir, 'payload', 'Resources');
  if (!fs.existsSync(metadataPath)) {
    die(`payload metadata not found: ${metadataPath}`);
  }
  if (!fs.existsSync(resourcesPath)) {
    die(`payload resources not found: ${resourcesPath}`);
  }

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const electronVersion = String(metadata.electronVersion || '').trim();
  if (!electronVersion) {
    die('electronVersion missing in payload-metadata.json');
  }

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), `codex-windows-${arch}-`));
  try {
    const projectDir = path.join(stagingDir, 'project');
    const appDir = path.join(stagingDir, 'Codex');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(appDir, { recursive: true });

    const npmArch = arch === 'arm64' ? 'arm64' : 'x64';

    fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
      name: 'codex-windows-portable-build',
      private: true,
      version: '1.0.0',
      dependencies: {
        electron: electronVersion,
      },
    }, null, 2));

    const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: projectDir,
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        npm_config_platform: 'win32',
        npm_config_arch: npmArch,
      },
    });

    if (install.status !== 0) {
      die('failed to install electron runtime for windows packaging');
    }

    const electronDist = path.join(projectDir, 'node_modules', 'electron', 'dist');
    if (!fs.existsSync(electronDist)) {
      die('electron dist folder not found after npm install');
    }

    fs.cpSync(electronDist, appDir, { recursive: true });

    const appResources = path.join(appDir, 'resources');
    if (fs.existsSync(appResources)) {
      fs.rmSync(appResources, { recursive: true, force: true });
    }
    fs.cpSync(resourcesPath, appResources, { recursive: true });

    fs.writeFileSync(path.join(appDir, 'build-info.txt'), [
      'Codex Windows portable package',
      `arch=${arch}`,
      `version=${metadata.version || ''}`,
      `electron=${electronVersion}`,
      `generated=${new Date().toISOString()}`,
    ].join('\n'));

    const result = spawnSync('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path "${appDir}\\*" -DestinationPath "${outputPath}" -Force`,
    ], { stdio: 'inherit' });

    if (result.status !== 0) {
      die('failed to create windows zip artifact');
    }
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }

  process.stdout.write(`Output ZIP: ${outputPath}\n`);
}

build();
