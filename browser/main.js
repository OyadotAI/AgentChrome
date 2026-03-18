/**
 * Oya Browser — Desktop browser with agent scripts built in.
 * Users run this on their machines. Connects to a deployed Oya server.
 * Multi-tab, persistent cookies, real browser — no extension install needed.
 *
 * All user input (click, type, key press, scroll) goes through Chrome DevTools
 * Protocol for full native control. Human-like timing and mouse paths.
 */

const { app, BrowserWindow, BrowserView, ipcMain, session: electronSession, nativeImage } = require('electron');
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

// ─── Chrome DevTools Protocol ───

const CDP_VERSION = '1.3';

function cdpAttach(view) {
  const dbg = view.webContents.debugger;
  if (!dbg.isAttached()) {
    try { dbg.attach(CDP_VERSION); } catch {}
  }
  return dbg;
}

async function cdp(view, method, params = {}) {
  const dbg = cdpAttach(view);
  return dbg.sendCommand(method, params);
}

// ── Key definitions (CDP Input.dispatchKeyEvent format) ──

const KEY_DEFS = {
  'Enter':      { key: 'Enter',      code: 'Enter',      keyCode: 13 },
  'Tab':        { key: 'Tab',        code: 'Tab',        keyCode: 9  },
  'Backspace':  { key: 'Backspace',  code: 'Backspace',  keyCode: 8  },
  'Delete':     { key: 'Delete',     code: 'Delete',     keyCode: 46 },
  'Escape':     { key: 'Escape',     code: 'Escape',     keyCode: 27 },
  'ArrowUp':    { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38 },
  'ArrowDown':  { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40 },
  'ArrowLeft':  { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37 },
  'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  'Home':       { key: 'Home',       code: 'Home',       keyCode: 36 },
  'End':        { key: 'End',        code: 'End',        keyCode: 35 },
  'PageUp':     { key: 'PageUp',     code: 'PageUp',     keyCode: 33 },
  'PageDown':   { key: 'PageDown',   code: 'PageDown',   keyCode: 34 },
  'Space':      { key: ' ',          code: 'Space',      keyCode: 32, text: ' ' },
};

function keyDef(ch) {
  if (KEY_DEFS[ch]) return { ...KEY_DEFS[ch] };
  const upper = ch.toUpperCase();
  const isLetter = /^[a-zA-Z]$/.test(ch);
  const isDigit = /^[0-9]$/.test(ch);
  return {
    key: ch,
    code: isLetter ? 'Key' + upper : isDigit ? 'Digit' + ch : '',
    keyCode: isLetter ? upper.charCodeAt(0) : isDigit ? ch.charCodeAt(0) : 0,
    text: ch,
    shift: ch !== ch.toLowerCase() && ch === upper,
  };
}

// ── Human-like timing ──

function typingDelay(ch, prev) {
  // Base: ~55-130ms per char (roughly 50-100 WPM)
  let ms = 55 + Math.random() * 75;
  if (prev === ' ') ms += 40 + Math.random() * 90;          // word boundary pause
  if (!/[a-zA-Z0-9 ]/.test(ch)) ms += 20 + Math.random() * 50; // special char
  if (Math.random() < 0.04) ms += 120 + Math.random() * 250;   // rare hesitation
  return ms;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── CDP keyboard ──

async function cdpKeyDown(view, def, modifiers = 0) {
  const isChar = !!def.text;
  await cdp(view, 'Input.dispatchKeyEvent', {
    type: isChar ? 'keyDown' : 'rawKeyDown',
    modifiers,
    windowsVirtualKeyCode: def.keyCode,
    nativeVirtualKeyCode: def.keyCode,
    key: def.key, code: def.code,
    text: isChar ? def.text : undefined,
    unmodifiedText: isChar ? def.text : undefined,
  });
}

async function cdpKeyUp(view, def, modifiers = 0) {
  await cdp(view, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers,
    windowsVirtualKeyCode: def.keyCode,
    nativeVirtualKeyCode: def.keyCode,
    key: def.key, code: def.code,
  });
}

async function cdpPressKey(view, key, modifiers = 0) {
  const def = keyDef(key);
  await cdpKeyDown(view, def, modifiers);
  await sleep(20 + Math.random() * 30);
  await cdpKeyUp(view, def, modifiers);
}

async function cdpTypeText(view, text) {
  let prev = '';
  for (const ch of text) {
    const def = keyDef(ch);
    const mods = def.shift ? 8 : 0; // Shift = 8
    await cdpKeyDown(view, def, mods);
    await cdpKeyUp(view, def, mods);
    await sleep(typingDelay(ch, prev));
    prev = ch;
  }
}

async function cdpSelectAll(view) {
  const mod = process.platform === 'darwin' ? 4 : 2; // Meta=4, Ctrl=2
  await cdpPressKey(view, 'a', mod);
}

async function cdpClearField(view) {
  await cdpSelectAll(view);
  await sleep(30 + Math.random() * 40);
  await cdpPressKey(view, 'Backspace');
  await sleep(30 + Math.random() * 40);
}

// ── CDP mouse (human-like Bézier paths) ──

let mouseX = 0, mouseY = 0;

function bezier(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function mousePath(x1, y1, x2, y2) {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(5, Math.min(30, Math.round(dist / 25)));
  // Random control points create a natural arc
  const jitter = dist * 0.3;
  const cp1x = x1 + (x2 - x1) * 0.25 + (Math.random() - 0.5) * jitter;
  const cp1y = y1 + (y2 - y1) * 0.25 + (Math.random() - 0.5) * jitter;
  const cp2x = x1 + (x2 - x1) * 0.75 + (Math.random() - 0.5) * jitter * 0.6;
  const cp2y = y1 + (y2 - y1) * 0.75 + (Math.random() - 0.5) * jitter * 0.6;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Ease-out: move fast at start, decelerate near target (like a real hand)
    const te = 1 - Math.pow(1 - t, 2);
    pts.push({
      x: Math.round(bezier(te, x1, cp1x, cp2x, x2)),
      y: Math.round(bezier(te, y1, cp1y, cp2y, y2)),
    });
  }
  return pts;
}

async function cdpMouseMove(view, toX, toY) {
  const pts = mousePath(mouseX, mouseY, toX, toY);
  for (const pt of pts) {
    await cdp(view, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: pt.x, y: pt.y,
    });
    await sleep(4 + Math.random() * 12);
  }
  mouseX = toX; mouseY = toY;
}

async function cdpClick(view, x, y) {
  const ix = Math.round(x), iy = Math.round(y);
  await cdpMouseMove(view, ix, iy);
  // Hover pause — human acquires target before pressing
  await sleep(40 + Math.random() * 80);
  await cdp(view, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: ix, y: iy,
    button: 'left', clickCount: 1, buttons: 1,
  });
  // Hold — humans don't release instantly
  await sleep(40 + Math.random() * 70);
  await cdp(view, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: ix, y: iy,
    button: 'left', clickCount: 1,
  });
}

async function cdpScroll(view, x, y, deltaX, deltaY) {
  await cdp(view, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel', x, y, deltaX, deltaY,
  });
}

// ── CDP page helpers ──

async function cdpEval(view, expression) {
  const res = await cdp(view, 'Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.text || 'Eval failed');
  return res.result?.value;
}

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

// ─── Cookie Sync ───

const BROWSER_PARTITION = 'persist:oya-browser';
let applyingCookieSync = false;

function getBrowserSession() {
  return electronSession.fromPartition(BROWSER_PARTITION);
}

/** Dump all cookies to the server for pool sync. */
async function dumpCookies() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    const cookies = await getBrowserSession().cookies.get({});
    const slim = cookies.map(c => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite || 'unspecified',
      expirationDate: c.expirationDate,
    }));
    ws.send(JSON.stringify({ type: 'cookie_dump', cookies: slim }));
  } catch (e) {
    console.log('[oya] Cookie dump failed:', e.message);
  }
}

/** Apply a full cookie jar from the server. */
async function applyCookieSync(cookies) {
  if (!Array.isArray(cookies)) return;
  applyingCookieSync = true;
  let applied = 0;
  for (const c of cookies) {
    try {
      const url = `http${c.secure ? 's' : ''}://${c.domain.replace(/^\./, '')}${c.path || '/'}`;
      await getBrowserSession().cookies.set({
        url,
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        secure: c.secure || false,
        httpOnly: c.httpOnly || false,
        sameSite: c.sameSite || 'unspecified',
        expirationDate: c.expirationDate || undefined,
      });
      applied++;
    } catch {}
  }
  applyingCookieSync = false;
  console.log(`[oya] Cookie sync applied: ${applied}/${cookies.length}`);
}

/** Apply an incremental cookie update from the server. */
async function applyCookieUpdate(change) {
  if (!change?.cookie) return;
  const c = change.cookie;
  const url = `http${c.secure ? 's' : ''}://${c.domain.replace(/^\./, '')}${c.path || '/'}`;
  applyingCookieSync = true;
  try {
    if (change.removed) {
      await getBrowserSession().cookies.remove(url, c.name);
    } else {
      await getBrowserSession().cookies.set({
        url,
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        secure: c.secure || false,
        httpOnly: c.httpOnly || false,
        sameSite: c.sameSite || 'unspecified',
        expirationDate: c.expirationDate || undefined,
      });
    }
  } catch {}
  applyingCookieSync = false;
}

/** Start listening for local cookie changes and forward to server. */
function startCookieChangeListener() {
  getBrowserSession().cookies.on('changed', (event, cookie, cause, removed) => {
    if (applyingCookieSync) return;
    if (!ws || ws.readyState !== WebSocket.OPEN || !wsReady) return;
    try {
      ws.send(JSON.stringify({
        type: 'cookie_changed',
        change: {
          removed,
          cookie: {
            name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path,
            secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite || 'unspecified',
            expirationDate: cookie.expirationDate,
          },
        },
      }));
    } catch {}
  });
}

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
  startCookieChangeListener();
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

  // Attach CDP debugger and auto-inject scripts into every new document
  setupTabCDP(view);

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
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500, height: 700,
          webPreferences: { partition: 'persist:oya-browser' },
        },
      };
    }

    createTab(url, true);
    return { action: 'deny' };
  });

  if (url) view.webContents.loadURL(url);
  if (activate) activateTab(id);
  sendTabList();
  return id;
}

function setupTabCDP(view) {
  try {
    cdpAttach(view);
    // Auto-inject analyzer + agent into every new document (navigations, SPAs)
    // The scripts' own guards prevent double-execution.
    view.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: analyzerScript + '\n;\n' + agentScript,
    }).catch(() => {});
    view.webContents.debugger.sendCommand('Page.enable').catch(() => {});
  } catch {}
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

  try { mainWindow.removeBrowserView(tab.view); } catch {}
  tabs.splice(idx, 1);

  // Detach debugger before destroying
  try {
    if (tab.view.webContents.debugger.isAttached()) tab.view.webContents.debugger.detach();
  } catch {}
  try {
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.destroy();
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

// ─── Script Injection (fallback — CDP auto-inject is primary) ───

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
      // Send our cookies to the server for pool sync
      dumpCookies();
      break;
    case 'cookie_sync':
      applyCookieSync(msg.cookies);
      break;
    case 'cookie_update':
      applyCookieUpdate(msg.change);
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

// Shared: find element via injected analyzer, return its center + metadata
const FIND_ELEMENT_JS = (selector) => `(() => {
  const f = window.__acFindElement || window.__acQueryShadow || document.querySelector.bind(document);
  const el = f(${JSON.stringify(selector)});
  if (!el) return { ok: false, error: 'Element not found: ${selector.replace(/'/g, "\\'")}' };
  el.scrollIntoView({ behavior: 'instant', block: 'center' });
  const rect = el.getBoundingClientRect();
  return {
    ok: true,
    data: {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      tag: el.tagName,
      editable: el.isContentEditable,
    },
  };
})()`;

async function handleCommand(msg) {
  const { id, action, params } = msg;

  if (!browsingMode) { sendResult(id, false, null, 'Browser not ready'); return; }

  try {
    // ── Tab management ──

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

    // ── Navigate ──

    if (action === 'navigate' && params?.url) {
      const view = getActiveView();
      const maxRetries = 2;
      let lastErr = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          await view.webContents.loadURL(params.url);
          lastErr = null;
          break;
        } catch (navErr) {
          if (navErr.message?.includes('ERR_ABORTED')) { lastErr = null; break; }
          lastErr = navErr;
          if (attempt < maxRetries) { await sleep(1000); continue; }
        }
      }
      if (lastErr) { sendResult(id, false, null, lastErr.message); return; }
      await injectScripts(view);
      sendResult(id, true, { url: view.webContents.getURL(), title: view.webContents.getTitle() });
      return;
    }

    // ── Screenshot (CDP) ──

    if (action === 'screenshot') {
      const view = getActiveView();
      const result = await cdp(view, 'Page.captureScreenshot', { format: 'png' });
      sendResult(id, true, { screenshot: 'data:image/png;base64,' + result.data });
      return;
    }

    // ── Click (CDP mouse) ──

    if (action === 'click') {
      const view = getActiveView();
      await injectScripts(view);
      const info = await view.webContents.executeJavaScript(FIND_ELEMENT_JS(params?.selector || ''), true);
      if (!info?.ok) { sendResult(id, false, null, info?.error || 'Element not found'); return; }

      await cdpClick(view, info.data.x, info.data.y);

      // Wait for potential navigation
      await sleep(300);
      if (view.webContents.isLoading()) {
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 15000);
          const done = () => { clearTimeout(timeout); resolve(); };
          view.webContents.once('did-finish-load', done);
          view.webContents.once('did-fail-load', done);
        });
      }
      const newUrl = view.webContents.getURL();
      const title = view.webContents.getTitle();
      await injectScripts(view);
      sendResult(id, true, { clicked: true, url: newUrl, title });
      return;
    }

    // ── Type (CDP keyboard — human-like) ──

    if (action === 'type') {
      const view = getActiveView();
      await injectScripts(view);

      // Find element and click on it (natural focus — like a human clicking the field)
      const info = await view.webContents.executeJavaScript(FIND_ELEMENT_JS(params?.selector || ''), true);
      if (!info?.ok) { sendResult(id, false, null, info?.error || 'Element not found'); return; }

      await cdpClick(view, info.data.x, info.data.y);
      await sleep(80 + Math.random() * 60);

      const text = params?.text || '';
      if (!text) { sendResult(id, true, { typed: true }); return; }

      // Clear existing content
      await cdpClearField(view);

      // Type with human cadence
      await cdpTypeText(view, text);

      await sleep(80);
      await view.webContents.executeJavaScript(
        'if (typeof window.__acForcePollState === "function") window.__acForcePollState()', true
      ).catch(() => {});

      sendResult(id, true, { typed: true });
      return;
    }

    // ── Press key (CDP keyboard) ──

    if (action === 'press_key') {
      const view = getActiveView();
      const key = params?.key || 'Enter';
      await cdpPressKey(view, key);

      if (key === 'Enter') {
        await sleep(300);
        if (view.webContents.isLoading()) {
          await new Promise((resolve) => {
            const timeout = setTimeout(resolve, 15000);
            const done = () => { clearTimeout(timeout); resolve(); };
            view.webContents.once('did-finish-load', done);
            view.webContents.once('did-fail-load', done);
          });
          await injectScripts(view);
        }
      }
      sendResult(id, true, { key });
      return;
    }

    // ── Scroll (CDP mouse wheel) ──

    if (action === 'scroll') {
      const view = getActiveView();
      await injectScripts(view);
      const vp = await cdpEval(view, `({ w: window.innerWidth, h: window.innerHeight })`);
      const cx = Math.round((vp?.w || 800) / 2);
      const cy = Math.round((vp?.h || 600) / 2);
      const amount = params?.amount || 500;
      const delta = params?.direction === 'up' ? -amount : amount;

      // Smooth scroll: break into smaller increments
      const steps = Math.max(3, Math.round(Math.abs(delta) / 120));
      const stepDelta = delta / steps;
      for (let i = 0; i < steps; i++) {
        await cdpScroll(view, cx, cy, 0, stepDelta);
        await sleep(30 + Math.random() * 30);
      }
      await sleep(300);

      // Run analyzer after scroll if requested
      const result = await view.webContents.executeJavaScript(
        `(typeof analyzePage === 'function') ? analyzePage(${JSON.stringify(params?.analyze || {})}) : { ok: true, data: { direction: '${params?.direction || 'down'}', amount: ${amount} } }`, true
      );
      sendResult(id, result?.ok ?? true, result?.data, result?.error);
      return;
    }

    // ── Hover (CDP mouse move) ──

    if (action === 'hover') {
      const view = getActiveView();
      await injectScripts(view);
      const info = await view.webContents.executeJavaScript(FIND_ELEMENT_JS(params?.selector || ''), true);
      if (!info?.ok) { sendResult(id, false, null, info?.error || 'Element not found'); return; }
      await cdpMouseMove(view, Math.round(info.data.x), Math.round(info.data.y));
      await sleep(100);
      sendResult(id, true, { hovered: true });
      return;
    }

    // ── Select option (CDP: click select, then click option) ──

    if (action === 'select') {
      const view = getActiveView();
      await injectScripts(view);
      const result = await view.webContents.executeJavaScript(`(() => {
        const f = window.__acFindElement || window.__acQueryShadow || document.querySelector.bind(document);
        const el = f(${JSON.stringify(params?.selector || '')});
        if (!el || el.tagName !== 'SELECT') return { ok: false, error: 'Select element not found' };
        el.value = ${JSON.stringify(params?.value || '')};
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true, data: { selected: el.value } };
      })()`, true);
      sendResult(id, result?.ok ?? true, result?.data, result?.error);
      return;
    }

    // ── All other actions via injected scripts ──

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
    case 'wait':
      return `(async () => { const f = window.__acFindElement || window.__acQueryShadow || document.querySelector.bind(document); const maxWait = ${params?.timeout || 10000}; const start = Date.now(); while (Date.now() - start < maxWait) { if (f(${JSON.stringify(params?.selector || '')})) return { ok: true, data: { found: true } }; await new Promise(r => setTimeout(r, 250)); } return { ok: false, error: 'Timeout' }; })()`;
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
