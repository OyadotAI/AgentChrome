/**
 * Oya Browser server — HTTP + WebSocket entry point.
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { router as apiRouter } from './api.js';
import { handleConnection } from './ws-handler.js';
import { handleMcpRequest } from './mcp-server.js';
import { validateApiKey } from './auth.js';
import { registry } from './connection-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3100', 10);

const app = express();
app.use(express.json());

// Static files
app.use(express.static(join(__dirname, 'public')));

// Dashboard at /dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'dashboard.html'));
});

// REST API
app.use(apiRouter);

// MCP endpoints (per browser)
app.post('/mcp/:browserId', handleMcpRequest);
app.get('/mcp/:browserId', handleMcpRequest);
app.delete('/mcp/:browserId', handleMcpRequest);

const server = createServer(app);

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
  console.log(`[oya] Browsers API: http://localhost:${PORT}/browsers`);
});
