/**
 * Auth — Supabase-backed user accounts, API keys, and fleet tokens.
 *
 * Three layers:
 *   1. Supabase Auth (signup/login) — users get JWTs
 *   2. API keys (per user, stored in oya_browser.api_keys) — browsers connect with these
 *   3. Admin keys (env var) + fleet token (env var) — for ops/fleet management
 */

import { randomBytes } from 'crypto';
import { db as supabase, dbAuth as supabaseAuth } from './db.js';

// ── Env-configured admin keys ──

const envKeys = new Set(
  (process.env.API_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
);

// ── Fleet token ──

const fleetToken = (process.env.FLEET_TOKEN || '').trim() || null;

// ── In-memory cache of API keys (loaded from Supabase on startup) ──

const keyCache = new Set();
let loaded = false;

async function loadKeys() {
  if (!supabase || loaded) return;
  try {
    const { data, error } = await supabase.from('api_keys').select('key');
    if (error) throw error;
    for (const row of data) keyCache.add(row.key);
    loaded = true;
    console.log(`[auth] Loaded ${data.length} API keys from Supabase`);
  } catch (e) {
    console.error('[auth] Failed to load keys:', e.message);
  }
}

loadKeys();

// ── Signup / Login ──

export async function signup(email, password, displayName) {
  if (!supabaseAuth) throw new Error('Database not configured');
  const { data, error } = await supabaseAuth.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName || email.split('@')[0] },
  });
  if (error) throw error;
  return { user: { id: data.user.id, email: data.user.email } };
}

export async function login(email, password) {
  if (!supabaseAuth) throw new Error('Database not configured');
  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return {
    user: { id: data.user.id, email: data.user.email },
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  };
}

export async function refreshSession(refreshToken) {
  if (!supabaseAuth) throw new Error('Database not configured');
  const { data, error } = await supabaseAuth.auth.refreshSession({ refresh_token: refreshToken });
  if (error) throw error;
  return {
    user: { id: data.user.id, email: data.user.email },
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  };
}

// ── API key management ──

export function validateApiKey(key) {
  if (!key) return false;
  return envKeys.has(key) || keyCache.has(key) || isFleetToken(key);
}

export async function registerApiKey(key, userId, label) {
  keyCache.add(key);
  if (supabase && userId) {
    const { error } = await supabase.from('api_keys').upsert(
      { key, user_id: userId, label: label || 'Default', created_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    if (error) throw error;
  }
}

export async function listApiKeys(userId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('api_keys')
    .select('key, label, created_at, last_used_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function deleteApiKey(key, userId) {
  keyCache.delete(key);
  if (supabase) {
    const { error } = await supabase
      .from('api_keys')
      .delete()
      .eq('key', key)
      .eq('user_id', userId);
    if (error) throw error;
  }
}

export async function touchApiKey(key) {
  if (supabase) {
    try {
      await supabase
        .from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('key', key);
    } catch (e) {
      console.error('[auth] touchApiKey failed:', e.message);
    }
  }
}

// ── User profile ──

export async function getProfile(userId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, display_name, role, created_at')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

// ── Admin / fleet helpers ──

export function isAdminKey(key) {
  return envKeys.has(key);
}

export function isFleetToken(key) {
  return fleetToken !== null && key === fleetToken;
}

export async function provisionKeys(count) {
  const keys = [];
  const rows = [];
  for (let i = 0; i < count; i++) {
    const key = randomBytes(24).toString('base64url');
    keyCache.add(key);
    keys.push(key);
    rows.push({ key, created_at: new Date().toISOString() });
  }
  if (supabase && rows.length > 0) {
    const { error } = await supabase.from('api_keys').upsert(rows, { onConflict: 'key' });
    if (error) console.error('[auth] Failed to save provisioned keys:', error.message);
  }
  return keys;
}

// ── JWT middleware (for authenticated user routes) ──

export async function userAuthMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  const token = header.slice(7);
  if (!supabaseAuth) {
    return res.status(503).json({ error: 'Auth not configured' });
  }
  try {
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error) throw error;
    req.user = data.user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── API key middleware (for browser/MCP connections) ──

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
