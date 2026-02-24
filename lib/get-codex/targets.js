'use strict';

const SUPPORTED_PLATFORMS = ['mac', 'windows'];

const SUPPORTED_ARCHES_BY_PLATFORM = {
  mac: ['x64'],
  windows: ['x64', 'arm64'],
};

const SUPPORTED_FORMATS_BY_PLATFORM = {
  mac: ['dmg'],
  windows: ['zip'],
};

function normalizeValue(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeTarget(input = {}) {
  const platform = normalizeValue(input.platform) || 'mac';
  const arch = normalizeValue(input.arch) || 'x64';
  const format = normalizeValue(input.format) || (platform === 'windows' ? 'zip' : 'dmg');
  const target = { platform, arch, format };
  validateTarget(target);
  return target;
}

function validateTarget(target = {}) {
  const platform = normalizeValue(target.platform);
  const arch = normalizeValue(target.arch);
  const format = normalizeValue(target.format);

  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    throw new Error(`Unsupported platform: ${target.platform}`);
  }

  if (!SUPPORTED_ARCHES_BY_PLATFORM[platform].includes(arch)) {
    throw new Error(`Unsupported arch for ${platform}: ${target.arch}`);
  }

  if (!SUPPORTED_FORMATS_BY_PLATFORM[platform].includes(format)) {
    throw new Error(`Unsupported format for ${platform}: ${target.format}`);
  }
}

module.exports = {
  SUPPORTED_PLATFORMS,
  SUPPORTED_ARCHES_BY_PLATFORM,
  SUPPORTED_FORMATS_BY_PLATFORM,
  normalizeTarget,
  validateTarget,
};
