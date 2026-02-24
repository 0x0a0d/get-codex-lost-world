'use strict';

function sanitizeVersion(version) {
  return String(version || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^0-9A-Za-z._-]/g, '-');
}

function makeOutputName(version) {
  return `CodexIntelMac_${sanitizeVersion(version)}.dmg`;
}

function makeOutputNameForTarget({ version, platform, arch, format }) {
  const safeVersion = sanitizeVersion(version);
  const normalizedPlatform = String(platform || '').trim().toLowerCase();
  const normalizedArch = String(arch || '').trim().toLowerCase();
  const normalizedFormat = String(format || '').trim().toLowerCase();

  if (normalizedPlatform === 'windows') {
    return `CodexWindows_${normalizedArch || 'x64'}_${safeVersion}.${normalizedFormat || 'zip'}`;
  }

  return `CodexIntelMac_${safeVersion}.${normalizedFormat || 'dmg'}`;
}

module.exports = {
  sanitizeVersion,
  makeOutputName,
  makeOutputNameForTarget,
};
