/**
 * Auth — Supabase-backed user accounts, API keys, and fleet tokens.
 *
 * Three layers:
 *   1. Supabase Auth (signup/login) — users get JWTs
 *   2. API keys (per user) — browsers connect with these. Only sha256(key) is
 *      stored, in oya_browser.api_keys.key_hash, alongside an 8-character
 *      prefix for display: a read of that table yields no working credential.
 *   3. Admin keys (env var) + fleet token (env var) — for ops/fleet management
 */

import { createHash, randomBytes } from 'crypto';
import { sealText } from './secrets.js';
import { control, projectId } from './control/service.js';
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

// ── Key digests ──

/**
 * The stored form of a key. Nothing here ever persists the key itself: a
 * backup, a replica, a support export or an over-broad grant on api_keys then
 * yields administrator credentials for every tenant's browsers, cookie jars and
 * personas. The rest of the control plane already worked this way — audit.js,
 * key-config.js, personas and sandbox labels all record a digest.
 */
export const keyDigest = (key) => createHash('sha256').update(String(key)).digest('hex');

/** What a person sees in a key list. The key itself is shown once, at creation. */
const keyPrefix = (key) => String(key).slice(0, 8);

/** Keys this process still holds in the clear: the env ones and the fleet token. */
export const knownKeys = () => [...new Set([...envKeys, ...(fleetToken ? [fleetToken] : [])])];

// ── In-memory cache of key digests (loaded from Supabase on startup) ──

const keyCache = new Set();     // sha256 hex digests, never keys
let loaded = false;

async function loadKeys() {
  if (!supabase || loaded) return;
  try {
    const { data, error } = await supabase.from('api_keys').select('key_hash');
    if (error) throw error;
    for (const row of data) keyCache.add(row.key_hash);
    loaded = true;
    console.log(`[auth] Loaded ${data.length} API key digests from Supabase`);
  } catch (e) {
    console.error('[auth] Failed to load keys:', e.message);
  }
}

// Readiness is shared with server startup; an empty cache is not an invalid key.
export const authReady = loadKeys().then(() => !supabase || loaded);

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
  return envKeys.has(key) || keyCache.has(keyDigest(key)) || isFleetToken(key);
}

/**
 * Resolve the account that owns an API key, or null for keys with no account
 * (env API_KEYS admin keys, the fleet token, or an unknown key).
 * Cached — this sits on the chat request path.
 */
const ownerCache = new Map();

export async function getKeyOwner(key) {
  if (!key || envKeys.has(key) || isFleetToken(key)) return null;
  if (ownerCache.has(key)) return ownerCache.get(key);
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('api_keys')
      .select('user_id')
      .eq('key_hash', keyDigest(key))
      .maybeSingle();
    if (error) throw error;
    const owner = data?.user_id || null;
    // Only cache a hit. Caching null would pin a key registered on another
    // instance to "no account" for the life of the process, silently falling
    // back to the server-wide OpenAI config.
    if (owner) ownerCache.set(key, owner);
    return owner;
  } catch (e) {
    console.error('[auth] Failed to resolve key owner:', e.message);
    return null;
  }
}

export async function registerApiKey(key, userId, label) {
  const digest = keyDigest(key);
  if (supabase && userId) {
    const { data: existing, error: lookupError } = await supabase.from('api_keys').select('user_id').eq('key_hash', digest).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing && existing.user_id !== userId) throw Object.assign(new Error('Key cannot be imported'), { status: 403 });
    if (existing) {
      await control().project(key);
      await control().store.transact(async tx => {
        const p = await tx.get('project', projectId(key));
        if (p.ownerUser && p.ownerUser !== userId) throw Object.assign(new Error('Key belongs to another account'), { status: 403 });
        p.ownerUser = userId;
        p.key = sealText(`control:${p.id}`, key);
      });
      keyCache.add(digest); ownerCache.set(key, userId); return;
    }
    const { error } = await supabase.from('api_keys').insert(
      { key_hash: digest, key_prefix: keyPrefix(key), project: projectId(key),
        user_id: userId, label: label || 'Default', created_at: new Date().toISOString() }
    );
    if (error) throw error;
  }
  keyCache.add(digest);
  if (userId) ownerCache.set(key, userId);
  const project = await control().project(key);
  if (userId) await control().store.transact(async tx => {
    const p = await tx.get('project', project.id);
    // Claiming only works on an unowned project. Assigning unconditionally let
    // an import of someone else's key — one with a project but no api_keys row,
    // such as a key from API_KEYS — hand its browsers and the right to mint
    // credentials to whoever imported it.
    if (p.ownerUser && p.ownerUser !== userId) throw Object.assign(new Error('Key belongs to another account'), { status: 403 });
    p.ownerUser = userId;
    // A new project takes its key's label as its name, so every view calls it the same thing.
    if (label && /^Project [0-9a-f]{6}$/.test(p.name)) p.name = String(label).slice(0, 100);
  });
}

/**
 * Key metadata, never a key. `id` is the digest — the handle the console uses to
 * delete one — and `project` is what a project is opened with, via
 * POST /auth/projects/:id/access, which mints a scoped, expiring credential.
 */
export async function listApiKeys(userId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('api_keys')
    .select('key_hash, key_prefix, project, label, created_at, last_used_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(({ key_hash, key_prefix, ...rest }) => ({ id: key_hash, prefix: key_prefix, ...rest }));
}

/** By digest: the server has no way to look a key up by its plaintext any more. */
export async function deleteApiKey(id, userId) {
  if (!supabase) throw Object.assign(new Error('Accounts need Supabase'), { status: 409 });
  const { data, error } = await supabase.from('api_keys').delete().eq('key_hash', id).eq('user_id', userId).select('key_hash');
  if (error) throw error;
  if (!data?.length) throw Object.assign(new Error('Key not found'), { status: 404 });
  keyCache.delete(id);
  for (const [key, owner] of ownerCache) if (owner === userId && keyDigest(key) === id) ownerCache.delete(key);
}

export async function touchApiKey(key) {
  if (supabase) {
    try {
      await supabase
        .from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('key_hash', keyDigest(key));
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

/**
 * Change what a person is allowed to change about themselves: their name.
 *
 * Email is the login and role is an authority grant, so neither is editable
 * here — a profile form that could raise its own role would be a privilege
 * escalation with a text input in front of it.
 */
export async function updateProfile(userId, { display_name }) {
  if (!supabase) throw Object.assign(new Error('Accounts need Supabase'), { status: 409 });
  const name = String(display_name ?? '').trim().slice(0, 100);
  if (!name) throw Object.assign(new Error('display_name cannot be empty'), { status: 400 });
  const { data, error } = await supabase
    .from('profiles')
    .update({ display_name: name })
    .eq('id', userId)
    .select('id, email, display_name, role, created_at')
    .single();
  if (error) throw error;
  return data;
}

// ── Admin / fleet helpers ──

/**
 * Keys listed in API_KEYS exist for self-hosting without a database. They are
 * ordinary keys: env grants existence, never authority. Host-level operations
 * use OYA_OPERATOR_TOKEN, which is not an API key at all.
 */

export function isFleetToken(key) {
  return fleetToken !== null && key === fleetToken;
}

export async function provisionKeys(count) {
  const keys = [];
  const rows = [];
  for (let i = 0; i < count; i++) {
    const key = randomBytes(24).toString('base64url');
    keys.push(key);
    rows.push({ key_hash: keyDigest(key), key_prefix: keyPrefix(key), project: projectId(key), created_at: new Date().toISOString() });
  }
  if (supabase && rows.length > 0) {
    const { error } = await supabase.from('api_keys').upsert(rows, { onConflict: 'key_hash' });
    if (error) throw error;
  }
  for (const key of keys) { keyCache.add(keyDigest(key)); await control().project(key); }
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

/** Resolve scoped credentials without changing legacy resource ownership. A managed browser's credential works only where allowBrowser is set. */
export async function authenticateToken(token, { allowBrowser = false } = {}) {
  if (!token) throw Object.assign(new Error('Missing API key'), { status: 401 });
  if (token.startsWith('oya_')) {
    const principal = await control().authenticate(token);
    if (principal?.role === 'browser' && !allowBrowser) throw Object.assign(new Error('Managed browser credentials cannot call this API'), { status: 403 });
    if (principal) return principal;
  }
  const project = await control().store.get('project', projectId(token));
  if (project?.deletedAt) throw Object.assign(new Error('Project has been deleted'), { status: 410 });
  if (envKeys.has(token) || isFleetToken(token)) return { key: token, role: 'administrator' };
  const digest = keyDigest(token);
  if (supabase) {
    const { data, error } = await supabase.from('api_keys').select('key_hash').eq('key_hash', digest).maybeSingle();
    if (error) throw Object.assign(new Error('Credential validation unavailable'), { status: 503 });
    if (data) { keyCache.add(digest); return { key: token, role: 'administrator' }; }
    keyCache.delete(digest);
  } else if (keyCache.has(digest)) return { key: token, role: 'administrator' };
  throw Object.assign(new Error('Invalid API key'), { status: 403 });
}

export async function authMiddleware(req, res, next) {
  try {
    const token = req.authToken || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '');
    const principal = await authenticateToken(token);
    req.authToken = token;
    req.principal = principal;
    if (principal.role === 'viewer' && !['GET', 'HEAD'].includes(req.method)) return res.status(403).json({ error: 'Viewer credentials cannot change resources' });
    if (principal.role !== 'administrator' && /^\/(config|personas|proxies|gateway\/(providers|strategy|profiles))/i.test(req.path) && !['GET', 'HEAD'].includes(req.method)) return res.status(403).json({ error: 'Administrator permission required' });
    // Secrets and recordings are not part of the sanitized viewer surface.
    // Both guards are case-insensitive to match however the router is configured.
    if (principal.role === 'viewer' && /^\/(config|pool\/cookies|live|gateway\/(profiles|recordings))/i.test(req.path)) return res.status(403).json({ error: 'Operator permission required' });
    req.headers.authorization = `Bearer ${principal.key}`;
    next();
  } catch (err) { res.status(err.status || 503).json({ error: err.message }); }
}
