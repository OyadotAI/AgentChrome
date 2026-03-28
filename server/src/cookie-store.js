/**
 * Shared cookie store — holds the canonical cookie jar for a browser pool.
 * When one browser's cookies change, the delta is broadcast to all others.
 *
 * Primary storage: Supabase (oya_browser.cookies)
 * Fallback: local file (data/cookies.json) when Supabase is not configured.
 *
 * DB writes are incremental (single-row upsert/delete per change) and
 * debounced for bulk operations like mergeDump.
 */

import { readFileSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
// DB disabled for cookies — volume too high for Supabase
const db = null;

const __dirname = dirname(fileURLToPath(import.meta.url));
const COOKIE_PATH = join(__dirname, '..', 'data', 'cookies.json');

/**
 * Cookies keyed by "<domain>|<path>|<name>" for fast dedup/merge.
 * @type {Map<string, object>}
 */
const jar = new Map();

function cookieKey(c) {
  return `${c.domain}|${c.path || '/'}|${c.name}`;
}

// ── Pending DB writes (batched) ──
const pendingUpserts = new Map();   // id → data
const pendingDeletes = new Set();   // ids to delete
let flushTimer = null;
const FLUSH_DELAY = 2000; // 2s debounce

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush().catch((e) => console.error('[cookies] flush error:', e.message));
  }, FLUSH_DELAY);
}

async function flush() {
  if (db) {
    await flushToDb();
  } else {
    await flushToFile();
  }
}

async function flushToDb() {
  // Grab and clear pending work
  const upserts = [...pendingUpserts.entries()];
  const deletes = [...pendingDeletes];
  pendingUpserts.clear();
  pendingDeletes.clear();

  try {
    if (upserts.length > 0) {
      // Batch in chunks of 500 to stay within Supabase limits
      for (let i = 0; i < upserts.length; i += 500) {
        const chunk = upserts.slice(i, i + 500).map(([id, data]) => ({
          id, data, updated_at: new Date().toISOString(),
        }));
        const { error } = await db.from('cookies').upsert(chunk, { onConflict: 'id' });
        if (error) console.error('[cookies] upsert error:', error.message);
      }
    }
    if (deletes.length > 0) {
      for (let i = 0; i < deletes.length; i += 500) {
        const chunk = deletes.slice(i, i + 500);
        const { error } = await db.from('cookies').delete().in('id', chunk);
        if (error) console.error('[cookies] delete error:', error.message);
      }
    }
  } catch (e) {
    console.error('[cookies] flush error:', e.message);
  }
}

async function flushToFile() {
  pendingUpserts.clear();
  pendingDeletes.clear();
  try {
    mkdirSync(dirname(COOKIE_PATH), { recursive: true });
    await writeFile(COOKIE_PATH, JSON.stringify([...jar.values()], null, 2));
  } catch {}
}

// ── Queue a single cookie change ──

function queueUpsert(id, data) {
  pendingDeletes.delete(id);
  pendingUpserts.set(id, data);
  scheduleFlush();
}

function queueDelete(id) {
  pendingUpserts.delete(id);
  pendingDeletes.add(id);
  scheduleFlush();
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

loadFromDb().then((ok) => {
  if (!ok) loadFromFile();
}).catch((e) => {
  console.error('[cookies] Failed to load from DB:', e.message);
  loadFromFile();
});

// ── Public API (unchanged signatures) ──

/**
 * Merge a full cookie dump (from a browser that just connected).
 * Returns the current full jar so the caller can sync it to other browsers.
 */
export function mergeDump(cookies) {
  for (const c of cookies) {
    const id = cookieKey(c);
    jar.set(id, c);
    queueUpsert(id, c);
  }
  return getAll();
}

/**
 * Apply an incremental cookie change.
 * @param {object} change - { cookie, removed }
 * @returns {object} the change to broadcast
 */
export function applyChange(change) {
  const id = cookieKey(change.cookie);
  if (change.removed) {
    jar.delete(id);
    queueDelete(id);
  } else {
    jar.set(id, change.cookie);
    queueUpsert(id, change.cookie);
  }
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
  pendingUpserts.clear();
  pendingDeletes.clear();
  if (db) {
    db.from('cookies').delete().neq('id', '').then(({ error }) => {
      if (error) console.error('[cookies] Failed to clear in Supabase:', error.message);
    }).catch((e) => {
      console.error('[cookies] Failed to clear in Supabase:', e.message);
    });
  } else {
    scheduleFlush();
  }
}
