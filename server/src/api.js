/**
 * REST API routes.
 */

import { Router } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';
import {
  authMiddleware, userAuthMiddleware,
  registerApiKey, listApiKeys, deleteApiKey,
  provisionKeys, getKeyOwner,
  signup, login, getProfile,
} from './auth.js';
import { registry } from './connection-registry.js';
import { sendCommand } from './ws-handler.js';
import { runChat } from './chat-service.js';
import { runtimeConfig, userConfig } from './runtime-config.js';
import { nextBrowser, poolStats } from './pool.js';
import { getAll as getAllCookies, clear as clearCookies } from './cookie-store.js';
import { isConfigured as sandboxConfigured, createSandbox, removeSandbox } from './sandbox.js';
import { metrics, render as renderMetrics, snapshot as metricsSnapshot } from './metrics.js';
import { audit, history as auditHistory, fingerprint } from './audit.js';
import * as usage from './usage.js';
import { enforce, consume, checkQuota, checkHourly, status as limitStatus, LIMITS, QUOTAS } from './limits.js';
import { acquire as acquireBrowser, available as availableProviders } from './providers.js';
import { CDPDriver } from './drivers/cdp.js';
import { assertSafeTarget } from './net-guard.js';
import { v4 as uuidv4 } from 'uuid';
import { listSessions, killSession, sessions as gatewaySessions } from './gateway.js';
import { pool, STRATEGIES } from './routing.js';
import * as profiles from './profiles.js';
import * as recorder from './recorder.js';
import * as personas from './personas.js';

export const router = Router();

/**
 * HTTP metrics. Labelled by the route pattern, never the concrete path — at
 * this fleet size /browsers/:id/command must not become one series per browser.
 */
router.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    const route = (req.route?.path || req.path)
      .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id')
      .replace(/\/[A-Za-z0-9_-]{24,}/g, '/:token');
    metrics.httpRequests.inc({ route, status: `${Math.floor(res.statusCode / 100)}xx` });
    metrics.httpDuration.observe({ route }, Date.now() - started);
  });
  next();
});

// One pair of listeners for the whole process. Registering per browser would
// leak a listener each time and trip EventEmitter's max at 11 CDP browsers.
registry.on('stream:start', ({ id }) => {
  const browser = registry.get(id);
  if (!browser?.driver?.startScreencast) return;   // Oya clients push frames themselves
  browser.driver.startScreencast((dataUrl) => {
    registry.pushFrame(id, dataUrl);
    metrics.frames.inc({ client: 'cdp' });
  }).catch(() => {});
});
registry.on('stream:stop', ({ id }) => {
  registry.get(id)?.driver?.stopScreencast?.().catch(() => {});
});

/** Everything is scoped to the calling key. There is no tier above it. */
const ownerScope = (req) => fingerprint(getKey(req));

/**
 * Process-level controls (Prometheus scrape, drain) are host operations, not
 * tenant data, so they are gated on an explicitly-named operator token rather
 * than on any API key. An API key never confers power over the host, and no
 * env var silently turns a key into a superuser.
 */
function operatorOnly(req, res, next) {
  const token = process.env.OYA_OPERATOR_TOKEN || process.env.OYA_METRICS_TOKEN;
  // Header only: a token in the query string lands in access logs, proxy logs
  // and browser history. Prometheus sends an Authorization header natively.
  const supplied = getKey(req);
  if (token && supplied) {
    const a = Buffer.from(supplied);
    const b = Buffer.from(token);
    if (a.length === b.length && timingSafeEqual(a, b)) return next();
  }
  return res.status(403).json({
    error: 'Host controls need OYA_OPERATOR_TOKEN in the Authorization header',
  });
}

/** Extract API key from Authorization header */
function getKey(req) {
  return req.headers.authorization?.slice(7) || '';
}

/** A browser belongs to the key that connected it. Nothing else can reach it. */
function canAccess(req, browserId) {
  return registry.belongsTo(browserId, getKey(req));
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

// Batch-provision API keys. Minting credentials is a host capability — a
// tenant key must not be able to mint more identities. Accounts still create
// their own keys through /auth/keys.
router.post('/fleet/provision', operatorOnly, async (req, res) => {
  const key = getKey(req);
  const count = Math.min(Math.max(parseInt(req.query.count || req.body?.count) || 1, 1), 10000);
  const keys = await provisionKeys(count);
  audit({ action: 'key.provision', actorKey: key, targetType: 'key', meta: { count: keys.length }, req });
  res.json({ ok: true, count: keys.length, keys });
});

// ─── Observability ───────────────────────────────────────────────────────────

/**
 * Prometheus scrape target. Accepts an admin key or a dedicated
 * OYA_METRICS_TOKEN, so a scraper does not need admin credentials.
 */
router.get('/metrics', operatorOnly, (req, res) => {
  metrics.browsersConnected.set({}, registry.browsers.size);
  res.type('text/plain; version=0.0.4').send(renderMetrics());
});

/**
 * Everything this key owns, in one call: its browsers, sessions, providers,
 * usage and allowance. This is the dashboard's fleet view. There is no admin
 * variant, because the key is the whole identity.
 */
router.get('/fleet', authMiddleware, (req, res) => {
  const key = getKey(req);
  const owner = fingerprint(key);
  const mine = [...registry.browsers.values()].filter((b) => b.apiKey === key);
  const byClient = {};
  const byProvider = {};
  for (const b of mine) {
    byClient[b.clientType || 'oya'] = (byClient[b.clientType || 'oya'] || 0) + 1;
    if (b.provider) byProvider[b.provider] = (byProvider[b.provider] || 0) + 1;
  }
  const sessions = listSessions(key);
  res.json({
    at: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    browsers: { total: mine.length, byClient, byProvider },
    sessions: {
      total: sessions.length,
      attached: sessions.filter((s) => s.connected).length,
      recording: sessions.filter((s) => s.recording).length,
    },
    routing: pool.stats(owner),
    usage: usage.current(key),
    ...limitStatus(key),
  });
});

/** The caller's own usage and remaining allowance — no admin key needed. */
router.get('/usage', authMiddleware, async (req, res) => {
  const key = getKey(req);
  const mine = [...registry.browsers.values()].filter((b) => b.apiKey === key).length;
  res.json({
    current: usage.current(key),
    browsers: { connected: mine, quota: QUOTAS.browsers },
    ...limitStatus(key),
    history: (await usage.history(key, { hours: Number(req.query.hours) || 24 })).rows,
  });
});

/** Audit trail. Admin only: it spans every tenant by construction. */
/** This key's own audit trail. */
router.get('/audit', authMiddleware, async (req, res) => {
  const result = await auditHistory({
    limit: Math.min(Number(req.query.limit) || 100, 1000),
    action: req.query.action,
    actor: fingerprint(getKey(req)),   // never another key's history
    since: req.query.since,
  });
  res.json(result);
});

// ─── Control ─────────────────────────────────────────────────────────────────

/** Force a browser off the fleet — a stuck client, a runaway, an abusive key. */
router.post('/browsers/:browserId/disconnect', authMiddleware, (req, res) => {
  const { browserId } = req.params;
  const browser = registry.get(browserId);
  if (!browser || !canAccess(req, browserId)) return res.status(404).json({ error: 'Browser not connected' });
  try { browser.ws?.close(4008, 'Disconnected by operator'); } catch {}
  registry.remove(browserId);
  audit({ action: 'browser.disconnect', actorKey: getKey(req), targetType: 'browser', targetId: browserId,
    meta: { clientType: browser.clientType, reason: req.body?.reason || null }, req });
  metrics.browsersConnected.set({}, registry.browsers.size);
  res.json({ ok: true, disconnected: browserId });
});

/** Drop every browser belonging to one key, without waiting for key deletion. */
/** Drop every browser on the calling key. */
router.post('/browsers/disconnect-all', authMiddleware, (req, res) => {
  const target = getKey(req);
  const ids = [...registry.browsers.entries()].filter(([, b]) => b.apiKey === target).map(([id]) => id);
  for (const id of ids) {
    try { registry.get(id)?.ws?.close(4008, 'Key disconnected by operator'); } catch {}
    registry.remove(id);
  }
  audit({ action: 'key.disconnect', actorKey: getKey(req), targetType: 'key', targetId: fingerprint(target),
    meta: { browsers: ids.length }, req });
  metrics.browsersConnected.set({}, registry.browsers.size);
  res.json({ ok: true, disconnected: ids.length });
});

/**
 * Drain: stop accepting new browsers so this instance can be restarted without
 * dropping in-flight work. Read by the WebSocket handler.
 */
router.post('/operator/drain', operatorOnly, (req, res) => {
  const draining = req.body?.draining !== false;
  registry.draining = draining;
  audit({ action: draining ? 'fleet.drain' : 'fleet.undrain', actorKey: getKey(req), targetType: 'fleet', req });
  res.json({ ok: true, draining, connected: registry.browsers.size });
});

// ─── Browser providers (CDP) ─────────────────────────────────────────────────

router.get('/providers', authMiddleware, (req, res) => {
  res.json({ providers: availableProviders(), daytona: sandboxConfigured() });
});

/**
 * Attach a CDP browser: one we dial out to, rather than one that dials in.
 * Anchor, Browserbase, Steel, or any Chrome with --remote-debugging-port.
 */
router.post('/browsers/connect', authMiddleware, enforce('connect'), async (req, res) => {
  const key = getKey(req);
  const mine = [...registry.browsers.values()].filter((b) => b.apiKey === key).length;
  const quota = checkQuota('browsers', key, mine);
  if (!quota.allowed) {
    audit({ action: 'browser.connect', actorKey: key, targetType: 'browser', outcome: 'denied',
      meta: { reason: 'quota', quota: quota.quota }, req });
    return res.status(429).json({ error: `Browser quota reached (${quota.quota})`, ...quota });
  }

  const provider = String(req.body?.provider || 'cdp');
  let session;
  try {
    if (provider === 'cdp' && req.body?.wsUrl) await assertSafeTarget(req.body.wsUrl, { label: 'wsUrl' });
    session = await acquireBrowser({ provider, wsUrl: req.body?.wsUrl });
  } catch (err) {
    audit({ action: 'browser.connect', actorKey: key, targetType: 'browser', outcome: 'error',
      meta: { provider, error: err.message }, req });
    return res.status(err.status || 502).json({ error: err.message });
  }

  const browserId = uuidv4();
  try {
    const driver = await new CDPDriver({
      wsUrl: session.wsUrl,
      provider: session.provider,
      onClose: () => { if (registry.get(browserId)) registry.remove(browserId); },
    }).connect();

    registry.add(browserId, {
      apiKey: key,
      name: (req.body?.name || `${session.provider} browser`).slice(0, 100),
      driver,
      clientType: 'cdp',
      provider: session.provider,
      release: session.release,
    });

    usage.browserConnected(key, browserId);
    metrics.wsConnections.inc({ outcome: 'ok' });
    metrics.browsersConnected.set({}, registry.browsers.size);
    audit({ action: 'browser.connect', actorKey: key, targetType: 'browser', targetId: browserId,
      meta: { provider: session.provider, sessionId: session.sessionId }, req });

    res.status(201).json({ id: browserId, provider: session.provider, clientType: 'cdp' });
  } catch (err) {
    await session.release().catch(() => {});
    audit({ action: 'browser.connect', actorKey: key, targetType: 'browser', outcome: 'error',
      meta: { provider, error: err.message }, req });
    res.status(502).json({ error: `Could not attach to the CDP browser: ${err.message}` });
  }
});

/** Detach a CDP browser and release the vendor session. */
router.delete('/browsers/:browserId/connection', authMiddleware, (req, res) => {
  const { browserId } = req.params;
  const browser = registry.get(browserId);
  if (!browser || !canAccess(req, browserId)) return res.status(404).json({ error: 'Browser not found' });
  usage.browserDisconnected(browser.apiKey, browserId);
  registry.remove(browserId);   // closes the driver and releases the session
  metrics.browsersConnected.set({}, registry.browsers.size);
  audit({ action: 'browser.disconnect', actorKey: getKey(req), targetType: 'browser', targetId: browserId,
    meta: { clientType: browser.clientType, provider: browser.provider }, req });
  res.json({ ok: true });
});

// ─── Personas ────────────────────────────────────────────────────────────────
//
// A persona is one identity — fingerprint, cookie jar and proxy bound together
// and stable. Rotation means choosing a different persona, never giving one a
// new fingerprint.

router.get('/personas', authMiddleware, (req, res) => {
  res.json({ personas: personas.list(getKey(req)).map(personas.describe) });
});

router.post('/personas', authMiddleware, (req, res) => {
  const created = personas.create(getKey(req), {
    name: req.body?.name,
    proxy: req.body?.proxy,
    maxConcurrent: req.body?.maxConcurrent,
  });
  audit({ action: 'persona.create', actorKey: getKey(req), targetType: 'persona', targetId: created.id,
    meta: { name: created.name }, req });
  res.status(201).json(personas.describe(created));
});

router.get('/personas/:id', authMiddleware, (req, res) => {
  const p = personas.get(getKey(req), req.params.id);
  if (!p) return res.status(404).json({ error: 'No such persona' });
  res.json(personas.describe(p));
});

router.delete('/personas/:id', authMiddleware, (req, res) => {
  try {
    const removed = personas.remove(getKey(req), req.params.id);
    if (!removed) return res.status(404).json({ error: 'No such persona' });
    audit({ action: 'persona.delete', actorKey: getKey(req), targetType: 'persona', targetId: req.params.id, req });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── CDP gateway: sessions, providers, profiles, recordings ──────────────────

router.get('/gateway/sessions', authMiddleware, (req, res) => {
  const key = getKey(req);
  res.json({ sessions: listSessions(key) });
});

router.delete('/gateway/sessions/:id', authMiddleware, async (req, res) => {
  const session = gatewaySessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'No such session' });
  if (session.apiKey !== getKey(req)) {
    return res.status(404).json({ error: 'No such session' });
  }
  await killSession(req.params.id, req.body?.reason || 'closed by operator');
  audit({ action: 'gateway.session.kill', actorKey: getKey(req), targetType: 'session', targetId: req.params.id, req });
  res.json({ ok: true });
});

/** Provider pool: health, capacity, latency and the queue. */
router.get('/gateway/providers', authMiddleware, (req, res) =>
  res.json(pool.stats(fingerprint(getKey(req)))));

router.post('/gateway/providers', authMiddleware, async (req, res) => {
  try {
    const cfg = { ...(req.body || {}), owner: fingerprint(getKey(req)) };
    // The host dials this URL, using its network position rather than the
    // caller's. Unvalidated, that is a server-side request forgery primitive.
    if (cfg.wsUrl) {
      const safe = await assertSafeTarget(cfg.wsUrl, { label: 'wsUrl' });
      cfg.wsUrl = safe.href;
    }
    const provider = pool.register(cfg);
    audit({ action: 'provider.upsert', actorKey: getKey(req), targetType: 'provider', targetId: provider.name,
      meta: { type: provider.type, maxConcurrent: provider.maxConcurrent, priority: provider.priority }, req });
    res.json(provider.toJSON());
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

router.delete('/gateway/providers/:name', authMiddleware, (req, res) => {
  // Only your own; shared host providers are not yours to remove.
  const removed = pool.remove(fingerprint(getKey(req)), req.params.name);
  if (removed) audit({ action: 'provider.remove', actorKey: getKey(req), targetType: 'provider', targetId: req.params.name, req });
  res.json({ ok: removed });
});

router.post('/gateway/strategy', authMiddleware, (req, res) => {
  const strategy = String(req.body?.strategy || '');
  if (!STRATEGIES.includes(strategy)) {
    return res.status(400).json({ error: `strategy must be one of ${STRATEGIES.join(', ')}` });
  }
  // Per key: how you want your sessions routed is not a host-wide switch.
  const owner = fingerprint(getKey(req));
  const previous = pool.strategyFor(owner);
  pool.setStrategy(owner, strategy);
  audit({ action: 'routing.strategy', actorKey: getKey(req), targetType: 'routing',
    meta: { from: previous, to: strategy }, req });
  res.json({ ok: true, strategy });
});

// Profiles and recordings are per-key. Names and session ids are caller-chosen
// or guessable, so they are scoped by owner rather than treated as secrets.
router.get('/gateway/profiles', authMiddleware, async (req, res) =>
  res.json({ profiles: await profiles.list(fingerprint(getKey(req))) }));

router.delete('/gateway/profiles/:name', authMiddleware, async (req, res) => {
  try {
    const removed = await profiles.remove(fingerprint(getKey(req)), req.params.name);
    audit({ action: 'profile.delete', actorKey: getKey(req), targetType: 'profile', targetId: req.params.name,
      outcome: removed ? 'ok' : 'error', req });
    res.json({ ok: removed });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/gateway/recordings', authMiddleware, async (req, res) =>
  res.json({ recordings: await recorder.list(fingerprint(getKey(req))) }));

router.get('/gateway/recordings/:id', authMiddleware, async (req, res) => {
  const found = await recorder.manifest(req.params.id, ownerScope(req));
  if (!found) return res.status(404).json({ error: 'No such recording' });
  res.json(found);
});

/** One frame of a recording, for the dashboard player to scrub through. */
router.get('/gateway/recordings/:id/frames/:index', authMiddleware, async (req, res) => {
  const buf = await recorder.frame(req.params.id, req.params.index, ownerScope(req));
  if (!buf) return res.status(404).json({ error: 'No such frame' });
  res.type('image/jpeg').set('Cache-Control', 'private, max-age=3600').send(buf);
});

router.delete('/gateway/recordings/:id', authMiddleware, async (req, res) => {
  const removed = await recorder.remove(req.params.id, ownerScope(req));
  audit({ action: 'recording.delete', actorKey: getKey(req), targetType: 'recording', targetId: req.params.id, req });
  res.json({ ok: removed });
});

// ─── Cloud browser provisioning (Daytona) ───
//
// Launches sandboxed browsers that enroll over the normal WebSocket with the
// caller's own key, so they join that caller's pool as ordinary browsers.

router.post('/browsers/provision', authMiddleware, enforce('provision'), async (req, res) => {
  const hourly = checkHourly('sandboxesPerHour', getKey(req));
  if (!hourly.allowed) {
    audit({ action: 'browser.provision', actorKey: getKey(req), outcome: 'denied',
      meta: { reason: 'hourly quota', quota: hourly.quota }, req });
    return res.status(429).json({ error: `Sandbox quota reached for this hour (${hourly.quota})`, ...hourly });
  }
  if (!sandboxConfigured()) {
    return res.status(409).json({
      error: 'Cloud browsers are not configured. Set DAYTONA_API_KEY, DAYTONA_SNAPSHOT and OYA_PUBLIC_WS_URL.',
    });
  }
  const key = getKey(req);
  const count = Math.min(Math.max(parseInt(req.body?.count) || 1, 1), 100);
  const name = typeof req.body?.name === 'string' ? req.body.name.slice(0, 100) : undefined;

  // Bounded concurrency: a fleet is built by repeating this call, and firing
  // every create at once would just rate-limit us at the provider.
  const IN_FLIGHT = 10;
  const results = [];
  const queue = Array.from({ length: count }, (_, i) => i);
  await Promise.all(Array.from({ length: Math.min(IN_FLIGHT, count) }, async () => {
    while (queue.length) {
      queue.shift();
      try { results.push({ status: 'fulfilled', value: await createSandbox({ apiKey: key, name }) }); }
      catch (reason) { results.push({ status: 'rejected', reason }); }
    }
  }));
  const created = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const failed = results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message || 'unknown error');

  if (failed.length) console.error(`[sandbox] ${failed.length}/${count} failed:`, failed.join('; '));
  usage.record(key, 'sandboxes_created', created.length);
  metrics.sandboxes.inc({ op: 'create', outcome: 'ok' }, created.length);
  if (failed.length) metrics.sandboxes.inc({ op: 'create', outcome: 'error' }, failed.length);
  audit({ action: 'browser.provision', actorKey: key, targetType: 'sandbox',
    outcome: created.length ? 'ok' : 'error',
    meta: { requested: count, created: created.length, failed: failed.length }, req });

  res.status(created.length ? 202 : 502).json({
    ok: created.length > 0,
    requested: count,
    browsers: created,
    failed,
    note: 'Browsers connect on their own; they appear in GET /browsers within ~90s.',
  });
});

router.delete('/browsers/:browserId/sandbox', authMiddleware, async (req, res) => {
  const { browserId } = req.params;
  try {
    // Ownership is enforced by the sandbox's owner label, which works whether or
    // not the browser is currently connected.
    const removed = await removeSandbox(browserId, getKey(req));
    metrics.sandboxes.inc({ op: 'delete', outcome: 'ok' });
    audit({ action: 'sandbox.delete', actorKey: getKey(req), targetType: 'sandbox', targetId: browserId,
      meta: { removed }, req });
    res.json({ ok: true, removed });
  } catch (err) {
    console.error('[sandbox] delete failed:', err.message);
    res.status(err.status || 502).json({ error: err.message });
  }
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
    // A key with no account reads the host defaults it would resolve against.
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
      audit({ action: 'config.update', actorKey: key, actorUser: userId, targetType: 'config',
        meta: { scope: 'account', fields: Object.keys(req.body || {}) }, req });
      return res.json({ ok: true, scope: 'account' });
    }
    // Writing the host default affects every key that has not set its own,
    // so it needs the operator token rather than any API key.
    const operator = process.env.OYA_OPERATOR_TOKEN || process.env.OYA_METRICS_TOKEN;
    if (!operator || key !== operator) {
      return res.status(403).json({
        error: 'This key has no account. Sign in to store settings for your account, '
          + 'or present OYA_OPERATOR_TOKEN to change the host default.',
      });
    }
    runtimeConfig.set(req.body);
    audit({ action: 'config.update', actorKey: key, targetType: 'config',
      meta: { scope: 'host', fields: Object.keys(req.body || {}) }, req });
    res.json({ ok: true, scope: 'host' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List connected browsers — scoped to caller's API key (admin sees all)
router.get('/browsers', authMiddleware, (req, res) => {
  const key = getKey(req);
  res.json(registry.list(key));
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
router.post('/browsers/:browserId/command', authMiddleware, enforce('command'), async (req, res) => {
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
    usage.record(getKey(req), 'commands');
    if (result?.ok === false) usage.record(getKey(req), 'command_errors');
    res.json(result);
  } catch (err) {
    usage.record(getKey(req), 'command_errors');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Chat — LLM + MCP tools for natural-language browser control
router.post('/browsers/:browserId/chat', authMiddleware, enforce('chat'), async (req, res) => {
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
// Cookies live with the persona, not the key — the jar and the fingerprint
// have to move together or a returning session looks like a new device.
router.get('/pool/cookies', authMiddleware, (req, res) => {
  try {
    const persona = personas.resolve(getKey(req), req.query.persona);
    res.json({ persona: persona.id, cookies: getAllCookies(persona.id) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Pool cookies — clear the caller's API-key jar only. Admin clears every jar.
router.delete('/pool/cookies', authMiddleware, (req, res) => {
  const key = getKey(req);
  let persona;
  try {
    persona = personas.resolve(key, req.query.persona);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
  clearCookies(persona.id);
  // Destroying sessions is exactly the action you want a record of afterwards.
  audit({ action: 'cookies.clear', actorKey: key, targetType: 'cookies', targetId: persona.id, req });
  res.json({ ok: true, persona: persona.id });
});
