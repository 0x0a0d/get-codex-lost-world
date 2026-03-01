# Get Codex Lost World - Codex for Desktop

Bring Codex to **Intel Mac** with a simple CLI workflow for build, download, and packaging. 🚀

[![Build](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/0x0a0d/get-codex-lost-world)
[![Version](https://img.shields.io/badge/version-1.0.3-blue)](https://github.com/0x0a0d/get-codex-lost-world)
[![License: ISC](https://img.shields.io/badge/license-ISC-lightgrey)](./LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/0x0a0d/get-codex-lost-world?style=social)](https://github.com/0x0a0d/get-codex-lost-world)

![Get Codex Lost World Screenshot](./codex.png)

## Introduction

**Get Codex** is a desktop-focused toolchain that helps users on platforms often left behind by official releases:

- macOS Intel (`.dmg`)

It automates artifact resolution, local build flow, and optional signing steps.

> [!NOTE]
> Windows support in this repository was removed because OpenAI now provides an official Codex app for Windows via Microsoft Store: https://apps.microsoft.com/detail/9plm9xgg6vks?hl=en-US&gl=EG

## Features

- ⚡ Build mode for Intel Mac target
- 📦 Cache/download mode for latest release artifacts
- 🍎 macOS Intel DMG output
- 🔐 Optional signing flow for macOS artifacts
- 🧩 Simple CLI flags for platform, arch, format, and workdir

## Tech Stack

- **Runtime:** Node.js
- **Language:** JavaScript (CommonJS)
- **Testing:** Node.js built-in test runner (`node --test`)
- **Packaging Scripts:** Custom Node scripts for macOS build artifacts

## Installation

### Option 1: Run directly with NPX

```bash
npx get-codex-lost-world --help
```

### Option 2: Clone and run locally

```bash
git clone https://github.com/0x0a0d/get-codex-lost-world.git
cd get-codex-lost-world
npm install
npm test
```

## Usage

### Show help

```bash
npx get-codex-lost-world --help
```

### Build mode (default)

```bash
npx get-codex-lost-world
```

```bash
npx get-codex-lost-world --build --workdir /absolute/path/to/workdir
```

### Cache/download mode

```bash
npx get-codex-lost-world --cache --platform mac --arch x64 --format dmg
```

### Sign mode

```bash
npx get-codex-lost-world --sign /Applications/Codex.app
```

## Contributing

Contributions are welcome! 🙌

```bash
git checkout -b feat/your-feature
npm test
git commit -m "feat: add your feature"
git push origin feat/your-feature
```

Then open a Pull Request.

## License

Licensed under the **ISC** License.
