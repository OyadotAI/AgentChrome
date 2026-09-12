/** Durable, persona-scoped login state. Cookies and localStorage share one store. */
import { readFileSync, renameSync } from 'fs';
import { mkdir, writeFile, rename } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { defaultPersonaSeed } from './fingerprint.js';
import { sealText, openText } from './secrets.js';

const FILE = join(process.env.OYA_DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'data'), 'cookies.json');
const jars = new Map();
const origins = new Map();
const updated = new Map();
let revision = 0, savedRevision = 0, timer = null, writing = null;
const cookieKey = (c) => `${c.domain}|${c.path || '/'}|${c.name}`;
const validCookie = (c) => c && typeof c.name === 'string' && typeof c.value === 'string' && typeof c.domain === 'string' && c.domain.length > 0;
const expired = (c) => Number(c.expirationDate ?? c.expires) > 0 && Number(c.expirationDate ?? c.expires) <= Date.now() / 1000;

function changed(id) {
  updated.set(id, new Date().toISOString());
  revision++;
  if (!timer) {
    timer = setTimeout(() => {
      timer = null;
      flush().catch((e) => { console.error('[profiles] Save failed:', e.message); changed(id); });
    }, 500);
    timer.unref?.();
  }
}

/** Serialize writers and rename atomically; never truncate a working profile. */
async function flush() {
  if (writing) { await writing; return flush(); }
  if (savedRevision === revision) return;
  const snapshotRevision = revision;
  const records = {};
  for (const id of new Set([...jars.keys(), ...origins.keys()])) {
    records[id] = sealText(`login:${id}`, { cookies: getAll(id), origins: getStorage(id), updatedAt: updated.get(id) || null });
  }
  writing = (async () => {
    await mkdir(dirname(FILE), { recursive: true, mode: 0o700 });
    const temp = `${FILE}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify({ version: 2, records }), { mode: 0o600 });
    await rename(temp, FILE);
    savedRevision = snapshotRevision;
  })();
  try { await writing; } finally { writing = null; }
}

export async function drain() {
  clearTimeout(timer); timer = null;
  while (savedRevision !== revision) await flush();
}

// Load before accepting browsers. Migrate owned jars; never guess an unscoped jar's owner.
try {
  const data = JSON.parse(readFileSync(FILE, 'utf8'));
  if (Array.isArray(data)) {
    renameSync(FILE, `${FILE}.legacy-${Date.now()}`);
  } else if (data.version === 2) {
    for (const [id, sealed] of Object.entries(data.records || {})) {
      const state = openText(`login:${id}`, sealed);
      jars.set(id, new Map((state.cookies || []).filter(validCookie).map((c) => [cookieKey(c), c])));
      origins.set(id, state.origins || {});
      updated.set(id, state.updatedAt || null);
    }
  } else {
    for (const [key, cookies] of Object.entries(data)) {
      if (!Array.isArray(cookies)) continue;
      const id = /^(apikey-[0-9a-f]{12}|p-[0-9a-f]{16})$/.test(key) ? key : defaultPersonaSeed(key).id;
      mergeDump(id, cookies);
    }
  }
} catch (e) {
  if (e.code !== 'ENOENT') throw new Error(`Cannot read saved login state: ${e.message}`);
}

export function mergeDump(id, cookies) {
  if (!id || !Array.isArray(cookies)) return [];
  if (!jars.has(id)) jars.set(id, new Map());
  const jar = jars.get(id);
  for (const c of cookies.filter(validCookie)) {
    if (expired(c)) jar.delete(cookieKey(c)); else jar.set(cookieKey(c), c);
  }
  changed(id);
  return getAll(id);
}

export function applyChange(id, change) {
  if (!id || !validCookie(change?.cookie)) return null;
  if (!jars.has(id)) jars.set(id, new Map());
  const jar = jars.get(id), c = change.cookie;
  if (change.removed || expired(c)) jar.delete(cookieKey(c)); else jar.set(cookieKey(c), c);
  changed(id);
  return change;
}

export function getAll(id) {
  return [...(jars.get(id)?.values() || [])].filter((c) => !expired(c));
}

export function getForDomains(id, domains) {
  if (!Array.isArray(domains)) return [];
  const hosts = domains.filter((d) => typeof d === 'string').slice(0, 20).map((d) => d.toLowerCase().replace(/^\./, ''));
  return getAll(id).filter((c) => {
    const domain = c.domain.toLowerCase().replace(/^\./, '');
    return hosts.some((h) => h === domain || (c.hostOnly !== true && c.domain.startsWith('.') && h.endsWith('.' + domain)));
  });
}

export function getStorage(id) { return origins.get(id) || {}; }

/** Replace only visited origins, including empty storage after logout. */
export function mergeStorage(id, values) {
  if (!id || !values || typeof values !== 'object' || Array.isArray(values)) return;
  const current = { ...getStorage(id) };
  for (const [origin, items] of Object.entries(values).slice(0, 100)) {
    try { if (!/^https?:$/.test(new URL(origin).protocol) || new URL(origin).origin !== origin) continue; } catch { continue; }
    if (!items || typeof items !== 'object' || Array.isArray(items)) continue;
    const entries = Object.entries(items).filter(([k, v]) => k.length <= 8192 && typeof v === 'string');
    if (JSON.stringify(entries).length > 2 * 1024 * 1024) continue;
    current[origin] = Object.fromEntries(entries);
  }
  origins.set(id, current);
  changed(id);
}

/** Metadata only; credential values never belong in a list. */
export function summary(id) {
  const cookies = getAll(id);
  const sites = new Set(cookies.map((c) => c.domain.replace(/^\./, '')));
  for (const [origin, items] of Object.entries(getStorage(id))) if (Object.keys(items).length) sites.add(new URL(origin).hostname);
  return { cookies: cookies.length, sites: [...sites].sort(), updatedAt: updated.get(id) || null };
}

export function clear(id) {
  if (!id) return;
  jars.delete(id); origins.delete(id); updated.delete(id);
  changed(id);
}
