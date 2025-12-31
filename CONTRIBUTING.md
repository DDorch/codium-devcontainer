# Contributing to Codium Devcontainer

Thanks for your interest in contributing! This guide covers local setup, building, testing, packaging, and releasing the extension.

## Prerequisites
- Node.js and npm
- Docker (daemon running)
- VS Code, VSCodium, or Positron for extension development

## Setup
```bash
npm ci
```

## Build and Type-Check
```bash
npm run check-types
npm run compile
# Or watch mode during development
npm run watch
```

## Run and Debug Locally
Launch the extension host and test against your current workspace:

- Positron (if installed):
```bash
positron --extensionDevelopmentPath="$PWD"
```
- VS Code:
```bash
code --extensionDevelopmentPath="$PWD"
```

In the Extension Development Host, open a folder that contains a `.devcontainer/devcontainer.json`, then run "Devcontainer: Open Folder in Devcontainer (SSH)" from the Command Palette.

## Packaging
Create a production build and bundle assets:
```bash
npm run package
```
Optionally produce a VSIX with `vsce`:
```bash
npm run vsce:package
```
The resulting `.vsix` can be installed via the editor UI or CLI.

## Release Process
1. Update version in `package.json` and add notes in `NEWS.md`.
2. Commit and tag the release:
```bash
git commit -am "chore(release): vX.Y.Z"
git tag vX.Y.Z
git push && git push --tags
```
3. Create a GitHub Release (attach the VSIX if desired).
4. CI publishes to Open VSX if configured (see `.github/workflows` for details). Ensure repository secret `OVSX_TOKEN` is set.

## Project Structure
- Extension entry point: `src/extension.ts`
- Extension manifest: `package.json`
- SSH-enabled Dockerfile template: `assets/devcontainer/Dockerfile`
- Template entrypoint script: `assets/devcontainer/entrypoint.sh`
- Release notes: `NEWS.md`

## Coding Guidelines
- Language: TypeScript (strict where practical)
- Keep changes minimal and focused; prefer clear, small PRs
- Follow existing naming and formatting; run type checks before committing
- Avoid hardcoding platform-specific paths; support Linux, macOS, and Windows where possible

## Reporting Issues
Please include:
- Extension version, editor (VS Code/VSCodium/Positron) and version
- OS details
- Steps to reproduce
- Relevant logs from the "Codium Devcontainer" output channel
