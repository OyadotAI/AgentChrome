/**
 * Deployment-wide configuration — persisted to DB, editable by the operator.
 *
 * This is the fallback layer only. Per-tenant settings live in key-config.js,
 * keyed by the API key, because the API key is the identity for everything
 * else in this control plane. Resolution is key -> here -> environment.
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


// The control plane fetches whatever base URL a tenant saves, so an
// unvalidated value is a server-side request forgery primitive: cloud metadata,
// internal services, anything routable from this host.
const PRIVATE_HOST = new RegExp(
  '^(localhost$|.*\\.local$|.*\\.internal$'
  + '|127\\.|10\\.|192\\.168\\.|169\\.254\\.|0\\.'
  + '|172\\.(1[6-9]|2[0-9]|3[01])\\.'
  + '|::1$|::$|fc|fd|fe80)', 'i');

export function validateBaseUrl(value) {
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
