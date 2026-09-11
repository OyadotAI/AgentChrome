/**
 * Audit log — who did what, to what, and whether it worked.
 *
 * Privileged and state-changing actions only. Per-command volume belongs in
 * usage.js: at 1k-5k browsers, writing a durable row per command would be
 * tens of thousands of inserts a second and would tell you less.
 *
 * Actors are recorded as a key fingerprint, never the key itself.
 */

import { createHash } from 'crypto';
import { appendFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from './db.js';
import { metrics } from './metrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT_PATH = process.env.OYA_DATA_DIR
  ? join(process.env.OYA_DATA_DIR, 'audit.log')
  : join(__dirname, '..', 'data', 'audit.log');


/** Stable, non-reversible actor id. Same shape used for sandbox owner labels. */
export const fingerprint = (key) => (key ? createHash('sha256').update(key).digest('hex').slice(0, 16) : null);

const RING_MAX = 500;
const ring = [];
const pending = [];
let flushTimer = null;
const FLUSH_DELAY = 2000;
const PENDING_MAX = 5000; // a burst must not become unbounded memory

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flush().catch(() => {}); }, FLUSH_DELAY);
}

async function toFile(batch) {
  await mkdir(dirname(AUDIT_PATH), { recursive: true });
  await appendFile(AUDIT_PATH, batch.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

let warnedFallback = false;

async function flush() {
  if (!pending.length) return;
  const batch = pending.splice(0, pending.length);
  try {
    if (!db) return await toFile(batch);
    for (let i = 0; i < batch.length; i += 500) {
      const { error } = await db.from('audit_log').insert(batch.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    // Losing an audit trail because a table is missing or the database is
    // briefly unreachable is the wrong failure. Fall back to the file rather
    // than drop, and say so once instead of on every flush.
    if (!warnedFallback) {
      console.error(`[audit] database write failed (${e.message}) — falling back to ${AUDIT_PATH}`);
      warnedFallback = true;
    }
    try { await toFile(batch); }
    catch (fileErr) {
      console.error(`[audit] ${batch.length} events lost, file fallback also failed:`, fileErr.message);
    }
  }
}

/**
 * Record one auditable action.
 * @param {object} e
 * @param {string} e.action     e.g. 'key.create', 'browser.provision', 'config.update'
 * @param {string} [e.actorKey] raw API key — fingerprinted, never stored
 * @param {string} [e.actorUser] account id when known
 * @param {string} [e.targetType] 'browser' | 'key' | 'config' | 'sandbox' | 'account'
 * @param {string} [e.targetId]
 * @param {string} [e.outcome]  'ok' | 'denied' | 'error'
 * @param {object} [e.meta]     small, non-secret detail
 * @param {object} [e.req]      express request, for ip and user agent
 */
export function audit({ action, actorKey, actorUser, targetType, targetId, outcome = 'ok', meta, req }) {
  const event = {
    ts: new Date().toISOString(),
    action,
    actor: fingerprint(actorKey),
    actor_user: actorUser || null,
    target_type: targetType || null,
    target_id: targetId ? String(targetId).slice(0, 200) : null,
    outcome,
    ip: req ? (req.headers?.['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || null) : null,
    user_agent: req?.headers?.['user-agent']?.slice(0, 200) || null,
    meta: meta ? JSON.parse(JSON.stringify(meta)) : null,
  };

  ring.push(event);
  if (ring.length > RING_MAX) ring.shift();

  if (pending.length < PENDING_MAX) pending.push(event);
  else if (pending.length === PENDING_MAX) console.error('[audit] buffer full — dropping events until the backlog drains');

  metrics.auditEvents.inc({ action, outcome });
  scheduleFlush();
  return event;
}

/** Recent events without a round trip. Newest first. */
export function recent({ limit = 100, action, actor, outcome } = {}) {
  return ring
    .filter((e) => (!action || e.action === action)
      && (!actor || e.actor === actor)
      && (!outcome || e.outcome === outcome))
    .slice(-Math.min(limit, RING_MAX))
    .reverse();
}

/** Durable history. Falls back to the in-memory ring with no database. */
export async function history({ limit = 100, action, actor, since } = {}) {
  if (!db) return { source: 'memory', events: recent({ limit, action, actor }) };
  let q = db.from('audit_log').select('*').order('ts', { ascending: false }).limit(Math.min(limit, 1000));
  if (action) q = q.eq('action', action);
  if (actor) q = q.eq('actor', actor);
  if (since) q = q.gte('ts', since);
  const { data, error } = await q;
  if (error) return { source: 'memory', events: recent({ limit, action, actor }), error: error.message };
  return { source: 'database', events: data };
}

/** Flush before shutdown so the tail of the trail is not lost. */
export async function drain() {
  clearTimeout(flushTimer);
  flushTimer = null;
  await flush();
}
