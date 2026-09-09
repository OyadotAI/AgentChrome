/**
 * Browser session registry — tracks connected browsers, scoped by API key.
 * Each key only sees its own browsers.
 */

import { EventEmitter } from 'events';

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
  add(browserId, { ws, apiKey, name, driver = null, clientType = 'oya', provider = null, release = null, persona = null }) {
    this.browsers.set(browserId, {
      ws,
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
    });
    this.emit('browser:connected', { id: browserId, name, clientType, provider });
  }

  remove(browserId) {
    const browser = this.browsers.get(browserId);
    if (browser) {
      // An outbound browser does not disconnect itself; close what we opened
      // and hand the vendor session back so it stops billing.
      try { browser.driver?.close(); } catch {}
      if (browser.release) Promise.resolve(browser.release()).catch(() => {});
      for (const res of browser.streamViewers) {
        try { res.end(); } catch {}
      }
      browser.streamViewers.clear();
      this.browsers.delete(browserId);
      this.emit('browser:disconnected', { id: browserId, name: browser.name });
    }
  }

  get(browserId) {
    return this.browsers.get(browserId);
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
      result.push({
        id,
        name: b.name,
        clientType: b.clientType,
        provider: b.provider,
        persona: b.persona?.id || null,
        connectedAt: b.connectedAt.toISOString(),
        lastSeen: b.lastSeen.toISOString(),
        currentUrl: b.currentUrl,
      });
    }
    return result;
  }
}

export const registry = new ConnectionRegistry();
