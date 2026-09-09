/**
 * WebSocket handler — manages browser connections, auth, ping/pong, and command dispatch.
 */

import { v4 as uuidv4 } from 'uuid';
import { validateApiKey } from './auth.js';
import { registry } from './connection-registry.js';
import { destroyMcpServer } from './mcp-server.js';
import { mergeDump, applyChange, getAll as getAllCookies, getForDomains } from './cookie-store.js';
import { getFingerprintForKey } from './fingerprint.js';
import { metrics } from './metrics.js';
import * as usage from './usage.js';

/** One place both client types report through, so the numbers are comparable. */
function recordCommand(action, outcome, ms) {
  metrics.commands.inc({ action, outcome });
  metrics.commandDuration.observe({ action }, ms);
}


const PING_INTERVAL = 20000;
const PONG_TIMEOUT = PING_INTERVAL * 4;

// Pending commands: cmdId → { resolve, reject, timer }
const pendingCommands = new Map();

/**
 * Handle a new WebSocket connection from a browser extension.
 */
export function handleConnection(ws) {
  let browserId = null;
  let apiKey = null;
  let authenticated = false;
  let pingTimer = null;
  let lastPong = Date.now();

  // Must authenticate within 10s
  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      ws.close(4001, 'Auth timeout');
    }
  }, 10000);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!msg || !msg.type) return;

    // ── Auth ──
    if (msg.type === 'auth') {
      clearTimeout(authTimeout);

      // Draining: finish what is in flight, accept nothing new, so an
      // instance can be restarted without dropping live sessions.
      if (registry.draining) {
        metrics.wsConnections.inc({ outcome: 'draining' });
        ws.close(4009, 'Server draining');
        return;
      }

      if (!validateApiKey(msg.api_key)) {
        metrics.wsConnections.inc({ outcome: 'invalid_key' });
        ws.close(4003, 'Invalid API key');
        return;
      }

      browserId = msg.browser_id || uuidv4();
      apiKey = msg.api_key;

      // If browser_id already connected, verify the incoming key owns it
      // before kicking the existing connection. Without this check, any
      // valid key could hijack another tenant's browser_id.
      const existing = registry.get(browserId);
      if (existing && existing.apiKey !== apiKey) {
        metrics.wsConnections.inc({ outcome: 'id_conflict' });
        ws.close(4003, 'browser_id registered to a different key');
        return;
      }

      authenticated = true;

      if (existing) {
        // Same owner reconnecting — replace the old socket.
        for (const [cmdId, pending] of pendingCommands) {
          if (pending.browserId === browserId) {
            clearTimeout(pending.timer);
            pendingCommands.delete(cmdId);
            recordCommand(pending.action, 'reconnected', Date.now() - pending.startedAt);
            pending.reject(new Error('Browser reconnected'));
          }
        }
        try { existing.ws.close(4000, 'Replaced by new connection'); } catch {}
        registry.remove(browserId);
        destroyMcpServer(browserId);
      }

      registry.add(browserId, { ws, apiKey: msg.api_key, name: msg.browser_name || 'Browser', clientType: 'oya' });
      metrics.wsConnections.inc({ outcome: 'ok' });
      metrics.browsersConnected.set({}, registry.browsers.size);
      usage.browserConnected(apiKey, browserId);

      // Generate deterministic fingerprint from API key — same key = same profile everywhere
      const fingerprint = getFingerprintForKey(msg.api_key);

      ws.send(JSON.stringify({
        type: 'auth_ok',
        browser_id: browserId,
        fingerprint,
      }));

      // Send this API key's cookie jar so this browser syncs immediately.
      // Cookies are scoped per API key to prevent cross-account leakage.
      const cookies = getAllCookies(apiKey);
      if (cookies.length > 0) {
        try {
          ws.send(JSON.stringify({ type: 'cookie_sync', cookies }));
        } catch {}
      }

      // Start ping loop
      startPing();
      return;
    }

    if (!authenticated) return;

    // ── Ping from browser — respond with pong ──
    if (msg.type === 'ping') {
      lastPong = Date.now();
      registry.updateLastSeen(browserId);
      try {
        ws.send(JSON.stringify({ type: 'pong' }));
      } catch {}
      return;
    }

    // ── Pong ──
    if (msg.type === 'pong') {
      lastPong = Date.now();
      registry.updateLastSeen(browserId);
      return;
    }

    // ── Live frame from browser ──
    if (msg.type === 'frame') {
      if (msg.data) {
        registry.pushFrame(browserId, msg.data);
        metrics.frames.inc({ client: 'oya' });
        usage.record(apiKey, 'frames');
        usage.record(apiKey, 'bytes_out', msg.data.length);
      }
      return;
    }

    // ── Cookie dump (full jar from browser on connect) ──
    //
    // Merged into this key's jar and left there. Nothing is pushed to peers:
    // fanning a full jar out to every browser in the pool on every connect was
    // O(pool size) per connect, so a fleet-wide restart was quadratic.
    if (msg.type === 'cookie_dump') {
      if (Array.isArray(msg.cookies)) {
        const merged = mergeDump(apiKey, msg.cookies);
        console.log(`[ws] Cookie dump from ${browserId}: ${msg.cookies.length} cookies, jar now ${merged.length}`);
      }
      return;
    }

    // ── Cookie change (incremental, single or batched) ──
    //
    // Recorded in the jar only. Peers pick changes up via cookie_pull when they
    // navigate somewhere that needs them.
    if (msg.type === 'cookie_changed') {
      const changes = Array.isArray(msg.changes) ? msg.changes : (msg.change ? [msg.change] : []);
      for (const change of changes.slice(0, 500)) applyChange(apiKey, change);
      metrics.cookieChanges.inc({}, changes.length);
      return;
    }

    // ── Cookie pull (browser asks for the hosts it is about to visit) ──
    if (msg.type === 'cookie_pull') {
      const cookies = getForDomains(apiKey, msg.domains || []);
      metrics.cookiePulls.inc({});
      usage.record(apiKey, 'cookie_pulls');
      try {
        ws.send(JSON.stringify({ type: 'cookie_sync', cookies, pullId: msg.pullId }));
      } catch {}
      return;
    }

    // ── Command result ──
    if (msg.type === 'cmd_result') {
      const pending = pendingCommands.get(msg.id);
      if (pending && pending.browserId === browserId && registry.get(browserId)?.ws === ws) {
        console.log(`[ws] ← cmd_result from ${browserId}: id=${msg.id} ok=${msg.ok}`);
        clearTimeout(pending.timer);
        pendingCommands.delete(msg.id);
        metrics.pendingCommands.set({}, pendingCommands.size);
        recordCommand(pending.action, msg.ok ? 'ok' : 'error', Date.now() - pending.startedAt);
        pending.resolve({
          ok: msg.ok,
          data: msg.data,
          error: msg.error,
        });
      } else {
        console.log(`[ws] ← cmd_result from ${browserId}: id=${msg.id} (no pending command — stale or timed out)`);
      }

      // Update current URL if the result contains page info
      if (msg.data?.url) {
        registry.updateUrl(browserId, msg.data.url);
      }
      return;
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
    clearInterval(pingTimer);

    if (browserId) {
      // Guard: only clean up if WE are still the registered connection.
      // When a browser reconnects, the new connection replaces us in the
      // registry before our close event fires — removing the new entry
      // would cause the "on/off" flapping loop.
      const current = registry.get(browserId);
      if (current && current.ws === ws) {
        for (const [cmdId, pending] of pendingCommands) {
          if (pending.browserId === browserId) {
            clearTimeout(pending.timer);
            pendingCommands.delete(cmdId);
            recordCommand(pending.action, 'disconnected', Date.now() - pending.startedAt);
            pending.reject(new Error('Browser disconnected'));
          }
        }

        registry.remove(browserId);
        destroyMcpServer(browserId);
        usage.browserDisconnected(apiKey, browserId);
        metrics.wsDisconnections.inc({ client: 'oya' });
        metrics.browsersConnected.set({}, registry.browsers.size);
        metrics.pendingCommands.set({}, pendingCommands.size);
      }
    }
  });

  ws.on('error', () => {
    // onclose will fire after this
  });

  function startPing() {
    pingTimer = setInterval(() => {
      if (Date.now() - lastPong > PONG_TIMEOUT) {
        console.log(`[ws] Browser ${browserId} missed pongs — closing`);
        clearInterval(pingTimer);
        ws.close(4002, 'Pong timeout');
        return;
      }
      try {
        ws.send(JSON.stringify({ type: 'ping' }));
      } catch {
        clearInterval(pingTimer);
      }
    }, PING_INTERVAL);
  }
}

// ── Stream control: start/stop frame capture on the extension ──

registry.on('stream:start', ({ id }) => {
  const browser = registry.get(id);
  if (browser?.ws) {
    try {
      browser.ws.send(JSON.stringify({ type: 'stream_start', fps: 2 }));
    } catch {}
  }
});

registry.on('stream:stop', ({ id }) => {
  const browser = registry.get(id);
  if (browser?.ws) {
    try {
      browser.ws.send(JSON.stringify({ type: 'stream_stop' }));
    } catch {}
  }
});

/**
 * Send a command to a browser and wait for the result.
 * @returns {Promise<{ok: boolean, data: any, error: string?}>}
 */
export function sendCommand(browserId, action, params = {}, timeoutMs) {
  const browser = registry.get(browserId);
  if (!browser) {
    return Promise.reject(new Error(`Browser ${browserId} not connected`));
  }

  const id = uuidv4();
  const timeout = timeoutMs || (action === 'navigate' ? 90000 : 30000);

  // Outbound clients (CDP: Anchor, Browserbase, Steel, plain Chrome) are driven
  // directly rather than by handing a command to a socket and awaiting a
  // cmd_result. Same action vocabulary either way, so callers never branch.
  if (browser.driver) {
    const started = Date.now();
    return browser.driver.send(action, params, timeout).then(
      (result) => { recordCommand(action, result?.ok === false ? 'error' : 'ok', Date.now() - started); return result; },
      (err) => { recordCommand(action, 'error', Date.now() - started); throw err; },
    );
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(id);
      metrics.pendingCommands.set({}, pendingCommands.size);
      recordCommand(action, 'timeout', timeout);
      reject(new Error(`Command ${action} timed out after ${timeout / 1000}s`));
    }, timeout);

    pendingCommands.set(id, { resolve, reject, timer, browserId, action, startedAt: Date.now() });
    metrics.pendingCommands.set({}, pendingCommands.size);

    console.log(`[ws] → cmd to ${browserId}: id=${id} action=${action}`);
    try {
      browser.ws.send(JSON.stringify({
        type: 'cmd',
        id,
        action,
        params,
      }));
    } catch (err) {
      clearTimeout(timer);
      pendingCommands.delete(id);
      reject(err);
    }
  });
}
