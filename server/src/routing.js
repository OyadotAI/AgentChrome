/**
 * Provider pool: which backend should this session go to.
 *
 * Providers are heterogeneous — a hosted vendor, a docker host, a plain Chrome
 * — so routing has to account for capacity, health and latency rather than
 * just taking turns. A saturated pool queues instead of failing, and a
 * provider that errors is put in cooldown rather than being retried forever.
 */

import { metrics } from './metrics.js';

export const STRATEGIES = ['priority', 'round-robin', 'least-connections', 'latency', 'weighted'];

const COOLDOWN_BASE_MS = 5_000;
const COOLDOWN_MAX_MS = 5 * 60_000;

/** `|| fallback` would turn a deliberate 0 into the default. */
const numOr = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

class Provider {
  constructor(cfg) {
    this.name = cfg.name;
    // null = shared infrastructure declared by the host (OYA_PROVIDERS).
    // Otherwise the fingerprint of the API key that registered it.
    this.owner = cfg.owner ?? null;
    this.type = cfg.type || 'cdp';          // 'cdp' (wsUrl) or a hosted vendor
    this.wsUrl = cfg.wsUrl || null;
    this.maxConcurrent = numOr(cfg.maxConcurrent, 10);
    this.weight = numOr(cfg.weight, 1);
    this.priority = numOr(cfg.priority, 100);  // lower wins
    this.enabled = cfg.enabled !== false;
    this.active = 0;
    this.failures = 0;
    this.cooldownUntil = 0;
    this.latencyMs = null;                   // EWMA
    this.totalSessions = 0;
    this.totalFailures = 0;
  }

  get healthy() { return this.enabled && Date.now() >= this.cooldownUntil; }
  get hasCapacity() { return this.active < this.maxConcurrent; }
  get available() { return this.healthy && this.hasCapacity; }

  succeed(latencyMs) {
    this.failures = 0;
    this.cooldownUntil = 0;
    if (Number.isFinite(latencyMs)) {
      this.latencyMs = this.latencyMs == null ? latencyMs : this.latencyMs * 0.7 + latencyMs * 0.3;
    }
  }

  fail() {
    this.failures += 1;
    this.totalFailures += 1;
    // Exponential, capped. A flapping provider backs off without being
    // permanently written off.
    const backoff = Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * 2 ** (this.failures - 1));
    this.cooldownUntil = Date.now() + backoff;
    metrics.providerFailures.inc({ provider: this.name });
  }

  toJSON() {
    return {
      name: this.name, type: this.type, enabled: this.enabled,
      owner: this.owner, shared: this.owner === null,
      active: this.active, maxConcurrent: this.maxConcurrent,
      weight: this.weight, priority: this.priority,
      healthy: this.healthy, available: this.available,
      latencyMs: this.latencyMs == null ? null : Math.round(this.latencyMs),
      cooldownMsRemaining: Math.max(0, this.cooldownUntil - Date.now()),
      totalSessions: this.totalSessions, totalFailures: this.totalFailures,
    };
  }
}

export class ProviderPool {
  constructor() {
    this.providers = new Map();
    this.rr = 0;
    this.waiters = [];
    this.strategy = STRATEGIES.includes(process.env.OYA_ROUTING_STRATEGY)
      ? process.env.OYA_ROUTING_STRATEGY : 'priority';
  }

  /** Config comes from OYA_PROVIDERS (JSON array) or register() at runtime. */
  loadFromEnv(env = process.env) {
    if (!env.OYA_PROVIDERS) return this;
    try {
      for (const cfg of JSON.parse(env.OYA_PROVIDERS)) this.register(cfg);
    } catch (e) {
      console.error('[routing] OYA_PROVIDERS is not valid JSON:', e.message);
    }
    return this;
  }

  /** Names are namespaced by owner so two keys can both have a "chrome". */
  key(owner, name) { return `${owner ?? '@shared'}::${name}`; }

  register(cfg) {
    if (!cfg?.name) throw Object.assign(new Error('Provider needs a name'), { status: 400 });
    const id = this.key(cfg.owner ?? null, cfg.name);
    const existing = this.providers.get(id);
    if (existing) {
      // Keep live counters across an edit; only settings change.
      Object.assign(existing, { ...cfg, active: existing.active, failures: existing.failures });
      return existing;
    }
    const p = new Provider(cfg);
    this.providers.set(id, p);
    return p;
  }

  remove(owner, name) { return this.providers.delete(this.key(owner, name)); }
  get(owner, name) { return this.providers.get(this.key(owner, name)); }

  /** What this key can see: its own providers plus shared host infrastructure. */
  visible(owner) {
    return [...this.providers.values()].filter((p) => p.owner === null || p.owner === owner);
  }

  list(owner) { return this.visible(owner).map((p) => p.toJSON()); }

  /** Candidates that could take a session for this owner right now. */
  candidates(owner) { return this.visible(owner).filter((p) => p.available); }

  pick(owner, strategy = this.strategy, exclude = new Set()) {
    const pool = this.candidates(owner).filter((p) => !exclude.has(p.name));
    if (!pool.length) return null;

    switch (strategy) {
      case 'round-robin':
        return pool[this.rr++ % pool.length];
      case 'least-connections':
        return pool.reduce((a, b) => (b.active / b.maxConcurrent < a.active / a.maxConcurrent ? b : a));
      case 'latency':
        // Unmeasured providers sort first so they get a chance to be measured.
        return pool.reduce((a, b) => ((b.latencyMs ?? -1) < (a.latencyMs ?? -1) ? b : a));
      case 'weighted': {
        const total = pool.reduce((sum, p) => sum + p.weight, 0);
        let r = Math.random() * total;
        for (const p of pool) { r -= p.weight; if (r <= 0) return p; }
        return pool[pool.length - 1];
      }
      case 'priority':
      default:
        return pool.reduce((a, b) => (b.priority < a.priority ? b : a));
    }
  }

  /**
   * Take a slot, trying each healthy provider in turn.
   * @param connect  async (provider) => session — failure marks that provider
   *                 down and the next one is tried.
   */
  async acquire({ owner = null, strategy, connect, queueMs = 30_000, attempts = 3 } = {}) {
    const excluded = new Set();
    for (let i = 0; i < attempts; i++) {
      let provider = this.pick(owner, strategy, excluded);

      if (!provider) {
        // Everything is busy or cooling down: wait for a release rather than
        // failing a request that would succeed a second later.
        provider = await this.waitForSlot(queueMs, owner, strategy, excluded);
        if (!provider) {
          metrics.routingRejected.inc({ reason: 'saturated' });
          throw Object.assign(new Error('No browser provider available'), { status: 503 });
        }
      }

      provider.active += 1;
      const started = Date.now();
      try {
        const session = await connect(provider);
        provider.succeed(Date.now() - started);
        provider.totalSessions += 1;
        metrics.routingAcquired.inc({ provider: provider.name });
        return {
          provider,
          session,
          release: () => this.release(provider),
        };
      } catch (err) {
        provider.active -= 1;
        provider.fail();
        excluded.add(provider.name);
        console.error(`[routing] ${provider.name} failed (${err.message}); failing over`);
        if (i === attempts - 1) {
          metrics.routingRejected.inc({ reason: 'all_failed' });
          throw Object.assign(new Error(`All providers failed. Last error: ${err.message}`), { status: 502 });
        }
      }
    }
    throw Object.assign(new Error('No browser provider available'), { status: 503 });
  }

  release(provider) {
    provider.active = Math.max(0, provider.active - 1);
    // Hand the freed slot to the longest waiter that can actually use it.
    const i = this.waiters.findIndex((w) => provider.owner === null || provider.owner === w.owner);
    if (i === -1) return;
    const [waiter] = this.waiters.splice(i, 1);
    waiter.resolve(provider.available ? provider : this.pick(waiter.owner, waiter.strategy, waiter.exclude));
  }

  waitForSlot(timeoutMs, owner, strategy, exclude) {
    if (timeoutMs <= 0) return Promise.resolve(null);
    metrics.routingQueued.inc({});
    return new Promise((resolve) => {
      const entry = { owner, strategy, exclude, resolve: null };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== entry);
        resolve(null);
      }, timeoutMs);
      entry.resolve = (provider) => { clearTimeout(timer); resolve(provider); };
      this.waiters.push(entry);
    });
  }

  get queueDepth() { return this.waiters.length; }

  stats(owner = null) {
    const providers = this.list(owner);
    return {
      strategy: this.strategy,
      queueDepth: this.queueDepth,
      capacity: providers.reduce((n, p) => n + p.maxConcurrent, 0),
      active: providers.reduce((n, p) => n + p.active, 0),
      healthy: providers.filter((p) => p.healthy).length,
      providers,
    };
  }
}

export const pool = new ProviderPool().loadFromEnv();
