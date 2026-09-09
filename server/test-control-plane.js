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
  const scraped = await call('/metrics', { key: 'scrape-token', raw: true });
  assert(scraped.status === 200, 'OYA_METRICS_TOKEN can scrape without admin rights');
  assert(/^# HELP /m.test(scraped.body), 'output is Prometheus text exposition');
  assert(/oya_commands_total\{action="navigate",outcome="ok"\} \d+/.test(scraped.body), 'counters carry their labels');
  assert(/oya_command_duration_ms_bucket\{.*le="50"\}/.test(scraped.body), 'histogram emits cumulative buckets');
  assert(/oya_event_loop_lag_p99_ms/.test(scraped.body), 'event loop health is exported');

  const json = await call('/api/admin/metrics');
  assert(json.status === 200 && json.body.metrics, 'admin JSON metrics mirror the same registry');
  assert(typeof json.body.browsers.total === 'number', 'fleet composition is reported');

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

  const across = await call('/api/admin/usage');
  assert(across.body.keys.some((k) => k.commands >= 5), 'admin sees usage across keys');
  assert(across.body.keys.every((k) => !k.actor.includes('tenant-key')), 'raw API keys are not echoed back');

  console.log('\n5️⃣  Audit trail...');
  await call('/api/pool/cookies', { method: 'DELETE', key: 'tenant-key' });
  const trail = await call('/api/admin/audit');
  assert(trail.status === 200, 'admin can read the audit trail');
  const clear = trail.body.events.find((e) => e.action === 'cookies.clear');
  assert(clear != null, 'clearing cookies is audited');
  assert(clear.actor && clear.actor !== 'tenant-key', 'the actor is a fingerprint, not the key');
  assert(clear.ip != null, 'the source address is recorded');

  const denied = await call('/api/admin/audit', { key: 'tenant-key' });
  assert(denied.status === 403, 'a tenant cannot read the audit trail');
  assert(recent({ action: 'admin.denied' }).length > 0, 'the refused attempt is itself audited');

  console.log('\n6️⃣  Operator control...');
  assert((await call('/api/admin/browsers/b-1/disconnect', { method: 'POST' })).status === 200, 'admin can force-disconnect a browser');
  assert(!registry.isConnected('b-1'), 'the browser is gone from the registry');
  assert(recent({ action: 'browser.disconnect' }).length > 0, 'the disconnect is audited');

  const drain = await call('/api/admin/drain', { method: 'POST', body: { draining: true } });
  assert(drain.body.draining === true, 'drain mode can be turned on');
  assert(registry.draining === true, 'the WebSocket handler will see it');
  await call('/api/admin/drain', { method: 'POST', body: { draining: false } });

  assert((await call('/api/admin/drain', { method: 'POST', key: 'tenant-key' })).status === 403, 'a tenant cannot drain the fleet');

  console.log('\n7️⃣  Providers...');
  const providers = await call('/api/providers', { key: 'tenant-key' });
  assert(providers.body.providers.some((p) => p.name === 'cdp' && p.configured), 'the bring-your-own-CDP provider is always available');
  assert(providers.body.providers.some((p) => p.name === 'anchor'), 'hosted providers are listed with their config state');

  const badConnect = await call('/api/browsers/connect', { method: 'POST', body: { provider: 'cdp' }, key: 'tenant-key' });
  assert(badConnect.status === 400, 'connecting without a wsUrl is rejected');
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
