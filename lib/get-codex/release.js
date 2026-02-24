'use strict';

function summarizeRelease(release) {
  return {
    version: release?.tag_name || release?.name || '',
    datetime: release?.published_at || release?.created_at || '',
    notes: release?.body || '',
  };
}

function ensureAssetUrl(asset, extensionLabel) {
  if (typeof asset?.browser_download_url !== 'string' || asset.browser_download_url.trim() === '') {
    throw new Error(`Selected ${extensionLabel} asset is missing browser_download_url`);
  }
}

function pickLatestAssetForTarget(release, target = {}) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const platform = String(target.platform || 'mac').trim().toLowerCase();
  const arch = String(target.arch || 'x64').trim().toLowerCase();
  const format = String(target.format || (platform === 'windows' ? 'zip' : 'dmg')).trim().toLowerCase();

  const candidates = assets.filter((asset) => typeof asset?.name === 'string' && asset.name.toLowerCase().endsWith(`.${format}`));
  if (candidates.length === 0) {
    throw new Error(`No .${format} asset found in release assets`);
  }

  if (platform === 'windows') {
    const strictMatch = candidates.find((asset) => {
      const name = asset.name.toLowerCase();
      return name.includes('windows') && name.includes(arch);
    });

    if (strictMatch) {
      ensureAssetUrl(strictMatch, `.${format}`);
      return strictMatch;
    }

    const archMatch = candidates.find((asset) => asset.name.toLowerCase().includes(arch));
    if (archMatch) {
      ensureAssetUrl(archMatch, `.${format}`);
      return archMatch;
    }

    throw new Error(`No .${format} asset found for windows/${arch}`);
  }

  const preferred = candidates.find((asset) => /^CodexIntelMac_.*\.dmg$/i.test(asset.name));
  const selected = preferred || candidates[0];
  ensureAssetUrl(selected, `.${format}`);
  return selected;
}

function pickLatestDmgAsset(release) {
  return pickLatestAssetForTarget(release, { platform: 'mac', arch: 'x64', format: 'dmg' });
}

module.exports = {
  summarizeRelease,
  pickLatestAssetForTarget,
  pickLatestDmgAsset,
};
