#!/usr/bin/env bash
set -euo pipefail

SSH_TARGET="${1:-${CLASHBOT_SSH_HOST:-}}"
LOCAL_PORT="${LOCAL_PORT:-8080}"
REMOTE_HOST="${REMOTE_HOST:-api.clashofclans.com}"
REMOTE_PORT="${REMOTE_PORT:-443}"
TUNNEL_DURATION_SEC="${TUNNEL_DURATION_SEC:-3600}"

if [[ -z "$SSH_TARGET" ]]; then
    echo "Usage: $0 <user@server-ip>" >&2
    echo "   or: CLASHBOT_SSH_HOST=<user@server-ip> $0" >&2
    exit 1
fi

echo "Setting up SSH tunnel via $SSH_TARGET (localhost:$LOCAL_PORT -> $REMOTE_HOST:$REMOTE_PORT)..."

if command -v lsof >/dev/null 2>&1 && lsof -ti :"$LOCAL_PORT" >/dev/null 2>&1; then
    echo "Existing listener on port $LOCAL_PORT found, stopping..."
    kill "$(lsof -ti :"$LOCAL_PORT")" 2>/dev/null || true
    sleep 2
fi

ssh -f \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -L "${LOCAL_PORT}:${REMOTE_HOST}:${REMOTE_PORT}" \
    "$SSH_TARGET" \
    "echo 'Tunnel active' && sleep ${TUNNEL_DURATION_SEC}"

sleep 2
if curl -k -s --max-time 5 "https://localhost:${LOCAL_PORT}/v1/" >/dev/null; then
    echo "Tunnel launched successfully on https://localhost:${LOCAL_PORT}/v1"
else
    echo "Tunnel started, but endpoint check did not succeed yet." >&2
    exit 1
fi
