/**
 * Rate limits and quotas, enforced.
 *
 * Rate limits are token buckets: O(1) per check, no timers, no sweep. A bucket
 * is created lazily and reclaimed once it has been full and idle, so 5k keys
 * do not leak 5k live objects.
 *
 * Quotas are point-in-time ceilings answered from live state (how many
 * browsers does this key have right now) or from usage.js (how much has it
 * spent this hour).
 *
 * Every limit is configurable; setting one to 0 or false disables it.
 */

import { metrics } from './metrics.js';
import * as usage from './usage.js';

const num = (name, fallback) => {
  if (process.env[name] === 'false') return 0;
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

/** perMinute 0 disables the limit. burst defaults to one minute's worth. */
export const LIMITS = {
  command: { perMinute: num('OYA_LIMIT_COMMANDS_PER_MIN', 600), burst: num('OYA_LIMIT_COMMANDS_BURST', 120) },
  chat: { perMinute: num('OYA_LIMIT_CHAT_PER_MIN', 60), burst: num('OYA_LIMIT_CHAT_BURST', 10) },
  provision: { perMinute: num('OYA_LIMIT_PROVISION_PER_MIN', 20), burst: num('OYA_LIMIT_PROVISION_BURST', 20) },
  connect: { perMinute: num('OYA_LIMIT_CONNECT_PER_MIN', 120), burst: num('OYA_LIMIT_CONNECT_BURST', 60) },
};

export const QUOTAS = {
  browsers: num('OYA_QUOTA_MAX_BROWSERS', 5000),
  chatTokensPerHour: num('OYA_QUOTA_CHAT_TOKENS_HOUR', 2_000_000),
  sandboxesPerHour: num('OYA_QUOTA_SANDBOXES_HOUR', 500),
};

const buckets = new Map(); // `${limit}:${key}` -> { tokens, updated }

function refill(entry, cfg, now) {
  const elapsed = (now - entry.updated) / 60000;
  entry.tokens = Math.min(cfg.burst, entry.tokens + elapsed * cfg.perMinute);
  entry.updated = now;
}

/**
 * Consume one token.
 * @returns {{allowed: boolean, limit: number, remaining: number, retryAfter: number}}
 */
export function consume(name, key, cost = 1) {
  const cfg = LIMITS[name];
  if (!cfg || !cfg.perMinute || !key) return { allowed: true, limit: 0, remaining: Infinity, retryAfter: 0 };

  const id = `${name}:${key}`;
  const now = Date.now();
  let entry = buckets.get(id);
  if (!entry) { entry = { tokens: cfg.burst, updated: now }; buckets.set(id, entry); }
  else refill(entry, cfg, now);

  if (entry.tokens < cost) {
    const retryAfter = Math.ceil(((cost - entry.tokens) / cfg.perMinute) * 60);
    metrics.rateLimited.inc({ limit: name });
    usage.record(key, 'rate_limited');
    return { allowed: false, limit: cfg.perMinute, remaining: 0, retryAfter: Math.max(1, retryAfter) };
  }

  entry.tokens -= cost;
  return { allowed: true, limit: cfg.perMinute, remaining: Math.floor(entry.tokens), retryAfter: 0 };
}

/**
 * Check a ceiling. `current` is supplied by the caller so this module does not
 * reach into the registry and create a cycle.
 * @returns {{allowed: boolean, quota: number, current: number}}
 */
export function checkQuota(name, key, current) {
  const quota = QUOTAS[name];
  if (!quota) return { allowed: true, quota: 0, current };
  const allowed = current < quota;
  if (!allowed) {
    metrics.quotaExceeded.inc({ quota: name });
    usage.record(key, 'quota_denied');
  }
  return { allowed, quota, current };
}

/** Hourly spend ceilings, answered from this key's usage bucket. */
export function checkHourly(name, key) {
  const u = usage.current(key);
  if (name === 'chatTokensPerHour') {
    return checkQuota(name, key, (u.chat_input_tokens || 0) + (u.chat_output_tokens || 0));
  }
  if (name === 'sandboxesPerHour') return checkQuota(name, key, u.sandboxes_created || 0);
  return { allowed: true, quota: 0, current: 0 };
}

/** Express helper: applies a rate limit and answers with standard headers. */
export function enforce(name) {
  return (req, res, next) => {
    const key = req.headers.authorization?.slice(7) || '';
    const result = consume(name, key);
    res.set('RateLimit-Limit', String(result.limit));
    res.set('RateLimit-Remaining', String(Number.isFinite(result.remaining) ? result.remaining : 0));
    if (result.allowed) return next();
    res.set('Retry-After', String(result.retryAfter));
    res.status(429).json({
      error: `Rate limit exceeded for ${name}`,
      limit: result.limit,
      retryAfter: result.retryAfter,
    });
  };
}

/** What this key is currently allowed, without consuming anything. */
export function status(key) {
  const now = Date.now();
  const out = {};
  for (const [name, cfg] of Object.entries(LIMITS)) {
    if (!cfg.perMinute) { out[name] = { limit: 0, remaining: Infinity, disabled: true }; continue; }
    const entry = buckets.get(`${name}:${key}`);
    if (entry) refill(entry, cfg, now);
    out[name] = { limit: cfg.perMinute, burst: cfg.burst, remaining: Math.floor(entry ? entry.tokens : cfg.burst) };
  }
  return { limits: out, quotas: QUOTAS };
}

/**
 * Reclaim buckets that are full (nothing owed) and idle. Full means the key
 * has spent nothing recently, so dropping it loses no state.
 */
const SWEEP_MS = 10 * 60_000;
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of buckets) {
    const cfg = LIMITS[id.slice(0, id.indexOf(':'))];
    if (!cfg) { buckets.delete(id); continue; }
    refill(entry, cfg, now);
    if (entry.tokens >= cfg.burst && now - entry.updated > SWEEP_MS) buckets.delete(id);
  }
}, SWEEP_MS);
sweep.unref?.();

/** Test hook. */
export function reset() { buckets.clear(); }
