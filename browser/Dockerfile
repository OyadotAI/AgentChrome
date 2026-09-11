# ── Oya Browser — Docker (headless Electron via Xvfb) ──
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Install Xvfb, dbus, and all Electron/Chromium dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11-utils \
    dbus \
    dbus-x11 \
    # Chromium/Electron shared libraries
    libgtk-3-0 \
    libnotify4 \
    libnss3 \
    libxss1 \
    libxtst6 \
    libgbm1 \
    libasound2 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libpango-1.0-0 \
    libcairo2 \
    libxkbcommon0 \
    libatspi2.0-0 \
    # Fonts
    fonts-liberation \
    fonts-noto-color-emoji \
    # VNC (optional, for debugging)
    x11vnc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy browser source
COPY main.js preload.js login-state.js governance.js ./
COPY renderer/ ./renderer/
COPY scripts/ ./scripts/
COPY anonymity/ ./anonymity/
COPY build/ ./build/

# Copy entrypoint
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Display
ENV DISPLAY=:99

# Screen resolution
ENV SCREEN_WIDTH=1920
ENV SCREEN_HEIGHT=1080
ENV SCREEN_DEPTH=24

# Docker mode
ENV OYA_DOCKER=true
LABEL ai.getoya.governance="1"

# VNC off by default
ENV VNC_ENABLED=false
ENV VNC_PORT=5900

EXPOSE 5900

ENTRYPOINT ["/docker-entrypoint.sh"]
