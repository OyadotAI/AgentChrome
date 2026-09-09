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

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CDPConnection } from './drivers/cdp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = process.env.OYA_DATA_DIR
  ? join(process.env.OYA_DATA_DIR, 'profiles')
  : join(__dirname, '..', 'data', 'profiles');

const SECRET = process.env.OYA_PROFILE_SECRET || '';
const SALT = Buffer.from(process.env.OYA_PROFILE_SALT || 'oya-profile-kek-v1');

let kek = null;
function key() {
  if (kek) return kek;
  if (!SECRET) {
    throw Object.assign(
      new Error('OYA_PROFILE_SECRET is required to store browser profiles. Generate one with `openssl rand -hex 32`.'),
      { status: 409 },
    );
  }
  // scrypt is deliberate: the secret may be operator-chosen rather than random.
  // N=2^15,r=8 needs 32MB, which is exactly Node's default maxmem ceiling, so
  // maxmem is raised explicitly rather than left to trip at runtime.
  kek = scryptSync(SECRET, SALT, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
  return kek;
}

const safeName = (name) => {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw Object.assign(new Error('Profile names are 1-64 chars of letters, digits, dot, dash or underscore'), { status: 400 });
  }
  return name;
};

const fileFor = (name) => join(DIR, `${safeName(name)}.enc`);

function seal(name, value) {
  const dek = randomBytes(32);
  const aad = Buffer.from(`profile:${name}`);

  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', dek, nonce);
  c.setAAD(aad);
  const body = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);

  const wrapNonce = randomBytes(12);
  const w = createCipheriv('aes-256-gcm', key(), wrapNonce);
  w.setAAD(aad);
  const wrapped = Buffer.concat([w.update(dek), w.final()]);

  return Buffer.concat([
    Buffer.from([1]),                       // format version
    wrapNonce, w.getAuthTag(), wrapped,     // 12 + 16 + 32
    nonce, c.getAuthTag(), body,
  ]);
}

function open(name, buf) {
  if (buf[0] !== 1) throw new Error('Unsupported profile format');
  const aad = Buffer.from(`profile:${name}`);
  let o = 1;
  const wrapNonce = buf.subarray(o, o += 12);
  const wrapTag = buf.subarray(o, o += 16);
  const wrapped = buf.subarray(o, o += 32);
  const nonce = buf.subarray(o, o += 12);
  const tag = buf.subarray(o, o += 16);
  const body = buf.subarray(o);

  const w = createDecipheriv('aes-256-gcm', key(), wrapNonce);
  w.setAAD(aad); w.setAuthTag(wrapTag);
  const dek = Buffer.concat([w.update(wrapped), w.final()]);

  const c = createDecipheriv('aes-256-gcm', dek, nonce);
  c.setAAD(aad); c.setAuthTag(tag);
  return JSON.parse(Buffer.concat([c.update(body), c.final()]).toString('utf8'));
}

// ── Concurrency lock ──
// One writer per profile. Two sessions sharing a jar interleave writes and
// corrupt it, so the second connect is refused rather than allowed to race.
const locks = new Map(); // name -> { apiKey, since }

export function tryLock(name, apiKey) {
  safeName(name);
  const held = locks.get(name);
  if (held) return { ok: false, since: held.since };
  locks.set(name, { apiKey, since: Date.now() });
  return { ok: true };
}

export function unlock(name) { locks.delete(name); }
export function isLocked(name) { return locks.has(name); }

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
export async function capture(name, session) {
  safeName(name);
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
    await writeFile(fileFor(name), seal(name, payload), { mode: 0o600 });
    return true;
  } finally {
    conn.close();
  }
}

/** Replay a stored profile into a fresh browser before the client uses it. */
export async function restore(name, session) {
  safeName(name);
  let payload;
  try { payload = open(name, await readFile(fileFor(name))); }
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

export async function list() {
  try {
    const files = await readdir(DIR);
    return files.filter((f) => f.endsWith('.enc')).map((f) => {
      const name = f.slice(0, -4);
      return { name, locked: isLocked(name), lockedSince: locks.get(name)?.since || null };
    });
  } catch { return []; }
}

export async function remove(name) {
  safeName(name);
  if (isLocked(name)) throw Object.assign(new Error('Profile is in use'), { status: 409 });
  try { await unlink(fileFor(name)); return true; } catch { return false; }
}

/** Exposed for tests: prove a profile cannot be opened under another name. */
export const _internals = { seal, open, timingSafeEqual };
