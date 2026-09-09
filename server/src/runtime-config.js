/**
 * Runtime configuration — persisted to DB, editable from dashboard.
 *
 * Two layers, resolved most-specific first:
 *   1. per-account  (oya_browser.user_settings) — each user's own key/model
 *   2. server-wide  (oya_browser.settings)      — admin default for everyone
 *   3. environment  (OPENAI_API_KEY, ...)       — last resort
 *
 * Fallback: local file (data/config.json) when Supabase is not configured.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// OYA_DATA_DIR lets tests point at a scratch directory instead of writing
// through to the deployment's real state.
const CONFIG_PATH = process.env.OYA_DATA_DIR
  ? join(process.env.OYA_DATA_DIR, 'config.json')
  : join(__dirname, '..', 'data', 'config.json');

let config = {};
let loaded = false;

// ── Load on startup ──

async function loadFromDb() {
  if (!db) return false;
  try {
    const { data, error } = await db.from('settings').select('key, value');
    if (error) throw error;
    for (const row of data) {
      config[row.key] = row.value;
    }
    console.log(`[config] Loaded ${data.length} settings from Supabase`);
    return true;
  } catch (e) {
    console.error('[config] Failed to load from Supabase:', e.message);
    return false;
  }
}

function loadFromFile() {
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    console.log('[config] Loaded settings from file');
  } catch {}
}

// Init: try DB first, fall back to file
loadFromDb().then((ok) => {
  if (!ok) loadFromFile();
  loaded = true;
}).catch((e) => {
  console.error('[config] Failed to load from DB:', e.message);
  loadFromFile();
  loaded = true;
});

// ── Persistence ──

async function saveToDb() {
  if (!db) return;
  try {
    const rows = Object.entries(config).map(([key, value]) => ({
      key,
      value: String(value),
      updated_at: new Date().toISOString(),
    }));
    if (rows.length > 0) {
      const { error } = await db.from('settings').upsert(rows, { onConflict: 'key' });
      if (error) throw error;
    }
  } catch (e) {
    console.error('[config] Failed to save to Supabase:', e.message);
  }
}

function saveToFile() {
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch {}
}

function save() {
  if (db) {
    saveToDb().catch((e) => console.error('[config] save error:', e.message));
  } else {
    saveToFile();
  }
}

// ── Public API (unchanged signatures) ──

export const runtimeConfig = {
  get() {
    return {
      openai_api_key: config.openai_api_key ? '••••' + config.openai_api_key.slice(-4) : (process.env.OPENAI_API_KEY ? '••••' + process.env.OPENAI_API_KEY.slice(-4) : ''),
      openai_base_url: config.openai_base_url || process.env.OPENAI_BASE_URL || '',
      chat_model: config.chat_model || process.env.CHAT_MODEL || 'gpt-4o-mini',
      has_openai_key: !!(config.openai_api_key || process.env.OPENAI_API_KEY),
    };
  },

  set(updates) {
    if (updates.openai_api_key !== undefined && !updates.openai_api_key.startsWith('••••')) {
      config.openai_api_key = updates.openai_api_key;
    }
    if (updates.openai_base_url !== undefined) config.openai_base_url = validateBaseUrl(updates.openai_base_url);
    if (updates.chat_model !== undefined) config.chat_model = updates.chat_model;
    save();
  },

  /** Get the actual OpenAI key (not masked) — used by chat-service */
  getOpenAIKey() {
    return config.openai_api_key || process.env.OPENAI_API_KEY || '';
  },

  getOpenAIBase() {
    return config.openai_base_url || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  },

  getChatModel() {
    return config.chat_model || process.env.CHAT_MODEL || 'gpt-4o-mini';
  },
};


// ── Per-account layer ──────────────────────────────────────────────────────
//
// Keyed by user id. Read-through cache, invalidated on write; a miss falls back
// to the server-wide values above, so an account that has never saved anything
// behaves exactly as it did before.

const SETTING_KEYS = ['openai_api_key', 'openai_base_url', 'chat_model'];

// The control plane fetches whatever base URL an account saves, so an
// unvalidated value is a server-side request forgery primitive: cloud metadata,
// internal services, anything routable from this host.
const PRIVATE_HOST = new RegExp(
  '^(localhost$|.*\\.local$|.*\\.internal$'
  + '|127\\.|10\\.|192\\.168\\.|169\\.254\\.|0\\.'
  + '|172\\.(1[6-9]|2[0-9]|3[01])\\.'
  + '|::1$|::$|fc|fd|fe80)', 'i');

function validateBaseUrl(value) {
  const raw = String(value).trim();
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch {
    throw Object.assign(new Error('openai_base_url must be a valid URL'), { status: 400 });
  }
  const reject = (why) => { throw Object.assign(new Error(`openai_base_url ${why}`), { status: 400 }); };
  if (url.protocol !== 'https:') reject('must use https');
  if (url.username || url.password) reject('must not embed credentials');
  if (url.hash) reject('must not contain a fragment');
  // WHATWG keeps the brackets on IPv6 hostnames ("[::1]"), so strip them first.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (PRIVATE_HOST.test(host)) reject('must not point at a private, loopback or link-local address');
  // ponytail: hostname check only. A public name that resolves to an internal
  // address (DNS rebinding) still gets through; closing that needs a
  // resolve-then-pin agent at connect time. redirect:'error' on the fetch
  // covers the cheap redirect-to-internal variant.
  return url.href.replace(/\/+$/, '');
}

const userCache = new Map();

async function loadUserConfig(userId) {
  if (userCache.has(userId)) return userCache.get(userId);
  let values = {};
  if (db) {
    try {
      const { data, error } = await db
        .from('user_settings')
        .select('key, value')
        .eq('user_id', userId);
      if (error) throw error;
      for (const row of data) values[row.key] = row.value;
    } catch (e) {
      console.error('[config] Failed to load user settings:', e.message);
      return {}; // don't cache a failed read
    }
  }
  userCache.set(userId, values);
  return values;
}

export const userConfig = {
  /** Masked view for the dashboard — same shape as runtimeConfig.get(). */
  async get(userId) {
    const own = await loadUserConfig(userId);
    const global = runtimeConfig.get();
    const key = own.openai_api_key;
    return {
      openai_api_key: key ? '\u2022\u2022\u2022\u2022' + key.slice(-4) : global.openai_api_key,
      openai_base_url: own.openai_base_url || global.openai_base_url,
      chat_model: own.chat_model || global.chat_model,
      has_openai_key: !!key || global.has_openai_key,
      /** True when the values shown come from the server-wide default, not this account. */
      inherited: !key && global.has_openai_key,
    };
  },

  async set(userId, updates) {
    const own = { ...(await loadUserConfig(userId)) };
    const rows = [];
    for (const field of SETTING_KEYS) {
      let value = updates[field];
      if (value === undefined) continue;
      // Never persist the masked placeholder back over a real key.
      if (field === 'openai_api_key' && String(value).startsWith('\u2022')) continue;
      if (field === 'openai_base_url') value = validateBaseUrl(value);
      own[field] = value;
      rows.push({
        user_id: userId,
        key: field,
        value: String(value),
        updated_at: new Date().toISOString(),
      });
    }
    if (rows.length === 0) return;
    userCache.set(userId, own);
    if (db) {
      try {
        const { error } = await db
          .from('user_settings')
          .upsert(rows, { onConflict: 'user_id,key' });
        if (error) throw error;
      } catch (e) {
        userCache.delete(userId); // re-read next time rather than trust the cache
        throw e;
      }
    }
  },

  /**
   * Effective config for a request, given the API key it arrived with.
   * Keys with no account (env admin keys, fleet token) get the server-wide values.
   */
  async resolve(userId) {
    if (!userId) {
      return {
        openaiKey: runtimeConfig.getOpenAIKey(),
        baseUrl: runtimeConfig.getOpenAIBase(),
        model: runtimeConfig.getChatModel(),
      };
    }
    const own = await loadUserConfig(userId);
    // An account's base URL is only honoured alongside that account's own key.
    // Pairing a user-supplied endpoint with the server-wide key would ship the
    // deployment's OpenAI credential to an address the user controls.
    return {
      openaiKey: own.openai_api_key || runtimeConfig.getOpenAIKey(),
      baseUrl: own.openai_api_key
        ? (own.openai_base_url || runtimeConfig.getOpenAIBase())
        : runtimeConfig.getOpenAIBase(),
      model: own.chat_model || runtimeConfig.getChatModel(),
    };
  },
};
