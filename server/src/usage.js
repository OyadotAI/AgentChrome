/**
 * Per-key usage accounting.
 *
 * Aggregated in memory and flushed on an interval, never a write per event —
 * at 1k-5k browsers a durable row per command would be tens of thousands of
 * inserts a second. Counters are bucketed by UTC hour, which is the grain
 * billing and quotas actually need.
 *
 * This is the keyed counterpart to metrics.js: same events, but sliced by
 * api key instead of aggregated across the fleet.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import { fingerprint } from './audit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USAGE_PATH = process.env.OYA_DATA_DIR
  ? join(process.env.OYA_DATA_DIR, 'usage.json')
  : join(__dirname, '..', 'data', 'usage.json');


export const FIELDS = [
  'commands', 'command_errors', 'chat_requests', 'chat_input_tokens', 'chat_output_tokens',
  'browser_seconds', 'browsers_started', 'cookie_pulls', 'frames', 'sandboxes_created',
  'rate_limited', 'quota_denied', 'bytes_out', 'residential_proxy_bytes',
];

const hourOf = (d = new Date()) => new Date(Date.UTC(
  d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours())).toISOString();

/**
 * Keyed by key fingerprint, never by the key. These rows are persisted, and a
 * metering table is no place to keep a working bearer credential — audit.js
 * has recorded actors this way from the start.
 */
/** fingerprint -> { hour, counters } for the current bucket. */
const buckets = new Map();
/** fingerprint -> Map<browserId, connectedAtMs>, for browser_seconds. */
const live = new Map();
let dirty = false;
let warnedFallback = false;

function bucket(id) {
  const hour = hourOf();
  let b = buckets.get(id);
  if (!b || b.hour !== hour) {
    b = { hour, counters: Object.fromEntries(FIELDS.map((f) => [f, 0])) };
    buckets.set(id, b);
  }
  return b;
}

function recordId(id, field, n) {
  if (!id || !FIELDS.includes(field) || !Number.isFinite(n)) return;
  bucket(id).counters[field] += n;
  dirty = true;
}

/** Add to a counter for this key's current hour. */
export function record(apiKey, field, n = 1) {
  if (!apiKey) return;
  recordId(fingerprint(apiKey), field, n);
}

export function browserConnected(apiKey, browserId) {
  if (!apiKey || !browserId) return;
  const id = fingerprint(apiKey);
  if (!live.has(id)) live.set(id, new Map());
  live.get(id).set(browserId, Date.now());
  recordId(id, 'browsers_started', 1);
}

export function browserDisconnected(apiKey, browserId) {
  if (!apiKey) return;
  const id = fingerprint(apiKey);
  const started = live.get(id)?.get(browserId);
  if (!started) return;
  live.get(id).delete(browserId);
  recordId(id, 'browser_seconds', Math.round((Date.now() - started) / 1000));
}

/**
 * Browser-seconds for connections still open, so a long-lived browser is
 * accounted for before it disconnects rather than landing in one lump.
 */
function settleOpenBrowsers() {
  const now = Date.now();
  for (const [key, browsers] of live) {
    for (const [id, since] of browsers) {
      const seconds = Math.round((now - since) / 1000);
      if (seconds <= 0) continue;
      recordId(key, 'browser_seconds', seconds);
      browsers.set(id, now);
    }
  }
}

/** Current hour's counters for one key. */
export function current(apiKey) {
  const id = fingerprint(apiKey);
  const b = buckets.get(id);
  const openBrowsers = live.get(id)?.size || 0;
  return { hour: b?.hour || hourOf(), openBrowsers, ...(b?.counters || Object.fromEntries(FIELDS.map((f) => [f, 0]))) };
}

/** Every key with activity this hour. */
export function snapshot() {
  return [...buckets.entries()].map(([id, b]) => ({
    actor: id.slice(0, 12),
    hour: b.hour,
    openBrowsers: live.get(id)?.size || 0,
    ...b.counters,
  }));
}

/** Durable history for one key. */
export async function history(apiKey, { hours = 24 } = {}) {
  if (!db) return { source: 'memory', rows: [current(apiKey)] };
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const { data, error } = await db.from('usage')
    .select('*').eq('api_key', fingerprint(apiKey)).gte('hour', since).order('hour', { ascending: false });
  if (error) return { source: 'memory', rows: [current(apiKey)], error: error.message };
  return { source: 'database', rows: data };
}

async function flush() {
  settleOpenBrowsers();
  if (!dirty) return;
  dirty = false;
  const rows = [...buckets.entries()].map(([id, b]) => ({
    api_key: id, hour: b.hour, ...b.counters, updated_at: new Date().toISOString(),
  }));
  if (!rows.length) return;
  const toFile = async () => {
    await mkdir(dirname(USAGE_PATH), { recursive: true });
    await writeFile(USAGE_PATH, JSON.stringify(rows, null, 2));
  };
  try {
    if (!db) return await toFile();
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from('usage').upsert(rows.slice(i, i + 500), { onConflict: 'api_key,hour' });
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    // Counters live in memory and are rewritten whole each flush, so a failed
    // write is not lost data — but retrying a permanently broken table every
    // minute forever is noise. Mirror to the file and say so once.
    if (!warnedFallback) {
      console.error(`[usage] database write failed (${e.message}) — falling back to ${USAGE_PATH}`);
      warnedFallback = true;
    }
    await toFile().catch((fileErr) => console.error('[usage] file fallback failed:', fileErr.message));
  }
}

/**
 * Reload the current hour so a restart mid-hour continues the bucket instead
 * of resetting it — which would otherwise let a quota be evaded by a restart.
 */
export async function restore() {
  if (!db) return;
  try {
    const { data, error } = await db.from('usage').select('*').eq('hour', hourOf());
    if (error || !data) return;
    for (const row of data) {
      const counters = Object.fromEntries(FIELDS.map((f) => [f, Number(row[f]) || 0]));
      buckets.set(row.api_key, { hour: row.hour, counters });
    }
    if (data.length) console.log(`[usage] restored ${data.length} key buckets for the current hour`);
  } catch (e) {
    console.error('[usage] restore failed:', e.message);
  }
}

const FLUSH_INTERVAL = Number(process.env.OYA_USAGE_FLUSH_MS) || 60_000;
let timer = setInterval(() => flush().catch(() => {}), FLUSH_INTERVAL);
timer.unref?.();

export async function drain() { clearInterval(timer); await flush(); }

/** Test hook. */
export function reset() { buckets.clear(); live.clear(); dirty = false; }
