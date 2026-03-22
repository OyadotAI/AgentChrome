FROM node:22-alpine

WORKDIR /app

# Install server deps
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# Copy server source
COPY server/src/ ./src/

# Static files (openapi.json, llms.txt)
COPY server/src/public/ ./src/public/

# Browser binaries for download (populated by CI before build)
COPY server/downloads/ ./downloads/

EXPOSE 3100

ENV NODE_ENV=production
ENV PORT=3100

CMD ["node", "src/index.js"]
