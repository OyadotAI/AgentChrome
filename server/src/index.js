/**
 * Oya Browser server — HTTP + WebSocket + MCP API.
 * API routes are served under /api, static UI at /.
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cors from 'cors';
import { router as apiRouter } from './api.js';
import { handleConnection } from './ws-handler.js';
import { handleMcpRequest, handlePoolMcpRequest } from './mcp-server.js';
import { validateApiKey } from './auth.js';
import { registry } from './connection-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3100', 10);

const app = express();
app.use(express.json());
app.use(cors());

const publicDir = join(__dirname, 'public');

// ── Discovery & docs (root level) ──
app.use('/.well-known', express.static(join(publicDir, '.well-known')));
app.get('/llms.txt', (req, res) => res.type('text/plain').sendFile(join(publicDir, 'llms.txt')));
app.get('/docs.txt', (req, res) => res.type('text/plain').sendFile(join(publicDir, 'llms.txt')));
app.get('/openapi.json', (req, res) => res.type('application/json').sendFile(join(publicDir, 'openapi.json')));

// ── REST API under /api ──
app.use('/api', apiRouter);

// ── Downloads (binary files) ──
app.use('/downloads', express.static(join(__dirname, '..', 'downloads')));

// ── MCP endpoints (root level — clients connect directly) ──
app.post('/mcp/pool', handlePoolMcpRequest);
app.get('/mcp/pool', handlePoolMcpRequest);
app.delete('/mcp/pool', handlePoolMcpRequest);
app.post('/mcp/:browserId', handleMcpRequest);
app.get('/mcp/:browserId', handleMcpRequest);
app.delete('/mcp/:browserId', handleMcpRequest);

// ── Static UI (Next.js export) ──
const uiDir = join(__dirname, '..', 'ui-static');
app.use(express.static(uiDir, { extensions: ['html'] }));
// SPA fallback — serve index.html for any unmatched route
app.get('*', (req, res, next) => {
  // Don't intercept API, MCP, WS, or file requests
  if (req.path.startsWith('/api') || req.path.startsWith('/mcp') ||
      req.path.startsWith('/ws') || req.path.startsWith('/downloads') ||
      req.path.startsWith('/.well-known') || req.path.includes('.')) {
    return next();
  }
  res.sendFile(join(uiDir, '404.html'), (err) => {
    if (err) res.sendFile(join(uiDir, 'index.html'), () => {});
  });
});

const server = createServer(app);

// Disable HTTP server timeout so long-running commands aren't killed
server.timeout = 0;
server.requestTimeout = 0;

// ── WebSocket at /ws ──
const wss = new WebSocketServer({
  server,
  path: '/ws',
  perMessageDeflate: false,
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const apiKey = url.searchParams.get('key');

  if (apiKey && !validateApiKey(apiKey)) {
    ws.close(4003, 'Invalid API key');
    return;
  }

  handleConnection(ws);
});

// Log browser events
registry.on('browser:connected', ({ id, name }) => {
  console.log(`[oya] Browser connected: ${name} (${id})`);
});

registry.on('browser:disconnected', ({ id, name }) => {
  console.log(`[oya] Browser disconnected: ${name} (${id})`);
});

server.listen(PORT, () => {
  console.log(`[oya] Oya Browser server listening on port ${PORT}`);
  console.log(`[oya] UI:           http://localhost:${PORT}/`);
  console.log(`[oya] API:          http://localhost:${PORT}/api/`);
  console.log(`[oya] WebSocket:    ws://localhost:${PORT}/ws`);
  console.log(`[oya] MCP endpoint: http://localhost:${PORT}/mcp/:browserId`);
  console.log(`[oya] MCP pool:     http://localhost:${PORT}/mcp/pool`);
});
