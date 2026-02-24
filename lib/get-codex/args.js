'use strict';

function parseArgs(argv = []) {
  const modeFlags = [];
  let signPath;
  let workdir;
  let platform;
  let arch;
  let format;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg === '--cache' || arg === '-c') {
      modeFlags.push('cache');
      continue;
    }

    if (arg === '--build' || arg === '-b') {
      modeFlags.push('build');
      continue;
    }

    if (arg === '--sign' || arg === '-s') {
      modeFlags.push('sign');
      const candidate = argv[i + 1];
      if (typeof candidate !== 'string' || candidate.trim() === '' || candidate.startsWith('-')) {
        throw new Error('--sign requires a path');
      }
      signPath = candidate;
      i += 1;
      continue;
    }

    if (arg === '--workdir' || arg === '-w') {
      const candidate = argv[i + 1];
      if (typeof candidate !== 'string' || candidate.trim() === '' || candidate.startsWith('-')) {
        throw new Error('--workdir requires a path');
      }
      workdir = candidate;
      i += 1;
      continue;
    }

    if (arg === '--platform') {
      const candidate = argv[i + 1];
      if (typeof candidate !== 'string' || candidate.trim() === '' || candidate.startsWith('-')) {
        throw new Error('--platform requires a value');
      }
      platform = candidate;
      i += 1;
      continue;
    }

    if (arg === '--arch') {
      const candidate = argv[i + 1];
      if (typeof candidate !== 'string' || candidate.trim() === '' || candidate.startsWith('-')) {
        throw new Error('--arch requires a value');
      }
      arch = candidate;
      i += 1;
      continue;
    }

    if (arg === '--format') {
      const candidate = argv[i + 1];
      if (typeof candidate !== 'string' || candidate.trim() === '' || candidate.startsWith('-')) {
        throw new Error('--format requires a value');
      }
      format = candidate;
      i += 1;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  const uniqueModes = [...new Set(modeFlags)];
  if (uniqueModes.length > 1) {
    throw new Error('mode flag conflict');
  }

  if (help) {
    return { mode: 'help' };
  }

  const mode = uniqueModes[0] || 'build';
  const result = { mode };

  if (typeof platform === 'string') {
    result.platform = platform;
  }

  if (typeof arch === 'string') {
    result.arch = arch;
  }

  if (typeof format === 'string') {
    result.format = format;
  }

  if (typeof workdir === 'string') {
    result.workdir = workdir;
  }

  if (mode === 'sign') {
    result.signPath = signPath;
    return result;
  }

  return result;
}

module.exports = {
  parseArgs,
};
