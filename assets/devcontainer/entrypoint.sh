#!/usr/bin/env bash
# Added by codiumDevcontainer: entrypoint
set -euo pipefail

# Start sshd in foreground (backgrounded here for supervision)
/usr/sbin/sshd -D &
SSHD_PID=$!

# Stop file written by remote extension deactivate()
STOP_FILE="${CODIUM_WS:-/workspace}/.codium-devcontainer-stop"

cleanup() {
  if kill -0 "$SSHD_PID" 2>/dev/null; then
    kill "$SSHD_PID" || true
    wait "$SSHD_PID" 2>/dev/null || true
  fi
  exit 0
}
trap cleanup TERM INT

# Detect active SSH connections to port 22
has_active_ssh() {
  ss -tan 2>/dev/null | awk '$4 ~ /:22$/ && $1 ~ /ESTAB/ {found=1} END {exit !found}'
  return $?
}

CHECK_INTERVAL=${CHECK_INTERVAL:-2}
IDLE_GRACE_SECONDS=${IDLE_GRACE_SECONDS:-60}
idle_elapsed=0

# Poll for stop file or idle ssh
while true; do
  if [ -f "$STOP_FILE" ]; then
    rm -f "$STOP_FILE" || true
    cleanup
  fi

  if has_active_ssh; then
    idle_elapsed=0
  else
    idle_elapsed=$((idle_elapsed + CHECK_INTERVAL))
    if [ "$idle_elapsed" -ge "$IDLE_GRACE_SECONDS" ]; then
      echo "No active SSH sessions for ${IDLE_GRACE_SECONDS}s; stopping." >&2
      cleanup
    fi
  fi

  sleep "$CHECK_INTERVAL"

  # In case sshd died unexpectedly, exit
  if ! kill -0 "$SSHD_PID" 2>/dev/null; then
    exit 1
  fi
done
