# Codium Devcontainer

Alternative to proprietary VS Code Dev Containers for VSCodium, Positron, and similar IDEs. Uses Docker + SSH to build/run a container and open your folder inside it.

## Features
- Open Folder in Devcontainer (SSH): Builds an SSH-enabled image, runs or reuses the container, configures keys, and opens the folder via Remote SSH.
- Rebuild & Open: Prompts to stop/recreate safely when the container is running.
- Per-project image/container names: Clear tags and container reuse per project.
- Auto rebuild detection: Warns if `devcontainer.json` changed since the container was created.
- Add Dockerfile Template: Scaffolds `.devcontainer/Dockerfile` using the built-in template.
- Remote Indicator menu entries (bottom-left): Open Devcontainer Configuration, Open Folder in Devcontainer, Rebuild & Open.

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
2. Use the Command Palette or status bar:
  - Devcontainer: Open Folder in Devcontainer (SSH)
  - Devcontainer: Rebuild & Open
  - Click the status bar “Devcontainer” item for quick actions.

## How it Works
- Uses your `devcontainer.json` and its `image` as the base to build an SSH-enabled container.
- Mounts your folder at `/workspace/<folder>` and opens it inside the container over Remote SSH.
- Chooses a random available localhost port for SSH and adds your public key to the container for seamless login.
- Picks the effective SSH user automatically (or honor `remoteUser`) and focuses the terminal when `postStartCommand` runs.
- Reuses the per‑project container whenever possible; warns and lets you rebuild if the configuration changed.
- Stops the container one minute after the session ends.

## Limitations
- Debian/Ubuntu images recommended (template installs `openssh-server` via `apt`).
- Single-container only (no Docker Compose).
- No authoring tools for `devcontainer.json`.
- One container per project name; the extension reuses it when possible.
- Docker volumes are not managed (bind mounts only).

## Testing Locally
See contributing guide for local testing instructions.

## Commands
- Devcontainer: Add Dockerfile Template — creates `.devcontainer/Dockerfile` from the template.
- Devcontainer: Open Folder in Devcontainer (SSH) — builds with `BASE_IMAGE`, runs/reuses with SSH on a random local port, configures your key, and opens the folder over SSH.
- Devcontainer: Rebuild & Open — forces rebuild and safe recreate when needed.
- Devcontainer: Open Devcontainer Configuration — opens `.devcontainer/devcontainer.json`.
  - Note: Explorer context menu entries appear only when `.devcontainer/devcontainer.json` exists.

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
