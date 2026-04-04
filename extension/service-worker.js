/**
 * Oya Browser Extension — Service Worker
 * Accepts WebSocket connection from the local MCP bridge and routes
 * commands to content scripts running in browser tabs.
 *
 * Architecture:
 *   MCP Client (Cursor/CC) ──MCP──▶ Local Bridge (port 9333) ──WS──▶ This Service Worker ──msg──▶ Content Script
 */

const DEFAULT_PORT = 9333;

let ws = null;
let wsReady = false;
let port = DEFAULT_PORT;
let reconnectTimer = null;
let reconnectAttempts = 0;
let pingInterval = null;
let missedPongs = 0;

// ─── Config ───

async function loadConfig() {
  const data = await chrome.storage.local.get(['oya_port']);
  if (data.oya_port) port = data.oya_port;
}

// ─── Helpers ───

function randomId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// ─── WebSocket (connects to local bridge) ───

function connect() {
  // Tear down old socket without triggering reconnect
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (ws) {
    const old = ws;
    ws = null;
    old.onclose = null;
    old.onerror = null;
    try { old.close(); } catch {}
  }

  try {
    const socket = new WebSocket(`ws://localhost:${port}/ext`);

    socket.onopen = () => {
      wsReady = true;
      reconnectAttempts = 0;
      startPingLoop();
      broadcastStatus();
    };

    socket.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      handleBridgeMessage(msg);
    };

    socket.onclose = () => {
      if (ws !== socket) return; // stale socket, ignore
      wsReady = false;
      clearInterval(pingInterval);
      broadcastStatus();
      scheduleReconnect();
    };

    socket.onerror = () => {};
    ws = socket;
  } catch {
    scheduleReconnect();
  }
}

function disconnect() {
  clearTimeout(reconnectTimer);
  clearInterval(pingInterval);
  reconnectTimer = null;
  reconnectAttempts = 0;
  missedPongs = 0;
  if (ws) {
    const old = ws;
    ws = null;
    old.onclose = null;
    old.onerror = null;
    try { old.close(); } catch {}
  }
  wsReady = false;
  broadcastStatus();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(1.3, reconnectAttempts), 8000) + Math.random() * 500;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
}

function startPingLoop() {
  clearInterval(pingInterval);
  missedPongs = 0;
  pingInterval = setInterval(() => {
    missedPongs++;
    if (missedPongs > 4) { clearInterval(pingInterval); if (ws) try { ws.close(); } catch {}; return; }
    try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
  }, 15000);
}

function sendToBridge(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function sendResult(id, ok, data, error) {
  const msg = { type: 'result', id, ok };
  if (ok) msg.data = data || {};
  else msg.error = error || 'Unknown error';
  sendToBridge(msg);
}

function broadcastStatus() {
  try {
    chrome.runtime.sendMessage({
      type: 'status',
      connected: wsReady,
      port,
    }, () => { if (chrome.runtime.lastError) {} });
  } catch {}
}

// ─── Bridge Message Handler ───

function handleBridgeMessage(msg) {
  switch (msg.type) {
    case 'ping':
      missedPongs = 0;
      sendToBridge({ type: 'pong' });
      break;
    case 'pong':
      missedPongs = 0;
      break;
    case 'cmd':
      handleCommand(msg);
      break;
  }
}

// ─── Command Handler ───

async function handleCommand(msg) {
  const { id, action, params } = msg;

  try {
    // ── Tab management (service worker APIs) ──

    if (action === 'list_tabs') {
      const tabs = await chrome.tabs.query({});
      sendResult(id, true, {
        tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.active })),
      });
      return;
    }

    if (action === 'open_tab') {
      const tab = await chrome.tabs.create({ url: params?.url || 'about:blank', active: true });
      if (params?.url && params.url !== 'about:blank') await waitForTabLoad(tab.id);
      sendResult(id, true, { tab_id: tab.id, url: params?.url || 'about:blank' });
      return;
    }

    if (action === 'switch_tab') {
      if (!params?.tab_id) { sendResult(id, false, null, 'tab_id required'); return; }
      await chrome.tabs.update(params.tab_id, { active: true });
      sendResult(id, true, { tab_id: params.tab_id });
      return;
    }

    if (action === 'close_tab') {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = params?.tab_id || activeTab?.id;
      if (tabId) await chrome.tabs.remove(tabId);
      sendResult(id, true, { closed: true });
      return;
    }

    // ── Screenshot ──

    if (action === 'screenshot') {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      sendResult(id, true, { screenshot: dataUrl });
      return;
    }

    // ── Navigate ──

    if (action === 'navigate') {
      if (!params?.url) { sendResult(id, false, null, 'URL required'); return; }
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab) { sendResult(id, false, null, 'No active tab'); return; }
      let url = params.url;
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      await chrome.tabs.update(activeTab.id, { url });
      await waitForTabLoad(activeTab.id);
      const tab = await chrome.tabs.get(activeTab.id);
      sendResult(id, true, { url: tab.url, title: tab.title });
      return;
    }

    // ── All other commands → content script ──

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) { sendResult(id, false, null, 'No active tab'); return; }

    // Ensure content script is injected
    try {
      await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content.js'] });
    } catch {}

    const response = await chrome.tabs.sendMessage(activeTab.id, { type: 'cmd', action, params });

    if (response?.ok) {
      sendResult(id, true, response.data);
    } else {
      sendResult(id, false, null, response?.error || 'Command failed');
    }

  } catch (err) {
    sendResult(id, false, null, err.message);
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 15000);
    function listener(tid, changeInfo) {
      if (tid === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        setTimeout(resolve, 200);
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ─── Message Handler (from popup / side panel) ───

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'get-status') {
    sendResponse({ connected: wsReady, port });
    return false;
  }
  if (msg.type === 'set-port') {
    port = msg.port || DEFAULT_PORT;
    chrome.storage.local.set({ oya_port: port });
    disconnect();
    connect();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'connect') {
    if (msg.port) port = msg.port;
    connect();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === 'disconnect') {
    disconnect();
    sendResponse({ ok: true });
    return false;
  }
  // Forward panel commands (for side panel actions)
  if (msg.type === 'panel-cmd') {
    handleCommand({ id: msg.id || randomId(), action: msg.action, params: msg.params }).catch(() => {});
    return false;
  }
  return false;
});

// ─── Side Panel ───

// Open side panel on action click if user enabled it
chrome.storage.local.get(['oya_side_panel'], (data) => {
  if (data.oya_side_panel) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }
});

// ─── Startup ───

loadConfig().then(() => connect());
