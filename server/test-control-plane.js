#!/usr/bin/env node
/**
 * Control plane: metrics, usage accounting, audit trail, rate limits, quotas
 * and operator control actions.
 */

import { createServer } from 'http';
import express from 'express';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join as joinPath } from 'path';

process.env.OYA_DATA_DIR = mkdtempSync(joinPath(tmpdir(), 'oya-test-'));
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
process.env.API_KEYS = 'admin-key';
process.env.FLEET_TOKEN = 'tenant-key';
process.env.OYA_LIMIT_COMMANDS_PER_MIN = '60';
process.env.OYA_LIMIT_COMMANDS_BURST = '3';
process.env.OYA_METRICS_TOKEN = 'scrape-token';
process.env.OYA_OPERATOR_TOKEN = 'operator-token';

const { router } = await import('./src/api.js');
const { registry } = await import('./src/connection-registry.js');
const { metrics } = await import('./src/metrics.js');
const usage = await import('./src/usage.js');
const { recent } = await import('./src/audit.js');

let passed = 0, failed = 0;
const assert = (c, label) => {
  if (c) { console.log(`  ✅ ${label}`); passed++; }
  else { console.log(`  ❌ ${label}`); failed++; }
};

const app = express();
app.use(express.json());
app.use('/api', router);
app.use('/', router);
const server = createServer(app);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const call = async (path, { method = 'GET', body, key = 'admin-key', raw = false } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, headers: res.headers, body: raw ? await res.text() : await res.json().catch(() => ({})) };
};

try {
  console.log('\n1️⃣  Metrics exposition...');
  metrics.commands.inc({ action: 'navigate', outcome: 'ok' });
  metrics.commandDuration.observe({ action: 'navigate' }, 42);

  const anon = await fetch(`${base}/metrics`);
  assert(anon.status === 403, `unauthenticated scrape is refused (got ${anon.status})`);
  const byApiKey = await call('/metrics', { key: 'admin-key', raw: true });
  assert(byApiKey.status === 403, 'an API key cannot scrape host metrics');
  const scraped = await call('/metrics', { key: 'operator-token', raw: true });
  assert(scraped.status === 200, 'the operator token can scrape');
  assert(/^# HELP /m.test(scraped.body), 'output is Prometheus text exposition');
  assert(/oya_commands_total\{action="navigate",outcome="ok"\} \d+/.test(scraped.body), 'counters carry their labels');
  assert(/oya_command_duration_ms_bucket\{.*le="50"\}/.test(scraped.body), 'histogram emits cumulative buckets');
  assert(/oya_event_loop_lag_p99_ms/.test(scraped.body), 'event loop health is exported');

  const fleet = await call('/api/fleet', { key: 'tenant-key' });
  assert(fleet.status === 200, 'any key can read its own fleet view — no admin tier');
  assert(typeof fleet.body.browsers.total === 'number', 'its browser count is reported');
  assert(fleet.body.routing && fleet.body.usage, 'routing and usage come with it');

  console.log('\n2️⃣  Cardinality is bounded...');
  // A per-browser label would be one series per browser at 5k. Prove the
  // registry refuses to grow without bound instead.
  for (let i = 0; i < 2500; i++) metrics.commands.inc({ action: `act${i}`, outcome: 'ok' });
  assert(metrics.commands.series.size <= 2000, `label explosion is capped (${metrics.commands.series.size} series)`);

  console.log('\n3️⃣  Rate limits enforce...');
  // A driver-backed browser answers immediately, which also exercises the
  // outbound dispatch path a CDP browser uses.
  registry.add('b-1', {
    apiKey: 'tenant-key', name: 'B1', clientType: 'cdp', provider: 'cdp',
    driver: { send: async () => ({ ok: true, data: {} }), close() {} },
  });
  const codes = [];
  for (let i = 0; i < 5; i++) {
    const r = await call('/api/browsers/b-1/command', { method: 'POST', body: { action: 'noop' }, key: 'tenant-key' });
    codes.push(r.status);
  }
  assert(codes.filter((c) => c === 429).length >= 2, `burst of 3 then 429 (got ${codes.join(',')})`);
  const limited = await call('/api/browsers/b-1/command', { method: 'POST', body: { action: 'noop' }, key: 'tenant-key' });
  assert(limited.headers.get('retry-after'), 'a 429 carries Retry-After');
  assert(limited.headers.get('ratelimit-limit') === '60', 'RateLimit-Limit header is set');

  const otherKey = await call('/api/browsers/b-1/command', { method: 'POST', body: { action: 'noop' }, key: 'admin-key' });
  assert(otherKey.status !== 429, "one key's limit does not affect another");

  console.log('\n4️⃣  Usage accounting...');
  usage.record('tenant-key', 'commands', 5);
  usage.record('tenant-key', 'chat_input_tokens', 1200);
  const mine = await call('/api/usage', { key: 'tenant-key' });
  assert(mine.status === 200, 'a tenant can read its own usage without admin rights');
  assert(mine.body.current.commands >= 5, 'commands are counted for the calling key');
  assert(mine.body.current.chat_input_tokens === 1200, 'model tokens are counted');
  assert(mine.body.limits.command.limit === 60, 'remaining allowance is reported back');
  assert(mine.body.current.rate_limited > 0, 'rate-limited requests are recorded against the key');

  const otherView = await call('/api/usage', { key: 'admin-key' });
  assert(otherView.body.current.commands === 0, "one key cannot see another key's usage");

  console.log('\n5️⃣  Audit trail...');
  await call('/api/pool/cookies', { method: 'DELETE', key: 'tenant-key' });
  const trail = await call('/api/audit', { key: 'tenant-key' });
  assert(trail.status === 200, 'any key can read its own audit trail');
  const clear = trail.body.events.find((e) => e.action === 'cookies.clear');
  assert(clear != null, 'clearing cookies is audited');
  assert(clear.actor && clear.actor !== 'tenant-key', 'the actor is a fingerprint, not the key');
  assert(clear.ip != null, 'the source address is recorded');

  const otherTrail = await call('/api/audit', { key: 'admin-key' });
  assert(!(otherTrail.body.events || []).some((e) => e.action === 'cookies.clear'),
    "one key does not see another key's audit events");

  console.log('\n6️⃣  Operator control...');
  assert((await call('/api/browsers/b-1/disconnect', { method: 'POST', key: 'admin-key' })).status === 404,
    "a key cannot disconnect another key's browser");
  assert((await call('/api/browsers/b-1/disconnect', { method: 'POST', key: 'tenant-key' })).status === 200,
    'a key can disconnect its own browser');
  assert(!registry.isConnected('b-1'), 'the browser is gone from the registry');
  assert(recent({ action: 'browser.disconnect' }).length > 0, 'the disconnect is audited');

  const drain = await call('/api/operator/drain', { method: 'POST', body: { draining: true }, key: 'operator-token' });
  assert(drain.body.draining === true, 'the operator token can drain the host');
  assert(registry.draining === true, 'the WebSocket handler will see it');
  await call('/api/operator/drain', { method: 'POST', body: { draining: false }, key: 'operator-token' });

  assert((await call('/api/operator/drain', { method: 'POST', key: 'tenant-key' })).status === 403,
    'an API key cannot drain the host');

  console.log('\n7️⃣  Providers...');
  const providers = await call('/api/providers', { key: 'tenant-key' });
  assert(providers.body.providers.some((p) => p.name === 'cdp' && p.configured), 'the bring-your-own-CDP provider is always available');
  assert(providers.body.providers.some((p) => p.name === 'anchor'), 'hosted providers are listed with their config state');

  const badConnect = await call('/api/browsers/connect', { method: 'POST', body: { provider: 'cdp' }, key: 'tenant-key' });
  assert(badConnect.status === 400, 'connecting without a wsUrl is rejected');
  console.log('\n8.  The host does not dial caller-supplied private addresses...');
  const { assertSafeTarget } = await import('./src/net-guard.js');
  delete process.env.OYA_ALLOW_PRIVATE_TARGETS;
  const hostile = ['ws://127.0.0.1:6379/', 'ws://169.254.169.254/', 'wss://[::1]/x', 'ws://10.1.2.3/x',
    'ws://user:pw@example.com/', 'http://example.com/', 'garbage'];
  let blocked = 0;
  for (const url of hostile) {
    try { await assertSafeTarget(url, { label: 'wsUrl' }); }
    catch (e) { if (e.status === 400) blocked++; }
  }
  assert(blocked === hostile.length, `all ${hostile.length} unsafe targets refused (${blocked})`);

  const viaApi = await call('/api/gateway/providers', { method: 'POST', key: 'tenant-key',
    body: { name: 'ssrf', type: 'cdp', wsUrl: 'ws://169.254.169.254/' } });
  assert(viaApi.status === 400, `provider registration refuses a metadata address (got ${viaApi.status})`);

  process.env.OYA_ALLOW_PRIVATE_TARGETS = 'true';
  const allowed = await assertSafeTarget('ws://127.0.0.1:9222/x', { label: 'wsUrl' }).then(() => true, () => false);
  assert(allowed, 'a single-operator host can opt in to loopback targets');
  // The escape hatch must not cover cloud metadata: opting into loopback for a
  // laptop should never open 169.254.169.254 on a cloud VM.
  const stillBlocked = [];
  for (const url of ['ws://169.254.169.254/', 'wss://[fe80::1]/x', 'ws://0.0.0.0/x']) {
    const ok = await assertSafeTarget(url, { label: 'wsUrl' }).then(() => true, () => false);
    if (!ok) stillBlocked.push(url);
  }
  assert(stillBlocked.length === 3, 'link-local and reserved stay blocked even with the opt-in on');
  delete process.env.OYA_ALLOW_PRIVATE_TARGETS;

  console.log('\n9.  Operator token is header-only...');
  const viaQuery = await fetch(`${base}/metrics?token=operator-token`);
  assert(viaQuery.status === 403, `a token in the query string is not accepted (got ${viaQuery.status})`);
  assert((await call('/metrics', { key: 'operator-token', raw: true })).status === 200, 'the header is');

  console.log('\n10. Routing strategy is per key...');
  await call('/api/gateway/strategy', { method: 'POST', key: 'tenant-key', body: { strategy: 'latency' } });
  const mineStrategy = await call('/api/gateway/providers', { key: 'tenant-key' });
  const theirStrategy = await call('/api/gateway/providers', { key: 'admin-key' });
  assert(mineStrategy.body.strategy === 'latency', "the key's own strategy changed");
  assert(theirStrategy.body.strategy !== 'latency', "another key's routing is unaffected");
} catch (e) {
  console.log(`  ❌ threw: ${e.message}\n${e.stack}`);
  failed++;
} finally {
  await new Promise((r) => server.close(r));
}

console.log('\n──────────────────────────────────────────────────');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('──────────────────────────────────────────────────');
process.exit(failed ? 1 : 0);
