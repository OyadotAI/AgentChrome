/**
 * Oya Browser — Desktop browser with agent scripts built in.
 * Users run this on their machines. Connects to a deployed Oya server.
 * Multi-tab, persistent cookies, real browser — no extension install needed.
 */

const { app, BrowserWindow, BrowserView, ipcMain, session, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

// Set dock icon on macOS (needed for dev mode — built app uses icon from package.json)
if (process.platform === 'darwin') {
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  if (fs.existsSync(iconPath)) {
    app.whenReady().then(() => {
      app.dock.setIcon(nativeImage.createFromPath(iconPath));
    });
  }
}

// ─── Config ───

const CONFIG_DEFAULTS = {
  serverUrl: 'ws://localhost:3100/ws',
  apiKey: '',
  browserName: `Oya Browser ${process.platform}`,
};

let config = { ...CONFIG_DEFAULTS };
let configPath = null;

function loadConfig() {
  configPath = path.join(app.getPath('userData'), 'config.json');
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config = { ...CONFIG_DEFAULTS, ...data };
  } catch {}
}

function saveConfig() {
  try { fs.writeFileSync(configPath, JSON.stringify(config, null, 2)); } catch {}
}

// ─── Scripts ───

const analyzerScript = fs.readFileSync(path.join(__dirname, 'scripts', 'analyzer.js'), 'utf8');
const agentScript = fs.readFileSync(path.join(__dirname, 'scripts', 'agent.js'), 'utf8');

// ─── Window & Tabs ───

let mainWindow = null;
let browsingMode = false;
let devPanelOpen = false;
const DEV_PANEL_WIDTH = 380;
const TOOLBAR_HEIGHT = 82; // 52px toolbar + 30px tab bar

/** @type {{ id: number, view: BrowserView, title: string, url: string }[]} */
const tabs = [];
let activeTabId = null;
let nextTabId = 1;

// ─── WebSocket ───

let ws = null;
let wsReady = false;
let browserId = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let pingInterval = null;
let missedPongs = 0;

// ─── App Lifecycle ───

app.whenReady().then(() => {
  loadConfig();
  createWindow();
  if (config.apiKey) connect();
});

app.on('window-all-closed', () => { disconnect(); app.quit(); });

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 860, minWidth: 600, minHeight: 400,
    icon: path.join(__dirname, 'build', process.platform === 'darwin' ? 'icon.icns' : 'icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 12 } : undefined,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  mainWindow.loadFile('renderer/index.html');
  mainWindow.on('resize', layoutActiveTab);
}

// ─── Tab Management ───

function createTab(url, activate = true) {
  const id = nextTabId++;
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true, sandbox: true,
      partition: 'persist:oya-browser', // cookies persist across restarts
    },
  });

  const tab = { id, view, title: 'New Tab', url: url || '' };
  tabs.push(tab);

  view.webContents.on('did-finish-load', () => injectScripts(view));

  const updateUrl = (e, u) => {
    tab.url = u;
    if (tab.id === activeTabId) sendToRenderer('url-changed', u);
    sendTabList();
  };
  view.webContents.on('did-navigate', updateUrl);
  view.webContents.on('did-navigate-in-page', updateUrl);
  view.webContents.on('page-title-updated', (e, title) => {
    tab.title = title;
    if (tab.id === activeTabId) sendToRenderer('title-changed', title);
    sendTabList();
  });

  // target="_blank" / window.open → new tab
  // But allow OAuth popups (Google, GitHub, etc.) to work natively
  view.webContents.setWindowOpenHandler(({ url, features }) => {
    const isOAuthPopup = url.includes('accounts.google.com') ||
      url.includes('github.com/login/oauth') ||
      url.includes('login.microsoftonline.com') ||
      url.includes('appleid.apple.com') ||
      (features && features.includes('popup'));

    if (isOAuthPopup) {
      // Let it open as a real popup so window.opener works for the callback
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500, height: 700,
          webPreferences: {
            partition: 'persist:oya-browser',
          },
        },
      };
    }

    // Everything else → open as a new tab
    createTab(url, true);
    return { action: 'deny' };
  });

  if (url) view.webContents.loadURL(url);
  if (activate) activateTab(id);
  sendTabList();
  return id;
}

function activateTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  if (activeTabId !== null) {
    const old = tabs.find(t => t.id === activeTabId);
    if (old) mainWindow.removeBrowserView(old.view);
  }
  activeTabId = id;
  mainWindow.setBrowserView(tab.view);
  layoutActiveTab();
  sendToRenderer('url-changed', tab.url);
  sendToRenderer('title-changed', tab.title);
  sendTabList();
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = tabs[idx];
  const wasActive = tab.id === activeTabId;

  // Always detach from window before destroying
  try { mainWindow.removeBrowserView(tab.view); } catch {}

  // Remove from list first, then destroy
  tabs.splice(idx, 1);

  // Destroy the webContents (delayed to avoid race)
  try {
    if (!tab.view.webContents.isDestroyed()) {
      tab.view.webContents.destroy();
    }
  } catch {}

  if (tabs.length === 0) {
    activeTabId = null;
    createTab('https://google.com', true);
  } else if (wasActive) {
    activeTabId = null;
    activateTab(tabs[Math.min(idx, tabs.length - 1)].id);
  } else {
    sendTabList();
  }
}

function getActiveView() {
  return tabs.find(t => t.id === activeTabId)?.view || null;
}

function sendTabList() {
  sendToRenderer('tabs-updated', tabs.map(t => ({
    id: t.id, title: t.title, url: t.url, active: t.id === activeTabId,
  })));
}

function layoutActiveTab() {
  const view = getActiveView();
  if (!mainWindow || !view || !browsingMode) return;
  const bounds = mainWindow.getContentBounds();
  const panelW = devPanelOpen ? DEV_PANEL_WIDTH : 0;
  view.setBounds({
    x: 0, y: TOOLBAR_HEIGHT,
    width: bounds.width - panelW,
    height: bounds.height - TOOLBAR_HEIGHT,
  });
}

function enterBrowsingMode(url) {
  if (browsingMode) return;
  browsingMode = true;
  createTab(url || 'https://google.com', true);
  sendToRenderer('mode-changed', 'browsing');
}

// ─── Script Injection ───

async function injectScripts(view) {
  if (!view) view = getActiveView();
  if (!view) return;
  try {
    await view.webContents.executeJavaScript(analyzerScript, true);
    await view.webContents.executeJavaScript(agentScript, true);
  } catch {}
}

// ─── IPC ───

ipcMain.handle('navigate', (e, url) => {
  if (!browsingMode) { enterBrowsingMode(url); return; }
  const view = getActiveView();
  if (!view) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  view.webContents.loadURL(url);
});

ipcMain.handle('go-back', () => getActiveView()?.webContents.goBack());
ipcMain.handle('go-forward', () => getActiveView()?.webContents.goForward());
ipcMain.handle('reload', () => getActiveView()?.webContents.reload());
ipcMain.handle('get-config', () => config);

ipcMain.handle('save-config', (e, newConfig) => {
  config = { ...config, ...newConfig };
  saveConfig();
  disconnect();
  connect();
  return true;
});

ipcMain.handle('get-status', () => ({
  connected: wsReady, browserId,
  url: getActiveView()?.webContents.getURL() || '',
}));

ipcMain.handle('enter-browsing', () => enterBrowsingMode('https://google.com'));
ipcMain.handle('new-tab', (e, url) => createTab(url || 'https://google.com', true));
ipcMain.handle('close-tab', (e, id) => closeTab(id));
ipcMain.handle('activate-tab', (e, id) => activateTab(id));

ipcMain.handle('show-overlay', () => {
  const view = getActiveView();
  if (view && browsingMode) mainWindow.removeBrowserView(view);
});
ipcMain.handle('hide-overlay', () => {
  const view = getActiveView();
  if (view && browsingMode) { mainWindow.setBrowserView(view); layoutActiveTab(); }
});

ipcMain.handle('toggle-dev-panel', () => {
  devPanelOpen = !devPanelOpen;
  layoutActiveTab();
  sendToRenderer('dev-panel-state', devPanelOpen);
  return devPanelOpen;
});

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

// ─── Dev Log ───

function devLog(direction, type, data) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const entry = {
    ts: Date.now(), dir: direction, type,
    data: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
  };
  if (entry.data && entry.data.length > 8000) entry.data = entry.data.slice(0, 8000) + '\n... (truncated)';
  mainWindow.webContents.send('dev-log', entry);
}

// ─── WebSocket ───

function connect() {
  if (!config.apiKey) return;
  if (ws) disconnect();
  browserId = browserId || randomId();

  try {
    const socket = new WebSocket(config.serverUrl);

    socket.on('open', () => {
      devLog('out', 'auth', { browser_id: browserId, browser_name: config.browserName });
      socket.send(JSON.stringify({
        type: 'auth', api_key: config.apiKey,
        browser_id: browserId, browser_name: config.browserName,
      }));
    });

    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type !== 'ping' && msg.type !== 'pong') {
        if (msg.type === 'cmd') {
          devLog('in', `cmd: ${msg.action}`, { id: msg.id?.slice(0, 8), action: msg.action, params: msg.params && Object.keys(msg.params).length ? msg.params : '(none)' });
        } else {
          devLog('in', msg.type, msg);
        }
      }
      handleServerMessage(msg);
    });

    socket.on('close', () => { wsReady = false; clearInterval(pingInterval); sendStatus(); scheduleReconnect(); });
    socket.on('error', () => {});
    ws = socket;
  } catch { scheduleReconnect(); }
}

function disconnect() {
  stopStream();
  clearTimeout(reconnectTimer); clearInterval(pingInterval);
  reconnectTimer = null; reconnectAttempts = 0; missedPongs = 0;
  if (ws) { ws.removeAllListeners(); try { ws.close(); } catch {} ws = null; }
  wsReady = false; sendStatus();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); },
    Math.min(500 * Math.pow(1.5, reconnectAttempts), 10000) + Math.random() * 500);
}

function sendStatus() { sendToRenderer('ws-status', { connected: wsReady, browserId }); }

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'auth_ok':
      wsReady = true; reconnectAttempts = 0;
      if (msg.browser_id) browserId = msg.browser_id;
      startPingLoop(); sendStatus();
      if (!browsingMode) enterBrowsingMode('https://google.com');
      break;
    case 'ping': missedPongs = 0; try { ws.send(JSON.stringify({ type: 'pong' })); } catch {} break;
    case 'pong': missedPongs = 0; break;
    case 'stream_start': startStream(msg.fps || 2); break;
    case 'stream_stop': stopStream(); break;
    case 'cmd': handleCommand(msg); break;
  }
}

function startPingLoop() {
  clearInterval(pingInterval); missedPongs = 0;
  pingInterval = setInterval(() => {
    missedPongs++;
    if (missedPongs > 2) { clearInterval(pingInterval); if (ws) try { ws.close(); } catch {} return; }
    try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
  }, 15000);
}

// ─── Command Handling ───

async function handleCommand(msg) {
  const { id, action, params } = msg;

  if (!browsingMode) { sendResult(id, false, null, 'Browser not ready'); return; }

  try {
    // Tab management
    if (action === 'list_tabs') {
      sendResult(id, true, { tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.id === activeTabId })) });
      return;
    }
    if (action === 'open_tab') {
      const tabId = createTab(params?.url || 'about:blank', true);
      if (params?.url) await waitForLoad();
      sendResult(id, true, { tab_id: tabId, url: params?.url || 'about:blank' });
      return;
    }
    if (action === 'switch_tab') {
      if (!tabs.find(t => t.id === params?.tab_id)) { sendResult(id, false, null, `Tab ${params?.tab_id} not found`); return; }
      activateTab(params.tab_id);
      sendResult(id, true, { tab_id: params.tab_id });
      return;
    }
    if (action === 'close_tab') {
      closeTab(params?.tab_id || activeTabId);
      sendResult(id, true, { closed: true });
      return;
    }

    // Navigate
    if (action === 'navigate' && params?.url) {
      const view = getActiveView();
      try {
        await view.webContents.loadURL(params.url);
      } catch (navErr) {
        // loadURL rejects on redirects or cert errors that still land on a page — ignore
        if (!navErr.message?.includes('ERR_ABORTED')) {
          sendResult(id, false, null, navErr.message);
          return;
        }
      }
      await injectScripts(view);
      sendResult(id, true, { url: view.webContents.getURL(), title: view.webContents.getTitle() });
      return;
    }

    // Screenshot
    if (action === 'screenshot') {
      const img = await getActiveView().webContents.capturePage();
      sendResult(id, true, { screenshot: 'data:image/png;base64,' + img.toPNG().toString('base64') });
      return;
    }

    // All other actions via injected scripts
    const view = getActiveView();
    await injectScripts(view);
    const result = await view.webContents.executeJavaScript(buildActionJS(action, params), true);
    sendResult(id, result?.ok ?? true, result?.data, result?.error);
  } catch (err) {
    sendResult(id, false, null, err.message || String(err));
  }
}

function buildActionJS(action, params) {
  switch (action) {
    case 'analyze':
      return `(typeof analyzePage === 'function') ? analyzePage(${JSON.stringify(params || {})}) : { ok: false, error: 'Analyzer not loaded' }`;
    case 'scroll':
      return `(() => { const px = ${params?.amount || 500}; window.scrollBy({ top: ${params?.direction === 'up' ? '-px' : 'px'}, behavior: 'smooth' }); return { ok: true, data: { direction: '${params?.direction || 'down'}', amount: px } }; })()`;
    case 'click':
      return `(() => { const el = document.querySelector(${JSON.stringify(params?.selector || '')}); if (!el) return { ok: false, error: 'Element not found' }; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.click(); return { ok: true, data: { clicked: true } }; })()`;
    case 'type':
      return `(async () => { const el = document.querySelector(${JSON.stringify(params?.selector || '')}); if (!el) return { ok: false, error: 'Element not found' }; el.focus(); if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } const text = ${JSON.stringify(params?.text || '')}; for (const ch of text) { if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value += ch; else if (el.isContentEditable) el.textContent += ch; el.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 30 + Math.random() * 70)); } el.dispatchEvent(new Event('change', { bubbles: true })); return { ok: true, data: { typed: true } }; })()`;
    case 'wait':
      return `(async () => { const maxWait = ${params?.timeout || 10000}; const start = Date.now(); while (Date.now() - start < maxWait) { if (document.querySelector(${JSON.stringify(params?.selector || '')})) return { ok: true, data: { found: true } }; await new Promise(r => setTimeout(r, 250)); } return { ok: false, error: 'Timeout' }; })()`;
    case 'press_key':
      return `(() => {
        const target = document.activeElement || document.body;
        const key = ${JSON.stringify(params?.key || 'Enter')};
        const opts = { key, bubbles: true, cancelable: true };
        target.dispatchEvent(new KeyboardEvent('keydown', opts));
        target.dispatchEvent(new KeyboardEvent('keypress', opts));
        target.dispatchEvent(new KeyboardEvent('keyup', opts));
        if (key === 'Enter' && target.form) { target.form.requestSubmit?.() || target.form.submit(); }
        return { ok: true, data: { key } };
      })()`;
    case 'read_page':
      return `({ ok: true, data: { url: location.href, title: document.title, elements: [] } })`;
    default:
      return `({ ok: false, error: 'Unknown action: ${action}' })`;
  }
}

function sendResult(id, ok, data, error) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const msg = { type: 'cmd_result', id, ok, data: data || null, error: error || null };
  const summary = { id: id.slice(0, 8), ok };
  if (error) summary.error = error;
  if (data) {
    if (data.screenshot) summary.screenshot = `${Math.round(data.screenshot.length / 1024)}KB`;
    if (data.url) summary.url = data.url;
    if (data.title) summary.title = data.title;
    if (data.markdown) summary.markdown = data.markdown.slice(0, 500) + (data.markdown.length > 500 ? '...' : '');
    if (data.elements) summary.elements = `${data.elements.length} elements`;
    if (data.tabs) summary.tabs = `${data.tabs.length} tabs`;
    if (data.tab_id) summary.tab_id = data.tab_id;
    if (data.viewport) summary.viewport = data.viewport;
    if (data.scroll) summary.scroll = data.scroll;
  }
  devLog('out', ok ? 'result: ok' : 'result: error', summary);
  ws.send(JSON.stringify(msg));
}

function waitForLoad(timeout = 30000) {
  const view = getActiveView();
  if (!view) return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    view.webContents.once('did-finish-load', finish);
    setTimeout(finish, timeout);
  });
}

// ─── Live Stream ───

let streamInterval = null;
function startStream(fps) {
  stopStream();
  const ms = Math.max(200, Math.round(1000 / fps));
  streamInterval = setInterval(async () => {
    const view = getActiveView();
    if (!ws || ws.readyState !== WebSocket.OPEN || !view) return;
    try {
      const img = await view.webContents.capturePage();
      ws.send(JSON.stringify({ type: 'frame', data: 'data:image/jpeg;base64,' + img.toJPEG(40).toString('base64') }));
    } catch {}
  }, ms);
}
function stopStream() { if (streamInterval) { clearInterval(streamInterval); streamInterval = null; } }

// ─── Utils ───

function randomId() {
  return 'oya-' + Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
