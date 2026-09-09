/**
 * Persistent browser profiles.
 *
 * Cookies and origin storage are captured when a gateway session ends and
 * replayed when the next session names the same profile, so a login survives
 * across sessions and across providers.
 *
 * At rest: AES-256-GCM under a per-profile data key, itself wrapped by a KEK
 * derived from OYA_PROFILE_SECRET with scrypt. The profile name is the AAD on
 * both layers, so a ciphertext moved onto another profile fails to open rather
 * than silently handing one tenant's session to another.
 */

import { timingSafeEqual } from 'crypto';
import { seal as sealScoped, open as openScoped } from './secrets.js';
import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CDPConnection } from './drivers/cdp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = process.env.OYA_DATA_DIR
  ? join(process.env.OYA_DATA_DIR, 'profiles')
  : join(__dirname, '..', 'data', 'profiles');

const safeName = (name) => {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw Object.assign(new Error('Profile names are 1-64 chars of letters, digits, dot, dash or underscore'), { status: 400 });
  }
  return name;
};

/**
 * Profiles are namespaced by owner. Without this, naming another tenant's
 * profile on connect would hand over their cookies and localStorage — the
 * names are chosen by callers and are not secrets.
 */
const safeOwner = (owner) => {
  if (typeof owner !== 'string' || !/^[0-9a-f]{8,64}$/.test(owner)) {
    throw Object.assign(new Error('A profile owner fingerprint is required'), { status: 400 });
  }
  return owner;
};

const scopeOf = (owner, name) => `${safeOwner(owner)}__${safeName(name)}`;
const fileFor = (owner, name) => join(DIR, `${scopeOf(owner, name)}.enc`);

const seal = (scope, value) => sealScoped(`profile:${scope}`, value);

const open = (scope, buf) => openScoped(`profile:${scope}`, buf);

// ── Concurrency lock ──
// One writer per profile. Two sessions sharing a jar interleave writes and
// corrupt it, so the second connect is refused rather than allowed to race.
const locks = new Map(); // name -> { apiKey, since }

export function tryLock(owner, name) {
  const scope = scopeOf(owner, name);
  const held = locks.get(scope);
  if (held) return { ok: false, since: held.since };
  locks.set(scope, { owner, since: Date.now() });
  return { ok: true };
}

export function unlock(owner, name) { locks.delete(scopeOf(owner, name)); }
export function isLocked(owner, name) { return locks.has(scopeOf(owner, name)); }

/** A second CDP connection, so the client's own wire is never touched. */
async function attach(session) {
  const conn = await new CDPConnection(session.upstreamUrl).connect();
  const { targetInfos = [] } = await conn.send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  if (!page) { conn.close(); return null; }
  const { sessionId } = await conn.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  await conn.send('Network.enable', {}, sessionId).catch(() => {});
  await conn.send('Runtime.enable', {}, sessionId).catch(() => {});
  return { conn, sessionId };
}

const ORIGIN_STORAGE_JS = `(() => {
  const dump = (s) => { const o = {}; for (let i = 0; i < s.length; i++) { const k = s.key(i); o[k] = s.getItem(k); } return o; };
  try { return { origin: location.origin, local: dump(localStorage), session: dump(sessionStorage) }; }
  catch { return null; }
})()`;

const restoreStorageJS = (data) => `(() => {
  try {
    for (const [k, v] of Object.entries(${JSON.stringify(data.local || {})})) localStorage.setItem(k, v);
    for (const [k, v] of Object.entries(${JSON.stringify(data.session || {})})) sessionStorage.setItem(k, v);
    return true;
  } catch { return false; }
})()`;

/** Read the live browser state and persist it under this profile. */
export async function capture(owner, name, session) {
  const scope = scopeOf(owner, name);
  const attached = await attach(session);
  if (!attached) return false;
  const { conn, sessionId } = attached;
  try {
    const { cookies = [] } = await conn.send('Network.getAllCookies', {}, sessionId);
    let storage = null;
    try { storage = await conn.send('Runtime.evaluate', { expression: ORIGIN_STORAGE_JS, returnByValue: true }, sessionId); } catch {}
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      cookies,
      storage: storage?.result?.value || null,
    };
    await mkdir(DIR, { recursive: true, mode: 0o700 });
    await writeFile(fileFor(owner, name), seal(scope, payload), { mode: 0o600 });
    return true;
  } finally {
    conn.close();
  }
}

/** Replay a stored profile into a fresh browser before the client uses it. */
export async function restore(owner, name, session) {
  const scope = scopeOf(owner, name);
  let payload;
  try { payload = open(scope, await readFile(fileFor(owner, name))); }
  catch (e) {
    if (e.code === 'ENOENT') return false;   // first use of this profile
    throw e;
  }
  const attached = await attach(session);
  if (!attached) return false;
  const { conn, sessionId } = attached;

  if (payload.cookies?.length) {
    await conn.send('Network.setCookies', { cookies: payload.cookies }, sessionId);
  }

  if (payload.storage?.origin) {
    // Storage is origin-scoped, so it can only be written once a document on
    // that origin exists. addScriptToEvaluateOnNewDocument is scoped to the
    // connection that registered it, so this connection has to outlive the
    // call — it is closed when the session ends.
    await conn.send('Page.enable', {}, sessionId).catch(() => {});
    await conn.send('Page.addScriptToEvaluateOnNewDocument',
      { source: `if (location.origin === ${JSON.stringify(payload.storage.origin)}) ${restoreStorageJS(payload.storage)};` },
      sessionId).catch(() => {});
    session.profileConn = conn;
    return true;
  }

  conn.close();
  return true;
}

/** Only this owner's profiles. Names are caller-chosen and must not leak. */
export async function list(owner) {
  const prefix = `${safeOwner(owner)}__`;
  try {
    const files = await readdir(DIR);
    return files
      .filter((f) => f.endsWith('.enc') && f.startsWith(prefix))
      .map((f) => {
        const name = f.slice(prefix.length, -4);
        const scope = `${prefix}${name}`;
        return { name, locked: locks.has(scope), lockedSince: locks.get(scope)?.since || null };
      });
  } catch { return []; }
}

export async function remove(owner, name) {
  if (isLocked(owner, name)) throw Object.assign(new Error('Profile is in use'), { status: 409 });
  try { await unlink(fileFor(owner, name)); return true; } catch { return false; }
}

/** Exposed for tests: prove a profile cannot be opened under another name. */
export const _internals = { seal, open, timingSafeEqual };
