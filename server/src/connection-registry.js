/**
 * Browser session registry — tracks connected browsers.
 */

import { EventEmitter } from 'events';

class ConnectionRegistry extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, { ws: WebSocket, name: string, connectedAt: Date, lastSeen: Date, currentUrl: string }>} */
    this.browsers = new Map();
  }

  add(browserId, { ws, name }) {
    this.browsers.set(browserId, {
      ws,
      name: name || 'Unknown Browser',
      connectedAt: new Date(),
      lastSeen: new Date(),
      currentUrl: '',
      lastFrame: null,       // latest JPEG frame (data URL)
      lastFrameAt: null,     // timestamp of last frame
      streamViewers: new Set(), // SSE response objects watching this browser
    });
    this.emit('browser:connected', { id: browserId, name });
  }

  remove(browserId) {
    const browser = this.browsers.get(browserId);
    if (browser) {
      // Close all SSE viewers for this browser
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

  updateLastSeen(browserId) {
    const browser = this.browsers.get(browserId);
    if (browser) browser.lastSeen = new Date();
  }

  updateUrl(browserId, url) {
    const browser = this.browsers.get(browserId);
    if (browser) browser.currentUrl = url;
  }

  /** Store a frame and push to all SSE viewers */
  pushFrame(browserId, dataUrl) {
    const browser = this.browsers.get(browserId);
    if (!browser) return;
    browser.lastFrame = dataUrl;
    browser.lastFrameAt = Date.now();
    for (const res of browser.streamViewers) {
      try {
        res.write(`data: ${dataUrl}\n\n`);
      } catch {
        browser.streamViewers.delete(res);
      }
    }
  }

  /** Add an SSE viewer for a browser's stream */
  addViewer(browserId, res) {
    const browser = this.browsers.get(browserId);
    if (!browser) return false;
    browser.streamViewers.add(res);
    // Start streaming on the extension if this is the first viewer
    if (browser.streamViewers.size === 1) {
      this.emit('stream:start', { id: browserId });
    }
    return true;
  }

  /** Remove an SSE viewer */
  removeViewer(browserId, res) {
    const browser = this.browsers.get(browserId);
    if (!browser) return;
    browser.streamViewers.delete(res);
    // Stop streaming if no viewers left
    if (browser.streamViewers.size === 0) {
      this.emit('stream:stop', { id: browserId });
    }
  }

  hasViewers(browserId) {
    const browser = this.browsers.get(browserId);
    return browser ? browser.streamViewers.size > 0 : false;
  }

  list() {
    const result = [];
    for (const [id, b] of this.browsers) {
      result.push({
        id,
        name: b.name,
        connectedAt: b.connectedAt.toISOString(),
        lastSeen: b.lastSeen.toISOString(),
        currentUrl: b.currentUrl,
      });
    }
    return result;
  }
}

export const registry = new ConnectionRegistry();
