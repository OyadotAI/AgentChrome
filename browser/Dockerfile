FROM node:22-slim

# Electron needs these system libraries + a virtual display
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    libgtk-3-0 \
    libnotify4 \
    libnss3 \
    libxss1 \
    libasound2t64 \
    libxtst6 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libgbm1 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libcups2 \
    libpango-1.0-0 \
    libcairo2 \
    libatspi2.0-0 \
    fonts-liberation \
    xdg-utils \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx electron rebuild 2>/dev/null; true

# Copy app
COPY main.js preload.js ./
COPY renderer/ ./renderer/
COPY scripts/ ./scripts/

# Electron needs --no-sandbox in Docker
ENV ELECTRON_DISABLE_SANDBOX=1
ENV DISPLAY=:99

# Default env vars (override at runtime)
ENV OYA_SERVER_URL=ws://host.docker.internal:3100/ws
ENV OYA_API_KEY=
ENV OYA_BROWSER_NAME=Oya Browser Docker
ENV OYA_HEADLESS=1

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
