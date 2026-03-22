/**
 * Shared cookie store — holds the canonical cookie jar for a browser pool.
 * When one browser's cookies change, the delta is broadcast to all others.
 *
 * Primary storage: Supabase (oya_browser.cookies)
 * Fallback: local file (data/cookies.json) when Supabase is not configured.
 */

import { readFileSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COOKIE_PATH = join(__dirname, '..', 'data', 'cookies.json');

/**
 * Cookies keyed by "<domain>|<path>|<name>" for fast dedup/merge.
 * @type {Map<string, object>}
 */
const jar = new Map();
let loaded = false;

function cookieKey(c) {
  return `${c.domain}|${c.path || '/'}|${c.name}`;
}

// ── Load on startup ──

async function loadFromDb() {
  if (!db) return false;
  try {
    const { data, error } = await db.from('cookies').select('id, data');
    if (error) throw error;
    for (const row of data) jar.set(row.id, row.data);
    console.log(`[cookies] Loaded ${data.length} cookies from Supabase`);
    return true;
  } catch (e) {
    console.error('[cookies] Failed to load from Supabase:', e.message);
    return false;
  }
}

function loadFromFile() {
  try {
    const data = JSON.parse(readFileSync(COOKIE_PATH, 'utf8'));
    if (Array.isArray(data)) {
      for (const c of data) jar.set(cookieKey(c), c);
    }
    console.log(`[cookies] Loaded ${jar.size} cookies from file`);
  } catch {}
}

// Init: try DB first, fall back to file
loadFromDb().then((ok) => {
  if (!ok) loadFromFile();
  loaded = true;
});

// ── Persistence ──

let saveQueued = false;

function save() {
  if (saveQueued) return;
  saveQueued = true;
  queueMicrotask(async () => {
    saveQueued = false;
    if (db) {
      await saveToDb();
    } else {
      await saveToFile();
    }
  });
}

async function saveToDb() {
  try {
    // Upsert all current cookies
    const rows = [];
    for (const [id, data] of jar) {
      rows.push({ id, data, updated_at: new Date().toISOString() });
    }
    if (rows.length > 0) {
      const { error } = await db.from('cookies').upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    }
    // Delete cookies no longer in jar
    const { data: existing } = await db.from('cookies').select('id');
    if (existing) {
      const toDelete = existing.filter(r => !jar.has(r.id)).map(r => r.id);
      if (toDelete.length > 0) {
        await db.from('cookies').delete().in('id', toDelete);
      }
    }
  } catch (e) {
    console.error('[cookies] Failed to save to Supabase:', e.message);
  }
}

async function saveToFile() {
  try {
    mkdirSync(dirname(COOKIE_PATH), { recursive: true });
    await writeFile(COOKIE_PATH, JSON.stringify([...jar.values()], null, 2));
  } catch {}
}

// ── Public API (unchanged signatures) ──

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
  if (db) {
    db.from('cookies').delete().neq('id', '').then(({ error }) => {
      if (error) console.error('[cookies] Failed to clear in Supabase:', error.message);
    });
  } else {
    save();
  }
}
