/**
 * Shared cookie store — holds the canonical cookie jar for a browser pool.
 * When one browser's cookies change, the delta is broadcast to all others.
 *
 * Cookies are scoped per API key: browsers sharing an API key share cookies;
 * browsers with different keys are fully isolated from each other.
 *
 * Primary storage: Supabase (oya_browser.cookies) — currently disabled.
 * Fallback: local file (data/cookies.json) keyed by apiKey.
 */

import { readFileSync, mkdirSync, renameSync, existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
// DB disabled for cookies — volume too high for Supabase
const db = null;

const __dirname = dirname(fileURLToPath(import.meta.url));
// OYA_DATA_DIR lets tests point at a scratch directory instead of writing
// through to the deployment's real state.
const COOKIE_PATH = process.env.OYA_DATA_DIR
  ? join(process.env.OYA_DATA_DIR, 'cookies.json')
  : join(__dirname, '..', 'data', 'cookies.json');

/**
 * Per-API-key jars. Outer key is the API key, inner key is "<domain>|<path>|<name>".
 * @type {Map<string, Map<string, object>>}
 */
const jars = new Map();

function cookieKey(c) {
  return `${c.domain}|${c.path || '/'}|${c.name}`;
}

function getJar(apiKey) {
  let jar = jars.get(apiKey);
  if (!jar) {
    jar = new Map();
    jars.set(apiKey, jar);
  }
  return jar;
}

// ── Pending DB writes (batched) ──
// Upsert payloads carry apiKey so the eventual DB schema can key by (apiKey, id).
const pendingUpserts = new Map();   // `${apiKey}::${id}` → { apiKey, id, data }
const pendingDeletes = new Map();   // `${apiKey}::${id}` → { apiKey, id }
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
  const upserts = [...pendingUpserts.values()];
  const deletes = [...pendingDeletes.values()];
  pendingUpserts.clear();
  pendingDeletes.clear();

  try {
    if (upserts.length > 0) {
      for (let i = 0; i < upserts.length; i += 500) {
        const chunk = upserts.slice(i, i + 500).map(({ apiKey, id, data }) => ({
          api_key: apiKey, id, data, updated_at: new Date().toISOString(),
        }));
        const { error } = await db.from('cookies').upsert(chunk, { onConflict: 'api_key,id' });
        if (error) console.error('[cookies] upsert error:', error.message);
      }
    }
    if (deletes.length > 0) {
      for (let i = 0; i < deletes.length; i += 500) {
        const chunk = deletes.slice(i, i + 500);
        const ids = chunk.map((e) => e.id);
        const { error } = await db.from('cookies').delete().in('id', ids);
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
    const out = {};
    for (const [apiKey, jar] of jars) {
      out[apiKey] = [...jar.values()];
    }
    await writeFile(COOKIE_PATH, JSON.stringify(out, null, 2));
  } catch {}
}

// ── Queue a single cookie change ──

function queueUpsert(apiKey, id, data) {
  const k = `${apiKey}::${id}`;
  pendingDeletes.delete(k);
  pendingUpserts.set(k, { apiKey, id, data });
  scheduleFlush();
}

function queueDelete(apiKey, id) {
  const k = `${apiKey}::${id}`;
  pendingUpserts.delete(k);
  pendingDeletes.set(k, { apiKey, id });
  scheduleFlush();
}

// ── Load on startup ──

async function loadFromDb() {
  if (!db) return false;
  try {
    const { data, error } = await db.from('cookies').select('api_key, id, data');
    if (error) throw error;
    for (const row of data) getJar(row.api_key).set(row.id, row.data);
    console.log(`[cookies] Loaded ${data.length} cookies from Supabase`);
    return true;
  } catch (e) {
    console.error('[cookies] Failed to load from Supabase:', e.message);
    return false;
  }
}

function loadFromFile() {
  if (!existsSync(COOKIE_PATH)) return;
  try {
    const parsed = JSON.parse(readFileSync(COOKIE_PATH, 'utf8'));

    if (Array.isArray(parsed)) {
      // Legacy format: flat array with no API-key ownership. Cannot safely
      // attribute to any key — sessions must be re-authenticated. Archive
      // and start empty.
      const legacyPath = `${COOKIE_PATH}.legacy-${Date.now()}`;
      try {
        renameSync(COOKIE_PATH, legacyPath);
        console.warn(
          `[cookies] Legacy (unscoped) cookie file detected — archived to ${legacyPath}. ` +
          `Starting with empty jars. All existing sessions will require re-auth. ` +
          `This is the correct response to the cross-account cookie leak; the archived ` +
          `file contained unowned cookies and must not be reloaded.`
        );
      } catch (e) {
        console.error('[cookies] Failed to archive legacy cookie file:', e.message);
      }
      return;
    }

    if (parsed && typeof parsed === 'object') {
      let total = 0;
      for (const [apiKey, cookies] of Object.entries(parsed)) {
        if (!Array.isArray(cookies)) continue;
        const jar = getJar(apiKey);
        for (const c of cookies) jar.set(cookieKey(c), c);
        total += cookies.length;
      }
      console.log(`[cookies] Loaded ${total} cookies across ${jars.size} API keys from file`);
    }
  } catch {}
}

loadFromDb().then((ok) => {
  if (!ok) loadFromFile();
}).catch((e) => {
  console.error('[cookies] Failed to load from DB:', e.message);
  loadFromFile();
});

// ── Public API ──

/**
 * Merge a full cookie dump (from a browser that just connected) into the
 * jar for the given API key. Returns that jar's current contents so the
 * caller can sync it to other browsers in the same pool.
 */
export function mergeDump(apiKey, cookies) {
  if (!apiKey) return [];
  const jar = getJar(apiKey);
  for (const c of cookies) {
    const id = cookieKey(c);
    jar.set(id, c);
    queueUpsert(apiKey, id, c);
  }
  return [...jar.values()];
}

/**
 * Apply an incremental cookie change scoped to a single API key.
 * @param {string} apiKey
 * @param {object} change - { cookie, removed }
 * @returns {object} the change to broadcast (or null if apiKey missing)
 */
export function applyChange(apiKey, change) {
  if (!apiKey) return null;
  const jar = getJar(apiKey);
  const id = cookieKey(change.cookie);
  if (change.removed) {
    jar.delete(id);
    queueDelete(apiKey, id);
  } else {
    jar.set(id, change.cookie);
    queueUpsert(apiKey, id, change.cookie);
  }
  return change;
}

/**
 * Get all cookies for a single API key.
 */
export function getAll(apiKey) {
  if (!apiKey) return [];
  const jar = jars.get(apiKey);
  return jar ? [...jar.values()] : [];
}

/**
 * Cookies matching the given hosts, for a browser about to navigate there.
 *
 * This is the pull side of cookie sync: browsers ask for what they need at
 * navigation time instead of every browser being pushed every change, which
 * made fan-out quadratic in pool size.
 *
 * ponytail: linear scan of the jar. The jar is keyed by domain|path|name, so a
 * pool sharing one identity converges on one cookie set regardless of how many
 * browsers are in it — measured 0.05 ms/pull at 1k cookies vs the ~170 pulls/s
 * a 5k fleet generates. Index by registrable domain only if a pool ever holds
 * many distinct identities under one key (50k cookies measured 2.2 ms/pull).
 */
export function getForDomains(apiKey, domains) {
  if (!apiKey || !Array.isArray(domains)) return [];
  const jar = jars.get(apiKey);
  if (!jar) return [];
  const hosts = domains
    .filter((d) => typeof d === 'string' && d)
    .slice(0, 20)
    .map((d) => d.toLowerCase().replace(/^\./, ''));
  if (!hosts.length) return [];
  return [...jar.values()].filter((c) => {
    const cookieDomain = String(c.domain || '').toLowerCase().replace(/^\./, '');
    if (!cookieDomain) return false;
    return hosts.some((h) => h === cookieDomain || h.endsWith('.' + cookieDomain));
  });
}

/**
 * Get all cookies across every API key, as an object keyed by apiKey.
 * Admin-only — do not expose to regular callers.
 */
export function getAllByKey() {
  const out = {};
  for (const [apiKey, jar] of jars) {
    out[apiKey] = [...jar.values()];
  }
  return out;
}

/**
 * Clear all cookies for a single API key.
 */
export function clear(apiKey) {
  if (!apiKey) return;
  const jar = jars.get(apiKey);
  if (!jar) return;
  for (const id of jar.keys()) queueDelete(apiKey, id);
  jars.delete(apiKey);
  if (db) {
    db.from('cookies').delete().eq('api_key', apiKey).then(({ error }) => {
      if (error) console.error('[cookies] Failed to clear in Supabase:', error.message);
    }).catch((e) => {
      console.error('[cookies] Failed to clear in Supabase:', e.message);
    });
  } else {
    scheduleFlush();
  }
}

/**
 * Clear every jar for every API key. Admin-only.
 */
export function clearAll() {
  for (const apiKey of [...jars.keys()]) clear(apiKey);
}
