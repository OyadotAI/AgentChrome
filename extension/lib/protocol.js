/**
 * WebSocket protocol message types and helpers.
 */

// Client → Server
export const MSG_AUTH = 'auth';
export const MSG_PING = 'ping';
export const MSG_CMD_RESULT = 'cmd_result';

// Server → Client
export const MSG_AUTH_OK = 'auth_ok';
export const MSG_PONG = 'pong';
export const MSG_CMD = 'cmd';

/**
 * Create a protocol message.
 */
export function makeMessage(type, payload = {}) {
  return JSON.stringify({ type, ...payload });
}

/**
 * Parse a protocol message. Returns null on failure.
 */
export function parseMessage(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Generate a UUID v4.
 */
export function uuid() {
  return crypto.randomUUID();
}
