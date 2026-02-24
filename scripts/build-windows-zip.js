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
  const betterSqlite3Version = String(metadata.betterSqlite3Version || '').trim();
  const nodePtyVersion = String(metadata.nodePtyVersion || '').trim();
  if (!electronVersion) {
    die('electronVersion missing in payload-metadata.json');
  }
  if (!betterSqlite3Version || !nodePtyVersion) {
    die('native module versions missing in payload-metadata.json');
  }

  function runCommand(command, args, opts = {}) {
    const result = spawnSync(command, args, {
      stdio: 'inherit',
      shell: true,
      ...opts,
    });
    if (result.status !== 0) {
      die(`command failed: ${command} ${args.join(' ')}`);
    }
  }

  function assertPeMachine(filePath, expectedMachine) {
    const buffer = fs.readFileSync(filePath);
    const peOffset = buffer.readUInt32LE(0x3c);
    const peSig = buffer.toString('ascii', peOffset, peOffset + 4);
    if (peSig !== 'PE\u0000\u0000') {
      die(`invalid PE signature: ${filePath}`);
    }

    const machine = buffer.readUInt16LE(peOffset + 4);
    if (machine !== expectedMachine) {
      die(`unexpected machine type for ${filePath}: got 0x${machine.toString(16)}, expected 0x${expectedMachine.toString(16)}`);
    }
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
        'better-sqlite3': betterSqlite3Version,
        'node-pty': nodePtyVersion,
        '@openai/codex': 'latest',
      },
      devDependencies: {
        '@electron/rebuild': '3.7.2',
      },
    }, null, 2));

    runCommand('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: projectDir,
      env: {
        ...process.env,
        npm_config_platform: 'win32',
        npm_config_arch: npmArch,
      },
    });

    runCommand('npx', [
      '--yes',
      '@electron/rebuild',
      '-f',
      '-w',
      'better-sqlite3,node-pty',
      '--arch',
      npmArch,
      '--version',
      electronVersion,
      '-m',
      projectDir,
    ], { cwd: projectDir });

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

    const targetUnpacked = path.join(appResources, 'app.asar.unpacked');
    if (!fs.existsSync(targetUnpacked)) {
      die('target app.asar.unpacked not found in payload resources');
    }

    const srcBetterSqlite3 = path.join(projectDir, 'node_modules', 'better-sqlite3');
    const srcNodePty = path.join(projectDir, 'node_modules', 'node-pty');
    const dstBetterSqlite3 = path.join(targetUnpacked, 'node_modules', 'better-sqlite3');
    const dstNodePty = path.join(targetUnpacked, 'node_modules', 'node-pty');

    fs.rmSync(dstBetterSqlite3, { recursive: true, force: true });
    fs.rmSync(dstNodePty, { recursive: true, force: true });
    fs.cpSync(srcBetterSqlite3, dstBetterSqlite3, { recursive: true });
    fs.cpSync(srcNodePty, dstNodePty, { recursive: true });

    const sqliteNode = path.join(dstBetterSqlite3, 'build', 'Release', 'better_sqlite3.node');
    const ptyNode = path.join(dstNodePty, 'build', 'Release', 'pty.node');
    if (!fs.existsSync(sqliteNode) || !fs.existsSync(ptyNode)) {
      die('rebuilt native binaries are missing after module replacement');
    }

    const expectedMachine = npmArch === 'arm64' ? 0xaa64 : 0x8664;
    assertPeMachine(sqliteNode, expectedMachine);
    assertPeMachine(ptyNode, expectedMachine);

    // Replace codex/rg binaries with Windows-target ones when found.
    const vendorRoot = path.join(projectDir, 'node_modules');
    const walk = (dir, out = []) => {
      if (!fs.existsSync(dir)) {
        return out;
      }
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
          walk(full, out);
        } else {
          out.push(full);
        }
      }
      return out;
    };
    const files = walk(vendorRoot, []);
    const codexExe = files.find((f) => /codex\\.exe$/i.test(f) && /win32/i.test(f));
    const rgExe = files.find((f) => /rg\\.exe$/i.test(f) && /win32/i.test(f));
    if (codexExe) {
      fs.copyFileSync(codexExe, path.join(appResources, 'codex.exe'));
      fs.copyFileSync(codexExe, path.join(targetUnpacked, 'codex.exe'));
    }
    if (rgExe) {
      fs.copyFileSync(rgExe, path.join(appResources, 'rg.exe'));
    }

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
