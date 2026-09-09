/**
 * REST API routes.
 */

import { Router } from 'express';
import { randomBytes } from 'crypto';
import {
  authMiddleware, userAuthMiddleware,
  registerApiKey, listApiKeys, deleteApiKey,
  isAdminKey, provisionKeys, getKeyOwner,
  signup, login, getProfile,
} from './auth.js';
import { registry } from './connection-registry.js';
import { sendCommand } from './ws-handler.js';
import { runChat } from './chat-service.js';
import { runtimeConfig, userConfig } from './runtime-config.js';
import { nextBrowser, poolStats } from './pool.js';
import { getAll as getAllCookies, getAllByKey as getAllCookiesByKey, clear as clearCookies, clearAll as clearAllCookies } from './cookie-store.js';

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

// ─── User Auth ────────────────────────────────────────────────────────────────

router.post('/auth/signup', async (req, res) => {
  const { email, password, display_name } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    const result = await signup(email, password, display_name);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }
  try {
    const result = await login(email, password);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

router.post('/auth/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    return res.status(400).json({ error: 'refresh_token required' });
  }
  try {
    const { refreshSession } = await import('./auth.js');
    const result = await refreshSession(refresh_token);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

router.get('/auth/me', userAuthMiddleware, async (req, res) => {
  try {
    const profile = await getProfile(req.user.id);
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── API Key Management (authenticated users) ────────────────────────────────

router.get('/auth/keys', userAuthMiddleware, async (req, res) => {
  try {
    const keys = await listApiKeys(req.user.id);
    res.json(keys);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/auth/keys', userAuthMiddleware, async (req, res) => {
  const { label } = req.body;
  try {
    const key = randomBytes(24).toString('base64url');
    await registerApiKey(key, req.user.id, label);
    res.json({ key, label: label || 'Default' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/auth/keys/import', userAuthMiddleware, async (req, res) => {
  const { key, label } = req.body;
  if (!key || typeof key !== 'string' || key.length < 1) {
    return res.status(400).json({ error: 'key is required' });
  }
  try {
    await registerApiKey(key, req.user.id, label || 'Imported');
    res.json({ ok: true, key, label: label || 'Imported' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/auth/keys/:key', userAuthMiddleware, async (req, res) => {
  try {
    await deleteApiKey(req.params.key, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Batch-provision API keys (admin only)
router.post('/fleet/provision', authMiddleware, async (req, res) => {
  const key = getKey(req);
  if (!isAdminKey(key)) {
    return res.status(403).json({ error: 'Admin key required' });
  }
  const count = Math.min(Math.max(parseInt(req.query.count || req.body?.count) || 1, 1), 10000);
  const keys = await provisionKeys(count);
  res.json({ ok: true, count: keys.length, keys });
});

// Runtime config — server-wide settings (OpenAI key, model, base URL).
// Admin only: anyone who can write this can hijack every tenant's chat requests.
// A key that belongs to an account reads and writes that account's own
// settings. Keys with no account (env API_KEYS, fleet token) act on the
// server-wide defaults, which stays admin-only — writing those affects
// every tenant that has not set their own.
router.get('/config', authMiddleware, async (req, res) => {
  const key = getKey(req);
  try {
    const userId = await getKeyOwner(key);
    if (userId) return res.json(await userConfig.get(userId));
    if (!isAdminKey(key)) {
      return res.status(403).json({ error: 'Admin key required' });
    }
    res.json(runtimeConfig.get());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/config', authMiddleware, async (req, res) => {
  const key = getKey(req);
  try {
    const userId = await getKeyOwner(key);
    if (userId) {
      await userConfig.set(userId, req.body);
      return res.json({ ok: true, scope: 'account' });
    }
    if (!isAdminKey(key)) {
      return res.status(403).json({ error: 'Admin key required' });
    }
    runtimeConfig.set(req.body);
    res.json({ ok: true, scope: 'server' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
    try { res.write(`data: ${browser.lastFrame}\n\n`); } catch {}
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
      apiKey: getKey(req),
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

// Pool cookies — view the shared cookie jar for the caller's API key.
// Admin also gets a per-key breakdown.
router.get('/pool/cookies', authMiddleware, (req, res) => {
  const key = getKey(req);
  if (isAdminKey(key)) {
    const byKey = getAllCookiesByKey();
    const flat = [];
    for (const arr of Object.values(byKey)) flat.push(...arr);
    res.json({ cookies: flat, cookies_by_key: byKey });
    return;
  }
  res.json({ cookies: getAllCookies(key) });
});

// Pool cookies — clear the caller's API-key jar only. Admin clears every jar.
router.delete('/pool/cookies', authMiddleware, (req, res) => {
  const key = getKey(req);
  if (isAdminKey(key)) {
    clearAllCookies();
  } else {
    clearCookies(key);
  }
  res.json({ ok: true });
});
