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
  const positional = [];

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

    if (arg.startsWith('-')) {
      die(`Unknown option: ${arg}`);
    }

    positional.push(arg);
  }

  if (!outputPath) {
    die('--output is required');
  }

  if (positional.length !== 1) {
    die('source Codex.dmg path is required');
  }

  return {
    outputPath: path.resolve(outputPath),
    sourceDmgPath: path.resolve(positional[0]),
    arch: String(arch).trim().toLowerCase(),
  };
}

function build() {
  const { outputPath, sourceDmgPath, arch } = parseArgs();
  const outputDir = path.dirname(outputPath);
  fs.mkdirSync(outputDir, { recursive: true });

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), `codex-windows-${arch}-`));
  try {
    const payloadDir = path.join(stagingDir, 'payload');
    fs.mkdirSync(payloadDir, { recursive: true });

    // Placeholder payload for deterministic zip output in CI scaffolding.
    fs.writeFileSync(path.join(payloadDir, 'README.txt'), [
      'Codex Windows portable package (build scaffold).',
      `arch=${arch}`,
      `source=${sourceDmgPath}`,
    ].join('\n'));

    const result = spawnSync('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path "${payloadDir}\\*" -DestinationPath "${outputPath}" -Force`,
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
