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
    });
    this.emit('browser:connected', { id: browserId, name });
  }

  remove(browserId) {
    const browser = this.browsers.get(browserId);
    if (browser) {
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
