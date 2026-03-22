/**
 * Runtime configuration — persisted to DB, editable from dashboard.
 * Values here override environment variables.
 *
 * Primary storage: Supabase (oya_browser.settings)
 * Fallback: local file (data/config.json) when Supabase is not configured.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', 'data', 'config.json');

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
    saveToDb();
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
    if (updates.openai_base_url !== undefined) config.openai_base_url = updates.openai_base_url;
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
