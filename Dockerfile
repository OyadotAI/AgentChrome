# ── Stage 1: Build Next.js UI ──
FROM node:22-alpine AS ui-build

WORKDIR /ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

# ── Stage 2: Production server ──
FROM node:22-alpine

WORKDIR /app

# Install server deps (production only)
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# Server source
COPY server/src/ ./src/

# The page analyzer, which drivers/cdp.js injects into CDP browsers. It resolves
# it relative to its own file (../../../browser/scripts), so the layout matters:
# without this, analyze and click-by-element-id silently degrade in the image.
COPY browser/scripts/ /browser/scripts/

# Static UI from build stage
COPY --from=ui-build /ui/out/ ./ui-static/

# Browser binaries for download (populated by CI before build)
COPY server/downloads/ ./downloads/

EXPOSE 3100

ENV NODE_ENV=production
ENV PORT=3100

CMD ["node", "src/index.js"]
