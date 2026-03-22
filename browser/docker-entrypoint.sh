#!/bin/bash
set -e

# ── Start D-Bus ──
if [ -z "$DBUS_SESSION_BUS_ADDRESS" ]; then
  eval $(dbus-launch --sh-syntax)
  export DBUS_SESSION_BUS_ADDRESS
fi

# ── Start Xvfb ──
rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 "${SCREEN_WIDTH:-1920}x${SCREEN_HEIGHT:-1080}x${SCREEN_DEPTH:-24}" \
  -ac -nolisten tcp +extension GLX &
XVFB_PID=$!

# Wait for Xvfb to be ready
for i in $(seq 1 10); do
  if xdpyinfo -display :99 >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

# ── Optional VNC ──
if [ "$VNC_ENABLED" = "true" ]; then
  x11vnc -display :99 -forever -shared -rfbport "${VNC_PORT:-5900}" \
    -nopw -xkb -noxrecord -noxfixes -noxdamage &
  echo "[oya-docker] VNC server started on port ${VNC_PORT:-5900}"
fi

# ── Graceful shutdown ──
cleanup() {
  echo "[oya-docker] Shutting down..."
  kill $ELECTRON_PID 2>/dev/null || true
  wait $ELECTRON_PID 2>/dev/null || true
  kill $XVFB_PID 2>/dev/null || true
  exit 0
}
trap cleanup SIGTERM SIGINT

# ── Start Electron ──
# --no-sandbox must be a CLI arg — Electron checks for root before app code runs
echo "[oya-docker] Starting Oya Browser (${SCREEN_WIDTH:-1920}x${SCREEN_HEIGHT:-1080})"
npx electron . --no-sandbox --disable-gpu 2>&1 | grep -v "bus.cc\|viz_main_impl\|command_buffer_proxy\|interface_endpoint_client" &
ELECTRON_PID=$!

wait $ELECTRON_PID
cleanup
