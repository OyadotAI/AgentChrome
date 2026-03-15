/**
 * Oya Browser — Electron shell with agent scripts built in.
 * No extension install needed. Scripts are injected into every page.
 */

const { app, BrowserWindow, BrowserView, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

// Docker / sandbox: disable GPU and sandbox if env says so
if (process.env.ELECTRON_DISABLE_SANDBOX === '1' || process.argv.includes('--no-sandbox')) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
}

// Persistent data directory — mount a volume here in Docker to keep cookies across restarts
const dataDir = process.env.OYA_DATA_DIR || (
  process.env.ELECTRON_DISABLE_SANDBOX === '1' ? '/app/data' : null
);
if (dataDir) {
  app.setPath('userData', dataDir);
}

// ─── Config: env vars > CLI args > config file > defaults ───

const CONFIG_DEFAULTS = {
  serverUrl: 'ws://localhost:3100/ws',
  apiKey: '',
  browserName: `Oya Browser ${process.platform}`,
};

let config = { ...CONFIG_DEFAULTS };
let configPath = null;
let headless = false;
let startUrl = 'https://google.com';

function parseArgs() {
  const argv = process.argv.slice(1);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--server-url' && argv[i + 1]) config.serverUrl = argv[++i];
    else if (arg === '--api-key' && argv[i + 1]) config.apiKey = argv[++i];
    else if (arg === '--browser-name' && argv[i + 1]) config.browserName = argv[++i];
    else if (arg === '--browser-id' && argv[i + 1]) browserId = argv[++i];
    else if (arg === '--url' && argv[i + 1]) startUrl = argv[++i];
    else if (arg === '--headless') headless = true;
  }
}

function loadConfig() {
  configPath = path.join(app.getPath('userData'), 'config.json');
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config = { ...CONFIG_DEFAULTS, ...data };
  } catch {}

  // Env vars override config file
  if (process.env.OYA_SERVER_URL) config.serverUrl = process.env.OYA_SERVER_URL;
  if (process.env.OYA_API_KEY) config.apiKey = process.env.OYA_API_KEY;
  if (process.env.OYA_BROWSER_NAME) config.browserName = process.env.OYA_BROWSER_NAME;
  if (process.env.OYA_BROWSER_ID) browserId = process.env.OYA_BROWSER_ID;
  if (process.env.OYA_START_URL) startUrl = process.env.OYA_START_URL;
  if (process.env.OYA_HEADLESS === '1' || process.env.OYA_HEADLESS === 'true') headless = true;

  // CLI args override everything
  parseArgs();
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch {}
}

// ─── Injected Scripts ───

const analyzerScript = fs.readFileSync(path.join(__dirname, 'scripts', 'analyzer.js'), 'utf8');
const agentScript = fs.readFileSync(path.join(__dirname, 'scripts', 'agent.js'), 'utf8');

// ─── Window State ───

let mainWindow = null;
let pageView = null;
let browsingMode = false;
let devPanelOpen = false;
const DEV_PANEL_WIDTH = 380;

// ─── WebSocket State ───

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

  if (headless) {
    // Headless: skip UI, connect immediately, enter browsing mode for commands
    createWindow();
    if (config.apiKey) {
      connect();
      enterBrowsingMode(startUrl);
    } else {
      console.error('[oya] No API key — pass --api-key or set OYA_API_KEY');
      app.quit();
    }
  } else {
    createWindow();
    if (config.apiKey) {
      connect();
    }
  }
});

app.on('window-all-closed', () => {
  disconnect();
  app.quit();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 600,
    minHeight: 400,
    show: !headless,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 12 } : undefined,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('renderer/index.html');
  mainWindow.on('resize', layoutPageView);
}

/**
 * Switch to browsing mode — create the BrowserView and shrink the renderer to a toolbar.
 */
function enterBrowsingMode(url) {
  if (browsingMode) return;
  browsingMode = true;

  pageView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      partition: 'persist:oya-browser',
    },
  });

  mainWindow.setBrowserView(pageView);
  layoutPageView();

  // Inject agent scripts on every navigation
  pageView.webContents.on('did-finish-load', injectScripts);

  // Forward URL/title changes to the toolbar
  const sendUrl = (e, u) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('url-changed', u);
  };
  pageView.webContents.on('did-navigate', sendUrl);
  pageView.webContents.on('did-navigate-in-page', sendUrl);
  pageView.webContents.on('page-title-updated', (e, title) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('title-changed', title);
  });

  pageView.webContents.loadURL(url || 'https://google.com');

  // Tell renderer to switch to toolbar mode
  mainWindow.webContents.send('mode-changed', 'browsing');
}

function layoutPageView() {
  if (!mainWindow || !pageView || !browsingMode) return;
  const bounds = mainWindow.getContentBounds();
  const toolbarHeight = 52;
  const panelW = devPanelOpen ? DEV_PANEL_WIDTH : 0;
  pageView.setBounds({
    x: 0,
    y: toolbarHeight,
    width: bounds.width - panelW,
    height: bounds.height - toolbarHeight,
  });
}

// ─── Script Injection ───

async function injectScripts() {
  if (!pageView) return;
  try {
    await pageView.webContents.executeJavaScript(analyzerScript, true);
    await pageView.webContents.executeJavaScript(agentScript, true);
  } catch {}
}

// ─── IPC from Renderer ───

ipcMain.handle('navigate', (e, url) => {
  if (!browsingMode) enterBrowsingMode(url);
  else {
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    pageView.webContents.loadURL(url);
  }
});

ipcMain.handle('go-back', () => pageView?.webContents.goBack());
ipcMain.handle('go-forward', () => pageView?.webContents.goForward());
ipcMain.handle('reload', () => pageView?.webContents.reload());

ipcMain.handle('get-config', () => config);

ipcMain.handle('save-config', (e, newConfig) => {
  config = { ...config, ...newConfig };
  saveConfig();
  disconnect();
  connect();
  return true;
});

ipcMain.handle('get-status', () => ({
  connected: wsReady,
  browserId,
  url: pageView?.webContents.getURL() || '',
}));

ipcMain.handle('enter-browsing', () => {
  enterBrowsingMode(startUrl);
});

ipcMain.handle('show-overlay', () => {
  if (pageView && browsingMode) {
    mainWindow.removeBrowserView(pageView);
  }
});

ipcMain.handle('hide-overlay', () => {
  if (pageView && browsingMode) {
    mainWindow.setBrowserView(pageView);
    layoutPageView();
  }
});

ipcMain.handle('toggle-dev-panel', () => {
  devPanelOpen = !devPanelOpen;
  layoutPageView();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('dev-panel-state', devPanelOpen);
  }
  return devPanelOpen;
});

/**
 * Send a log entry to the dev panel in the renderer.
 */
function devLog(direction, type, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const entry = {
      ts: Date.now(),
      dir: direction,   // 'in' (from server) or 'out' (to server)
      type,
      data: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    };
    // Truncate large payloads for display
    if (entry.data && entry.data.length > 8000) {
      entry.data = entry.data.slice(0, 8000) + '\n... (truncated)';
    }
    mainWindow.webContents.send('dev-log', entry);
  }
}

// ─── WebSocket Connection ───

function connect() {
  if (!config.apiKey) return;
  if (ws) disconnect();

  browserId = browserId || randomId();

  try {
    const socket = new WebSocket(config.serverUrl);

    socket.on('open', () => {
      const authMsg = {
        type: 'auth',
        api_key: config.apiKey,
        browser_id: browserId,
        browser_name: config.browserName,
      };
      devLog('out', 'auth', { browser_id: browserId, browser_name: config.browserName });
      socket.send(JSON.stringify(authMsg));
    });

    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      // Log to dev panel (skip noisy ping/pong)
      if (msg.type !== 'ping' && msg.type !== 'pong') {
        if (msg.type === 'cmd') {
          const paramStr = msg.params && Object.keys(msg.params).length
            ? msg.params
            : '(no params)';
          devLog('in', `cmd: ${msg.action}`, { id: msg.id?.slice(0, 8), action: msg.action, params: paramStr });
        } else {
          devLog('in', msg.type, msg);
        }
      }
      handleServerMessage(msg);
    });

    socket.on('close', () => {
      wsReady = false;
      clearInterval(pingInterval);
      sendStatus();
      scheduleReconnect();
    });

    socket.on('error', () => {});

    ws = socket;
  } catch {
    scheduleReconnect();
  }
}

function disconnect() {
  stopStream();
  clearTimeout(reconnectTimer);
  clearInterval(pingInterval);
  reconnectTimer = null;
  reconnectAttempts = 0;
  missedPongs = 0;
  if (ws) {
    ws.removeAllListeners();
    try { ws.close(); } catch {}
    ws = null;
  }
  wsReady = false;
  sendStatus();
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(500 * Math.pow(1.5, reconnectAttempts), 10000) + Math.random() * 500;
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function sendStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ws-status', { connected: wsReady, browserId });
  }
}

// ─── Server Message Handling ───

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'auth_ok':
      wsReady = true;
      reconnectAttempts = 0;
      if (msg.browser_id) browserId = msg.browser_id;
      startPingLoop();
      sendStatus();
      // Auto-enter browsing mode on successful connection
      if (!browsingMode) enterBrowsingMode(startUrl);
      break;

    case 'ping':
      missedPongs = 0;
      try { ws.send(JSON.stringify({ type: 'pong' })); } catch {}
      break;

    case 'pong':
      missedPongs = 0;
      break;

    case 'stream_start':
      startStream(msg.fps || 2);
      break;

    case 'stream_stop':
      stopStream();
      break;

    case 'cmd':
      handleCommand(msg);
      break;
  }
}

function startPingLoop() {
  clearInterval(pingInterval);
  missedPongs = 0;
  pingInterval = setInterval(() => {
    missedPongs++;
    if (missedPongs > 2) {
      clearInterval(pingInterval);
      if (ws) { try { ws.close(); } catch {} }
      return;
    }
    try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
  }, 15000);
}

// ─── Command Handling ───

async function handleCommand(msg) {
  const { id, action, params } = msg;

  if (!browsingMode) {
    sendResult(id, false, null, 'Browser not ready');
    return;
  }

  try {
    if (action === 'navigate' && params?.url) {
      pageView.webContents.loadURL(params.url);
      await waitForLoad();
      await injectScripts();
      sendResult(id, true, { url: pageView.webContents.getURL(), title: pageView.webContents.getTitle() });
      return;
    }

    if (action === 'screenshot') {
      const img = await pageView.webContents.capturePage();
      sendResult(id, true, { screenshot: 'data:image/png;base64,' + img.toPNG().toString('base64') });
      return;
    }

    await injectScripts();

    const jsCode = buildActionJS(action, params);
    const result = await pageView.webContents.executeJavaScript(jsCode, true);
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
      return `(() => {
        const px = ${params?.amount || 500};
        window.scrollBy({ top: ${params?.direction === 'up' ? '-px' : 'px'}, behavior: 'smooth' });
        return { ok: true, data: { direction: '${params?.direction || 'down'}', amount: px } };
      })()`;

    case 'click':
      return `(() => {
        const el = document.querySelector(${JSON.stringify(params?.selector || '')});
        if (!el) return { ok: false, error: 'Element not found' };
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.click();
        return { ok: true, data: { clicked: true } };
      })()`;

    case 'type':
      return `(async () => {
        const el = document.querySelector(${JSON.stringify(params?.selector || '')});
        if (!el) return { ok: false, error: 'Element not found' };
        el.focus();
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
        const text = ${JSON.stringify(params?.text || '')};
        for (const ch of text) {
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value += ch;
          else if (el.isContentEditable) el.textContent += ch;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 30 + Math.random() * 70));
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, data: { typed: true } };
      })()`;

    case 'wait':
      return `(async () => {
        const maxWait = ${params?.timeout || 10000};
        const start = Date.now();
        while (Date.now() - start < maxWait) {
          if (document.querySelector(${JSON.stringify(params?.selector || '')})) return { ok: true, data: { found: true } };
          await new Promise(r => setTimeout(r, 250));
        }
        return { ok: false, error: 'Timeout' };
      })()`;

    case 'read_page':
      return `({ ok: true, data: { url: location.href, title: document.title, elements: [] } })`;

    default:
      return `({ ok: false, error: 'Unknown action: ${action}' })`;
  }
}

function sendResult(id, ok, data, error) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const msg = { type: 'cmd_result', id, ok, data: data || null, error: error || null };
    // Build a useful summary for the dev panel
    const summary = { id: id.slice(0, 8), ok };
    if (error) summary.error = error;
    if (data) {
      if (data.screenshot) summary.screenshot = `${Math.round(data.screenshot.length / 1024)}KB`;
      if (data.url) summary.url = data.url;
      if (data.title) summary.title = data.title;
      if (data.markdown) summary.markdown = data.markdown.slice(0, 500) + (data.markdown.length > 500 ? '...' : '');
      if (data.elements) summary.elements = `${data.elements.length} elements`;
      if (data.viewport) summary.viewport = data.viewport;
      if (data.scroll) summary.scroll = data.scroll;
      if (data.direction) summary.direction = data.direction;
      if (data.amount) summary.amount = data.amount;
      if (data.clicked) summary.clicked = true;
      if (data.typed) summary.typed = true;
      if (data.found !== undefined) summary.found = data.found;
    }
    devLog('out', ok ? 'result: ok' : 'result: error', summary);
    ws.send(JSON.stringify(msg));
  }
}

function waitForLoad(timeout = 30000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    pageView.webContents.once('did-finish-load', finish);
    setTimeout(finish, timeout);
  });
}

// ─── Live Stream ───

let streamInterval = null;

function startStream(fps) {
  stopStream();
  const ms = Math.max(200, Math.round(1000 / fps));
  streamInterval = setInterval(async () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !pageView) return;
    try {
      const img = await pageView.webContents.capturePage();
      ws.send(JSON.stringify({ type: 'frame', data: 'data:image/jpeg;base64,' + img.toJPEG(40).toString('base64') }));
    } catch {}
  }, ms);
}

function stopStream() {
  if (streamInterval) { clearInterval(streamInterval); streamInterval = null; }
}

// ─── Utils ───

function randomId() {
  return 'ac-' + Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
