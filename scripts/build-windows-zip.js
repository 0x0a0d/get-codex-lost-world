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

function warn(message) {
  process.stderr.write(`Warning: ${message}\n`);
}

function parseArgs(argv = process.argv.slice(2)) {
  let outputPath = '';
  let arch = process.env.BUILD_ARCH || 'x64';
  let payloadDir = '';
  let installerOutputPath = '';
  let projectDir = '';

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

    if (arg === '--installer-output') {
      const candidate = argv[i + 1];
      if (!candidate || candidate.startsWith('-')) {
        die('--installer-output requires a file path');
      }
      installerOutputPath = candidate;
      i += 1;
      continue;
    }

    if (arg === '--project-dir') {
      const candidate = argv[i + 1];
      if (!candidate || candidate.startsWith('-')) {
        die('--project-dir requires a path');
      }
      projectDir = candidate;
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

  if (!projectDir) {
    die('--project-dir is required');
  }

  return {
    outputPath: path.resolve(outputPath),
    payloadDir: path.resolve(payloadDir),
    installerOutputPath: installerOutputPath ? path.resolve(installerOutputPath) : '',
    projectDir: path.resolve(projectDir),
    arch: String(arch).trim().toLowerCase(),
  };
}

function build() {
  const { outputPath, payloadDir, installerOutputPath, projectDir, arch } = parseArgs();
  const outputDir = path.dirname(outputPath);
  fs.mkdirSync(outputDir, { recursive: true });
  if (installerOutputPath) {
    fs.mkdirSync(path.dirname(installerOutputPath), { recursive: true });
  }

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
  const windowsIconIcoPath = String(metadata.windowsIconIcoPath || '').trim();
  const payloadIconPath = windowsIconIcoPath
    ? path.join(payloadDir, windowsIconIcoPath.split('/').join(path.sep))
    : '';
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
    const appDir = path.join(stagingDir, 'Codex');
    fs.mkdirSync(appDir, { recursive: true });

    const npmArch = arch === 'arm64' ? 'arm64' : 'x64';

    const projectPackagePath = path.join(projectDir, 'package.json');
    if (!fs.existsSync(projectPackagePath)) {
      die(`project package.json not found: ${projectPackagePath}`);
    }

    const projectNodeModules = path.join(projectDir, 'node_modules');
    if (!fs.existsSync(projectNodeModules)) {
      die(`project node_modules not found: ${projectNodeModules}. Run npm install in a separate CI step first.`);
    }

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

    const electronExe = path.join(appDir, 'electron.exe');
    const codexExePath = path.join(appDir, 'Codex.exe');
    if (fs.existsSync(electronExe)) {
      fs.renameSync(electronExe, codexExePath);
    } else {
      die('electron.exe not found in electron dist output');
    }

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
    const codexExe = files.find((f) => /codex\.exe$/i.test(f) && /win32/i.test(f));
    const rgExe = files.find((f) => /rg\.exe$/i.test(f) && /win32/i.test(f));
    const icoCandidates = files.filter((f) => /\.ico$/i.test(f) && /(codex|icon|logo)/i.test(path.basename(f)));
    if (codexExe) {
      fs.copyFileSync(codexExe, path.join(appResources, 'codex.exe'));
      fs.copyFileSync(codexExe, path.join(targetUnpacked, 'codex.exe'));
    } else {
      die('failed to locate windows codex.exe from installed dependencies');
    }
    if (rgExe) {
      fs.copyFileSync(rgExe, path.join(appResources, 'rg.exe'));
    } else {
      die('failed to locate windows rg.exe from installed dependencies');
    }

    const iconPath = payloadIconPath && fs.existsSync(payloadIconPath)
      ? payloadIconPath
      : (icoCandidates.length > 0 ? icoCandidates[0] : '');
    if (iconPath) {
      const rceditExecutablePath = path.join(
        projectDir,
        'node_modules',
        '.bin',
        process.platform === 'win32' ? 'rcedit.cmd' : 'rcedit'
      );
      const rceditCommand = fs.existsSync(rceditExecutablePath)
        ? rceditExecutablePath
        : 'rcedit';
      const iconResult = spawnSync(
        rceditCommand,
        [codexExePath, '--set-icon', iconPath],
        { cwd: projectDir, stdio: 'inherit', shell: true }
      );
      if (iconResult.error || iconResult.status !== 0) {
        warn(`Unable to set executable icon with ${rceditCommand}. Continuing without patched exe icon.`);
      }
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

    if (installerOutputPath) {
      const buildVersion = String(metadata.version || '0.0.0').replace(/[^0-9.]/g, '.') || '0.0.0';
      const installerConfigPath = path.join(projectDir, 'electron-builder.json');
      fs.writeFileSync(installerConfigPath, JSON.stringify({
        appId: 'com.openai.codex',
        productName: 'Codex',
        directories: {
          output: path.dirname(installerOutputPath),
        },
        artifactName: path.basename(installerOutputPath),
        win: {
          target: [
            {
              target: 'nsis',
              arch: [npmArch],
            },
          ],
          icon: iconPath || undefined,
        },
        nsis: {
          oneClick: false,
          perMachine: false,
          allowToChangeInstallationDirectory: true,
          createDesktopShortcut: true,
          shortcutName: 'Codex',
        },
      }, null, 2));

      runCommand('npx', [
        '--yes',
        'electron-builder',
        '--win',
        'nsis',
        '--publish',
        'never',
        `--${npmArch}`,
        '--prepackaged',
        appDir,
        '--config',
        installerConfigPath,
        '--projectDir',
        projectDir,
        '--config.extraMetadata.version',
        buildVersion,
      ], { cwd: projectDir });

      if (!fs.existsSync(installerOutputPath)) {
        die(`expected installer was not created: ${installerOutputPath}`);
      }
    }
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }

  process.stdout.write(`Output ZIP: ${outputPath}\n`);
}

build();
