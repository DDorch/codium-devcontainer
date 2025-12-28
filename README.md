# Codium Devcontainer (VS Code Extension)

Build and run a devcontainer using a Docker image, then open your folder over SSH in the container.

## Disclaimer

This extension is under development.
**There may be bugs or missing features.**
**Use at your own risk.**

## Features
- Devcontainer: Build & Run — builds an image and runs a container mounting your folder.
- Devcontainer: Add Dockerfile Template — scaffolds a Dockerfile into `.devcontainer/Dockerfile`.
- Devcontainer: Open Folder in Devcontainer (SSH) — builds an SSH-enabled image from the template, runs the container, configures keys, and opens the folder via Remote SSH.
- Remote Indicator menu entries — in the bottom-left Remote menu:
  - Open Devcontainer Configuration
  - Reopen in Devcontainer

## Prerequisites
- Docker installed and daemon running.
- A folder with `.devcontainer/devcontainer.json`.
  - Uses `image` as the base image for the template.
  - Optional: `remoteUser` for the SSH user. If omitted, the extension detects the container's current user via `docker exec whoami` and uses that for SSH and key setup.
- A local SSH public key available (e.g., `~/.ssh/id_ed25519.pub` or `~/.ssh/id_rsa.pub`).
- Optional: Remote - SSH extension (needed only for "Open Folder in Devcontainer (SSH)" to open the folder in a Remote window). If unavailable on your marketplace (e.g., Open VSX/VSCodium), you can still use "Build & Run" or connect via an SSH terminal.

## Quickstart
1. Create a devcontainer config:
```json
{
  "image": "mcr.microsoft.com/devcontainers/javascript-node:22"
  // remoteUser is optional; defaults to the container's user (detected via whoami)
}
```
2. Compile the extension:
```bash
npm run compile
```
3. Use the Command Palette or status bar:
  - "Devcontainer: Open Folder in Devcontainer (SSH)"
   - Or: "Devcontainer: Build & Run" to use `docker exec` rather than SSH.
  - Click the status bar “Devcontainer” item for quick actions.

## How it Works
- The SSH-enabled template at [assets/devcontainer/Dockerfile](assets/devcontainer/Dockerfile) is always used to build.
- The `image` in [`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json) becomes the `BASE_IMAGE` for the template.
- The container exposes SSH on `127.0.0.1:2222`, mounts your folder to `/workspace/<folderName>`, sets the working directory to that path, and starts `sshd`.
- Your public key is added to `/home/<user>/.ssh/authorized_keys` inside the container, where `<user>` is either `remoteUser` (if set) or the detected container user (`whoami`).
- If `remoteUser` is provided, it is passed as `USERNAME` build arg to the image; otherwise the base image's default user is used and detected at runtime.
- An SSH host alias `codium-devcontainer` is appended to `~/.ssh/config`.
- The extension opens `/workspace/<folderName>` via Remote SSH.

## Testing in Positron
If Positron is installed and on PATH:
```bash
positron --extensionDevelopmentPath="$PWD"
```
If not available, test in VS Code similarly:
```bash
code --extensionDevelopmentPath="$PWD"
```

### Test via VSIX
```bash
npm i -D @vscode/vsce
npx vsce package
# Install into Positron or VS Code
positron --install-extension ./codium-devcontainer-0.0.1.vsix || \
code --install-extension ./codium-devcontainer-0.0.1.vsix
```
Open your folder and run "Devcontainer: Open Folder in Devcontainer (SSH)" from the Command Palette.

## Commands
- Devcontainer: Add Dockerfile Template — creates `.devcontainer/Dockerfile` from [assets/devcontainer/Dockerfile](assets/devcontainer/Dockerfile).
- Devcontainer: Build & Run — builds (if needed) and runs the container, then opens a Docker exec terminal.
- Devcontainer: Open Folder in Devcontainer (SSH) — builds with `BASE_IMAGE`, runs with SSH on port 2222, configures your key, and opens the folder over SSH.
- Devcontainer: Open Devcontainer Configuration — opens `.devcontainer/devcontainer.json`.
- Devcontainer: Reopen in Devcontainer — builds and reopens the current folder in the devcontainer.
  - Note: Explorer context menu entries appear only when `.devcontainer/devcontainer.json` exists in the current folder.

## Troubleshooting
- SSH port conflict: stop the previous container or change the port.
```bash
docker rm -f codium-devcontainer-ctr || true
```
- Remote - SSH missing: the command will prompt to install it. If it isn't available in your marketplace, use "Devcontainer: Build & Run" and work via the opened SSH terminal, or manually connect with your preferred SSH client to `<user>@localhost:2222` (the user is either `remoteUser` or detected via `whoami`).
- No public key found: you will be asked to select a `*.pub` key.
- Docker permissions: ensure your user can run Docker commands without sudo.

## Development
- Compile:
```bash
npm run compile
```
- Release (CI):
  - Push a tag `vX.Y.Z` matching `package.json` version.
  - GitHub Actions builds the VSIX and creates a release attaching the `.vsix`.
  - Manual trigger available via the workflow dispatch if needed.
- Project files:
  - Extension entry: [src/extension.ts](src/extension.ts)
  - Template Dockerfile: [assets/devcontainer/Dockerfile](assets/devcontainer/Dockerfile)
  - Extension manifest: [package.json](package.json)
  - CI workflow: [.github/workflows/release.yml](.github/workflows/release.yml)

## License
This project is licensed under the MIT License.

See [LICENSE](LICENSE) for the full text.
