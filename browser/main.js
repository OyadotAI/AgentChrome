/**
 * Oya Browser — Desktop browser with agent scripts built in.
 * Users run this on their machines. Connects to a deployed Oya server.
 * Multi-tab, persistent cookies, real browser — no extension install needed.
 *
 * All user input (click, type, key press, scroll) goes through Chrome DevTools
 * Protocol for full native control. Human-like timing and mouse paths.
 */

const { app, BrowserWindow, BrowserView, ipcMain, session: electronSession, nativeImage, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');
const { applyTelemetryFlags, applyDomainBlocking } = require('./anonymity/telemetry');
const { buildStealthScript } = require('./anonymity/stealth');
const { generateProfile, buildFingerprintInjectScript } = require('./anonymity/fingerprint');
const { configureProxy, applyDNSLeakPrevention } = require('./anonymity/proxy');
const { ProfileStore } = require('./anonymity/profile-store');

// Default to light mode
nativeTheme.themeSource = 'light';

// Prevent crashes from unhandled errors
process.on('uncaughtException', (err) => {
  console.error('[oya] Uncaught exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[oya] Unhandled rejection:', reason?.message || reason);
});

// Apply telemetry + DNS leak prevention flags before app is ready
applyTelemetryFlags(app);
applyDNSLeakPrevention(app);

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
  activeProfileId: null,
};

let activeProfile = null;
let profileStore = null;

let config = { ...CONFIG_DEFAULTS };
let configPath = null;

function loadConfig() {
  configPath = path.join(app.getPath('userData'), 'config.json');
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config = { ...CONFIG_DEFAULTS, ...data };
  } catch {}
  // Env vars override file config (for Docker / headless use)
  if (process.env.OYA_SERVER_URL) config.serverUrl = process.env.OYA_SERVER_URL;
  if (process.env.OYA_API_KEY) config.apiKey = process.env.OYA_API_KEY.split(',')[0].trim();
  if (process.env.OYA_BROWSER_NAME) config.browserName = process.env.OYA_BROWSER_NAME;
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
  if (!view || view.webContents.isDestroyed()) return null;
  const dbg = view.webContents.debugger;
  if (!dbg.isAttached()) {
    try { dbg.attach(CDP_VERSION); } catch {}
  }
  return dbg;
}

async function cdp(view, method, params = {}) {
  const dbg = cdpAttach(view);
  if (!dbg) throw new Error('View is destroyed');
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
  let ms = 8 + Math.random() * 18;                          // 8-26ms base (~200-300 WPM)
  if (prev === ' ') ms += 5 + Math.random() * 15;           // small word boundary pause
  if (!/[a-zA-Z0-9 ]/.test(ch)) ms += 5 + Math.random() * 10; // special char
  if (Math.random() < 0.02) ms += 30 + Math.random() * 50;    // 2% micro-hesitation
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
  await sleep(10 + Math.random() * 15);
  await cdpPressKey(view, 'Backspace');
  await sleep(10 + Math.random() * 15);
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
  // Brief hover before click
  await sleep(10 + Math.random() * 20);
  await cdp(view, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: ix, y: iy,
    button: 'left', clickCount: 1, buttons: 1,
  });
  // Brief hold before release
  await sleep(10 + Math.random() * 20);
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
let devPanelWidth = 380;
const TOOLBAR_HEIGHT = 102; // 52px toolbar + 30px tab bar + 20px fingerprint bar

/** @type {{ id: number, view: BrowserView, title: string, url: string }[]} */
const tabs = [];
let activeTabId = null;
let nextTabId = 1;

// ─── Cookie Sync ───

let applyingCookieSync = false;

function getPartitionName() {
  if (activeProfile) return `persist:oya-${activeProfile.id}`;
  return 'persist:oya-browser';
}

function getBrowserSession() {
  return electronSession.fromPartition(getPartitionName());
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
  // Delay resetting the flag so any async 'changed' events fired by the
  // cookie set/remove above are still suppressed.
  setTimeout(() => { applyingCookieSync = false; }, 150);
}

/** Start listening for local cookie changes and forward to server. */
function startCookieChangeListener() {
  getBrowserSession().cookies.on('changed', (event, cookie, cause, removed) => {
    if (applyingCookieSync) return;
    // Only forward explicit changes — ignore overwrite (intermediate removal
    // when a cookie is replaced), expired, and evicted events to prevent
    // feedback loops between browsers in the pool.
    if (cause !== 'explicit') return;
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

// ─── Server Fingerprint ───

/**
 * Apply a fingerprint profile received from the server.
 * The server generates the profile from the API key and sends it on auth_ok.
 * This guarantees every browser with the same API key gets the exact same
 * fingerprint — the server is the single source of truth.
 */
function applyServerFingerprint(profile) {
  if (!profile?.id) return;

  // Persist it so it survives restarts (and loads before reconnect)
  if (profileStore) {
    profileStore.save(profile);
    profileStore.setActiveId(profile.id);
  }

  activeProfile = profile;
  config.activeProfileId = profile.id;
  saveConfig();

  // Re-setup session with the new fingerprint (user-agent, proxy, headers)
  setupBrowserSession();

  // Re-inject into all open tabs so they pick up the new fingerprint
  for (const tab of tabs) {
    if (!tab.view.webContents.isDestroyed()) {
      setupTabCDP(tab.view);
    }
  }

  // Notify renderer so the fingerprint debug bar updates
  sendToRenderer('fingerprint-changed', {
    id: profile.id,
    platform: profile.navigator.platform,
    hardwareConcurrency: profile.navigator.hardwareConcurrency,
    deviceMemory: profile.navigator.deviceMemory,
    screen: `${profile.screen.width}x${profile.screen.height}`,
    dpr: profile.screen.devicePixelRatio,
    gpu: profile.webgl.unmaskedRenderer,
    timezone: profile.timezone,
    locale: profile.locale,
    fonts: profile.fonts.available.length,
    canvasNoise: profile.canvas.noiseSeed.toFixed(6),
    audioNoise: profile.audio.noiseSeed.toFixed(6),
  });
}

// ─── Session Setup ───

/** Configure the persistent browser session — user-agent, cookies, privacy. */
function setupBrowserSession() {
  const ses = getBrowserSession();

  // Telemetry blocking is handled by Chromium flags (applyTelemetryFlags).
  // Domain-level blocking via onBeforeRequest was removed — it interfered
  // with normal page loads and handler stacking on session reuse.

  // ── User-Agent: strip Electron/oya-browser tokens, match profile platform ──
  const defaultUA = ses.getUserAgent();
  let cleanUA = defaultUA
    .replace(/\s*Electron\/[\d.]+/, '')
    .replace(/\s*oya-browser\/[\d.]+/i, '');

  const chromeFullVer = defaultUA.match(/Chrome\/([\d.]+)/)?.[1] || '134.0.0.0';
  const chromeMajor = chromeFullVer.split('.')[0];

  // Rewrite the OS portion of the UA to match the fingerprint profile's platform
  // so the UA and navigator.platform don't contradict each other.
  if (activeProfile?.navigator?.platform) {
    const plat = activeProfile.navigator.platform;
    if (plat === 'Win32') {
      cleanUA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeFullVer} Safari/537.36`;
    } else if (plat === 'MacIntel') {
      cleanUA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeFullVer} Safari/537.36`;
    } else if (plat === 'Linux x86_64') {
      cleanUA = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeFullVer} Safari/537.36`;
    }
  }
  ses.setUserAgent(cleanUA);

  const platformHint = activeProfile?.navigator?.platform === 'Win32' ? 'Windows'
    : activeProfile?.navigator?.platform === 'Linux x86_64' ? 'Linux'
    : activeProfile?.navigator?.platform === 'MacIntel' ? 'macOS'
    : process.platform === 'darwin' ? 'macOS'
    : process.platform === 'win32' ? 'Windows' : 'Linux';

  // ── Sec-CH-UA: rewrite client-hint headers to hide Electron ──
  // Calling onBeforeSendHeaders replaces the previous handler (Electron behavior).
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };

    for (const key of Object.keys(headers)) {
      const lk = key.toLowerCase();
      if (lk === 'sec-ch-ua') {
        headers[key] = `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not:A-Brand";v="24"`;
      } else if (lk === 'sec-ch-ua-full-version-list') {
        headers[key] = `"Chromium";v="${chromeFullVer}", "Google Chrome";v="${chromeFullVer}", "Not:A-Brand";v="24.0.0.0"`;
      } else if (lk === 'sec-ch-ua-platform') {
        headers[key] = `"${platformHint}"`;
      } else if (lk === 'sec-ch-ua-mobile') {
        headers[key] = '?0';
      }
    }

    callback({ requestHeaders: headers });
  });

  // ── Proxy: apply from active profile ──
  if (activeProfile?.proxy?.host) {
    configureProxy(ses, activeProfile.proxy);
  }
}

// ─── App Lifecycle ───

app.whenReady().then(() => {
  loadConfig();

  // Initialize profile store and load active profile
  profileStore = new ProfileStore(app.getPath('userData'));
  const activeId = config.activeProfileId || profileStore.getActiveId();
  if (activeId) {
    activeProfile = profileStore.get(activeId);
  }

  setupBrowserSession();
  createWindow();
  startCookieChangeListener();
  if (config.apiKey || process.env.OYA_AUTO_CONNECT === 'true') connect();
});

app.on('window-all-closed', () => { disconnect(); app.quit(); });

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 860, minWidth: 600, minHeight: 400,
    icon: path.join(__dirname, 'build', process.platform === 'darwin' ? 'icon.icns' : 'icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 12 } : undefined,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  mainWindow.loadFile('renderer/index.html');
  if (process.env.OYA_DOCKER === 'true') mainWindow.maximize();
  mainWindow.on('resize', layoutActiveTab);
}

// ─── Tab Management ───

function createTab(url, activate = true) {
  const id = nextTabId++;
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true, sandbox: true,
      partition: getPartitionName(),
    },
  });

  const tab = { id, view, title: 'New Tab', url: url || '' };
  tabs.push(tab);

  // Attach CDP debugger and auto-inject scripts into every new document
  setupTabCDP(view);

  view.webContents.on('did-finish-load', () => {
    injectScripts(view);
    // Make view-source pages readable (force light theme)
    const currentUrl = view.webContents.getURL();
    if (currentUrl.startsWith('view-source:')) {
      view.webContents.executeJavaScript(`
        document.documentElement.style.cssText = 'background:#fff!important;color:#000!important;color-scheme:light!important';
        document.body.style.cssText = 'background:#fff!important;color:#000!important';
        const s = document.createElement('style');
        s.textContent = '*, *::before, *::after { color-scheme: light !important; } body, html, .line-content, .line-number, td, tr, table { background-color: #fff !important; color: #000 !important; } a { color: #00e !important; }';
        document.head.appendChild(s);
      `, true).catch(() => {});
    }
  });

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
    const isAuthPopup = url.includes('accounts.google.com') ||
      url.includes('github.com/login/oauth') ||
      url.includes('login.microsoftonline.com') ||
      url.includes('appleid.apple.com') ||
      url.includes('x.com') ||
      url.includes('twitter.com') ||
      url.includes('api.twitter.com') ||
      url.includes('arkoselabs.com') ||
      (features && features.includes('popup'));

    if (isAuthPopup) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500, height: 700,
          webPreferences: { partition: getPartitionName() },
        },
      };
    }

    createTab(url, true);
    return { action: 'deny' };
  });

  // Configure child windows created by allowed popups (OAuth, 2FA, etc.)
  view.webContents.on('did-create-window', (childWindow) => {
    childWindow.webContents.on('did-finish-load', () => {
      // Inject stealth scripts into child windows so auth flows work
      const parts = [];
      if (activeProfile) parts.push(buildFingerprintInjectScript(activeProfile));
      parts.push(buildStealthScript());
      if (parts.length) childWindow.webContents.executeJavaScript(parts.join('\n;\n'), true).catch(() => {});
    });
  });

  // Right-click context menu with DevTools, View Source, Inspect
  view.webContents.on('context-menu', (e, params) => {
    const menu = Menu.buildFromTemplate([
      ...(params.linkURL ? [
        { label: 'Open Link in New Tab', click: () => createTab(params.linkURL, true) },
        { type: 'separator' },
      ] : []),
      { label: 'Back', enabled: view.webContents.navigationHistory.canGoBack(), click: () => view.webContents.goBack() },
      { label: 'Forward', enabled: view.webContents.navigationHistory.canGoForward(), click: () => view.webContents.goForward() },
      { label: 'Reload', click: () => view.webContents.reload() },
      { type: 'separator' },
      { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
      { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
      { label: 'Select All', role: 'selectAll' },
      { type: 'separator' },
      { label: 'View Page Source', click: async () => {
        try {
          await injectScripts(view);
          const html = await view.webContents.executeJavaScript('document.documentElement.outerHTML', true);
          let markdown = '';
          try {
            const result = await view.webContents.executeJavaScript(
              '(typeof analyzePage === "function") ? analyzePage({}) : null', true
            );
            if (result?.ok) markdown = result.data.markdown || '';
          } catch {}
          if (!devPanelOpen) {
            devPanelOpen = true;
            layoutActiveTab();
            sendToRenderer('dev-panel-state', devPanelOpen);
          }
          sendToRenderer('view-source', { html, markdown, url: view.webContents.getURL() });
        } catch (e) {
          sendToRenderer('view-source', { html: '', markdown: '', error: e.message });
        }
      }},
      { label: 'Inspect Element', click: async () => {
        try {
          await injectScripts(view);
          const result = await view.webContents.executeJavaScript(`
            (function() {
              const el = document.elementFromPoint(${params.x}, ${params.y});
              if (!el) return { ok: false, error: 'No element at coordinates' };
              // Walk up to find nearest element with data-ac-id, or use the element itself
              let target = el;
              while (target && !target.getAttribute('data-ac-id') && target !== document.body) {
                target = target.parentElement;
              }
              // Run analyzePage scoped to this element's parent section
              if (typeof analyzePage === 'function') {
                // Find a reasonable scope — the element's closest section/article/main or its parent
                let scope = el.closest('section, article, main, [role="main"], [role="dialog"], form, nav, aside') || el.parentElement || el;
                // Generate a unique temporary selector
                const tmpId = '__oya_inspect_' + Date.now();
                scope.setAttribute('data-oya-inspect', tmpId);
                const result = analyzePage({ selector: '[data-oya-inspect="' + tmpId + '"]', highlight: true });
                scope.removeAttribute('data-oya-inspect');
                return result;
              }
              return { ok: false, error: 'Analyzer not loaded' };
            })()
          `, true);
          // Open dev panel and show result in source pane
          if (!devPanelOpen) {
            devPanelOpen = true;
            layoutActiveTab();
            sendToRenderer('dev-panel-state', devPanelOpen);
          }
          sendToRenderer('inspect-result', result);
        } catch (e) {
          sendToRenderer('inspect-result', { ok: false, error: e.message });
        }
      }},
      { label: 'Open DevTools', click: () => view.webContents.openDevTools({ mode: 'detach' }) },
    ]);
    menu.popup({ window: mainWindow });
  });

  if (url) view.webContents.loadURL(url);
  if (activate) activateTab(id);
  sendTabList();
  return id;
}

function setupTabCDP(view) {
  try {
    cdpAttach(view);

    // Build injection chain: fingerprint → stealth → analyzer → agent
    const parts = [];

    // Fingerprint spoofing (if profile active)
    if (activeProfile) {
      parts.push(buildFingerprintInjectScript(activeProfile));
    }

    // Anti-detection stealth (always)
    parts.push(buildStealthScript());

    // Core scripts
    parts.push(analyzerScript);
    parts.push(agentScript);

    view.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: parts.join('\n;\n'),
    }).catch(() => {});
    view.webContents.debugger.sendCommand('Page.enable').catch(() => {});

    // Apply timezone/locale override via CDP if profile has them
    if (activeProfile?.timezone) {
      cdp(view, 'Emulation.setTimezoneOverride', { timezoneId: activeProfile.timezone }).catch(() => {});
    }
    if (activeProfile?.locale) {
      cdp(view, 'Emulation.setLocaleOverride', { locale: activeProfile.locale }).catch(() => {});
    }
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
  const panelW = devPanelOpen ? devPanelWidth : 0;
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

ipcMain.handle('resize-dev-panel', (e, width) => {
  devPanelWidth = Math.max(250, Math.min(width, 1200));
  layoutActiveTab();
  return devPanelWidth;
});

// ─── Profile Management IPC ───

ipcMain.handle('list-profiles', () => {
  return profileStore ? profileStore.list() : [];
});

ipcMain.handle('create-profile', (e, options) => {
  if (!profileStore) return null;
  const profile = generateProfile(options || {});
  profileStore.save(profile);
  return { id: profile.id, platform: profile.navigator.platform, timezone: profile.timezone };
});

ipcMain.handle('activate-profile', async (e, profileId) => {
  if (!profileStore) return false;
  const profile = profileStore.get(profileId);
  if (!profile) return false;

  // Close all tabs before switching
  while (tabs.length > 0) closeTab(tabs[0].id);

  activeProfile = profile;
  config.activeProfileId = profileId;
  profileStore.setActiveId(profileId);
  saveConfig();

  // Re-setup session with new profile (proxy, headers, etc.)
  setupBrowserSession();

  // Open a fresh tab
  enterBrowsingMode('https://google.com');
  return true;
});

ipcMain.handle('deactivate-profile', async () => {
  while (tabs.length > 0) closeTab(tabs[0].id);

  activeProfile = null;
  config.activeProfileId = null;
  if (profileStore) profileStore.clearActive();
  saveConfig();

  setupBrowserSession();
  enterBrowsingMode('https://google.com');
  return true;
});

ipcMain.handle('delete-profile', (e, profileId) => {
  if (!profileStore) return false;
  if (activeProfile?.id === profileId) {
    activeProfile = null;
    config.activeProfileId = null;
    profileStore.clearActive();
    saveConfig();
  }
  return profileStore.delete(profileId);
});

ipcMain.handle('get-active-profile', () => {
  if (!activeProfile) return null;
  return {
    id: activeProfile.id,
    platform: activeProfile.navigator.platform,
    timezone: activeProfile.timezone,
    hasProxy: !!activeProfile.proxy?.host,
  };
});

ipcMain.handle('get-fingerprint', () => {
  if (!activeProfile) return null;
  return {
    id: activeProfile.id,
    platform: activeProfile.navigator.platform,
    hardwareConcurrency: activeProfile.navigator.hardwareConcurrency,
    deviceMemory: activeProfile.navigator.deviceMemory,
    screen: `${activeProfile.screen.width}x${activeProfile.screen.height}`,
    dpr: activeProfile.screen.devicePixelRatio,
    gpu: activeProfile.webgl.unmaskedRenderer,
    timezone: activeProfile.timezone,
    locale: activeProfile.locale,
    fonts: activeProfile.fonts.available.length,
    canvasNoise: activeProfile.canvas.noiseSeed.toFixed(6),
    audioNoise: activeProfile.audio.noiseSeed.toFixed(6),
  };
});

// ─── Dev Panel: Chat, Source & Quick Actions ───

ipcMain.handle('send-chat', async (e, messages) => {
  if (!wsReady || !browserId) return { error: 'Not connected to server' };
  // Derive HTTP base URL from WebSocket URL
  const wsUrl = config.serverUrl || '';
  let httpBase = wsUrl.replace(/^wss/, 'https').replace(/^ws/, 'http').replace(/\/ws\/?$/, '');
  try {
    const res = await fetch(`${httpBase}/api/browsers/${browserId}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ messages }),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { error: `Server returned ${res.status}: ${text.slice(0, 200)}` };
    }
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('get-page-source', async () => {
  const view = getActiveView();
  if (!view) return { html: '', markdown: '', url: '' };
  try {
    const html = await view.webContents.executeJavaScript('document.documentElement.outerHTML', true);
    let markdown = '';
    try {
      const result = await view.webContents.executeJavaScript(
        '(typeof analyzePage === "function") ? analyzePage({}) : null', true
      );
      if (result?.ok) markdown = result.data.markdown || '';
    } catch {}
    return { html, markdown, url: view.webContents.getURL() };
  } catch (e) {
    return { html: '', markdown: '', url: '', error: e.message };
  }
});

ipcMain.handle('dev-action', async (e, action, params) => {
  const view = getActiveView();
  if (!view && action !== 'list-tabs') return { ok: false, error: 'No active tab' };
  try {
    switch (action) {
      case 'analyze': {
        await injectScripts(view);
        return await view.webContents.executeJavaScript(
          '(typeof analyzePage === "function") ? analyzePage({}) : { ok: false, error: "Analyzer not loaded" }', true
        );
      }
      case 'screenshot': {
        const r = await cdp(view, 'Page.captureScreenshot', { format: 'png' });
        return { ok: true, data: { screenshot: 'data:image/png;base64,' + r.data } };
      }
      case 'scroll-down': {
        const vp = await cdpEval(view, '({ w: window.innerWidth, h: window.innerHeight })');
        await cdpScroll(view, (vp?.w || 800) / 2, (vp?.h || 600) / 2, 0, params?.amount || 400);
        return { ok: true };
      }
      case 'scroll-up': {
        const vp2 = await cdpEval(view, '({ w: window.innerWidth, h: window.innerHeight })');
        await cdpScroll(view, (vp2?.w || 800) / 2, (vp2?.h || 600) / 2, 0, -(params?.amount || 400));
        return { ok: true };
      }
      case 'reload': {
        view.webContents.reload();
        return { ok: true };
      }
      case 'navigate': {
        if (!params?.url) return { ok: false, error: 'URL required' };
        let url = params.url;
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        await view.webContents.loadURL(url);
        await injectScripts(view);
        return { ok: true, data: { url: view.webContents.getURL(), title: view.webContents.getTitle() } };
      }
      case 'click': {
        if (!params?.element_id) return { ok: false, error: 'element_id required' };
        await injectScripts(view);
        const selector = `[data-ac-id="${params.element_id}"]`;
        const info = await view.webContents.executeJavaScript(FIND_ELEMENT_JS(selector), true);
        if (!info?.ok) return { ok: false, error: info?.error || 'Element not found' };
        await cdpClick(view, info.data.x, info.data.y);
        await sleep(300);
        return { ok: true, data: { clicked: true, url: view.webContents.getURL() } };
      }
      case 'type': {
        if (!params?.element_id || !params?.text) return { ok: false, error: 'element_id and text required' };
        await injectScripts(view);
        const sel = `[data-ac-id="${params.element_id}"]`;
        const inf = await view.webContents.executeJavaScript(FIND_ELEMENT_JS(sel), true);
        if (!inf?.ok) return { ok: false, error: inf?.error || 'Element not found' };
        await cdpClick(view, inf.data.x, inf.data.y);
        await sleep(20);
        await cdpClearField(view);
        await cdpTypeText(view, params.text);
        return { ok: true, data: { typed: true } };
      }
      case 'press-key': {
        if (!params?.key) return { ok: false, error: 'key required' };
        await cdpPressKey(view, params.key);
        return { ok: true, data: { key: params.key } };
      }
      case 'hover': {
        if (!params?.element_id) return { ok: false, error: 'element_id required' };
        await injectScripts(view);
        const hSel = `[data-ac-id="${params.element_id}"]`;
        const hInfo = await view.webContents.executeJavaScript(FIND_ELEMENT_JS(hSel), true);
        if (!hInfo?.ok) return { ok: false, error: hInfo?.error || 'Element not found' };
        await cdpMouseMove(view, Math.round(hInfo.data.x), Math.round(hInfo.data.y));
        return { ok: true, data: { hovered: true } };
      }
      case 'click-coords': {
        if (params?.x == null || params?.y == null) return { ok: false, error: 'x and y required' };
        await cdpClick(view, params.x, params.y);
        return { ok: true, data: { clicked: true, x: params.x, y: params.y } };
      }
      case 'wait': {
        if (!params?.selector) return { ok: false, error: 'selector required' };
        await injectScripts(view);
        const wResult = await view.webContents.executeJavaScript(
          `(async () => { const maxWait = ${params?.timeout || 10000}; const start = Date.now(); while (Date.now() - start < maxWait) { if (document.querySelector(${JSON.stringify(params.selector)})) return { ok: true, data: { found: true } }; await new Promise(r => setTimeout(r, 250)); } return { ok: false, error: 'Timeout' }; })()`, true
        );
        return wResult;
      }
      case 'list-tabs': {
        return { ok: true, data: { tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, active: t.id === activeTabId })) } };
      }
      case 'new-tab': {
        const tabId = createTab(params?.url || 'about:blank', true);
        return { ok: true, data: { tab_id: tabId } };
      }
      case 'close-tab': {
        closeTab(params?.tab_id || activeTabId);
        return { ok: true, data: { closed: true } };
      }
      case 'select': {
        if (!params?.element_id || !params?.value) return { ok: false, error: 'element_id and value required' };
        await injectScripts(view);
        const sResult = await view.webContents.executeJavaScript(`(() => {
          const el = document.querySelector('[data-ac-id="${params.element_id}"]');
          if (!el || el.tagName !== 'SELECT') return { ok: false, error: 'Select element not found' };
          el.value = ${JSON.stringify(params.value)};
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, data: { selected: el.value } };
        })()`, true);
        return sResult;
      }
      default:
        return { ok: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
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
  if (!config.apiKey && process.env.OYA_AUTO_CONNECT !== 'true') return;
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

    socket.on('close', (code) => {
      wsReady = false;
      clearInterval(pingInterval);
      sendStatus();
      // Don't reconnect on fatal/intentional close codes
      if (code === 4000) {
        console.log('[oya] Connection replaced by new session — not reconnecting');
        return;
      }
      if (code === 4001 || code === 4003) {
        console.log('[oya] Auth failure — not reconnecting');
        return;
      }
      scheduleReconnect();
    });
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
      // Apply fingerprint from the server — the server is the single source of truth.
      // Same API key = same fingerprint on every browser, guaranteed.
      if (msg.fingerprint) applyServerFingerprint(msg.fingerprint);
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
    if (missedPongs > 4) { clearInterval(pingInterval); if (ws) try { ws.close(); } catch {} return; }
    try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
  }, 20000);
}

// ─── Command Handling ───

// Shared: find element via injected analyzer, return its center + metadata
const FIND_ELEMENT_JS = (selector) => `(() => {
  window.__oyaInternalCall = true;
  try {
  const f = window.__acFindElement || ((s) => document.querySelector(s));
  const el = f(${JSON.stringify(selector)});
  if (!el) return { ok: false, error: 'Element not found: ${selector.replace(/'/g, "\\'")}' };
  el.scrollIntoView({ behavior: 'instant', block: 'center' });
  // Check if element is behind a sticky header and adjust scroll
  let rect = el.getBoundingClientRect();
  if (rect.top < 80) {
    // Likely behind a sticky nav (LinkedIn, Reddit, HN all have sticky headers ~52-80px)
    window.scrollBy(0, rect.top - 100);
    rect = el.getBoundingClientRect();
  }
  let offsetX = 0, offsetY = 0;
  // If element is inside an iframe, offset by the iframe's position in the parent page
  const ownerDoc = el.ownerDocument;
  if (ownerDoc !== document) {
    for (const iframe of document.querySelectorAll('iframe')) {
      try { if (iframe.contentDocument === ownerDoc) {
        const iframeRect = iframe.getBoundingClientRect();
        offsetX = iframeRect.x;
        offsetY = iframeRect.y;
        break;
      }} catch {}
    }
  }
  return {
    ok: true,
    data: {
      x: rect.x + rect.width / 2 + offsetX,
      y: rect.y + rect.height / 2 + offsetY,
      tag: el.tagName,
      editable: el.isContentEditable,
      inIframe: ownerDoc !== document,
    },
  };
  } finally { window.__oyaInternalCall = false; }
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

    // All remaining actions need an active tab
    const view = getActiveView();
    if (!view || view.webContents.isDestroyed()) {
      sendResult(id, false, null, 'No active tab');
      return;
    }

    // ── Navigate ──

    if (action === 'navigate' && params?.url) {
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

      // For iframe elements, also dispatch full pointer/mouse event sequence — CDP
      // mouse events may not trigger framework handlers (jsaction, etc.) in iframes.
      if (info.data.inIframe) {
        await view.webContents.executeJavaScript(`(() => {
          const f = window.__acFindElement || ((s) => document.querySelector(s));
          const el = f(${JSON.stringify(params?.selector || '')});
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const x = rect.x + rect.width / 2;
          const y = rect.y + rect.height / 2;
          const w = el.ownerDocument.defaultView;
          const opts = { bubbles: true, cancelable: true, view: w, clientX: x, clientY: y, screenX: x, screenY: y };
          el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse' }));
          el.dispatchEvent(new MouseEvent('mousedown', { ...opts, button: 0, buttons: 1 }));
          el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, pointerType: 'mouse' }));
          el.dispatchEvent(new MouseEvent('mouseup', { ...opts, button: 0 }));
          el.dispatchEvent(new MouseEvent('click', { ...opts, button: 0 }));
        })()`, true).catch(() => {});
      }

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
      await sleep(20 + Math.random() * 30);

      const text = params?.text || '';
      if (!text) { sendResult(id, true, { typed: true }); return; }

      if (info.data.inIframe) {
        // CDP keyboard events don't route to iframe frames — use JS clear + Electron insertText
        await view.webContents.executeJavaScript(`(() => {
          const f = window.__acFindElement || ((s) => document.querySelector(s));
          const el = f(${JSON.stringify(params?.selector || '')});
          if (!el) return;
          el.focus();
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { el.value = ''; }
          else if (el.isContentEditable) { el.textContent = ''; }
          el.dispatchEvent(new Event('input', { bubbles: true }));
        })()`, true).catch(() => {});
        await sleep(15);

        // Type character by character using insertText (routes to focused iframe element)
        let prev = '';
        for (const ch of text) {
          await view.webContents.insertText(ch);
          await sleep(typingDelay(ch, prev));
          prev = ch;
        }
      } else {
        // Clear existing content — use JS to target the specific element
        // instead of CDP Cmd+A which can select the entire page
        const cleared = await view.webContents.executeJavaScript(`(() => {
          const f = window.__acFindElement || ((s) => document.querySelector(s));
          const el = f(${JSON.stringify(params?.selector || '')});
          if (!el) return false;
          el.focus();
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.select();
            return 'select';
          } else if (el.isContentEditable) {
            const sel = window.getSelection();
            sel.selectAllChildren(el);
            return 'select';
          }
          return false;
        })()`, true).catch(() => false);

        if (cleared === 'select') {
          await sleep(10 + Math.random() * 15);
          await cdpPressKey(view, 'Backspace');
          await sleep(10 + Math.random() * 15);
        }

        // Type with human cadence
        await cdpTypeText(view, text);
      }

      // Wait for autocomplete/suggestions to appear
      await sleep(800);
      await view.webContents.executeJavaScript(
        'if (typeof window.__acForcePollState === "function") window.__acForcePollState()', true
      ).catch(() => {});

      // Check if suggestions/autocomplete appeared
      await injectScripts(view);
      const hasDropdown = await view.webContents.executeJavaScript(`(() => {
        const lists = document.querySelectorAll('[role="listbox"], [role="menu"], [role="list"], .pac-container, [class*="suggest"], [class*="autocomplete"], [class*="dropdown"], [id*="suggest"], [id*="autocomplete"], ul[class*="result"]');
        for (const l of lists) {
          const r = l.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return true;
        }
        return false;
      })()`, true).catch(() => false);

      sendResult(id, true, { typed: true, suggestions_visible: hasDropdown });
      return;
    }

    // ── Press key (CDP keyboard) ──

    if (action === 'press_key') {
      const view = getActiveView();
      const key = params?.key || 'Enter';
      // Block dangerous keys that zoom, open emoji picker, or trigger OS shortcuts
      const BLOCKED_KEYS = new Set([
        'F11', 'F12', 'F5',
        'Meta', 'Control', 'Alt', 'Shift',  // bare modifier keys
        'ZoomIn', 'ZoomOut', 'BrowserBack', 'BrowserForward',
        'MediaPlayPause', 'MediaTrackNext', 'MediaTrackPrevious',
        'AudioVolumeUp', 'AudioVolumeDown', 'AudioVolumeMute',
      ]);
      if (BLOCKED_KEYS.has(key)) {
        sendResult(id, false, null, `Key "${key}" is blocked — it can change browser state`);
        return;
      }
      // Use sendInputEvent (routes to focused frame) instead of CDP (main frame only)
      const def = keyDef(key);
      view.webContents.sendInputEvent({ type: 'keyDown', keyCode: def.key });
      await sleep(20 + Math.random() * 30);
      view.webContents.sendInputEvent({ type: 'keyUp', keyCode: def.key });

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

    // ── Click at coordinates (CDP mouse) ──

    if (action === 'click_coordinates') {
      const view = getActiveView();
      const x = params?.x ?? 0;
      const y = params?.y ?? 0;
      await cdpClick(view, x, y);
      await sleep(100);
      const newUrl = view.webContents.getURL();
      const title = view.webContents.getTitle();
      sendResult(id, true, { clicked: true, x, y, url: newUrl, title });
      return;
    }

    // ── Mouse move (CDP mouse) ──

    if (action === 'mouse_move') {
      const view = getActiveView();
      const x = params?.x ?? 0;
      const y = params?.y ?? 0;
      await cdpMouseMove(view, x, y);
      sendResult(id, true, { moved: true, x, y });
      return;
    }

    // ── Double click at coordinates (CDP mouse) ──

    if (action === 'double_click') {
      const view = getActiveView();
      let x, y;
      if (params?.x !== undefined && params?.y !== undefined) {
        x = params.x;
        y = params.y;
      } else if (params?.selector) {
        await injectScripts(view);
        const info = await view.webContents.executeJavaScript(FIND_ELEMENT_JS(params.selector), true);
        if (!info?.ok) { sendResult(id, false, null, info?.error || 'Element not found'); return; }
        x = info.data.x;
        y = info.data.y;
      } else {
        sendResult(id, false, null, 'Provide x,y coordinates or element_id'); return;
      }
      await cdpMouseMove(view, x, y);
      await sleep(10 + Math.random() * 15);
      await cdp(view, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await cdp(view, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await sleep(60 + Math.random() * 40);
      await cdp(view, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 2 });
      await cdp(view, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 2 });
      await sleep(100);
      sendResult(id, true, { double_clicked: true, x, y });
      return;
    }

    // ── Keyboard type raw text (CDP keyboard, no element focus) ──

    if (action === 'keyboard_type') {
      const view = getActiveView();
      const text = params?.text || '';
      if (!text) { sendResult(id, true, { typed: true }); return; }
      await cdpTypeText(view, text);
      sendResult(id, true, { typed: true, text });
      return;
    }

    // ── Drag (CDP mouse) ──

    if (action === 'drag') {
      const view = getActiveView();
      const fromX = params?.from_x ?? 0;
      const fromY = params?.from_y ?? 0;
      const toX = params?.to_x ?? 0;
      const toY = params?.to_y ?? 0;
      await cdpMouseMove(view, fromX, fromY);
      await sleep(10 + Math.random() * 15);
      await cdp(view, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y: fromY, button: 'left', buttons: 1 });
      await sleep(30);
      // Move along path
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = Math.round(fromX + (toX - fromX) * t);
        const y = Math.round(fromY + (toY - fromY) * t);
        await cdp(view, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
        await sleep(10);
      }
      await cdp(view, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: toY, button: 'left' });
      sendResult(id, true, { dragged: true, from: { x: fromX, y: fromY }, to: { x: toX, y: toY } });
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
        const f = window.__acFindElement || ((s) => document.querySelector(s));
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

    // ── Profile management ──

    if (action === 'list_profiles') {
      const profiles = profileStore ? profileStore.list() : [];
      const active = activeProfile ? { id: activeProfile.id, platform: activeProfile.navigator.platform } : null;
      sendResult(id, true, { profiles, active });
      return;
    }

    if (action === 'create_profile') {
      if (!profileStore) { sendResult(id, false, null, 'Profile store not initialized'); return; }
      const profile = generateProfile(params || {});
      profileStore.save(profile);
      sendResult(id, true, { id: profile.id, platform: profile.navigator.platform, timezone: profile.timezone });
      return;
    }

    if (action === 'set_profile') {
      if (!profileStore) { sendResult(id, false, null, 'Profile store not initialized'); return; }
      const profileId = params?.profile_id;
      if (!profileId) { sendResult(id, false, null, 'profile_id required'); return; }
      const profile = profileStore.get(profileId);
      if (!profile) { sendResult(id, false, null, `Profile ${profileId} not found`); return; }

      // Close all tabs, switch profile, re-setup
      while (tabs.length > 0) closeTab(tabs[0].id);
      activeProfile = profile;
      config.activeProfileId = profileId;
      profileStore.setActiveId(profileId);
      saveConfig();
      setupBrowserSession();
      enterBrowsingMode('https://google.com');
      sendResult(id, true, { activated: profileId, platform: profile.navigator.platform });
      return;
    }

    // ── All other actions via injected scripts ──

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
      return `(async () => { const f = window.__acFindElement || ((s) => document.querySelector(s)); const maxWait = ${params?.timeout || 10000}; const start = Date.now(); while (Date.now() - start < maxWait) { if (f(${JSON.stringify(params?.selector || '')})) return { ok: true, data: { found: true } }; await new Promise(r => setTimeout(r, 250)); } return { ok: false, error: 'Timeout' }; })()`;
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
