/**
 * CDP gateway.
 *
 * Serves Chrome's discovery endpoint and a WebSocket that speaks raw CDP, so
 * Playwright, Puppeteer, Stagehand, browser-use and any other CDP client
 * connect to this control plane as if it were a browser — no client changes,
 * no vendor SDK. The gateway picks a provider by the configured routing
 * strategy, fails over if one is down, and queues when everything is busy.
 *
 * The wire is forwarded verbatim. Features that need to observe it (recording,
 * profile capture) use a second, independent CDP connection to the same
 * browser rather than injecting frames into the client's session, so a
 * client's own use of Page.screencast or Network is never disturbed.
 *
 * ponytail: every message is forwarded through JS rather than piped at the
 * socket level. Measured cost is a JSON-free buffer copy per frame; if a
 * profile of a saturated gateway ever shows this dominating, add a raw
 * passthrough for sessions with no features enabled.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { validateApiKey } from './auth.js';
import { pool } from './routing.js';
import { acquire as acquireProvider } from './providers.js';
import { metrics } from './metrics.js';
import { audit } from './audit.js';
import * as usage from './usage.js';
import { consume, checkQuota, QUOTAS } from './limits.js';
import { fingerprint } from './audit.js';
import * as profiles from './profiles.js';
import * as recorder from './recorder.js';

/** Live gateway sessions, keyed by session id. */
export const sessions = new Map();

const GRACE_MS = Number(process.env.OYA_SESSION_GRACE_MS) || 60_000;

function chromeVersion() {
  return {
    Browser: 'Chrome/126.0.0.0',
    'Protocol-Version': '1.3',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      + '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'V8-Version': '12.6.228.9',
    'WebKit-Version': '537.36',
  };
}

/**
 * CDP discovery. Playwright and Puppeteer fetch this first and then dial
 * webSocketDebuggerUrl, which is why pointing them at the gateway just works.
 */
export function handleJsonVersion(req, res) {
  const host = req.headers.host || 'localhost';
  const scheme = (req.headers['x-forwarded-proto'] || '').includes('https') ? 'wss' : 'ws';
  const token = new URL(req.url, `http://${host}`).searchParams.get('token');
  res.json({
    ...chromeVersion(),
    webSocketDebuggerUrl: `${scheme}://${host}/connect${token ? `?token=${encodeURIComponent(token)}` : ''}`,
  });
}

/** Some clients probe /json/list before connecting. */
export function handleJsonList(req, res) {
  const host = req.headers.host || 'localhost';
  const scheme = (req.headers['x-forwarded-proto'] || '').includes('https') ? 'wss' : 'ws';
  res.json([...sessions.values()].map((s) => ({
    id: s.id,
    type: 'page',
    title: s.profile ? `Gateway session (${s.profile})` : 'Gateway session',
    url: 'about:blank',
    webSocketDebuggerUrl: `${scheme}://${host}/connect?session=${s.id}`,
  })));
}

export const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });

/**
 * A gateway session. Owns the upstream CDP connection and survives a client
 * disconnect for GRACE_MS so a dropped client can resume against the same
 * provider with its page state intact.
 */
class Session {
  constructor({ id, apiKey, provider, release, upstream, profile }) {
    Object.assign(this, { id, apiKey, provider, release, upstream, profile });
    // Profiles and recordings are namespaced by this, never by the raw key.
    this.owner = fingerprint(apiKey);
    this.client = null;
    this.startedAt = Date.now();
    this.bytesUp = 0;
    this.bytesDown = 0;
    this.graceTimer = null;
    this.closed = false;
    this.pendingToClient = [];
  }

  attach(client) {
    clearTimeout(this.graceTimer);
    this.graceTimer = null;
    this.client = client;

    // Anything the browser said while nobody was listening is delivered on
    // resume rather than lost.
    for (const buf of this.pendingToClient.splice(0)) {
      try { client.send(buf); } catch {}
    }

    client.on('message', (data, isBinary) => {
      this.bytesUp += data.length;
      if (this.upstream.readyState === WebSocket.OPEN) {
        this.upstream.send(data, { binary: isBinary });
      }
    });

    client.on('close', () => {
      if (this.client !== client) return;
      this.client = null;
      if (this.closed) return;
      // Hold the browser briefly so a reconnect resumes the same session.
      this.graceTimer = setTimeout(() => this.destroy('grace expired'), GRACE_MS);
      metrics.gatewaySessions.set({}, sessions.size);
    });

    client.on('error', () => {});
  }

  bindUpstream() {
    this.upstream.on('message', (data, isBinary) => {
      this.bytesDown += data.length;
      if (this.client?.readyState === WebSocket.OPEN) {
        this.client.send(data, { binary: isBinary });
      } else if (this.pendingToClient.length < 1000) {
        this.pendingToClient.push(data);
      }
    });
    this.upstream.on('close', () => this.destroy('provider closed'));
    this.upstream.on('error', () => this.destroy('provider error'));
  }

  async destroy(reason) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.graceTimer);
    sessions.delete(this.id);

    await recorder.stop(this.id).catch(() => {});
    if (this.profile) {
      await profiles.capture(this.owner, this.profile, this)
        .catch((e) => console.error(`[gateway] profile capture failed for ${this.profile}:`, e.message));
    }
    // Held open since restore so its on-new-document hook stays registered.
    try { this.profileConn?.close(); } catch {}

    try { this.client?.close(1001, reason); } catch {}
    try { this.upstream?.close(); } catch {}
    try { this.release?.(); } catch {}

    const seconds = Math.round((Date.now() - this.startedAt) / 1000);
    usage.record(this.apiKey, 'browser_seconds', seconds);
    usage.record(this.apiKey, 'bytes_out', this.bytesDown);
    metrics.gatewaySessions.set({}, sessions.size);
    metrics.gatewaySessionDuration.observe({ provider: this.provider }, seconds * 1000);
    audit({
      action: 'gateway.session.end', actorKey: this.apiKey, targetType: 'session', targetId: this.id,
      meta: { provider: this.provider, seconds, reason, profile: this.profile || null },
    });
  }

  toJSON() {
    return {
      id: this.id, provider: this.provider, profile: this.profile || null,
      connected: !!this.client, startedAt: new Date(this.startedAt).toISOString(),
      seconds: Math.round((Date.now() - this.startedAt) / 1000),
      bytesUp: this.bytesUp, bytesDown: this.bytesDown,
      recording: recorder.isRecording(this.id),
    };
  }
}

/** Route an HTTP upgrade on /connect into a gateway session. */
export async function handleUpgrade(req, socket, head) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token')
    || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '');

  const deny = (code, message) => {
    socket.write(`HTTP/1.1 ${code} ${message}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  if (!validateApiKey(token)) {
    metrics.gatewayConnects.inc({ outcome: 'unauthorized' });
    audit({ action: 'gateway.connect', outcome: 'denied', targetType: 'session', meta: { reason: 'bad token' }, req });
    return deny(401, 'Unauthorized');
  }

  if (!consume('connect', token).allowed) {
    metrics.gatewayConnects.inc({ outcome: 'rate_limited' });
    return deny(429, 'Too Many Requests');
  }

  // ── Resume an existing session ──
  const resumeId = url.searchParams.get('session');
  if (resumeId) {
    const existing = sessions.get(resumeId);
    if (!existing) { metrics.gatewayConnects.inc({ outcome: 'unknown_session' }); return deny(404, 'Not Found'); }
    if (existing.apiKey !== token) {
      metrics.gatewayConnects.inc({ outcome: 'forbidden' });
      return deny(403, 'Forbidden');
    }
    if (existing.client) { metrics.gatewayConnects.inc({ outcome: 'session_busy' }); return deny(409, 'Session In Use'); }
    return wss.handleUpgrade(req, socket, head, (client) => {
      existing.attach(client);
      metrics.gatewayConnects.inc({ outcome: 'resumed' });
      audit({ action: 'gateway.session.resume', actorKey: token, targetType: 'session', targetId: existing.id, req });
    });
  }

  // ── New session ──
  const profileName = url.searchParams.get('profile');
  const owner = fingerprint(token);
  if (profileName) {
    const lock = profiles.tryLock(owner, profileName);
    if (!lock.ok) {
      // Two browsers sharing one jar corrupts it, so the second is refused
      // rather than silently racing.
      metrics.gatewayConnects.inc({ outcome: 'profile_busy' });
      audit({ action: 'gateway.connect', actorKey: token, outcome: 'denied', targetType: 'profile',
        targetId: profileName, meta: { reason: 'profile in use' }, req });
      return deny(409, 'Profile In Use');
    }
  }

  const mine = [...sessions.values()].filter((s) => s.apiKey === token).length;
  const quota = checkQuota('browsers', token, mine);
  if (!quota.allowed) {
    if (profileName) profiles.unlock(owner, profileName);
    metrics.gatewayConnects.inc({ outcome: 'quota' });
    return deny(429, `Browser quota reached (${quota.quota})`);
  }

  let acquired;
  try {
    acquired = await pool.acquire({
      // This key's own providers plus whatever the host shares.
      owner,
      strategy: url.searchParams.get('strategy') || undefined,
      connect: async (provider) => {
        const target = provider.type === 'cdp' && provider.wsUrl
          ? { wsUrl: provider.wsUrl, provider: provider.name, sessionId: null, release: async () => {} }
          : await acquireProvider({ provider: provider.type });
        const upstream = new WebSocket(target.wsUrl, { maxPayload: 256 * 1024 * 1024, handshakeTimeout: 20_000 });
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('upstream connect timed out')), 20_000);
          upstream.once('open', () => { clearTimeout(t); resolve(); });
          upstream.once('error', (e) => { clearTimeout(t); reject(e); });
        });
        return { upstream, target };
      },
    });
  } catch (err) {
    if (profileName) profiles.unlock(owner, profileName);
    metrics.gatewayConnects.inc({ outcome: 'no_provider' });
    audit({ action: 'gateway.connect', actorKey: token, outcome: 'error', meta: { error: err.message }, req });
    return deny(err.status === 503 ? 503 : 502, err.status === 503 ? 'Service Unavailable' : 'Bad Gateway');
  }

  const { provider, session: { upstream, target }, release } = acquired;
  const id = randomUUID();
  const session = new Session({
    id, apiKey: token, provider: provider.name, profile: profileName || null,
    upstream,
    release: () => {
      release();
      target.release?.().catch(() => {});
      if (profileName) profiles.unlock(owner, profileName);
    },
  });
  session.upstreamUrl = target.wsUrl;
  session.bindUpstream();
  sessions.set(id, session);

  // Restore before the client can navigate, so the first page load already has
  // the profile's cookies.
  if (profileName) await profiles.restore(owner, profileName, session).catch((e) => console.error('[gateway] profile restore:', e.message));
  if (url.searchParams.get('record') === '1') await recorder.start(session).catch((e) => console.error('[gateway] record:', e.message));

  wss.handleUpgrade(req, socket, head, (client) => {
    session.attach(client);
    usage.record(token, 'browsers_started');
    metrics.gatewayConnects.inc({ outcome: 'ok' });
    metrics.gatewaySessions.set({}, sessions.size);
    audit({ action: 'gateway.session.start', actorKey: token, targetType: 'session', targetId: id,
      meta: { provider: provider.name, profile: profileName || null, recording: url.searchParams.get('record') === '1' }, req });
  });
}

export function listSessions(apiKey, { all = false } = {}) {
  return [...sessions.values()].filter((s) => all || s.apiKey === apiKey).map((s) => s.toJSON());
}

export async function killSession(id, reason = 'closed by operator') {
  const s = sessions.get(id);
  if (!s) return false;
  await s.destroy(reason);
  return true;
}
