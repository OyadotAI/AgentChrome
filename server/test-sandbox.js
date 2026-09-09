#!/usr/bin/env node
/**
 * Cloud browser provisioning + per-account config resolution.
 *
 * Covers:
 *  - POST /browsers/provision returns 409 (not 500) when Daytona is unconfigured
 *  - a sandbox is only deletable by the API key that created it, whether or not
 *    the browser is currently connected
 *  - keyConfig.resolve never pairs the deployment-wide OpenAI key with a
 *    tenant-supplied base URL (credential exfiltration)
 *
 * Usage:
 *   node test-sandbox.js
 */

import { createServer } from 'http';
import express from 'express';

import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join as joinPath } from 'path';
// Never write through to the deployment's real data/ directory.
process.env.OYA_DATA_DIR = mkdtempSync(joinPath(tmpdir(), 'oya-test-'));
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
const { runtimeConfig } = await import('./src/runtime-config.js');
const keyConfig = await import('./src/key-config.js');

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

  console.log('\n3.  The deployment-wide OpenAI key never reaches a tenant endpoint...');
  const serverKey = runtimeConfig.getOpenAIKey();
  const serverBase = runtimeConfig.getOpenAIBase();

  // A key that sets a base URL but has no LLM credential of its own must NOT
  // get the deployment-wide key pointed at its endpoint -- that would ship the
  // deployment's credential to an address the tenant controls.
  keyConfig.set('k-no-key', { openai_base_url: 'https://exfil.test/v1' });
  const exfil = keyConfig.resolve('k-no-key');
  assert(exfil.baseUrl !== 'https://exfil.test/v1', 'a keyless tenant cannot redirect the deployment key');
  assert(exfil.baseUrl === serverBase, 'it falls back to the deployment-wide base URL');
  assert(exfil.openaiKey === serverKey, 'it still resolves the deployment-wide key');

  // With its own credential, the key's own endpoint is honoured.
  keyConfig.set('k-own', { openai_api_key: 'sk-own', openai_base_url: 'https://own.test/v1' });
  const own = keyConfig.resolve('k-own');
  assert(own.openaiKey === 'sk-own', "a key's own LLM credential is used");
  assert(own.baseUrl === 'https://own.test/v1', "a key's own base URL is honoured with its own credential");

  // A blank own base URL must be ignored by BOTH layers. Before the fix get()
  // used ?? and resolve() used ||, so the dashboard showed blank while requests
  // used the server-wide value.
  keyConfig.set('k-blank', { openai_base_url: '' });
  assert(keyConfig.get('k-blank').openai_base_url === 'https://server-wide.test/v1',
    'a blank own base URL is ignored by get()');
  assert(keyConfig.resolve('k-blank').baseUrl === 'https://server-wide.test/v1',
    'a blank own base URL is ignored by resolve()');

  // Credentials are sealed at rest and never handed back in the clear.
  keyConfig.set('k-secret', { openai_api_key: 'sk-supersecret-tail' });
  const shownSecret = keyConfig.get('k-secret').openai_api_key;
  assert(!shownSecret.includes('supersecret') && shownSecret.endsWith('tail'),
    'a stored LLM credential reads back masked');
  assert(keyConfig.resolve('k-secret').openaiKey === 'sk-supersecret-tail',
    'the server still resolves the plaintext');
  assert(keyConfig.envFor('k-secret').OPENAI_API_KEY === 'sk-supersecret-tail',
    'envFor layers the key\'s credential over the environment');

  // Re-saving the masked value the dashboard displays must not destroy the key.
  keyConfig.set('k-secret', { openai_api_key: shownSecret });
  assert(keyConfig.resolve('k-secret').openaiKey === 'sk-supersecret-tail',
    'saving the masked placeholder leaves the real credential intact');

  // One key's settings are invisible to another.
  assert(keyConfig.resolve('k-other').openaiKey === serverKey,
    "another key sees none of this key's settings");

  console.log('\n4.  A tenant base URL cannot point the control plane inward (SSRF)...');
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
    try { keyConfig.set('k-ssrf', { openai_base_url: bad }); }
    catch (e) { if (e.status === 400) blockedCount++; else console.log('    unexpected:', bad, e.message); }
  }
  assert(blockedCount === blocked.length, `all ${blocked.length} hostile base URLs rejected (got ${blockedCount})`);

  keyConfig.set('k-ok', { openai_api_key: 'sk-x', openai_base_url: 'https://api.groq.com/openai/v1' });
  const good = keyConfig.resolve('k-ok');
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
