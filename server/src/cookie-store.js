/**
 * Shared cookie store — holds the canonical cookie jar for a browser pool.
 * When one browser's cookies change, the delta is broadcast to all others.
 */

import { readFileSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COOKIE_PATH = join(__dirname, '..', 'data', 'cookies.json');

/**
 * Cookies keyed by "<domain>|<path>|<name>" for fast dedup/merge.
 * @type {Map<string, object>}
 */
const jar = new Map();

// Load persisted cookies
try {
  const data = JSON.parse(readFileSync(COOKIE_PATH, 'utf8'));
  if (Array.isArray(data)) {
    for (const c of data) jar.set(cookieKey(c), c);
  }
} catch {}

function cookieKey(c) {
  return `${c.domain}|${c.path || '/'}|${c.name}`;
}

let saveQueued = false;

function save() {
  if (saveQueued) return;
  saveQueued = true;
  queueMicrotask(async () => {
    saveQueued = false;
    try {
      mkdirSync(dirname(COOKIE_PATH), { recursive: true });
      await writeFile(COOKIE_PATH, JSON.stringify([...jar.values()], null, 2));
    } catch {}
  });
}

/**
 * Merge a full cookie dump (from a browser that just connected).
 * Returns the current full jar so the caller can sync it to other browsers.
 */
export function mergeDump(cookies) {
  for (const c of cookies) {
    jar.set(cookieKey(c), c);
  }
  save();
  return getAll();
}

/**
 * Apply an incremental cookie change.
 * @param {object} change - { cookie, removed }
 * @returns {object} the change to broadcast
 */
export function applyChange(change) {
  const key = cookieKey(change.cookie);
  if (change.removed) {
    jar.delete(key);
  } else {
    jar.set(key, change.cookie);
  }
  save();
  return change;
}

/**
 * Get all cookies.
 */
export function getAll() {
  return [...jar.values()];
}

/**
 * Clear all cookies.
 */
export function clear() {
  jar.clear();
  save();
}
