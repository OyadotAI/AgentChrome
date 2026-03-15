/**
 * WebSocket handler — manages browser connections, auth, ping/pong, and command dispatch.
 */

import { v4 as uuidv4 } from 'uuid';
import { validateApiKey } from './auth.js';
import { registry } from './connection-registry.js';
import { destroyMcpServer } from './mcp-server.js';

const PING_INTERVAL = 20000;
const PONG_TIMEOUT = PING_INTERVAL * 2.5;

// Pending commands: cmdId → { resolve, reject, timer }
const pendingCommands = new Map();

/**
 * Handle a new WebSocket connection from a browser extension.
 */
export function handleConnection(ws) {
  let browserId = null;
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

      if (!validateApiKey(msg.api_key)) {
        ws.close(4003, 'Invalid API key');
        return;
      }

      browserId = msg.browser_id || uuidv4();
      authenticated = true;

      // If browser_id already connected, close the old one
      const existing = registry.get(browserId);
      if (existing) {
        try { existing.ws.close(4000, 'Replaced by new connection'); } catch {}
        registry.remove(browserId);
        destroyMcpServer(browserId);
      }

      registry.add(browserId, { ws, name: msg.browser_name || 'Browser' });

      ws.send(JSON.stringify({
        type: 'auth_ok',
        browser_id: browserId,
      }));

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

    // ── Command result ──
    if (msg.type === 'cmd_result') {
      const pending = pendingCommands.get(msg.id);
      if (pending) {
        console.log(`[ws] ← cmd_result from ${browserId}: id=${msg.id} ok=${msg.ok}`);
        clearTimeout(pending.timer);
        pendingCommands.delete(msg.id);
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
      // Reject all pending commands for this browser
      for (const [cmdId, pending] of pendingCommands) {
        if (pending.browserId === browserId) {
          clearTimeout(pending.timer);
          pendingCommands.delete(cmdId);
          pending.reject(new Error('Browser disconnected'));
        }
      }

      registry.remove(browserId);
      destroyMcpServer(browserId);
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

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(id);
      reject(new Error(`Command ${action} timed out after ${timeout / 1000}s`));
    }, timeout);

    pendingCommands.set(id, { resolve, reject, timer, browserId });

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
