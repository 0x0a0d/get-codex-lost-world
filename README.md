# get-codex-mac-intel

CLI to build/download Codex artifacts from upstream `Codex.dmg`, with support for:

- Mac Intel DMG
- Windows portable ZIP (x64/arm64)

## Quick start

Entrypoint:

```bash
npx get-codex-mac-intel
```

Help:

```bash
npx get-codex-mac-intel --help
```

## Modes

### 1) Build mode (default)

```bash
npx get-codex-mac-intel
# or
npx get-codex-mac-intel --build
```

- By default, the **current working directory (cwd)** is used for source download + output.
- Use `-w, --workdir <path>` to set the working directory.
- Default target output: `CodexIntelMac_<version>.dmg`.
- Windows target output:
  - `CodexWindows_x64_<version>.zip`
  - `CodexWindows_arm64_<version>.zip`
- `version` is read from source `Codex.dmg` -> `Codex.app/Contents/Info.plist`:
  - `CFBundleShortVersionString`
  - fallback: `CFBundleVersion`

Target flags:

- `--platform <mac|windows>`
- `--arch <x64|arm64>` (for windows)
- `--format <dmg|zip>`

Example:

```bash
npx get-codex-mac-intel --build --workdir ~/Downloads
npx get-codex-mac-intel --build --platform windows --arch arm64 --format zip --workdir ~/Downloads
```

### 2) Cache mode

```bash
npx get-codex-mac-intel --cache
```

Flow:
1. Shows latest release info.
2. Prompts for `Download location`.
3. If empty -> skip download.
4. If a path is provided -> download latest release asset.
5. For Mac target, asks whether to sign the downloaded file.
6. For Windows target, signing step is skipped.

Windows cache example:

```bash
npx get-codex-mac-intel --cache --platform windows --arch x64 --format zip
```

### 3) Sign mode

```bash
npx get-codex-mac-intel --sign <path>
```

Example:

```bash
npx get-codex-mac-intel --sign /Applications/Codex.app
```
