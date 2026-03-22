/**
 * Oya Browser server — HTTP + WebSocket + MCP API.
 * UI is served separately from the `ui/` Next.js app.
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

// .well-known discovery files
const publicDir = join(__dirname, 'public');
app.use('/.well-known', express.static(join(publicDir, '.well-known')));

// Public binary downloads (served outside of git)
app.use('/downloads', express.static(join(__dirname, '..', 'downloads')));

// LLM-readable docs (plain text)
app.get('/llms.txt', (req, res) => {
  res.type('text/plain').sendFile(join(publicDir, 'llms.txt'));
});
app.get('/docs.txt', (req, res) => {
  res.type('text/plain').sendFile(join(publicDir, 'llms.txt'));
});

// OpenAPI schema
app.get('/openapi.json', (req, res) => {
  res.type('application/json').sendFile(join(publicDir, 'openapi.json'));
});

// REST API
app.use(apiRouter);

// MCP endpoints — pool (round-robin across all browsers for this key)
app.post('/mcp/pool', handlePoolMcpRequest);
app.get('/mcp/pool', handlePoolMcpRequest);
app.delete('/mcp/pool', handlePoolMcpRequest);

// MCP endpoints (per browser)
app.post('/mcp/:browserId', handleMcpRequest);
app.get('/mcp/:browserId', handleMcpRequest);
app.delete('/mcp/:browserId', handleMcpRequest);

const server = createServer(app);

// Disable HTTP server timeout so long-running commands (navigate=90s) aren't killed
server.timeout = 0;
server.requestTimeout = 0;

// WebSocket server at /ws
const wss = new WebSocketServer({
  server,
  path: '/ws',
  perMessageDeflate: false,
});

wss.on('connection', (ws, req) => {
  // Extract API key from query string for initial validation
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
  console.log(`[oya] WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`[oya] MCP endpoint: http://localhost:${PORT}/mcp/:browserId`);
  console.log(`[oya] MCP pool:     http://localhost:${PORT}/mcp/pool`);
  console.log(`[oya] Browsers API: http://localhost:${PORT}/browsers`);
});
