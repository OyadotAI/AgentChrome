FROM node:22-alpine

WORKDIR /app

# Install all deps (including devDependencies for build)
COPY server/package.json server/package-lock.json ./
RUN npm ci

# Copy source + build script
COPY server/src/ ./src/
COPY server/build.js ./

# Minify HTML/CSS/JS → dist/
RUN node build.js

# Copy browser downloads (served publicly at /downloads)
COPY server/downloads/ ./downloads/

# Remove devDependencies and build artifacts
RUN npm prune --omit=dev && rm -f build.js

EXPOSE 3100

ENV NODE_ENV=production
ENV PORT=3100

CMD ["node", "dist/index.js"]
