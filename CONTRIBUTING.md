# Contributing to Codium Devcontainer

Thanks for your interest in contributing! This guide covers how to ask for features, report bugs, develop locally, open pull requests, and cut releases.

## Ways to Contribute
- Bug reports: use the Bug Report template and include logs and repro steps.
- Feature requests: describe the use case and expected behavior.
- Documentation: clarify instructions, fix typos, or improve examples.
- Code contributions: fixes, features, or refactors that improve reliability or UX.

## Community Expectations
Be respectful and constructive. Assume good intent. Keep discussions focused on the problem and solution. If you feel a separate Code of Conduct is needed, open an issue to discuss adding one.

## Development Environment
- Node.js and npm
- Docker (daemon running)
- VS Code, VSCodium, or Positron

### Setup
```bash
npm ci
```

### Build and Type-Check
```bash
npm run check-types      # TypeScript only (no emit)
npm run build            # Dev build (fast, no minify)
npm run build:prod       # Production build (minified)
npm run compile          # Type-check + dev build
# Watch mode during development
npm run watch
```

### Run and Debug Locally
Launch an Extension Development Host and test against your current workspace:

- Positron (if installed):
```bash
positron --extensionDevelopmentPath="$PWD"
```
- VS Code:
```bash
code --extensionDevelopmentPath="$PWD"
```

Open a folder that contains a `.devcontainer/devcontainer.json`, then run "Devcontainer: Open Folder in Devcontainer (SSH)" from the Command Palette.

## Pull Requests
- Keep PRs focused and small when possible.
- Follow Conventional Commits for titles, e.g.:
	- `fix(ssh): handle missing public key prompt on Windows`
	- `feat: support custom SSH port via setting`
	- `docs: clarify prerequisites for Remote - SSH`
- Include a brief description, screenshots or logs where helpful, and manual test steps.
- Update docs if user-visible behavior changes (README/NEWS).
- Ensure CI (type-check/build) passes.

### PR Checklist
- Type-checks locally: `npm run check-types`
- Builds locally: `npm run package`
- Commands/labels match manifest and README
- Added/updated entries in `NEWS.md` if user-facing
- Tested "Open Folder in Devcontainer (SSH)" on your OS

## Reporting Issues
Please include:
- Editor and version (VS Code/VSCodium/Positron)
- Extension version (`package.json` or Extensions view)
- OS details
- Reproduction steps (minimal, exact, expected vs actual)
- Logs from the "Codium Devcontainer" output channel
- Relevant `/.devcontainer/devcontainer.json` fields (`image`, `remoteUser`, `post*Command`)

## Packaging
Produce a VSIX (runs production build via prepublish hook):
```bash
npm run vsce:package
```
Install the resulting `.vsix` via editor UI or CLI.

## Release Process
1. Update version in `package.json` and add notes in `NEWS.md`.
2. Commit and tag the release:
```bash
git commit -am "chore(release): vX.Y.Z"
git tag vX.Y.Z
git push && git push --tags
```
3. Create a GitHub Release (attach VSIX if desired).
4. CI publishes to Open VSX if configured (see `.github/workflows`). Ensure secret `OVSX_TOKEN` is set.

## Project Structure
- Extension entry: `src/extension.ts`
- Manifest: `package.json`
- SSH-enabled Dockerfile template: `assets/devcontainer/Dockerfile`
- Entrypoint script template: `assets/devcontainer/entrypoint.sh`
- Release notes: `NEWS.md`

## Coding Guidelines
- TypeScript throughout; keep changes minimal and focused
- Prefer clear naming; avoid platform-specific assumptions
- Run type checks before committing; keep `package.json` valid JSON
- Follow Conventional Commits to help generate clean changelogs
