'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function createLocalBuilder(overrides = {}) {
  const builderEntry = overrides.builderEntry || path.resolve(__dirname, '../../index.js');
  const fsApi = overrides.fsApi || fs;
  const spawnSyncFn = overrides.spawnSync || spawnSync;
  const nodeExecPath = overrides.nodeExecPath || process.execPath;

  return {
    async run({ location, downloadedPath, outputName }) {
      const normalizedLocation = typeof location === 'string' ? location.trim() : '';
      const normalizedSource = typeof downloadedPath === 'string' ? downloadedPath.trim() : '';
      const normalizedOutputName = typeof outputName === 'string' ? outputName.trim() : '';

      if (!normalizedLocation) {
        throw new Error('build output location is required');
      }
      if (!normalizedSource) {
        throw new Error('source Codex.dmg path is required to run the builder');
      }
      if (!normalizedOutputName) {
        throw new Error('build output filename is required');
      }
      if (!fsApi.existsSync(builderEntry)) {
        throw new Error('Local builder entrypoint (index.js) was not found');
      }

      fsApi.mkdirSync(normalizedLocation, { recursive: true });
      const outputPath = path.join(normalizedLocation, normalizedOutputName);
      const result = spawnSyncFn(nodeExecPath, [
        builderEntry,
        '--output',
        outputPath,
        normalizedSource,
      ], {
        stdio: 'inherit',
      });

      if (result.error) {
        throw result.error;
      }

      if (result.status !== 0) {
        throw new Error('Local builder failed (see logs above for details)');
      }

      return { outputPath };
    },
  };
}

module.exports = {
  createLocalBuilder,
};
