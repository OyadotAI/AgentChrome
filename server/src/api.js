/**
 * REST API routes.
 */

import { Router } from 'express';
import { authMiddleware, registerApiKey, isAdminKey, provisionKeys } from './auth.js';
import { registry } from './connection-registry.js';
import { sendCommand } from './ws-handler.js';
import { runChat } from './chat-service.js';
import { runtimeConfig } from './runtime-config.js';
import { nextBrowser, poolStats } from './pool.js';
import { getAll as getAllCookies, clear as clearCookies } from './cookie-store.js';

export const router = Router();

/** Extract API key from Authorization header */
function getKey(req) {
  return req.headers.authorization?.slice(7) || '';
}

/** Check if caller owns this browser (or is admin) */
function canAccess(req, browserId) {
  const key = getKey(req);
  if (isAdminKey(key)) return true;
  return registry.belongsTo(browserId, key);
}

// Health check (no auth required)
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    browsers: registry.list().length,
    uptime: process.uptime(),
  });
});

// Register a new API key (public — anyone can create a key)
router.post('/register-key', (req, res) => {
  const { key } = req.body;
  if (!key || typeof key !== 'string' || key.length < 32) {
    return res.status(400).json({ error: 'Key must be at least 32 characters' });
  }
  registerApiKey(key);
  res.json({ ok: true });
});

// Batch-provision API keys (admin only)
router.post('/fleet/provision', authMiddleware, (req, res) => {
  const key = getKey(req);
  if (!isAdminKey(key)) {
    return res.status(403).json({ error: 'Admin key required' });
  }
  const count = Math.min(Math.max(parseInt(req.query.count || req.body?.count) || 1, 1), 10000);
  const keys = provisionKeys(count);
  res.json({ ok: true, count: keys.length, keys });
});

// Runtime config — get/set server configuration from the dashboard
router.get('/config', authMiddleware, (req, res) => {
  res.json(runtimeConfig.get());
});

router.post('/config', authMiddleware, (req, res) => {
  runtimeConfig.set(req.body);
  res.json({ ok: true });
});

// List connected browsers — scoped to caller's API key (admin sees all)
router.get('/browsers', authMiddleware, (req, res) => {
  const key = getKey(req);
  res.json(registry.list(isAdminKey(key) ? null : key));
});

// Live view — SSE stream of JPEG frames
// Supports both header auth and ?key= query param (EventSource can't set headers)
router.get('/live/:browserId', (req, res, next) => {
  const queryKey = req.query.key;
  if (queryKey) {
    req.headers.authorization = `Bearer ${queryKey}`;
  }
  authMiddleware(req, res, next);
}, (req, res) => {
  const { browserId } = req.params;

  if (!registry.isConnected(browserId) || !canAccess(req, browserId)) {
    return res.status(404).json({ error: `Browser ${browserId} not connected` });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Send latest frame immediately if available
  const browser = registry.get(browserId);
  if (browser?.lastFrame) {
    res.write(`data: ${browser.lastFrame}\n\n`);
  }

  registry.addViewer(browserId, res);

  req.on('close', () => {
    registry.removeViewer(browserId, res);
  });
});

// Send command to a browser
router.post('/browsers/:browserId/command', authMiddleware, async (req, res) => {
  // Navigate can take up to 90s — disable socket timeout for this request
  req.setTimeout(0);
  res.setTimeout(0);

  const { browserId } = req.params;
  const { action, params } = req.body;

  if (!action) {
    return res.status(400).json({ error: 'Missing action' });
  }

  if (!registry.isConnected(browserId) || !canAccess(req, browserId)) {
    return res.status(404).json({ error: `Browser ${browserId} not connected` });
  }

  try {
    const result = await sendCommand(browserId, action, params || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Chat — LLM + MCP tools for natural-language browser control
router.post('/browsers/:browserId/chat', authMiddleware, async (req, res) => {
  req.setTimeout(0);
  res.setTimeout(0);

  const { browserId } = req.params;
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  if (!registry.isConnected(browserId) || !canAccess(req, browserId)) {
    return res.status(404).json({ error: `Browser ${browserId} not connected` });
  }

  const toolCalls = [];
  try {
    const result = await runChat(browserId, messages, {
      onToolCall: ({ name, args }) => toolCalls.push({ name, args }),
      onText: () => {},
    });
    res.json({ text: result.text, toolCalls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Pool Endpoints ─────────────────────────────────────────────────────────

// Pool status — how many browsers, who's connected
router.get('/pool', authMiddleware, (req, res) => {
  const key = getKey(req);
  res.json(poolStats(key));
});

// Pool command — send a command to the next browser via round-robin
router.post('/pool/command', authMiddleware, async (req, res) => {
  req.setTimeout(0);
  res.setTimeout(0);

  const key = getKey(req);
  const { action, params } = req.body;

  if (!action) {
    return res.status(400).json({ error: 'Missing action' });
  }

  const browserId = nextBrowser(key);
  if (!browserId) {
    return res.status(503).json({ error: 'No browsers available in pool' });
  }

  try {
    const result = await sendCommand(browserId, action, params || {});
    res.json({ ...result, _browser: browserId });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, _browser: browserId });
  }
});

// Pool cookies — view the shared cookie jar
router.get('/pool/cookies', authMiddleware, (req, res) => {
  res.json({ cookies: getAllCookies() });
});

// Pool cookies — clear the shared jar
router.delete('/pool/cookies', authMiddleware, (req, res) => {
  clearCookies();
  res.json({ ok: true });
});
