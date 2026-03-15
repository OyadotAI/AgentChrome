FROM node:22-alpine

WORKDIR /app

# Install deps first (layer cache)
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# Copy server source
COPY server/src/ ./src/

EXPOSE 3100

ENV NODE_ENV=production
ENV PORT=3100

CMD ["node", "src/index.js"]
