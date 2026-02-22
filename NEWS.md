# codium-devcontainer News

## Unreleased

Enhancements
- [#25](https://github.com/DDorch/codium-devcontainer/issues/25): Align `postStartCommand` behavior with devcontainer lifecycle semantics: run on each remote session start (removed once-per-session guard).

## 0.3.1 — 2026-01-05

Fixes
- [#18](https://github.com/DDorch/codium-devcontainer/issues/18): Ensure Docker image/tag names are lowercase to satisfy Docker naming rules.
- [#19](https://github.com/DDorch/codium-devcontainer/issues/19): Honor `postCreateCommand` by building with a temporary Dockerfile that injects commands as `RUN` steps.

## 0.3.0 — 2026-01-02

Enhancements
- [#13](https://github.com/DDorch/codium-devcontainer/issues/13): Reuse existing container instead of recreating it each time
- [#12](https://github.com/DDorch/codium-devcontainer/issues/12): Use per-project Docker image names for clarity
- [#14](https://github.com/DDorch/codium-devcontainer/issues/14): Auto-detect when an existing container needs rebuilding
- [#15](https://github.com/DDorch/codium-devcontainer/issues/15): Focus terminal when `postStartCommand` runs for deterministic UX

Fixes
- [#16](https://github.com/DDorch/codium-devcontainer/issues/16): Rebuild fails when container is already running; prompt and safely stop before recreate

## 0.2.1 — 2025-12-31

Enhancements
- [#11](https://github.com/DDorch/codium-devcontainer/issues/11): Simplify extension action list

Fixes
- [#9](https://github.com/DDorch/codium-devcontainer/issues/9): Extension not working on Windows; activation error "Cannot find module 'jsonc-parser'".

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
