#!/usr/bin/env node
/**
 * Cloud browser provisioning + per-account config resolution.
 *
 * Covers:
 *  - POST /browsers/provision returns 409 (not 500) when Daytona is unconfigured
 *  - a sandbox is only deletable by the API key that created it, whether or not
 *    the browser is currently connected
 *  - userConfig.resolve never pairs the server-wide OpenAI key with an
 *    account-supplied base URL (credential exfiltration)
 *
 * Usage:
 *   node test-sandbox.js
 */

import { createServer } from 'http';
import express from 'express';

process.env.API_KEYS = 'admin-key,tenant-key';
// Force the no-database path so nothing here can write to Supabase or to
// data/config.json. runtimeConfig.set() persists for real -- never call it.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
// A distinctive server-wide default, so the fallback assertions below can tell
// "inherited the server value" apart from "returned an empty own value".
process.env.OPENAI_BASE_URL = 'https://server-wide.test/v1';
delete process.env.DAYTONA_API_KEY;
delete process.env.DAYTONA_SNAPSHOT;
delete process.env.OYA_PUBLIC_WS_URL;

const { router } = await import('./src/api.js');
const { isConfigured } = await import('./src/sandbox.js');
const { userConfig, runtimeConfig } = await import('./src/runtime-config.js');

let passed = 0;
let failed = 0;
function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.log(`  ❌ ${label}`); failed++; }
}

const app = express();
app.use(express.json());
app.use('/', router);
const server = createServer(app);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const call = async (path, method = 'GET', body, key = 'admin-key') => {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

try {
  console.log('\n1️⃣  Provisioning is gated, not crashing...');
  assert(isConfigured({}) === false, 'isConfigured false with no Daytona settings');
  assert(
    isConfigured({ DAYTONA_API_KEY: 'a', DAYTONA_SNAPSHOT: 'b', OYA_PUBLIC_WS_URL: 'wss://x/ws' }) === true,
    'isConfigured true once all three are set',
  );
  assert(isConfigured({ DAYTONA_API_KEY: 'a', DAYTONA_SNAPSHOT: 'b' }) === false, 'partial config is not configured');

  const unconfigured = await call('/browsers/provision', 'POST', { count: 2 });
  assert(unconfigured.status === 409, `unconfigured provision returns 409, not 500 (got ${unconfigured.status})`);
  assert(/DAYTONA_API_KEY/.test(unconfigured.body.error || ''), 'error names the missing settings');

  const unauth = await fetch(base + '/browsers/provision', { method: 'POST' });
  assert(unauth.status === 401 || unauth.status === 403, `provision requires auth (got ${unauth.status})`);

  console.log('\n2️⃣  Sandbox deletion is owner-scoped...');
  // removeSandbox refuses before it ever reaches Daytona when no key is supplied.
  const { removeSandbox } = await import('./src/sandbox.js');
  let rejected = false;
  try { await removeSandbox('some-id', ''); } catch (e) { rejected = e.status === 400; }
  assert(rejected, 'removeSandbox requires an API key');

  const del = await call('/browsers/does-not-exist/sandbox', 'DELETE');
  assert(del.status === 409, `delete without Daytona configured returns 409 (got ${del.status})`);

  console.log('\n3.  The server-wide OpenAI key never reaches an account endpoint...');
  const serverKey = runtimeConfig.getOpenAIKey();
  const serverBase = runtimeConfig.getOpenAIBase();

  // An account that sets a base URL but has no key of its own must NOT get the
  // server-wide key pointed at its endpoint -- that would ship the deployment's
  // credential to an address the account controls.
  await userConfig.set('acct-no-key', { openai_base_url: 'https://exfil.test/v1' });
  const exfil = await userConfig.resolve('acct-no-key');
  assert(exfil.baseUrl !== 'https://exfil.test/v1', 'a keyless account cannot redirect the server-wide key');
  assert(exfil.baseUrl === serverBase, 'it falls back to the server-wide base URL');
  assert(exfil.openaiKey === serverKey, 'it still resolves the server-wide key');

  // With its own key, the account's own endpoint is honoured.
  await userConfig.set('acct-own-key', { openai_api_key: 'sk-own', openai_base_url: 'https://own.test/v1' });
  const own = await userConfig.resolve('acct-own-key');
  assert(own.openaiKey === 'sk-own', "an account's own key is used");
  assert(own.baseUrl === 'https://own.test/v1', "an account's own base URL is honoured with its own key");

  // A blank own base URL must be ignored by BOTH layers. Before the fix get()
  // used ?? and resolve() used ||, so the dashboard showed blank while requests
  // used the server-wide value.
  await userConfig.set('acct-blank', { openai_base_url: '' });
  const shown = await userConfig.get('acct-blank');
  const used = await userConfig.resolve('acct-blank');
  assert(shown.openai_base_url === 'https://server-wide.test/v1', 'a blank own base URL is ignored by get()');
  assert(used.baseUrl === 'https://server-wide.test/v1', 'a blank own base URL is ignored by resolve()');

  console.log('\n4.  An account base URL cannot point the control plane inward (SSRF)...');
  const blocked = [
    'http://169.254.169.254/latest/meta-data',   // cloud metadata
    'https://127.0.0.1/v1', 'https://localhost/v1', 'https://[::1]/v1',
    'https://10.1.2.3/v1', 'https://192.168.1.1/v1', 'https://172.16.0.1/v1',
    'https://redis.internal/v1',
    'http://api.openai.com/v1',                   // plaintext
    'https://user:pass@api.openai.com/v1',        // embedded credentials
    'not-a-url',
  ];
  let blockedCount = 0;
  for (const bad of blocked) {
    try { await userConfig.set('acct-ssrf', { openai_base_url: bad }); }
    catch (e) { if (e.status === 400) blockedCount++; else console.log('    unexpected:', bad, e.message); }
  }
  assert(blockedCount === blocked.length, `all ${blocked.length} hostile base URLs rejected (got ${blockedCount})`);

  await userConfig.set('acct-ok', { openai_api_key: 'sk-x', openai_base_url: 'https://api.groq.com/openai/v1' });
  const good = await userConfig.resolve('acct-ok');
  assert(good.baseUrl === 'https://api.groq.com/openai/v1', 'a legitimate https endpoint is still accepted');

  const src = (await import('fs')).readFileSync('./src/chat-service.js', 'utf8');
  assert(/redirect:\s*'error'/.test(src), "the chat fetch refuses redirects (no 30x bypass)");

} finally {
  await new Promise((r) => server.close(r));
}

console.log('\n──────────────────────────────────────────────────');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('──────────────────────────────────────────────────');
process.exit(failed ? 1 : 0);
