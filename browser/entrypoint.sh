#!/bin/bash
# Start virtual framebuffer and run Oya Browser

# Start Xvfb
Xvfb :99 -screen 0 1920x1080x24 -ac &
sleep 1

# Run Electron with --no-sandbox (required in Docker)
exec npx electron . --no-sandbox --headless "$@"
