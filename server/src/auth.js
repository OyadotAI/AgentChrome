/**
 * API key validation — supports env-configured keys, user-created keys,
 * and a fleet token for zero-config browser enrollment at scale.
 */

import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYS_PATH = join(__dirname, '..', 'data', 'keys.json');

// Env-configured keys (admin)
const envKeys = new Set(
  (process.env.API_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
);

// Fleet token — a single shared secret that all browsers can use to connect.
// Set FLEET_TOKEN env var to enable. Every browser using this token is accepted.
const fleetToken = (process.env.FLEET_TOKEN || '').trim() || null;

// User-created keys (persisted to disk)
let userKeys = new Set();
try {
  const data = JSON.parse(readFileSync(KEYS_PATH, 'utf8'));
  if (Array.isArray(data)) userKeys = new Set(data);
} catch {}

function saveUserKeys() {
  try {
    mkdirSync(dirname(KEYS_PATH), { recursive: true });
    writeFileSync(KEYS_PATH, JSON.stringify([...userKeys], null, 2));
  } catch {}
}

export function validateApiKey(key) {
  if (envKeys.size === 0 && userKeys.size === 0 && !fleetToken) return true;
  return envKeys.has(key) || userKeys.has(key) || isFleetToken(key);
}

export function registerApiKey(key) {
  userKeys.add(key);
  saveUserKeys();
}

export function isAdminKey(key) {
  return envKeys.has(key);
}

export function isFleetToken(key) {
  return fleetToken !== null && key === fleetToken;
}

/**
 * Generate N API keys and register them. Returns the array of keys.
 */
export function provisionKeys(count) {
  const keys = [];
  for (let i = 0; i < count; i++) {
    const key = randomBytes(24).toString('base64url');
    userKeys.add(key);
    keys.push(key);
  }
  saveUserKeys();
  return keys;
}

/**
 * Express middleware — expects Authorization: Bearer <key>
 */
export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing API key' });
  }
  const key = header.slice(7);
  if (!validateApiKey(key)) {
    return res.status(403).json({ error: 'Invalid API key' });
  }
  next();
}
