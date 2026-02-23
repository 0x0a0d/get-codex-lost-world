# get-codex-mac-intel

CLI to build **Codex Mac Intel** from upstream `Codex.dmg`, with cache/sign modes.

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
- Output name: `CodexIntelMac_<version>.dmg`.
- `version` is read from source `Codex.dmg` -> `Codex.app/Contents/Info.plist`:
  - `CFBundleShortVersionString`
  - fallback: `CFBundleVersion`

Example:

```bash
npx get-codex-mac-intel --build --workdir ~/Downloads
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
5. Asks whether to sign the downloaded file.

### 3) Sign mode

```bash
npx get-codex-mac-intel --sign <path>
```

Example:

```bash
npx get-codex-mac-intel --sign /Applications/Codex.app
```
