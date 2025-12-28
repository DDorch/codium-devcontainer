# codium-devcontainer News

## 0.2.0 — 2025-12-28

Enhancements
- [#6](https://github.com/DDorch/codium-devcontainer/issues/6): Use random SSH port to allow multiple sessions on the same computer; host alias updated automatically.
- [#8](https://github.com/DDorch/codium-devcontainer/issues/8): Add auto-stop for the devcontainer when the remote session closes or after idle; entrypoint supervises `sshd` and handles stop signal.

Documentation
- [#7](https://github.com/DDorch/codium-devcontainer/issues/7): Publish the extension on open-vsx.org and add release workflow to publish on tag; update Installation section.

## 0.1.1 — 2025-12-28

Fixes
- [#5](https://github.com/DDorch/codium-devcontainer/issues/5): postStartCommand not working (Open).

## 0.1.0 — 2025-12-28

Enhancements
- [#4](https://github.com/DDorch/codium-devcontainer/issues/4): Run postStartCommand in remote terminal with progress/logs (string/array; once per folder).
- [#3](https://github.com/DDorch/codium-devcontainer/issues/3): Default to container user (whoami) with non-root fallback; honor remoteUser; template user only when USERNAME is set.
- [#2](https://github.com/DDorch/codium-devcontainer/issues/2): Stream Docker build/run and SSH setup; add SSH preflight; ignore invalid local ssh config.
- [#1](https://github.com/DDorch/codium-devcontainer/issues/1): Append postCreateCommand as RUN lines to .devcontainer/Dockerfile (idempotent; string/array).
