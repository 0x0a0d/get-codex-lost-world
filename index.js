#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

let outputDmg = null;
let verbose = false;
const positional = [];

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '-h' || a === '--help') {
    printUsage();
    process.exit(0);
  } else if (a === '-V' || a === '--verbose') {
    verbose = true;
  } else if (a === '-o' || a === '--output') {
    outputDmg = argv[++i];
    if (!outputDmg) die('--output requires a <file> argument');
  } else if (a.startsWith('--output=')) {
    outputDmg = a.slice('--output='.length);
  } else if (a.startsWith('-')) {
    printUsage();
    die(`Unknown option: ${a}`);
  } else {
    positional.push(a);
  }
}

if (positional.length > 1) {
  printUsage();
  die('Too many arguments');
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const SCRIPT_DIR = __dirname;
const SCRIPT_PARENT_DIR = path.dirname(SCRIPT_DIR);
const TMP_BASE = path.join(os.tmpdir(), 'codex-intel-build');

// RUN_ID: YYYYmmdd_HHMMss
const _now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const RUN_ID =
  `${_now.getFullYear()}${pad(_now.getMonth() + 1)}${pad(_now.getDate())}` +
  `_${pad(_now.getHours())}${pad(_now.getMinutes())}${pad(_now.getSeconds())}`;

const WORK_DIR = path.join(TMP_BASE, `codex_intel_build_${RUN_ID}`);
const MOUNT_POINT = path.join(WORK_DIR, 'mount');

if (!outputDmg) {
  outputDmg = path.join(SCRIPT_DIR, 'CodexIntelMac.dmg');
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

let cleanedUp = false;

function timestamp() {
  const n = new Date();
  return (
    `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())} ` +
    `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`
  );
}

function log(msg) {
  const line = `[${timestamp()}] ${msg}`;
  process.stdout.write(line + '\n');
}

function die(msg) {
  log(`ERROR: ${msg}`);
  process.exit(1);
}

function printUsage() {
  process.stdout.write(`\
Usage:
  node index.js [options] [path/to/Codex.dmg]

Options:
  -o, --output <file>   Output DMG path (default: ./CodexIntelMac.dmg)
  -V, --verbose         Enable verbose logging
  -h, --help            Show this help

Behavior:
  - Reads source DMG from ../Codex.dmg by default (or explicit path argument)
  - Never modifies the original DMG
  - Uses os.tmpdir() for all build steps
  - Cleans temporary build files on completion
  - Produces Intel DMG output path provided by caller
`);
}

// ---------------------------------------------------------------------------
// Shell helpers
// ---------------------------------------------------------------------------

/**
 * Run a shell command, streaming output to the terminal (and log via stdio:inherit).
 * Throws on non-zero exit.
 */
function run(cmd, opts = {}) {
  if (verbose) log(`$ ${cmd}`);
  const result = spawnSync(cmd, {
    shell: true,
    stdio: opts.silent ? 'pipe' : 'inherit',
    cwd: opts.cwd,
  });
  if (result.status !== 0) {
    const stderr = result.stderr ? result.stderr.toString().trim() : '';
    die(`Command failed (exit ${result.status}): ${cmd}${stderr ? '\n' + stderr : ''}`);
  }
  return result.stdout ? result.stdout.toString().trim() : '';
}

/** Run a command and capture its stdout. Throws on non-zero exit. */
function capture(cmd, opts = {}) {
  if (verbose) log(`$ ${cmd}`);
  const result = spawnSync(cmd, { shell: true, stdio: 'pipe', cwd: opts.cwd });
  if (result.status !== 0) {
    die(`Command failed (exit ${result.status}): ${cmd}\n${result.stderr?.toString().trim() ?? ''}`);
  }
  return result.stdout.toString().trim();
}

/** Run silently, ignoring errors. */
function runIgnore(cmd) {
  spawnSync(cmd, { shell: true, stdio: 'pipe' });
}

/** Copy a file and set permissions to 0o755. */
function installBin(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  fs.chmodSync(dst, 0o755);
}

// ---------------------------------------------------------------------------
// Cleanup / signal handling
// ---------------------------------------------------------------------------

let attachedByScript = false;

function cleanup(exitCode) {
  if (cleanedUp) {
    return;
  }
  cleanedUp = true;

  if (attachedByScript && fs.existsSync(MOUNT_POINT)) {
    runIgnore(`hdiutil detach "${MOUNT_POINT}"`);
    runIgnore(`hdiutil detach -force "${MOUNT_POINT}"`);
  }

  if (fs.existsSync(WORK_DIR)) {
    try {
      fs.rmSync(WORK_DIR, { recursive: true, force: true });
    } catch {
      if (exitCode !== 0) {
        log(`Warning: unable to remove temporary directory: ${WORK_DIR}`);
      }
    }
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(1); process.exit(1); });
process.on('SIGTERM', () => { cleanup(1); process.exit(1); });

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(function main() {
  fs.mkdirSync(TMP_BASE, { recursive: true });

  log('Starting Intel build pipeline');
  log(`Script dir: ${SCRIPT_DIR}`);
  log(`Default source location: ${path.join(SCRIPT_PARENT_DIR, 'Codex.dmg')}`);
  log(`Work dir: ${WORK_DIR}`);
  fs.mkdirSync(WORK_DIR, { recursive: true });

  // Validate required tools early.
  for (const cmd of ['hdiutil', 'ditto', 'npm', 'npx', 'node', 'file', 'codesign', 'xattr']) {
    const check = spawnSync('command', ['-v', cmd], { shell: true, stdio: 'pipe' });
    if (check.status !== 0) die(`Missing required command: ${cmd}`);
  }

  // ------------------------------------------------------------------
  // Resolve source DMG path:
  //   1) explicit positional argument
  //   2) ../Codex.dmg
  //   3) single *.dmg in parent directory
  // ------------------------------------------------------------------
  let inputDmg;
  if (positional.length === 1) {
    inputDmg = path.resolve(positional[0]);
  } else if (fs.existsSync(path.join(SCRIPT_PARENT_DIR, 'Codex.dmg'))) {
    inputDmg = path.join(SCRIPT_PARENT_DIR, 'Codex.dmg');
  } else {
    const found = fs.readdirSync(SCRIPT_PARENT_DIR)
      .filter((f) => f.endsWith('.dmg') && path.join(SCRIPT_PARENT_DIR, f) !== outputDmg)
      .map((f) => path.join(SCRIPT_PARENT_DIR, f))
      .sort();
    if (found.length === 0) {
      die('No source DMG found. Put Codex.dmg next to this repo folder (../Codex.dmg) or pass a path.');
    }
    if (found.length > 1) {
      found.forEach((f) => process.stdout.write(f + '\n'));
      die('Multiple DMGs found. Pass source DMG path explicitly.');
    }
    inputDmg = found[0];
  }

  if (!fs.existsSync(inputDmg)) die(`Source DMG not found: ${inputDmg}`);
  log(`Source DMG: ${inputDmg}`);

  // ------------------------------------------------------------------
  // Mount source DMG in read-only mode.
  // ------------------------------------------------------------------
  log('Mounting source DMG in read-only mode');
  fs.mkdirSync(MOUNT_POINT, { recursive: true });

  let sourceApp;
  const mountResult = spawnSync(
    `hdiutil attach -readonly -nobrowse -mountpoint "${MOUNT_POINT}" "${inputDmg}"`,
    { shell: true, stdio: 'pipe' }
  );
  if (mountResult.status === 0) {
    attachedByScript = true;
    sourceApp = path.join(MOUNT_POINT, 'Codex.app');
  } else if (fs.existsSync('/Volumes/Codex Installer/Codex.app')) {
    sourceApp = '/Volumes/Codex Installer/Codex.app';
    log(`Using existing mounted volume: ${sourceApp}`);
  } else {
    die('Failed to mount DMG and no fallback mounted Codex.app found');
  }

  if (!fs.existsSync(sourceApp)) die('Codex.app not found inside DMG');

  const ORIG_APP      = path.join(WORK_DIR, 'CodexOriginal.app');
  const TARGET_APP    = path.join(WORK_DIR, 'Codex.app');
  const BUILD_PROJECT = path.join(WORK_DIR, 'build-project');
  const DMG_ROOT      = path.join(WORK_DIR, 'dmg-root');

  // ------------------------------------------------------------------
  // Copy app bundle to a local writable work directory.
  // ------------------------------------------------------------------
  log('Copying source app bundle to work dir');
  run(`ditto "${sourceApp}" "${ORIG_APP}"`);

  const FRAMEWORK_INFO = path.join(
    ORIG_APP,
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist'
  );
  if (!fs.existsSync(FRAMEWORK_INFO)) die('Cannot read Electron framework info plist');

  const electronVersion = capture(
    `/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "${FRAMEWORK_INFO}"`
  );
  if (!electronVersion) die('Cannot detect Electron version from source app');

  const ASAR_FILE = path.join(ORIG_APP, 'Contents/Resources/app.asar');
  if (!fs.existsSync(ASAR_FILE)) die('app.asar not found in source app');

  // ------------------------------------------------------------------
  // Extract dependency versions from app.asar metadata.
  // ------------------------------------------------------------------
  const ASAR_META_DIR = path.join(WORK_DIR, 'asar-meta');
  fs.mkdirSync(ASAR_META_DIR, { recursive: true });

  run(
    `npx --yes @electron/asar extract-file "${ASAR_FILE}" "node_modules/better-sqlite3/package.json" && ` +
    `mv package.json better-sqlite3.package.json`,
    { cwd: ASAR_META_DIR }
  );
  run(
    `npx --yes @electron/asar extract-file "${ASAR_FILE}" "node_modules/node-pty/package.json" && ` +
    `mv package.json node-pty.package.json`,
    { cwd: ASAR_META_DIR }
  );

  const BS_PKG = path.join(ASAR_META_DIR, 'better-sqlite3.package.json');
  const NP_PKG = path.join(ASAR_META_DIR, 'node-pty.package.json');
  if (!fs.existsSync(BS_PKG)) die('Cannot extract better-sqlite3 package.json from app.asar');
  if (!fs.existsSync(NP_PKG)) die('Cannot extract node-pty package.json from app.asar');

  const bsVersion = capture(`node -p "require(process.argv[1]).version" "${BS_PKG}"`);
  const npVersion = capture(`node -p "require(process.argv[1]).version" "${NP_PKG}"`);

  log(`Detected Electron version: ${electronVersion}`);
  log(`Detected better-sqlite3 version: ${bsVersion}`);
  log(`Detected node-pty version: ${npVersion}`);

  // ------------------------------------------------------------------
  // Build a temporary project to fetch x64 Electron/runtime artifacts.
  // ------------------------------------------------------------------
  log('Preparing x64 build project');
  fs.mkdirSync(BUILD_PROJECT, { recursive: true });
  fs.writeFileSync(
    path.join(BUILD_PROJECT, 'package.json'),
    JSON.stringify(
      {
        name: 'codex-intel-rebuild',
        private: true,
        version: '1.0.0',
        dependencies: {
          '@openai/codex': 'latest',
          'better-sqlite3': bsVersion,
          electron: electronVersion,
          'node-pty': npVersion,
        },
        devDependencies: {
          '@electron/rebuild': '3.7.2',
        },
      },
      null,
      2
    )
  );

  // Force x64 arch so Electron and native deps download x64 binaries,
  // even when host runner is ARM64 (macos-latest = Apple Silicon).
  run('npm_config_arch=x64 npm install --no-audit --no-fund', {
    cwd: BUILD_PROJECT,
    silent: true,
  });

  // Force-install x64 platform package for Codex CLI binaries.
  // npm only installs optional deps matching host arch (arm64 on macos-latest),
  // so we must explicitly install the x64 variant to get codex/rg binaries.
  const codexPkg = JSON.parse(
    fs.readFileSync(path.join(BUILD_PROJECT, 'node_modules/@openai/codex/package.json'), 'utf8')
  );
  const x64Alias = (codexPkg.optionalDependencies || {})['@openai/codex-darwin-x64'] || '';
  const x64Spec = x64Alias.startsWith('npm:') ? x64Alias.slice(4) : `@openai/codex@latest`;
  const x64Dir = path.join(BUILD_PROJECT, 'node_modules/@openai/codex-darwin-x64');
  if (!fs.existsSync(x64Dir)) {
    log('x64 codex platform package missing; installing explicitly');
    run(
      `npm install --no-audit --no-fund --no-save "${x64Spec}"`,
      { cwd: BUILD_PROJECT, silent: true }
    );
    // npm may nest the package; ensure it lands at the expected path
    if (!fs.existsSync(x64Dir)) {
      const tarball = capture(`npm pack "${x64Spec}" --pack-destination .`, { cwd: BUILD_PROJECT });
      fs.mkdirSync(x64Dir, { recursive: true });
      run(`tar xzf "${tarball}" --strip-components=1 -C "${x64Dir}"`, { cwd: BUILD_PROJECT });
    }
  }

  // ------------------------------------------------------------------
  // Use Electron x64 app template as the destination runtime.
  // ------------------------------------------------------------------
  log('Creating Intel app bundle from Electron runtime');
  run(`ditto "${path.join(BUILD_PROJECT, 'node_modules/electron/dist/Electron.app')}" "${TARGET_APP}"`);

  // ------------------------------------------------------------------
  // Inject original Codex resources into the x64 runtime shell.
  // ------------------------------------------------------------------
  log('Injecting Codex resources from original app');
  run(`rm -rf "${path.join(TARGET_APP, 'Contents/Resources')}"`);
  run(`ditto "${path.join(ORIG_APP, 'Contents/Resources')}" "${path.join(TARGET_APP, 'Contents/Resources')}"`);
  run(`cp "${path.join(ORIG_APP, 'Contents/Info.plist')}" "${path.join(TARGET_APP, 'Contents/Info.plist')}"`);

  const infoPlist = path.join(TARGET_APP, 'Contents/Info.plist');
  run(`/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable Electron" "${infoPlist}"`);

  // Codex main process treats isPackaged=false as dev and tries localhost:5175.
  // Force renderer URL to bundled app protocol in this transplanted runtime.
  const addEnv = spawnSync(
    `/usr/libexec/PlistBuddy -c "Add :LSEnvironment:ELECTRON_RENDERER_URL string app://-/index.html" "${infoPlist}"`,
    { shell: true, stdio: 'pipe' }
  );
  if (addEnv.status !== 0) {
    run(`/usr/libexec/PlistBuddy -c "Set :LSEnvironment:ELECTRON_RENDERER_URL app://-/index.html" "${infoPlist}"`);
  }

  // ------------------------------------------------------------------
  // Rebuild native modules against Electron x64 ABI.
  // ------------------------------------------------------------------
  log(`Rebuilding native modules for Electron ${electronVersion} x64`);
  run(
    `npx --yes @electron/rebuild -f -w better-sqlite3,node-pty --arch=x64 --version "${electronVersion}" -m "${BUILD_PROJECT}"`,
    { cwd: BUILD_PROJECT }
  );

  const TARGET_UNPACKED = path.join(TARGET_APP, 'Contents/Resources/app.asar.unpacked');
  if (!fs.existsSync(TARGET_UNPACKED)) die('Target app.asar.unpacked not found');

  // ------------------------------------------------------------------
  // Replace arm64 native artifacts with rebuilt x64 binaries.
  // ------------------------------------------------------------------
  log('Replacing native binaries inside app.asar.unpacked');

  installBin(
    path.join(BUILD_PROJECT, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
    path.join(TARGET_UNPACKED, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node')
  );
  installBin(
    path.join(BUILD_PROJECT, 'node_modules/node-pty/build/Release/pty.node'),
    path.join(TARGET_UNPACKED, 'node_modules/node-pty/build/Release/pty.node')
  );
  installBin(
    path.join(BUILD_PROJECT, 'node_modules/node-pty/build/Release/spawn-helper'),
    path.join(TARGET_UNPACKED, 'node_modules/node-pty/build/Release/spawn-helper')
  );

  // node-pty prebuilt bin/darwin-x64
  const nodePtyBinDir = path.join(BUILD_PROJECT, 'node_modules/node-pty/bin');
  let nodePtyBinSrc = null;
  if (fs.existsSync(nodePtyBinDir)) {
    const findRes = spawnSync(
      `find "${nodePtyBinDir}" -type f -name "node-pty.node" | grep "darwin-x64" | head -n 1`,
      { shell: true, stdio: 'pipe' }
    );
    nodePtyBinSrc = findRes.stdout.toString().trim() || null;
  }

  if (nodePtyBinSrc) {
    installBin(
      nodePtyBinSrc,
      path.join(TARGET_UNPACKED, 'node_modules/node-pty/bin/darwin-x64-143/node-pty.node')
    );
    const arm64Dst = path.join(TARGET_UNPACKED, 'node_modules/node-pty/bin/darwin-arm64-143/node-pty.node');
    if (fs.existsSync(arm64Dst)) {
      // Keep hardcoded/fallback load paths functional even if the app references arm64 folder.
      installBin(nodePtyBinSrc, arm64Dst);
    }
  }

  // ------------------------------------------------------------------
  // Replace bundled arm64 codex/rg command-line binaries.
  // ------------------------------------------------------------------
  const CLI_X64_ROOT = path.join(
    BUILD_PROJECT,
    'node_modules/@openai/codex-darwin-x64/vendor/x86_64-apple-darwin'
  );
  const CLI_X64_BIN = path.join(CLI_X64_ROOT, 'codex/codex');
  const RG_X64_BIN  = path.join(CLI_X64_ROOT, 'path/rg');

  if (!fs.existsSync(CLI_X64_BIN)) die('x64 Codex CLI binary not found after npm install');
  if (!fs.existsSync(RG_X64_BIN))  die('x64 rg binary not found after npm install');

  log('Replacing bundled codex/rg binaries with x64 versions');
  installBin(CLI_X64_BIN, path.join(TARGET_APP, 'Contents/Resources/codex'));
  installBin(CLI_X64_BIN, path.join(TARGET_UNPACKED, 'codex'));
  installBin(RG_X64_BIN,  path.join(TARGET_APP, 'Contents/Resources/rg'));

  // ------------------------------------------------------------------
  // Sparkle native addon is arm64-only in this flow; disable it.
  // ------------------------------------------------------------------
  log('Disabling incompatible Sparkle native addon');
  const sparkle1 = path.join(TARGET_APP, 'Contents/Resources/native/sparkle.node');
  const sparkle2 = path.join(TARGET_UNPACKED, 'native/sparkle.node');
  if (fs.existsSync(sparkle1)) fs.unlinkSync(sparkle1);
  if (fs.existsSync(sparkle2)) fs.unlinkSync(sparkle2);

  // ------------------------------------------------------------------
  // Sanity-check key binaries before signing/packaging.
  // ------------------------------------------------------------------
  log('Validating key binaries are x86_64');
  const binsToCheck = [
    path.join(TARGET_APP, 'Contents/MacOS/Electron'),
    path.join(TARGET_APP, 'Contents/Resources/codex'),
    path.join(TARGET_APP, 'Contents/Resources/rg'),
    path.join(TARGET_UNPACKED, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
    path.join(TARGET_UNPACKED, 'node_modules/node-pty/build/Release/pty.node'),
  ];
  for (const binary of binsToCheck) {
    const fileOutput = capture(`file "${binary}"`);
    process.stdout.write(fileOutput + '\n');
    if (!fileOutput.includes('x86_64')) die(`Expected x86_64 binary: ${binary}`);
  }

  // ------------------------------------------------------------------
  // Re-sign modified app ad-hoc to satisfy macOS code integrity checks.
  // ------------------------------------------------------------------
  log('Signing app ad-hoc');
  runIgnore(`xattr -cr "${TARGET_APP}"`);
  run(`codesign --force --deep --sign - --timestamp=none "${TARGET_APP}"`);
  run(`codesign --verify --deep --strict "${TARGET_APP}"`);

  // ------------------------------------------------------------------
  // Build final distributable DMG.
  // ------------------------------------------------------------------
  log(`Building output DMG: ${outputDmg}`);
  if (fs.existsSync(outputDmg)) fs.unlinkSync(outputDmg);
  fs.mkdirSync(DMG_ROOT, { recursive: true });
  run(`ditto "${TARGET_APP}" "${path.join(DMG_ROOT, 'Codex.app')}"`);
  run(`ln -s /Applications "${path.join(DMG_ROOT, 'Applications')}"`);
  run(`hdiutil create -volname "Codex App Mac Intel" -srcfolder "${DMG_ROOT}" -ov -format UDZO "${outputDmg}"`, { silent: true });

  log('Done');
  log(`Output DMG: ${outputDmg}`);
  log(`Work dir (will be removed): ${WORK_DIR}`);
})();
