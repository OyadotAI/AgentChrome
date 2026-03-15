/**
 * API key validation — supports both env-configured and user-created keys.
 */

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
  if (envKeys.size === 0 && userKeys.size === 0) return true;
  return envKeys.has(key) || userKeys.has(key);
}

export function registerApiKey(key) {
  userKeys.add(key);
  saveUserKeys();
}

export function isAdminKey(key) {
  return envKeys.has(key);
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
