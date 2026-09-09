/**
 * Oya Browser server — HTTP + WebSocket + MCP API.
 * API routes are served under /api, static UI at /.
 */

import 'dotenv/config';

// Prevent crashes from unhandled errors
process.on('uncaughtException', (err) => {
  console.error('[oya] Uncaught exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[oya] Unhandled rejection:', reason?.message || reason);
});

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cors from 'cors';
import { router as apiRouter } from './api.js';
import { drain as drainAudit } from './audit.js';
import {
  handleJsonVersion, handleJsonList, handleUpgrade as handleGatewayUpgrade, sessions as gatewaySessions,
} from './gateway.js';
import * as usage from './usage.js';
import * as personas from './personas.js';
import { handleConnection } from './ws-handler.js';
import { handleMcpRequest, handlePoolMcpRequest } from './mcp-server.js';
import { validateApiKey } from './auth.js';
import { registry } from './connection-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3100', 10);

const app = express();
app.use(express.json());
app.use(cors());

// ── Legacy domain redirect: *.oya.ai → *.getoya.ai ──
// The old hosts still resolve and terminate TLS at the ingress; anything
// human-facing gets pushed to the canonical domain. /ws, /mcp, /api and
// /downloads pass through untouched so already-installed browsers and MCP
// clients configured against the old host keep working.
const LEGACY_HOST = /^([a-z0-9-]+)\.oya\.ai$/i;
const REDIRECT_EXEMPT = ['/ws', '/mcp', '/api', '/downloads'];

app.use((req, res, next) => {
  const host = (req.headers.host || '').split(':')[0];
  const legacy = LEGACY_HOST.exec(host);
  if (!legacy) return next();
  if (REDIRECT_EXEMPT.some((p) => req.path === p || req.path.startsWith(p + '/'))) return next();
  // 308 rather than 301 — preserves method and body for non-GET requests
  res.redirect(308, `https://${legacy[1]}.getoya.ai${req.originalUrl}`);
});

const publicDir = join(__dirname, 'public');

// ── Discovery & docs (root level) ──
app.use('/.well-known', express.static(join(publicDir, '.well-known')));
app.get('/llms.txt', (req, res) => res.type('text/plain').sendFile(join(publicDir, 'llms.txt')));
app.get('/docs.txt', (req, res) => res.type('text/plain').sendFile(join(publicDir, 'llms.txt')));
app.get('/openapi.json', (req, res) => res.type('application/json').sendFile(join(publicDir, 'openapi.json')));

// ── REST API under /api ──
// CDP discovery. Playwright, Puppeteer, Stagehand and browser-use fetch these
// before connecting, which is what lets them treat the gateway as a browser.
app.get('/json/version', handleJsonVersion);
app.get('/json/list', handleJsonList);

app.use('/api', apiRouter);
// Prometheus convention is /metrics at the root; the same handler also serves
// /api/metrics for callers that prefix everything.
app.use('/', apiRouter);

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
    if (!err) return;
    res.sendFile(join(uiDir, 'index.html'), (fallbackErr) => {
      // Both are missing — usually the UI has not been built into ui-static.
      // Swallowing this left the request hanging forever, because the server's
      // own timeouts are disabled for long-running commands.
      if (!fallbackErr || res.headersSent) return;
      res.status(404).type('text/plain').send(
        'UI not built. Run `npm run build` in ui/ and copy ui/out to server/ui-static.\n');
    });
  });
});

const server = createServer(app);

// Disable HTTP server timeout so long-running commands aren't killed
server.timeout = 0;
server.requestTimeout = 0;

// ── WebSocket at /ws ──
const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
});

// One upgrade router: /ws is the Oya client protocol, /connect is raw CDP.
server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  if (pathname === '/ws') {
    return wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }
  if (pathname === '/connect') {
    return handleGatewayUpgrade(req, socket, head).catch((e) => {
      console.error('[gateway] upgrade failed:', e.message);
      try { socket.destroy(); } catch {}
    });
  }
  console.warn(`[ws] ✗ upgrade to unknown path ${pathname} — use /ws (Oya client) or /connect (CDP)`);
  socket.destroy();
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const apiKey = url.searchParams.get('key');

  if (apiKey && !validateApiKey(apiKey)) {
    ws.close(4003, 'Invalid API key');
    return;
  }

  handleConnection(ws, req);
});

// Log browser events
registry.on('browser:connected', ({ id, name }) => {
  console.log(`[oya] Browser connected: ${name} (${id})`);
});

registry.on('browser:disconnected', ({ id, name }) => {
  console.log(`[oya] Browser disconnected: ${name} (${id})`);
});

// Continue this hour's usage buckets across a restart, so a quota cannot be
// reset by bouncing the process.
usage.restore().catch(() => {});
personas.restore().catch(() => {});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    registry.draining = true;
    // End gateway sessions cleanly so profiles are captured and recordings
    // get their manifest, rather than being cut off mid-write.
    await Promise.allSettled([...gatewaySessions.values()].map((s) => s.destroy('server shutting down')));
    await Promise.allSettled([drainAudit(), usage.drain(), personas.drain()]);
    process.exit(0);
  });
}

server.listen(PORT, () => {
  console.log(`[oya] Oya Browser server listening on port ${PORT}`);
  console.log(`[oya] UI:           http://localhost:${PORT}/`);
  console.log(`[oya] API:          http://localhost:${PORT}/api/`);
  console.log(`[oya] WebSocket:    ws://localhost:${PORT}/ws`);
  console.log(`[oya] MCP endpoint: http://localhost:${PORT}/mcp/:browserId`);
  console.log(`[oya] MCP pool:     http://localhost:${PORT}/mcp/pool`);
  console.log(`[oya] CDP gateway:  ws://localhost:${PORT}/connect  (discovery: /json/version)`);
});
