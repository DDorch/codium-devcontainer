# Codium Devcontainer (VS Code Extension)

Build and run a devcontainer using a Docker image, then open your folder over SSH in the container.

## Features
- Devcontainer: Build & Run — builds an image and runs a container mounting your folder.
- Devcontainer: Add Dockerfile Template — scaffolds a Dockerfile into `.devcontainer/Dockerfile`.
- Devcontainer: Open Folder in Devcontainer (SSH) — builds an SSH-enabled image from the template, runs the container, configures keys, and opens the folder via Remote SSH.
- Remote Indicator menu entries — in the bottom-left Remote menu:
  - Open Devcontainer Configuration
  - Open Folder in Devcontainer (SSH)

## Installation
- From Open VSX Marketplace (recommended for VSCodium/Positron/Theia):
  - UI: Extensions view → search for "Codium Devcontainer" → Install
  - CLI:
    - VSCodium: `codium --install-extension DDorch.codium-devcontainer`
    - Positron: `positron --install-extension DDorch.codium-devcontainer`
  - Open VSX page: https://open-vsx.org/extension/DDorch/codium-devcontainer
- From GitHub Releases (for VS Code or offline):
  - Download the latest `.vsix` from https://github.com/DDorch/codium-devcontainer/releases/latest
  - Install the VSIX:
    - VS Code: `code --install-extension ./codium-devcontainer-X.Y.Z.vsix`
    - VSCodium/Positron: `codium|positron --install-extension ./codium-devcontainer-X.Y.Z.vsix`
    - UI: Extensions view → “…” menu → Install from VSIX…
- From source (optional):
  - `npm ci && npm run compile`
  - `npm i -D @vscode/vsce && npx vsce package`
  - Install the generated `.vsix` as above

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
- The container exposes SSH on `127.0.0.1:<port>`, mounts your folder to `/workspace/<folderName>`, sets the working directory to that path, and starts `sshd`.
- Your public key is added to `/home/<user>/.ssh/authorized_keys` inside the container, where `<user>` is either `remoteUser` (if set) or the detected container user (`whoami`).
- If `remoteUser` is provided, it is passed as `USERNAME` build arg to the image; otherwise the base image's default user is used and detected at runtime.
- If `postCreateCommand` is set in the devcontainer config, it runs as part of the Docker build (idempotent).
- A random available port is chosen for SSH.
- An SSH host alias `codium-devcontainer-<projectName>` is appended to `~/.ssh/config`.
- The extension opens `/workspace/<folderName>` via Remote SSH.
- If `postStartCommand` is set in the devcontainer config, it runs in the remote terminal after connection.
- The container auto-stops when the SSH session closes or after being idle for ~60 seconds by default. You can change the idle timeout via the `IDLE_GRACE_SECONDS` environment variable.

## Limitations
- Only work on docker images based on Debian/Ubuntu (uses `apt` to install `openssh-server`).
- Only single-container configurations are supported (no docker compose)
- No tools or templates are supplied for creating or authoring devcontainer.json files
- Only one container is supported per project (Re-open in Devcontainer will rebuild/run the same container)
- Docker volumes are not supported, just regular mounts

## Testing Locally
See contributing guide for local testing instructions.

## Commands
- Devcontainer: Add Dockerfile Template — creates `.devcontainer/Dockerfile` from [assets/devcontainer/Dockerfile](assets/devcontainer/Dockerfile).
- Devcontainer: Build & Run — builds (if needed) and runs the container, then opens a Docker exec terminal.
- Devcontainer: Open Folder in Devcontainer (SSH) — builds with `BASE_IMAGE`, runs with SSH on port 2222, configures your key, and opens the folder over SSH.
- Devcontainer: Open Devcontainer Configuration — opens `.devcontainer/devcontainer.json`.
  - Note: Explorer context menu entries appear only when `.devcontainer/devcontainer.json` exists in the current folder.

## Troubleshooting
- SSH connection issues:
  - Firewalls or corporate endpoint protection can block localhost SSH connections; temporarily disable or add an allow rule if needed.
- Remote - SSH missing: the command will prompt to install it. If it isn't available in your marketplace, use "Devcontainer: Build & Run" and work via the opened SSH terminal, or manually connect with your preferred SSH client to `<user>@localhost:<port>` (the user is either `remoteUser` or detected via `whoami`).
- No public key found: you will be asked to select a `*.pub` key.
- Docker permissions: ensure your user can run Docker commands without sudo.

## Contributing
Development setup, testing, packaging, and release instructions are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Changelog
See [NEWS.md](NEWS.md) for release notes.

## License
This project is licensed under the MIT License.

See [LICENSE](LICENSE) for the full text.

## Acknowledgements

This extension is inspired by Andrew Heiss’s blog post:

Heiss, Andrew. 2025. “Use Positron to Run R Inside a Docker Image Through SSH.” July 5, 2025. https://doi.org/10.59350/fredm-56671.
