# codium-devcontainer News

## 0.1.1 — 2025-12-28

Fixes
- [#5](https://github.com/DDorch/codium-devcontainer/issues/5): postStartCommand not working (Open).

## 0.1.0 — 2025-12-28

Enhancements
- [#4](https://github.com/DDorch/codium-devcontainer/issues/4): Run postStartCommand in remote terminal with progress/logs (string/array; once per folder).
- [#3](https://github.com/DDorch/codium-devcontainer/issues/3): Default to container user (whoami) with non-root fallback; honor remoteUser; template user only when USERNAME is set.
- [#2](https://github.com/DDorch/codium-devcontainer/issues/2): Stream Docker build/run and SSH setup; add SSH preflight; ignore invalid local ssh config.
- [#1](https://github.com/DDorch/codium-devcontainer/issues/1): Append postCreateCommand as RUN lines to .devcontainer/Dockerfile (idempotent; string/array).
