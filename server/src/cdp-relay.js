/**
 * CDP for Oya-client browsers, carried over the socket the browser dialled us on.
 *
 * A cloud sandbox or a desktop behind NAT has no endpoint we can dial, but it
 * already holds a socket to us. The gateway opens a relay on that socket and the
 * browser bridges it to its own CDP front door (cdp-front-door.js), so the
 * debug port never leaves the machine it runs on.
 *
 * A relay quacks like the `ws` socket gateway sessions expect: send, close,
 * readyState, and message/close events.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { WebSocket } from 'ws';

const relays = new Map();

export function openRelay(browser, browserId, timeoutMs = 20_000) {
  const sid = randomUUID();
  const relay = Object.assign(new EventEmitter(), { sid, browserId, readyState: WebSocket.CONNECTING });
  const tell = (msg) => { try { browser.ws.send(JSON.stringify({ ...msg, sid })); return true; } catch { return false; } };
  relay.end = (error) => {
    if (relay.readyState === WebSocket.CLOSED) return;
    relays.delete(sid);
    relay.readyState = WebSocket.CLOSED;
    relay.error = error;
    relay.emit('close');
  };
  relay.send = (data) => { if (!tell({ type: 'cdp', data: data.toString() })) relay.end('Browser disconnected'); };
  relay.close = relay.terminate = () => { if (relay.readyState !== WebSocket.CLOSED) { tell({ type: 'cdp_close' }); relay.end(); } };
  relays.set(sid, relay);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => relay.close(), timeoutMs);
    relay.once('open', () => { clearTimeout(timer); resolve(relay); });
    relay.once('close', () => { clearTimeout(timer); reject(new Error(relay.error || 'Browser did not open CDP')); });
    if (!tell({ type: 'cdp_open' })) relay.end('Browser disconnected');
  });
}

/** A relay message arriving on browserId's control socket. */
export function onBrowserMessage(browserId, msg) {
  const relay = relays.get(msg.sid);
  if (!relay || relay.browserId !== browserId) return;
  if (msg.type === 'cdp') relay.emit('message', Buffer.from(String(msg.data)), false);
  else if (msg.type === 'cdp_opened') { relay.readyState = WebSocket.OPEN; relay.emit('open'); }
  else if (msg.type === 'cdp_closed') relay.end(msg.error);
}

/** The browser's socket went away, so every relay on it did too. */
export function closeRelays(browserId) {
  for (const relay of [...relays.values()]) if (relay.browserId === browserId) relay.end('Browser disconnected');
}
