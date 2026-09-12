/**
 * Browser session registry — tracks connected browsers, scoped by API key.
 * Each key only sees its own browsers.
 */

import { EventEmitter } from 'events';

/** How many recent commands each browser remembers. Enough to see what it is doing. */
const ACTIVITY_SIZE = 50;

/**
 * Health is derived, never stored: a browser that has not been heard from in
 * 15s is stale, in 60s dead, and one that failed 3 of its last 10 commands
 * is in trouble regardless of heartbeat.
 */
function healthOf(b, now = Date.now()) {
  const recent = b.activity.slice(0, 10);
  const failing = recent.length >= 3 && recent.filter((a) => !a.ok).length >= 3;
  // An outbound (CDP) browser has no heartbeat: we drive it, it does not
  // report in. Its socket being open is the liveness signal.
  if (b.driver) {
    if (typeof b.driver.isAlive === 'function' && !b.driver.isAlive()) return 'dead';
    return failing ? 'errors' : 'ok';
  }
  const silent = now - b.lastSeen.getTime();
  if (silent > 80_000) return 'dead';
  if (silent > 40_000) return 'stale';
  return failing ? 'errors' : 'ok';
}

/**
 * What an activity entry may say about a command. Never the text that was
 * typed — this log is shown to whoever can see the dashboard.
 */
export function summarise(action, params = {}) {
  if (!params || typeof params !== 'object') return '';
  switch (action) {
    case 'navigate': case 'open_tab': return String(params.url || '').slice(0, 200);
    case 'type': case 'keyboard_type': return `${String(params.text || '').length} chars`;
    case 'press_key': return String(params.key || '');
    case 'click_coordinates': case 'mouse_move': case 'double_click': case 'hover':
      return params.x !== undefined ? `${Math.round(params.x)},${Math.round(params.y)}` : String(params.selector || params.element_id || '');
    case 'drag': return `${Math.round(params.from_x)},${Math.round(params.from_y)} → ${Math.round(params.to_x)},${Math.round(params.to_y)}`;
    case 'click': case 'select': case 'wait': return String(params.selector || params.element_id || '');
    case 'scroll': return `${params.direction || 'down'} ${params.amount || ''}`.trim();
    case 'switch_tab': case 'close_tab': return String(params.tab_id || '');
    default: return '';
  }
}

class ConnectionRegistry extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, { ws: WebSocket, apiKey: string, name: string, connectedAt: Date, lastSeen: Date, currentUrl: string, lastFrame: string|null, lastFrameAt: number|null, streamViewers: Set }>} */
    this.browsers = new Map();
  }

  /**
   * @param {object} opts
   * @param {WebSocket} [opts.ws]        inbound client (Oya) — it dialled us
   * @param {object}    [opts.driver]    outbound driver (CDP) — we dialled it
   * @param {string}    [opts.clientType] 'oya' | 'cdp'
   * @param {string}    [opts.provider]  which vendor supplied a hosted browser
   * @param {object}    [opts.persona]   the identity it is running as
   */
  add(browserId, { ws, apiKey, name, driver = null, clientType = 'oya', provider = null, release = null, persona = null, cdp = false }) {
    this.browsers.set(browserId, {
      ws,
      cdp,
      driver,
      clientType,
      provider,
      release,
      persona,
      apiKey: apiKey || '',
      name: name || 'Unknown Browser',
      connectedAt: new Date(),
      lastSeen: new Date(),
      currentUrl: '',
      lastFrame: null,
      lastFrameAt: null,
      streamViewers: new Set(),
      // What this browser has been doing. Bounded; newest first.
      activity: [],
      commands: 0,
      errors: 0,
      pending: 0,
      lastCommandAt: null,
      lastError: null,
    });
    this.emit('browser:connected', { id: browserId, name, clientType, provider });
  }

  remove(browserId) {
    const browser = this.browsers.get(browserId);
    if (browser) {
      // Remove before closing: a synchronous close callback can re-enter.
      this.browsers.delete(browserId);
      // An outbound browser does not disconnect itself; close what we opened
      // and hand the vendor session back so it stops billing.
      try { browser.driver?.close(); } catch {}
      const release = browser.release;
      if (release) Promise.resolve().then(() => release.call(browser)).catch((err) => console.error('[registry] release:', err.message));
      for (const res of browser.streamViewers) {
        try { res.end(); } catch {}
      }
      browser.streamViewers.clear();
      this.emit('browser:disconnected', { id: browserId, name: browser.name });
    }
  }

  get(browserId) {
    return this.browsers.get(browserId);
  }

  /** A command was sent. Paired with recordActivity when it settles. */
  commandStarted(browserId) {
    const b = this.browsers.get(browserId);
    if (b) b.pending++;
  }

  /**
   * A command settled. `summary` is already reduced by summarise() — the log
   * never holds what was typed.
   */
  recordActivity(browserId, { action, summary = '', ok, ms = 0, error = null }) {
    const b = this.browsers.get(browserId);
    if (!b) return;
    b.pending = Math.max(0, b.pending - 1);
    b.commands++;
    if (!ok) { b.errors++; b.lastError = String(error || 'failed').slice(0, 200); }
    b.lastCommandAt = new Date();
    b.lastSeen = b.lastCommandAt;
    b.activity.unshift({ ts: b.lastCommandAt.toISOString(), action, summary, ok: !!ok, ms: Math.round(ms), ...(ok ? {} : { error: b.lastError }) });
    if (b.activity.length > ACTIVITY_SIZE) b.activity.length = ACTIVITY_SIZE;
  }

  /** One browser, shaped for the API, with its activity. */
  describe(browserId) {
    const b = this.browsers.get(browserId);
    if (!b) return null;
    return { ...this.row(browserId, b), activity: b.activity };
  }

  row(id, b) {
    return {
      id,
      name: b.name,
      clientType: b.clientType,
      provider: b.provider,
      persona: b.persona?.id || null,
      personaName: b.persona?.name || null,
      health: healthOf(b),
      connectedAt: b.connectedAt.toISOString(),
      lastSeen: b.lastSeen.toISOString(),
      currentUrl: b.currentUrl,
      commands: b.commands,
      errors: b.errors,
      pending: b.pending,
      lastCommandAt: b.lastCommandAt ? b.lastCommandAt.toISOString() : null,
      lastError: b.lastError,
      streaming: b.streamViewers.size > 0,
    };
  }

  isConnected(browserId) {
    return this.browsers.has(browserId);
  }

  /** Check if a browser belongs to a specific API key */
  belongsTo(browserId, apiKey) {
    const browser = this.browsers.get(browserId);
    return browser ? browser.apiKey === apiKey : false;
  }

  updateLastSeen(browserId) {
    const browser = this.browsers.get(browserId);
    if (browser) browser.lastSeen = new Date();
  }

  updateUrl(browserId, url) {
    const browser = this.browsers.get(browserId);
    if (browser) browser.currentUrl = url;
  }

  pushFrame(browserId, dataUrl) {
    const browser = this.browsers.get(browserId);
    if (!browser) return;
    browser.lastFrame = dataUrl;
    browser.lastFrameAt = Date.now();
    for (const res of browser.streamViewers) {
      if (res.writableLength > 1024 * 1024) continue;
      try { res.write(`data: ${dataUrl}\n\n`); } catch { browser.streamViewers.delete(res); }
    }
  }

  addViewer(browserId, res) {
    const browser = this.browsers.get(browserId);
    if (!browser) return false;
    browser.streamViewers.add(res);
    if (browser.streamViewers.size === 1) this.emit('stream:start', { id: browserId });
    return true;
  }

  removeViewer(browserId, res) {
    const browser = this.browsers.get(browserId);
    if (!browser) return;
    browser.streamViewers.delete(res);
    if (browser.streamViewers.size === 0) this.emit('stream:stop', { id: browserId });
  }

  hasViewers(browserId) {
    const browser = this.browsers.get(browserId);
    return browser ? browser.streamViewers.size > 0 : false;
  }

  /** List browsers visible to a specific API key */
  list(apiKey) {
    const result = [];
    for (const [id, b] of this.browsers) {
      if (apiKey && b.apiKey !== apiKey) continue;
      result.push(this.row(id, b));
    }
    return result;
  }
}

export const registry = new ConnectionRegistry();
