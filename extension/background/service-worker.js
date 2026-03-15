/**
 * AgentChrome service worker — manages WebSocket lifecycle, tab routing,
 * and message relay between popup/content scripts and the server.
 */

import { MSG_AUTH, MSG_PING, MSG_CMD_RESULT, parseMessage, uuid } from '../lib/protocol.js';

// ─── WebSocket State ───

let ws = null;
let wsReady = false;
let connecting = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
let pingInterval = null;
let lastPongAt = 0;
let missedPongs = 0;
const MAX_RECONNECT_DELAY = 10000;
const PING_INTERVAL_MS = 15000;
const MAX_MISSED_PONGS = 2;

let currentBrowserId = null;
let currentBrowserName = null;

// Pending cmd results: cmdId -> callback
const pendingCmdResults = new Map();

// ─── Live Stream State ───
let streamInterval = null;
let streamActive = false;

// ─── Configuration ───

async function getConfig() {
  const result = await chrome.storage.local.get(['ac_server_url', 'ac_api_key', 'ac_browser_id', 'ac_browser_name']);
  return {
    serverUrl: result.ac_server_url || 'ws://localhost:3100/ws',
    apiKey: result.ac_api_key || '',
    browserId: result.ac_browser_id || null,
    browserName: result.ac_browser_name || null,
  };
}

async function getBrowserId() {
  const config = await getConfig();
  if (config.browserId) return config.browserId;
  const id = uuid();
  await chrome.storage.local.set({ ac_browser_id: id });
  return id;
}

function detectBrowserName() {
  const ua = navigator.userAgent;
  let browser = 'Chrome';
  if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('OPR/') || ua.includes('Opera')) browser = 'Opera';
  else if (ua.includes('Brave')) browser = 'Brave';

  let os = 'Unknown';
  if (ua.includes('Mac OS X') || ua.includes('Macintosh')) os = 'macOS';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('CrOS')) os = 'ChromeOS';

  return `${browser} on ${os}`;
}

// ─── WebSocket Lifecycle ───

async function connect() {
  if (connecting) return;
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    if (wsReady && missedPongs >= MAX_MISSED_PONGS) {
      forceCleanup();
    } else {
      return;
    }
  }

  connecting = true;

  const config = await getConfig();
  if (!config.apiKey) {
    connecting = false;
    broadcastToPopup({ type: 'ws_status', status: 'no_api_key' });
    return;
  }

  const browserId = await getBrowserId();
  const browserName = config.browserName || detectBrowserName();
  currentBrowserId = browserId;
  currentBrowserName = browserName;

  forceCleanup();

  try {
    const socket = new WebSocket(config.serverUrl);

    const connectTimeout = setTimeout(() => {
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        try { socket.close(); } catch {}
        if (ws === socket) ws = null;
        connecting = false;
        scheduleReconnect();
      }
    }, 10000);

    socket.onopen = () => {
      clearTimeout(connectTimeout);
      if (ws !== socket) return;
      try {
        socket.send(JSON.stringify({
          type: MSG_AUTH,
          api_key: config.apiKey,
          browser_id: browserId,
          browser_name: browserName,
        }));
      } catch (e) {
        console.error('[ac-ext] Failed to send auth:', e);
      }
    };

    socket.onmessage = (event) => {
      if (ws !== socket) return;
      const msg = parseMessage(event.data);
      if (!msg) return;
      handleServerMessage(msg);
    };

    socket.onclose = (event) => {
      clearTimeout(connectTimeout);
      if (ws === socket) {
        ws = null;
        wsReady = false;
        clearInterval(pingInterval);
        console.log(`[ac-ext] WS closed: ${event.reason || `code=${event.code}`}`);
        broadcastToPopup({ type: 'ws_status', status: 'disconnected' });
        scheduleReconnect();
      }
    };

    socket.onerror = (e) => {
      console.error('[ac-ext] WebSocket error:', e);
    };

    ws = socket;
    connecting = false;
  } catch (e) {
    connecting = false;
    scheduleReconnect();
  }
}

function forceCleanup() {
  if (ws) {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    try { ws.close(); } catch {}
    ws = null;
  }
  wsReady = false;
  missedPongs = 0;
  clearInterval(pingInterval);
}

function disconnect() {
  stopStream();
  clearTimeout(reconnectTimer);
  clearInterval(pingInterval);
  reconnectTimer = null;
  reconnectAttempts = 0;
  connecting = false;
  missedPongs = 0;
  chrome.alarms.clear('ac-keepalive');
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  wsReady = false;
  broadcastToPopup({ type: 'ws_status', status: 'disconnected' });
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const base = Math.min(500 * Math.pow(1.5, reconnectAttempts), MAX_RECONNECT_DELAY);
  const jitter = Math.random() * 500;
  const delayMs = Math.round(base + jitter);
  reconnectAttempts++;
  console.log(`[ac-ext] Reconnecting in ${delayMs}ms (attempt ${reconnectAttempts})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delayMs);
}

function startPingLoop() {
  clearInterval(pingInterval);
  missedPongs = 0;
  lastPongAt = Date.now();
  pingInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      missedPongs++;
      if (missedPongs > MAX_MISSED_PONGS) {
        console.log(`[ac-ext] ${missedPongs} pings without pong — forcing reconnect`);
        forceCleanup();
        broadcastToPopup({ type: 'ws_status', status: 'disconnected' });
        scheduleReconnect();
        return;
      }
      try {
        ws.send(JSON.stringify({ type: MSG_PING }));
      } catch {
        forceCleanup();
        broadcastToPopup({ type: 'ws_status', status: 'disconnected' });
        scheduleReconnect();
      }
    }
  }, PING_INTERVAL_MS);
}

// ─── Server Message Handling ───

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'auth_ok':
      wsReady = true;
      reconnectAttempts = 0;
      startPingLoop();
      chrome.alarms.create('ac-keepalive', { periodInMinutes: 0.5 });
      ensureOffscreen();
      if (msg.browser_id) currentBrowserId = msg.browser_id;
      console.log('[ac-ext] Connected, browser_id:', currentBrowserId);
      broadcastToPopup({
        type: 'ws_status',
        status: 'connected',
        browser_id: currentBrowserId,
        browser_name: currentBrowserName,
      });
      break;

    case 'ping':
      // Server pinging us — respond with pong
      missedPongs = 0;
      lastPongAt = Date.now();
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {}
      break;

    case 'pong':
      missedPongs = 0;
      lastPongAt = Date.now();
      break;

    case 'stream_start':
      startStream(msg.fps || 2);
      break;

    case 'stream_stop':
      stopStream();
      break;

    case 'cmd':
      handleBrowserCommand(msg);
      break;

    default:
      console.log('[ac-ext] Unknown server message:', msg.type);
  }
}

// ─── Browser Command Handling ───

async function handleBrowserCommand(msg) {
  const { id, action, params } = msg;

  try {
    // ── Navigate is handled at the tab level (not via content script) ──
    if (action === 'navigate' && params?.url) {
      const tabId = await findOrOpenTab(params.url);
      await waitForTabLoad(tabId, 30000);
      // Inject content scripts into the new page so subsequent commands work
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content/analyzer.js', 'content/agent.js'],
        });
      } catch {}
      const tab = await chrome.tabs.get(tabId);
      sendToServer({
        type: MSG_CMD_RESULT,
        id,
        ok: true,
        data: { url: tab.url || params.url, title: tab.title || '' },
      });
      return;
    }

    // ── Screenshot is handled at the tab level ──
    if (action === 'screenshot') {
      const tabId = await resolveTab(action, params);
      await chrome.tabs.update(tabId, { active: true });
      // Small delay for tab to render
      await new Promise((r) => setTimeout(r, 300));
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        sendToServer({ type: MSG_CMD_RESULT, id, ok: true, data: { screenshot: dataUrl } });
      } catch (captureErr) {
        sendToServer({ type: MSG_CMD_RESULT, id, ok: false, error: 'Screenshot capture failed: ' + captureErr.message });
      }
      return;
    }

    // ── All other actions go through content scripts ──
    const tabId = await resolveTab(action, params);
    await ensureContentScript(tabId);

    const sendExec = () =>
      chrome.tabs.sendMessage(tabId, {
        source: 'ac-service-worker',
        type: 'exec',
        action,
        params: params || {},
        cmdId: id,
      });

    const cmdTimeout = 30000;

    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingCmdResults.delete(id);
        reject(new Error(`Content script did not respond in ${cmdTimeout / 1000}s`));
      }, cmdTimeout);

      pendingCmdResults.set(id, (result) => {
        clearTimeout(timeout);
        pendingCmdResults.delete(id);
        resolve(result);
      });

      sendExec().catch(async (err) => {
        if (err?.message?.includes('Receiving end') || err?.message?.includes('Could not establish')) {
          for (let attempt = 0; attempt < 2; attempt++) {
            await new Promise((r) => setTimeout(r, 1000));
            try {
              await sendExec();
              return;
            } catch (retryErr) {
              if (attempt === 1) reject(retryErr);
            }
          }
        } else {
          reject(err);
        }
      });
    });

    sendToServer({
      type: MSG_CMD_RESULT,
      id,
      ok: response?.ok ?? true,
      data: response?.data ?? null,
      error: response?.error ?? null,
    });
  } catch (err) {
    console.error('[ac-ext] Command failed:', action, err);
    sendToServer({ type: MSG_CMD_RESULT, id, ok: false, error: err.message || 'Failed to execute browser command' });
  }
}

/**
 * Ensure content scripts are loaded in the tab.
 */
async function ensureContentScript(tabId) {
  const ping = () => chrome.tabs.sendMessage(tabId, { source: 'ac-service-worker', type: 'ping' });

  try {
    await ping();
    return;
  } catch {
    // Content script not loaded — inject it
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/analyzer.js', 'content/agent.js'],
    });
    await new Promise((r) => setTimeout(r, 600));
    try {
      await ping();
    } catch {
      await new Promise((r) => setTimeout(r, 400));
      await ping();
    }
  } catch (e) {
    console.log('[ac-ext] executeScript failed, reloading tab:', e.message);
    try {
      await chrome.tabs.reload(tabId);
      await waitForTabLoad(tabId, 10000);
      await new Promise((r) => setTimeout(r, 800));
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/analyzer.js', 'content/agent.js'],
      });
      await new Promise((r) => setTimeout(r, 600));
    } catch {
      // Give up
    }
  }
}

/**
 * Find the right tab for a command.
 */
async function resolveTab(action, params) {
  // For navigate, find or open the target URL's tab
  if (action === 'navigate' && params?.url) {
    return findOrOpenTab(params.url);
  }

  // Fall back to the active tab in the focused window
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab && activeTab.url && (activeTab.url.startsWith('http://') || activeTab.url.startsWith('https://'))) {
    return activeTab.id;
  }

  // No suitable tab — open example.com
  return findOrOpenTab('https://example.com');
}

async function findOrOpenTab(url) {
  const urlObj = new URL(url);
  const pattern = `${urlObj.origin}/*`;

  const tabs = await chrome.tabs.query({ url: pattern });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
    return tabs[0].id;
  }

  const tab = await chrome.tabs.create({ url, active: true });
  await waitForTabLoad(tab.id);
  return tab.id;
}

function waitForTabLoad(tabId, timeout = 15000) {
  return new Promise((resolve) => {
    let resolved = false;
    function done() {
      if (resolved) return;
      resolved = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(tid, info) {
      if (tid === tabId && info.status === 'complete') done();
    }
    chrome.tabs.onUpdated.addListener(listener);
    // Resolve immediately if tab is already complete (avoids 30s wait when navigating to existing tab)
    chrome.tabs.get(tabId).then(
      (tab) => { if (tab.status === 'complete') done(); },
      () => {}
    );
    setTimeout(done, timeout);
  });
}

// ─── Live Stream ───

function startStream(fps) {
  stopStream();
  streamActive = true;
  const intervalMs = Math.max(200, Math.round(1000 / fps)); // min 200ms (5fps cap)
  console.log(`[ac-ext] Stream started at ${Math.round(1000 / intervalMs)}fps`);

  streamInterval = setInterval(async () => {
    if (!streamActive || !ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 40 });
      ws.send(JSON.stringify({ type: 'frame', data: dataUrl }));
    } catch {
      // Tab might be chrome:// or unavailable — skip frame
    }
  }, intervalMs);
}

function stopStream() {
  if (streamInterval) {
    clearInterval(streamInterval);
    streamInterval = null;
  }
  streamActive = false;
}

// ─── Send to Server ───

function sendToServer(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch (e) {
      console.error('[ac-ext] Failed to send:', e);
    }
  }
}

// ─── Popup Communication ───

function broadcastToPopup(msg) {
  chrome.runtime.sendMessage({ source: 'ac-bg', ...msg }, () => {
    void chrome.runtime.lastError;
  });
}

// ─── Message Listener ───

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.source) return false;

  // From content script: deferred cmd result
  if (msg.source === 'ac-content' && msg.type === 'cmd_result') {
    const cb = pendingCmdResults.get(msg.cmdId);
    if (cb) cb({ ok: msg.ok, data: msg.data, error: msg.error });
    return false;
  }

  // From popup
  if (msg.source === 'ac-popup') {
    switch (msg.type) {
      case 'connect':
        connect().then(() => sendResponse({ ok: true }));
        return true;

      case 'disconnect':
        disconnect();
        sendResponse({ ok: true });
        return false;

      case 'get_status':
        sendResponse({
          connected: wsReady,
          browser_id: currentBrowserId,
          browser_name: currentBrowserName,
        });
        return false;

      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
        return false;
    }
  }

  // Offscreen keepalive
  if (msg.source === 'ac-keepalive') {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connect();
    }
    return false;
  }

  return false;
});

// ─── Keepalive alarm ───

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'ac-keepalive') return;

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connecting = false;
    connect();
    return;
  }

  const pongAge = Date.now() - lastPongAt;
  if (wsReady && pongAge > PING_INTERVAL_MS * (MAX_MISSED_PONGS + 1)) {
    forceCleanup();
    broadcastToPopup({ type: 'ws_status', status: 'disconnected' });
    connect();
  }
});

// ─── Offscreen Keepalive ───

let offscreenCreating = false;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  if (offscreenCreating) return;
  offscreenCreating = true;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen/keepalive.html',
      reasons: ['WORKERS'],
      justification: 'Keep WebSocket connection alive by preventing service worker suspension',
    });
  } catch (e) {
    if (!e.message?.includes('already exists')) {
      console.log('[ac-ext] Offscreen creation failed:', e.message);
    }
  }
  offscreenCreating = false;
}

// ─── Auto-connect on startup ───

ensureOffscreen();
connect();

// Re-inject content scripts after extension reload/update
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    try {
      if (tab.url.startsWith('http')) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/analyzer.js', 'content/agent.js'],
        });
      }
    } catch {
      // Tab may be restricted — skip
    }
  }
});
