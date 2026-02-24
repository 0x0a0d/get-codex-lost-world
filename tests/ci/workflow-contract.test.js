'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowPath = path.join(__dirname, '../../.github/workflows/codex-intel-release.yml');

function readWorkflow() {
  return fs.readFileSync(workflowPath, 'utf8');
}

test('workflow includes 3-hour schedule cron', () => {
  const content = readWorkflow();

  assert.match(content, /schedule:\s*[\s\S]*cron:\s*['"]0 \*\/3 \* \* \*['"]/);
});

test('workflow includes workflow_dispatch force input', () => {
  const content = readWorkflow();

  assert.match(content, /workflow_dispatch:/);
  assert.match(content, /inputs:\s*[\s\S]*force:/);
});

test('workflow references ci-cache branch', () => {
  const content = readWorkflow();

  assert.match(content, /ci-cache/);
});

test('workflow uses Codex.dmg source URL', () => {
  const content = readWorkflow();

  assert.match(content, /https:\/\/persistent\.oaistatic\.com\/codex-app-prod\/Codex\.dmg/);
});

test('workflow defines CodexIntelMac artifact naming pattern', () => {
  const content = readWorkflow();

  assert.match(content, /CodexIntelMac_/);
});

test('workflow release notes include signing guidance', () => {
  const content = readWorkflow();

  assert.match(content, /ad-hoc signing/i);
  assert.match(content, /Developer ID/i);
  assert.match(content, /notarization/i);
});

test('workflow uses macOS runner and contents: write permission', () => {
  const content = readWorkflow();

  assert.match(content, /runs-on:\s*macos-/i);
  assert.match(content, /runs-on:\s*windows-latest/i);
  assert.match(content, /permissions:\s*[\s\S]*contents:\s*write/);
});

test('workflow defines top-level concurrency guard', () => {
  const content = readWorkflow();

  assert.match(content, /concurrency:\s*[\s\S]*group:\s*codex-intel-release-\$\{\{\s*github\.repository\s*\}\}/);
  assert.match(content, /concurrency:\s*[\s\S]*cancel-in-progress:\s*false/);
});

test('workflow fetches Last-Modified via curl -fsSLI', () => {
  const content = readWorkflow();

  assert.match(content, /curl\s+-fsSLI\s+"\$SOURCE_URL"/);
  assert.match(content, /last-modified:/i);
});

test('workflow uses check-update contract outputs', () => {
  const content = readWorkflow();

  assert.match(content, /node\s+scripts\/ci\/check-update\.js/);
  assert.match(content, /steps\.decision\.outputs\.should_build/);
  assert.match(content, /steps\.decision\.outputs\.reason/);
});

test('workflow builds intel dmg and names output from VERSION', () => {
  const content = readWorkflow();

  assert.match(content, /PlistBuddy[\s\S]*CFBundleShortVersionString/);
  assert.match(content, /artifact_name="CodexIntelMac_\$\{safe_version\}\.dmg"/);
  assert.match(content, /node\s+scripts\/build-intel-dmg\.js\s+--output\s+"\$ARTIFACT_PATH"\s+"\$SOURCE_DMG_PATH"/);
});

test('workflow defines windows matrix for x64 and arm64 portable zip', () => {
  const content = readWorkflow();

  assert.match(content, /codex-windows-release:/);
  assert.match(content, /matrix:\s*[\s\S]*arch:\s*\[x64, arm64\]/);
  assert.match(content, /scripts\/build-windows-zip\.js/);
  assert.match(content, /CodexWindows_\$\{\{ matrix\.arch \}\}_\$\{env:SAFE_VERSION\}\.zip/);
});

test('workflow uploads and downloads payload metadata artifact between mac and windows jobs', () => {
  const content = readWorkflow();

  assert.match(content, /scripts\/ci\/extract-codex-payload\.js/);
  assert.match(content, /uses:\s*actions\/upload-artifact@v4/);
  assert.match(content, /name:\s*codex-payload-metadata/);
  assert.match(content, /uses:\s*actions\/download-artifact@v4/);
});

test('workflow updates ci-cache state with required fields', () => {
  const content = readWorkflow();

  assert.match(content, /cache-state\.json/);
  assert.match(content, /lastModified/);
  assert.match(content, /version/);
  assert.match(content, /releaseTag/);
  assert.match(content, /processedAt/);
});

test('workflow has explicit clean skip path when should_build is false', () => {
  const content = readWorkflow();

  assert.match(content, /if:\s*\$\{\{\s*steps\.decision\.outputs\.should_build\s*!=\s*'true'\s*\}\}/);
});
