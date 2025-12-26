# Codium Devcontainer (VS Code Extension)

Build and run a devcontainer using a Docker image, then open your workspace over SSH in the container.

## Disclaimer

This extension is under development.
**There may be bugs or missing features.**
**Use at your own risk.**

## Features
- Devcontainer: Build & Run — builds an image and runs a container mounting your workspace.
- Devcontainer: Add Dockerfile Template — scaffolds a Dockerfile into `.devcontainer/Dockerfile`.
- Devcontainer: Open Workspace in Devcontainer (SSH) — builds an SSH-enabled image from the template, runs the container, configures keys, and opens the workspace via Remote SSH.

## Prerequisites
- Docker installed and daemon running.
- A workspace folder with `.devcontainer/devcontainer.json`.
  - Uses `image` as the base image for the template.
  - Optional: `remoteUser` for the SSH user (default: `vscode`).
- A local SSH public key available (e.g., `~/.ssh/id_ed25519.pub` or `~/.ssh/id_rsa.pub`).
- Remote - SSH extension installed (the extension can prompt to install it).

## Quickstart
1. Create a devcontainer config:
```json
{
  "image": "mcr.microsoft.com/devcontainers/javascript-node:22",
  "remoteUser": "vscode"
}
```
2. Compile the extension:
```bash
npm run compile
```
3. Use the Command Palette:
   - "Devcontainer: Open Workspace in Devcontainer (SSH)"
   - Or: "Devcontainer: Build & Run" to use `docker exec` rather than SSH.

## How it Works
- The SSH-enabled template at [assets/devcontainer/Dockerfile](assets/devcontainer/Dockerfile) is always used to build.
- The `image` in [`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json) becomes the `BASE_IMAGE` for the template.
- The container exposes SSH on `127.0.0.1:2222`, mounts your workspace to `/workspace`, and starts `sshd`.
- Your public key is added to `/home/<remoteUser>/.ssh/authorized_keys` inside the container.
- An SSH host alias `codium-devcontainer` is appended to `~/.ssh/config`.
- The extension opens `/workspace` via Remote SSH.

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
Open your workspace and run "Devcontainer: Open Workspace in Devcontainer (SSH)" from the Command Palette.

## Commands
- Devcontainer: Add Dockerfile Template — creates `.devcontainer/Dockerfile` from [assets/devcontainer/Dockerfile](assets/devcontainer/Dockerfile).
- Devcontainer: Build & Run — builds (if needed) and runs the container, then opens a Docker exec terminal.
- Devcontainer: Open Workspace in Devcontainer (SSH) — builds with `BASE_IMAGE`, runs with SSH on port 2222, configures your key, and opens the folder over SSH.

## Troubleshooting
- SSH port conflict: stop the previous container or change the port.
```bash
docker rm -f codium-devcontainer-ctr || true
```
- Remote - SSH missing: the command will prompt to install it.
- No public key found: you will be asked to select a `*.pub` key.
- Docker permissions: ensure your user can run Docker commands without sudo.

## Development
- Compile:
```bash
npm run compile
```
- Project files:
  - Extension entry: [src/extension.ts](src/extension.ts)
  - Template Dockerfile: [assets/devcontainer/Dockerfile](assets/devcontainer/Dockerfile)
  - Extension manifest: [package.json](package.json)

## License
This project is intended for local development and testing. No explicit license is provided.
