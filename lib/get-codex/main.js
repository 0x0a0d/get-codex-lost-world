'use strict';

const os = require('os');
const fs = require('node:fs');
const path = require('path');
const https = require('node:https');
const { spawnSync } = require('node:child_process');
const readline = require('node:readline');
const { parseArgs } = require('./args');
const { summarizeRelease, pickLatestAssetForTarget } = require('./release');
const { makeOutputNameForTarget } = require('./build');
const { createLocalBuilder } = require('./local-builder');
const { normalizeTarget } = require('./targets');

function parseGithubRepoFromUrl(value) {
  const input = String(value || '').trim();
  if (!input) {
    return '';
  }

  const patterns = [
    /^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/i,
    /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return '';
}

function resolveGithubRepo() {
  try {
    const packageJsonPath = path.resolve(__dirname, '../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const repository = packageJson && packageJson.repository;

    if (typeof repository === 'string') {
      return parseGithubRepoFromUrl(repository);
    }

    if (repository && typeof repository.url === 'string') {
      return parseGithubRepoFromUrl(repository.url);
    }
  } catch {
    // Ignore package.json read/parse failures and let normal validation run.
  }

  return '';
}

function createDefaultIo() {
  return {
    log(message) {
      process.stdout.write(`${message}\n`);
    },
    prompt(question, defaultValue) {
      const suffix = typeof defaultValue === 'string' && defaultValue !== ''
        ? ` [${defaultValue}]`
        : '';
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      return new Promise((resolve) => {
        rl.question(`${question}${suffix}: `, (answer) => {
          rl.close();
          resolve(answer);
        });
      });
    },
  };
}

function isAffirmative(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes';
}

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          reject(new Error(`Request failed (${status}): ${url}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`Invalid JSON response from ${url}`));
        }
      });
    });
    req.on('error', reject);
  });
}

function streamDownload(url, outputPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (res) => {
      const status = res.statusCode || 0;
      const redirect = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && redirect) {
        res.resume();
        const nextUrl = new URL(redirect, url).toString();
        streamDownload(nextUrl, outputPath).then(resolve).catch(reject);
        return;
      }

      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`Download failed (${status}): ${url}`));
        return;
      }

      const out = fs.createWriteStream(outputPath);
      out.on('error', reject);
      out.on('finish', () => resolve(outputPath));
      res.on('error', reject);
      res.pipe(out);
    });

    request.on('error', reject);
  });
}

function createVersionResolver() {
  return {
    async resolveFromDmg(dmgPath) {
      const normalizedPath = typeof dmgPath === 'string' ? dmgPath.trim() : '';
      if (!normalizedPath) {
        throw new Error('source dmg path is required to resolve version');
      }

      const mountBase = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-version-resolver-'));
      const mountPoint = path.join(mountBase, 'mount');
      fs.mkdirSync(mountPoint, { recursive: true });

      const attach = spawnSync('hdiutil', [
        'attach',
        '-readonly',
        '-nobrowse',
        '-mountpoint',
        mountPoint,
        normalizedPath,
      ], { stdio: 'pipe' });

      if (attach.status !== 0) {
        const stderr = attach.stderr ? attach.stderr.toString().trim() : '';
        throw new Error(`unable to mount source dmg for version detection${stderr ? `: ${stderr}` : ''}`);
      }

      try {
        const infoPlist = path.join(mountPoint, 'Codex.app', 'Contents', 'Info.plist');
        if (!fs.existsSync(infoPlist)) {
          throw new Error('Info.plist not found in mounted Codex.app');
        }

        const shortVersion = spawnSync('/usr/libexec/PlistBuddy', [
          '-c',
          'Print :CFBundleShortVersionString',
          infoPlist,
        ], { stdio: 'pipe' });

        if (shortVersion.status === 0) {
          const value = shortVersion.stdout ? shortVersion.stdout.toString().trim() : '';
          if (value) {
            return value;
          }
        }

        const bundleVersion = spawnSync('/usr/libexec/PlistBuddy', [
          '-c',
          'Print :CFBundleVersion',
          infoPlist,
        ], { stdio: 'pipe' });

        if (bundleVersion.status === 0) {
          const value = bundleVersion.stdout ? bundleVersion.stdout.toString().trim() : '';
          if (value) {
            return value;
          }
        }

        throw new Error('could not read CFBundleShortVersionString from source app');
      } finally {
        const detach = spawnSync('hdiutil', ['detach', mountPoint], { stdio: 'pipe' });
        if (detach.status !== 0) {
          spawnSync('hdiutil', ['detach', '-force', mountPoint], { stdio: 'pipe' });
        }
        fs.rmSync(mountBase, { recursive: true, force: true });
      }
    },
  };
}

function getDefaultDeps(overrides = {}) {
  const io = overrides.io || createDefaultIo();
  const env = overrides.env || process.env;
  const githubRepo = resolveGithubRepo();
  const githubToken = env.GITHUB_TOKEN || env.GH_TOKEN || '';

  return {
    releaseApi: overrides.releaseApi || {
      async getLatest() {
        if (!githubRepo) {
          throw new Error('Missing repository for latest release lookup (set repository.url in package.json)');
        }

        const url = `https://api.github.com/repos/${githubRepo}/releases/latest`;
        const headers = {
          'User-Agent': 'get-codex-mac-intel',
          Accept: 'application/vnd.github+json',
        };

        if (githubToken) {
          headers.Authorization = `Bearer ${githubToken}`;
        }

        return getJson(url, headers);
      },
    },
    io,
    downloader: overrides.downloader || {
      async download(url, location, filename) {
        const normalizedLocation = String(location || '').trim();
        const normalizedName = String(filename || '').trim();
        if (!normalizedLocation || !normalizedName) {
          throw new Error('downloader.download requires location and filename');
        }
        fs.mkdirSync(normalizedLocation, { recursive: true });
        const outputPath = path.join(normalizedLocation, normalizedName);
        return streamDownload(url, outputPath);
      },
    },
    signer: overrides.signer || {
      async sign(targetPath) {
        const normalized = typeof targetPath === 'string' ? targetPath.trim() : '';
        if (!normalized) {
          throw new Error('sign path is required');
        }

        const result = spawnSync('codesign', [
          '--force',
          '--deep',
          '--sign',
          '-',
          '--timestamp=none',
          normalized,
        ], {
          stdio: 'pipe',
        });

        if (result.status !== 0) {
          const stderr = result.stderr ? result.stderr.toString().trim() : '';
          throw new Error(`codesign failed${stderr ? `: ${stderr}` : ''}`);
        }
      },
    },
    env,
    builder: overrides.builder || createLocalBuilder(),
    versionResolver: overrides.versionResolver || createVersionResolver(),
  };
}

function getDefaultDownloadsLocation(env) {
  const homeFromEnv = typeof env.HOME === 'string' ? env.HOME.trim() : '';
  const homeDir = homeFromEnv || os.homedir();
  return path.join(homeDir, 'Downloads');
}

function getDefaultBuildLocation(env) {
  if (env && typeof env.PWD === 'string' && env.PWD.trim() !== '') {
    return env.PWD.trim();
  }

  return process.cwd();
}

function usage() {
  return [
    'Usage:',
    '  npx get-codex-mac-intel [mode]',
    '',
    'Modes (choose one, default: --build):',
    '  -b, --build          Download upstream Codex.dmg for local build flow',
    '  -c, --cache          Show latest release info and optionally download/sign it',
    '  -s, --sign <path>    Ad-hoc sign a local app/dmg path',
    '  -w, --workdir <path> Build working directory (download source + write Intel DMG)',
    '      --platform <p>   Target platform: mac | windows',
    '      --arch <a>       Target arch: x64 | arm64 (windows)',
    '      --format <f>     Target format: dmg | zip',
    '',
    'Other options:',
    '  -h, --help           Show this help message',
    '',
    'Examples:',
    '  npx get-codex-mac-intel',
    '  npx get-codex-mac-intel --workdir /tmp/codex-build',
    '  npx get-codex-mac-intel --cache',
    '  npx get-codex-mac-intel --sign /Applications/Codex.app',
  ].join('\n');
}

async function runCacheMode(parsed, deps) {
  const target = normalizeTarget(parsed);
  const latest = await deps.releaseApi.getLatest();
  const summary = summarizeRelease(latest);
  const asset = pickLatestAssetForTarget(latest, target);
  const defaultLocation = getDefaultDownloadsLocation(deps.env);

  deps.io.log(`Version: ${summary.version}`);
  deps.io.log(`Datetime: ${summary.datetime}`);
  deps.io.log(`Release notes:\n${summary.notes}`);

  const locationFromArgs = String(parsed && parsed.workdir ? parsed.workdir : '').trim();
  const locationInput = locationFromArgs !== ''
    ? locationFromArgs
    : await deps.io.prompt('Download location', defaultLocation);
  const location = String(locationInput || '').trim();

  if (location === '') {
    return {
      mode: 'cache',
      downloaded: false,
      signed: false,
    };
  }

  const filename = asset.name;
  const fallbackPath = path.join(location, filename);
  deps.io.log(`Downloading: ${asset.browser_download_url}`);
  const downloadResult = await deps.downloader.download(asset.browser_download_url, location, filename);
  const downloadedPath = typeof downloadResult === 'string'
    ? downloadResult
    : (downloadResult && downloadResult.path) || fallbackPath;
  deps.io.log(`Download done: ${downloadedPath}`);

  if (target.platform === 'windows') {
    return {
      mode: 'cache',
      downloaded: true,
      signed: false,
      path: downloadedPath,
      target,
    };
  }

  const signAnswer = await deps.io.prompt('Sign downloaded file? (Y/n)', 'Y');
  let signed = false;
  if (isAffirmative(signAnswer)) {
    await deps.signer.sign(downloadedPath);
    signed = true;
  }

  return {
    mode: 'cache',
    downloaded: true,
    signed,
    path: downloadedPath,
    target,
  };
}

async function runSignMode(parsed, deps) {
  await deps.signer.sign(parsed.signPath);
  return {
    mode: 'sign',
    signed: true,
    path: parsed.signPath,
  };
}

async function runBuildMode(parsed, deps) {
  const target = normalizeTarget(parsed);
  const defaultLocation = getDefaultBuildLocation(deps.env);
  const location = String(parsed.workdir || '').trim() || defaultLocation;
  const filename = 'Codex.dmg';

  const sourceUrl = String(deps.env.CI_SOURCE_URL || 'https://persistent.oaistatic.com/codex-app-prod/Codex.dmg');
  deps.io.log(`Downloading: ${sourceUrl}`);
  const downloadResult = await deps.downloader.download(sourceUrl, location, filename);
  const downloadedPath = typeof downloadResult === 'string'
    ? downloadResult
    : (downloadResult && downloadResult.path) || path.join(location, filename);
  deps.io.log(`Download done: ${downloadedPath}`);

  const buildVersion = await deps.versionResolver.resolveFromDmg(downloadedPath);
  deps.io.log(`Detected source version: ${buildVersion}`);
  const outputName = makeOutputNameForTarget({
    version: buildVersion,
    platform: target.platform,
    arch: target.arch,
    format: target.format,
  });

  if (deps.builder && typeof deps.builder.run === 'function') {
    await deps.builder.run({
      location,
      downloadedPath,
      filename,
      outputName,
      target,
    });
  }

  return {
    mode: 'build',
    status: 'ok',
    downloaded: true,
    path: downloadedPath,
    outputName,
    target,
  };
}

async function runMain(argv = process.argv.slice(2), overrides = {}) {
  const parsed = parseArgs(argv);
  const deps = getDefaultDeps(overrides);

  if (parsed.mode === 'help') {
    deps.io.log(usage());
    return { mode: 'help' };
  }

  if (parsed.mode === 'cache') {
    return runCacheMode(parsed, deps);
  }

  if (parsed.mode === 'sign') {
    return runSignMode(parsed, deps);
  }

  return runBuildMode(parsed, deps);
}

module.exports = {
  runMain,
  isAffirmative,
  usage,
  parseGithubRepoFromUrl,
  resolveGithubRepo,
};
