# Implementation Plan

[Overview]
Add end-to-end Windows support to the existing CLI and CI pipeline by introducing Windows-aware artifact selection (download/use case A) and automated Windows portable build generation from upstream `Codex.dmg` via GitHub Actions (build/use case B).

The current project is a Node.js CommonJS CLI focused on Mac Intel output (`CodexIntelMac_<version>.dmg`) with three modes (`build`, `cache`, `sign`) and a macOS-only builder script (`scripts/build-intel-dmg.js`). Build mode currently downloads upstream `Codex.dmg`, resolves app version by mounting DMG with `hdiutil`, and runs a local builder that assumes macOS commands and codesign behavior. Cache mode currently selects only `.dmg` assets and optional ad-hoc signing. CI currently runs only on `macos-latest` and publishes one Mac Intel DMG.

To support Windows comprehensively, we will preserve existing Mac behavior while adding: (1) platform/arch-aware asset download in CLI so Windows users can fetch Windows artifacts directly, and (2) a multi-job CI pipeline where macOS extracts payload from `Codex.dmg` and Windows jobs produce portable `.zip` artifacts for `x64` and `arm64` using upstream runtime/dependency versions inferred from source metadata. The design avoids trying to mount DMG on Windows directly and instead introduces a handoff artifact from macOS to Windows jobs.

[Types]
Introduce explicit build-target and artifact-selection types so platform-specific behavior is deterministic and testable.

Define (in new `lib/get-codex/targets.js`) canonical enums and helpers:

- `SUPPORTED_PLATFORMS`: `'mac' | 'windows'`
- `SUPPORTED_ARCHES_BY_PLATFORM`:
  - `mac`: `['x64']` (keep current scope)
  - `windows`: `['x64', 'arm64']`
- `SUPPORTED_FORMATS_BY_PLATFORM`:
  - `mac`: `['dmg']`
  - `windows`: `['zip']`

Define `BuildTarget` object contract:

- `platform: 'mac' | 'windows'` (required)
- `arch: 'x64' | 'arm64'` (required for windows; optional/default `x64` for mac)
- `format: 'dmg' | 'zip'` (required)
- Validation rules:
  - Reject unsupported platform/arch/format combination with actionable error.
  - If `platform=windows`, force `format=zip`.
  - If `platform=mac`, force `arch=x64` and `format=dmg` for current compatibility.

Define `ReleaseAssetSelectorInput` contract:

- `assets: Array<{ name: string, browser_download_url: string }>`
- `target: BuildTarget`
- Selection strategy:
  - Case-insensitive match for platform token + arch token + extension.
  - Prefer project-specific naming prefix when present (future-proof), then first strict match.
  - Throw explicit error listing candidate names when no exact match.

Define `OutputNameParts` contract for naming utility:

- `version: string` (required; sanitized via existing rules)
- `platform: 'mac' | 'windows'`
- `arch: 'x64' | 'arm64'`
- `format: 'dmg' | 'zip'`
- Naming rules:
  - Mac: `CodexIntelMac_<version>.dmg` (no behavior change).
  - Windows x64: `CodexWindows_x64_<version>.zip`.
  - Windows arm64: `CodexWindows_arm64_<version>.zip`.

[Files]
Add platform/arch-aware CLI and Windows build pipeline while keeping mac flow stable.

- New files to be created:
  - `lib/get-codex/targets.js`
    - Centralized platform/arch/format constants and normalization/validation helpers.
  - `scripts/build-windows-zip.js`
    - Builds portable Windows app zip from extracted Codex payload + runtime/dependency metadata.
  - `scripts/ci/extract-codex-payload.js`
    - macOS-side extraction script for CI handoff artifact (app resources, version metadata, dependency versions).
  - `tests/get-codex/targets.test.js`
    - Unit tests for target normalization and validation.
  - `tests/get-codex/windows-build-naming.test.js`
    - Tests for output naming generation across platform/arch.
  - `tests/ci/windows-workflow-contract.test.js`
    - Workflow contract tests for windows-latest matrix and artifact naming.

- Existing files to be modified:
  - `lib/get-codex/args.js`
    - Add new flags: `--platform`, `--arch`, `--format` with conflict/validation rules.
  - `lib/get-codex/build.js`
    - Generalize output-name API to support Windows zip naming while preserving current function behavior for Mac default path.
  - `lib/get-codex/release.js`
    - Add platform-aware asset selector (keep existing `pickLatestDmgAsset` as wrapper for backward compatibility).
  - `lib/get-codex/main.js`
    - Integrate target resolution from args/env.
    - Cache mode: select assets by target (`dmg` vs `zip`) and disable mac-only signing prompt for windows target.
    - Build mode: dispatch to platform-specific builder path; preserve current mac default.
  - `lib/get-codex/local-builder.js`
    - Route to `scripts/build-intel-dmg.js` or `scripts/build-windows-zip.js` based on target.
  - `README.md`
    - Document Windows support (download/build), flags, examples for x64/arm64 portable zip.
  - `package.json`
    - Update package metadata/keywords and test script inputs if new test files are added.
  - `.github/workflows/codex-intel-release.yml`
    - Extend to include mac extraction stage + windows build matrix stage + release upload of 2 zip artifacts.
  - `tests/get-codex/args.test.js`
    - Add coverage for new platform/arch/format args and invalid combinations.
  - `tests/get-codex/main.test.js`
    - Add behavior tests for cache/build paths with windows target.
  - `tests/get-codex/release.test.js`
    - Add Windows zip asset selection cases for x64/arm64.

- Files to be deleted or moved:
  - None (avoid churn; preserve existing paths).

- Configuration file updates:
  - `.github/workflows/codex-intel-release.yml` becomes multi-platform release workflow (still same file name unless renamed intentionally).

[Functions]
Introduce target resolution and Windows build helpers while preserving current public entry points.

- New functions:
  - `normalizeTarget(input)` in `lib/get-codex/targets.js`
    - Signature: `(input: { platform?: string, arch?: string, format?: string, env?: object }) => BuildTarget`
    - Purpose: derive canonical target from CLI args + defaults.
  - `validateTarget(target)` in `lib/get-codex/targets.js`
    - Signature: `(target: BuildTarget) => void`
    - Purpose: fail fast on invalid combinations.
  - `pickLatestAssetForTarget(release, target)` in `lib/get-codex/release.js`
    - Signature: `(release: object, target: BuildTarget) => { name: string, browser_download_url: string }`
    - Purpose: choose release artifact for target.
  - `makeOutputNameForTarget({ version, platform, arch, format })` in `lib/get-codex/build.js`
    - Purpose: deterministic artifact naming across platforms.
  - `extractCodexPayload({ sourceDmgPath, outputDir })` in `scripts/ci/extract-codex-payload.js`
    - Purpose: macOS CI extraction handoff for Windows build jobs.
  - `buildWindowsZip({ payloadDir, arch, outputZipPath })` in `scripts/build-windows-zip.js`
    - Purpose: assemble portable Windows app (`x64`/`arm64`) and zip output.

- Modified functions:
  - `parseArgs` in `lib/get-codex/args.js`
    - Add parse/validation for `--platform`, `--arch`, `--format`.
  - `runCacheMode` in `lib/get-codex/main.js`
    - Use target-aware selector and conditional sign prompt (mac only).
  - `runBuildMode` in `lib/get-codex/main.js`
    - Use target-aware naming and builder dispatch.
  - `getDefaultDeps` in `lib/get-codex/main.js`
    - Add target-aware defaults and keep backward compatibility.
  - `createLocalBuilder().run` in `lib/get-codex/local-builder.js`
    - Accept target payload and pick proper script entrypoint.
  - `pickLatestDmgAsset` in `lib/get-codex/release.js`
    - Convert to wrapper around generic selector for legacy callers.

- Removed functions:
  - None.
  - Migration strategy: keep legacy helpers exported and stable while introducing generic APIs; migrate internals first, then external docs.

[Classes]
No class-based architecture changes are required because the codebase is function/module oriented.

- New classes:
  - None.
- Modified classes:
  - None.
- Removed classes:
  - None.

[Dependencies]
Minimize dependency churn and prefer built-in tooling; add only what is necessary for Windows packaging reliability.

- Preferred approach: no new runtime dependencies in `lib/*`.
- Build-script/tooling additions (if needed after spike):
  - `@electron/asar` already used ad hoc via `npx --yes`; keep same pattern.
  - If zip creation needs robust cross-platform behavior in Node scripts, add one dev dependency (e.g., `archiver`) and pin major version explicitly.
- CI requirements:
  - Ensure Windows jobs have `7z`/PowerShell `Compress-Archive` fallback.
  - Use `actions/upload-artifact` and `actions/download-artifact` for mac->windows handoff.

[Testing]
Extend unit + workflow contract coverage to guarantee backward compatibility and new Windows behavior.

- Unit test updates:
  - `tests/get-codex/args.test.js`
    - parse success/failure for new flags and platform/arch constraints.
  - `tests/get-codex/build.test.js` + new windows naming tests
    - stable naming for mac + windows x64/arm64.
  - `tests/get-codex/release.test.js`
    - target-based asset selection for `.zip` windows artifacts.
  - `tests/get-codex/main.test.js`
    - cache/build mode behavior for windows target; no sign prompt on windows.

- CI workflow contract tests:
  - New/updated tests assert:
    - `windows-latest` matrix includes `x64` and `arm64`.
    - mac extraction job exists before windows jobs.
    - release uploads include two Windows zip artifacts with expected naming.

- Validation strategy:
  - Run `npm test` locally for unit coverage.
  - Dry-run workflow logic by validating generated workflow YAML contract tests.
  - In integration phase, trigger `workflow_dispatch` with `force=true` and verify release contains Mac DMG + Windows x64/arm64 zip.

[Implementation Order]
Implement target plumbing first, then workflow/build scripts, then docs/tests to minimize regression risk.

1. Add `targets` module and generalized naming helpers in `lib/get-codex`.
2. Extend CLI arg parsing (`--platform --arch --format`) with strict validation and tests.
3. Implement target-aware release asset selection and update cache mode behavior.
4. Refactor build dispatch in `main.js` + `local-builder.js` to accept target metadata.
5. Add `scripts/ci/extract-codex-payload.js` (mac extraction handoff).
6. Add `scripts/build-windows-zip.js` and validate it for `x64` + `arm64` artifact generation.
7. Update `.github/workflows/codex-intel-release.yml` to include mac extraction job and windows matrix jobs on `windows-latest`.
8. Expand workflow contract tests and unit tests for all new behavior.
9. Update `README.md` and package metadata/docs for Windows usage.
10. Run full test suite; perform CI `workflow_dispatch(force=true)` verification and finalize.