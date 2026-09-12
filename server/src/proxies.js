/**
 * Proxy pool.
 *
 * Rotation without exit-IP rotation is not rotation: distinct fingerprints all
 * arriving from one address correlate just as well as one fingerprint would.
 *
 * A proxy is assigned to a persona and stays with it. Stickiness is the point —
 * a logged-in session that returns from a different country looks like an
 * account takeover, which is the opposite of what a customer wants.
 *
 * Structure mirrors routing.js (cooldown on failure, least-used selection,
 * health) rather than inventing a second shape for the same problem.
 */

import { randomBytes, createHash } from 'crypto';
import http from 'http';
import https from 'https';
import tls from 'tls';
import { sealText, openText, haveSecret } from './secrets.js';
import { metrics } from './metrics.js';
import { assertSafeTarget } from './net-guard.js';

const COOLDOWN_MS = 60_000;
const CHECK_TIMEOUT_MS = Number(process.env.OYA_PROXY_CHECK_TIMEOUT_MS) || 10_000;

/** id -> proxy */
const proxies = new Map();
/** personaId -> proxyId, so an identity keeps its exit. */
const assignments = new Map();

class Proxy {
  constructor(cfg) {
    this.id = cfg.id || 'px-' + randomBytes(6).toString('hex');
    this.owner = cfg.owner ?? null;          // null = shared host infrastructure
    this.label = cfg.label || this.id;
    this.kind = cfg.kind === 'datacenter' ? 'datacenter' : 'residential';
    this.geo = cfg.geo || null;              // e.g. "US", "US-CA", "DE"
    this.maxPersonas = Number(cfg.maxPersonas) > 0 ? Number(cfg.maxPersonas) : 1;
    this.sealed = cfg.sealed;                // encrypted { url, username, password }
    this.healthy = cfg.healthy !== false;
    this.cooldownUntil = 0;
    this.exitIp = cfg.exitIp || null;
    this.lastCheckedAt = cfg.lastCheckedAt || null;
    this.failures = 0;
  }

  get available() { return this.healthy && Date.now() >= this.cooldownUntil; }
  get assigned() { return [...assignments.values()].filter((id) => id === this.id).length; }

  fail() {
    this.failures += 1;
    this.cooldownUntil = Date.now() + Math.min(COOLDOWN_MS * 2 ** (this.failures - 1), 15 * 60_000);
    this.healthy = false;
    metrics.proxyFailures.inc({ kind: this.kind });
  }

  succeed(exitIp) {
    this.failures = 0;
    this.cooldownUntil = 0;
    this.healthy = true;
    if (exitIp) this.exitIp = exitIp;
    this.lastCheckedAt = new Date().toISOString();
  }

  /** Credentials never leave the server in a response. */
  toJSON() {
    return {
      id: this.id, label: this.label, kind: this.kind, geo: this.geo,
      shared: this.owner === null,
      healthy: this.healthy, available: this.available,
      exitIp: this.exitIp, lastCheckedAt: this.lastCheckedAt,
      assigned: this.assigned, maxPersonas: this.maxPersonas,
      cooldownMsRemaining: Math.max(0, this.cooldownUntil - Date.now()),
    };
  }
}

const scopeFor = (id) => `proxy:${id}`;

/** Decrypted connection details. Server-side only. */
export function credentials(proxy) {
  return openText(scopeFor(proxy.id), proxy.sealed);
}

export async function register({ owner = null, label, url, geo, kind, maxPersonas }) {
  if (!haveSecret()) {
    throw Object.assign(
      new Error('OYA_PROFILE_SECRET is required before proxy credentials can be stored'),
      { status: 409 },
    );
  }
  let parsed;
  try { parsed = new URL(url); } catch {
    throw Object.assign(new Error('proxy url must be a valid URL'), { status: 400 });
  }
  if (!['http:', 'https:', 'socks5:', 'socks:'].includes(parsed.protocol)) {
    throw Object.assign(new Error('proxy url must be http, https or socks5'), { status: 400 });
  }
  // Chromium does not implement SOCKS5 username/password auth — it drops the
  // credentials silently, and most residential vendors sell exactly that form.
  // Better to refuse than to hand back an exit that quietly does not apply.
  if (parsed.protocol.startsWith('socks') && (parsed.username || parsed.password)) {
    throw Object.assign(
      new Error('Chromium cannot authenticate SOCKS5 proxies. Use an http proxy, or terminate auth locally.'),
      { status: 400 },
    );
  }

  // The server dials this address during health checks, using its own network
  // position rather than the caller's — the same SSRF primitive as a
  // caller-supplied CDP endpoint. Private and loopback are refused unless the
  // host opts in, and link-local (cloud metadata) never.
  // Validate the address only — credentials are the normal form for a proxy,
  // and they are stripped and encrypted below rather than kept in the URL.
  await assertSafeTarget(`${parsed.protocol}//${parsed.host}`, {
    protocols: ['http:', 'https:', 'socks5:', 'socks:'],
    label: 'proxy url',
  });

  const id = 'px-' + randomBytes(6).toString('hex');
  const proxy = new Proxy({
    id, owner, label, geo, kind, maxPersonas,
    sealed: sealText(scopeFor(id), {
      url: `${parsed.protocol}//${parsed.host}`,
      username: parsed.username || null,
      password: parsed.password || null,
    }),
  });
  proxies.set(id, proxy);
  return proxy;
}

export function remove(owner, id) {
  const p = proxies.get(id);
  if (!p || (p.owner !== null && p.owner !== owner)) return false;
  if (p.owner === null) throw Object.assign(new Error('Shared proxies are host-configured'), { status: 403 });
  for (const [persona, proxyId] of assignments) if (proxyId === id) assignments.delete(persona);
  proxies.delete(id);
  return true;
}

/** What this owner can route through: their own plus shared host proxies. */
export function visible(owner) {
  return [...proxies.values()].filter((p) => p.owner === null || p.owner === owner);
}

export const list = (owner) => visible(owner).map((p) => p.toJSON());

/**
 * The proxy a persona should use, assigned once and kept.
 * @returns {Proxy|null} null when no proxy is configured at all — direct egress
 *   is a valid choice, but it should be a visible one.
 */
export function forPersona(owner, persona, { geo } = {}) {
  const existing = assignments.get(persona.id);
  if (existing) {
    const p = proxies.get(existing);
    if (p?.available) return p;
    // Its proxy is down. Reassigning changes the exit IP mid-life, which is
    // itself a signal, so say so rather than silently swapping.
    console.warn(`[proxies] ${persona.id} was on ${existing}, which is unhealthy — reassigning changes its exit IP`);
    assignments.delete(persona.id);
  }

  const wanted = geo || persona.proxy?.geo || null;
  const candidates = visible(owner)
    .filter((p) => p.available && p.assigned < p.maxPersonas)
    .filter((p) => !wanted || p.geo === wanted || String(p.geo || '').startsWith(wanted));
  if (!candidates.length) return null;

  const chosen = candidates.sort((a, b) => a.assigned - b.assigned)[0];
  assignments.set(persona.id, chosen.id);
  return chosen;
}

export function unassign(personaId) { assignments.delete(personaId); }

/** Pin a persona to one proxy. The owner check is the tenant boundary. */
export function assign(owner, personaId, proxyId) {
  const p = proxies.get(proxyId);
  if (!p || (p.owner !== null && p.owner !== owner)) return null;
  assignments.set(personaId, proxyId);
  return p;
}

/** Which proxy a persona is currently on, without assigning one. */
export function assigned(personaId) {
  const id = assignments.get(personaId);
  return id ? proxies.get(id) || null : null;
}

/**
 * Verify a proxy works and learn its exit IP, so a customer is not told an
 * identity is in Denver when its traffic leaves Frankfurt.
 */
export async function check(proxy) {
  const { url, username, password } = credentials(proxy);
  const target = new URL(process.env.OYA_PROXY_CHECK_URL || 'https://api.ipify.org?format=json');
  try {
    const body = JSON.parse(await getVia(new URL(url), username, password, target));
    proxy.succeed(body.ip || body.origin || null);
    return { ok: true, exitIp: proxy.exitIp };
  } catch (e) {
    proxy.fail();
    return { ok: false, error: e.message };
  }
}

/**
 * GET `target` through an http(s) proxy with the standard library: CONNECT to
 * the target, then TLS inside the tunnel when the target is https. (This used
 * to import undici, which the server does not depend on, so every check
 * failed and put a working proxy into cooldown.)
 */
function getVia(proxyUrl, username, password, target) {
  const secureTarget = target.protocol === 'https:';
  const port = Number(target.port) || (secureTarget ? 443 : 80);
  const auth = username ? { 'Proxy-Authorization': `Basic ${Buffer.from(`${username}:${password || ''}`).toString('base64')}` } : {};
  return new Promise((resolve, reject) => {
    let tunnel;
    const req = (proxyUrl.protocol === 'https:' ? https : http).request({
      host: proxyUrl.hostname, port: Number(proxyUrl.port) || (proxyUrl.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT', path: `${target.hostname}:${port}`, headers: { host: `${target.hostname}:${port}`, ...auth },
    });
    const timer = setTimeout(() => { req.destroy(); tunnel?.destroy(); reject(new Error('proxy check timed out')); }, CHECK_TIMEOUT_MS);
    const finish = (err, body) => { clearTimeout(timer); tunnel?.destroy(); err ? reject(err) : resolve(body); };
    req.on('error', (e) => finish(e));
    req.on('connect', (res, socket) => {
      tunnel = socket;
      if (res.statusCode !== 200) return finish(new Error(`proxy answered ${res.statusCode}`));
      const get = (secureTarget ? https : http).request({
        host: target.hostname, port, path: target.pathname + target.search, method: 'GET', agent: false,
        headers: { host: target.host, connection: 'close' },
        createConnection: () => (secureTarget ? tls.connect({ socket, servername: target.hostname }) : socket),
      }, (r) => {
        let data = '';
        r.setEncoding('utf8');
        r.on('data', (c) => { data += c; });
        r.on('end', () => (r.statusCode === 200 ? finish(null, data) : finish(new Error(`check returned ${r.statusCode}`))));
      });
      get.on('error', (e) => finish(e));
      get.end();
    });
    req.end();
  });
}

export async function checkAll(owner) {
  return Promise.all(visible(owner).map(async (p) => ({ id: p.id, ...(await check(p)) })));
}

/**
 * A timezone that does not match the exit IP's country is one of the cheapest
 * detections there is. Reported rather than enforced — the geo data needed to
 * fix it automatically is not something this server has.
 */
export function coherence(persona, fingerprint, proxy) {
  if (!proxy?.geo || !fingerprint?.timezone) return { checked: false };
  const country = String(proxy.geo).slice(0, 2).toUpperCase();
  const zone = String(fingerprint.timezone);
  const region = zone.split('/')[0];
  const plausible = {
    US: ['America', 'Pacific'], CA: ['America'], GB: ['Europe'], DE: ['Europe'],
    FR: ['Europe'], NL: ['Europe'], ES: ['Europe'], IT: ['Europe'],
    AU: ['Australia'], JP: ['Asia'], SG: ['Asia'], IN: ['Asia'], BR: ['America'],
  }[country];
  if (!plausible) return { checked: false };
  const ok = plausible.includes(region);
  if (!ok) metrics.proxyIncoherent.inc({});
  return {
    checked: true, ok, country, timezone: zone,
    detail: ok ? null : `persona ${persona.id} reports ${zone} but exits in ${country}`,
  };
}

/**
 * A residential exit out of the box, from one vendor gateway the operator pays
 * for (OYA_RESIDENTIAL_PROXY_URL). Used only when a persona has no proxy of its
 * own. `{session}` becomes a sticky id derived from the persona, so an identity
 * keeps its exit IP across connects; `{geo}` becomes its two-letter country.
 * Vendors spell these inside the username, e.g.
 *   http://user-country-{geo}-session-{session}:pass@gate.vendor.com:7000
 * ponytail: sticky for as long as the vendor holds a session (often 30 min to
 * 24 h); a per-persona vendor sub-user is the upgrade if IPs must never move.
 */
export function residential(persona, env = process.env) {
  const template = env.OYA_RESIDENTIAL_PROXY_URL;
  if (!template || !persona?.id) return null;
  const geo = String(persona.proxy?.geo || env.OYA_RESIDENTIAL_PROXY_GEO || 'US').slice(0, 2).toLowerCase();
  const session = createHash('sha256').update(`residential:${persona.id}`).digest('hex').slice(0, 16);
  const u = new URL(template.replaceAll('{session}', session).replaceAll('{geo}', geo));
  return {
    url: `${u.protocol}//${u.host}`,
    username: decodeURIComponent(u.username) || null,
    password: decodeURIComponent(u.password) || null,
    geo: geo.toUpperCase(),
  };
}

/** Test hook. */
export function reset() { proxies.clear(); assignments.clear(); }
