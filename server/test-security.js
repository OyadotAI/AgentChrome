#!/usr/bin/env node
/**
 * Security test — verifies multi-tenant isolation.
 *
 * Covers the fixes for:
 *  - Cookie jar leaked across API keys (Twitter hijack report)
 *  - /mcp/:browserId empty-string auth bypass
 *  - /mcp/pool unvalidated key
 *  - POST /config allowed any tenant to rewrite the global OpenAI key
 *  - Public POST /register-key let anyone mint valid credentials
 *  - validateApiKey's "no keys configured → allow all" fallback
 *  - WebSocket browser_id takeover by a different API key
 *
 * Usage:
 *   node test-security.js
 */

import { createServer } from 'http';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';

// Configure keys BEFORE importing server modules (they read env at load).
process.env.API_KEYS = 'admin-key-security-test';
process.env.FLEET_TOKEN = 'fleet-token-security-test';

const { router: apiRouter } = await import('./src/api.js');
const { handleConnection } = await import('./src/ws-handler.js');
const { handleMcpRequest, handlePoolMcpRequest } = await import('./src/mcp-server.js');
const { validateApiKey, provisionKeys } = await import('./src/auth.js');
const { registry } = await import('./src/connection-registry.js');

const app = express();
app.use(express.json());
app.use('/api', apiRouter);
app.post('/mcp/pool', handlePoolMcpRequest);
app.get('/mcp/pool', handlePoolMcpRequest);
app.post('/mcp/:browserId', handleMcpRequest);
app.get('/mcp/:browserId', handleMcpRequest);

const server = createServer(app);
server.timeout = 0;
const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false });
wss.on('connection', (ws) => handleConnection(ws));

const PORT = await new Promise((resolve) => server.listen(0, () => resolve(server.address().port)));
console.log(`\n🔒 Security test server on port ${PORT}\n`);

// ── Helpers ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { console.log(`  ❌ ${label}`); failed++; }
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function connectBrowser(name, apiKey, explicitBrowserId) {
  return new Promise((resolve, reject) => {
    const browserId = explicitBrowserId || uuidv4();
    const messages = [];
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    let settled = false;

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'auth',
        api_key: apiKey,
        browser_id: browserId,
        browser_name: name,
      }));
    });

    ws.on('close', (code, reason) => {
      if (!settled) {
        settled = true;
        resolve({ ws, browserId, name, messages, closed: { code, reason: reason.toString() } });
      }
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      messages.push(msg);
      if (msg.type === 'auth_ok' && !settled) {
        settled = true;
        resolve({ ws, browserId, name, messages, closed: null });
      }
      if (msg.type === 'ping') {
        try { ws.send(JSON.stringify({ type: 'pong' })); } catch {}
      }
    });

    ws.on('error', () => { /* handled via close */ });
    setTimeout(() => { if (!settled) { settled = true; reject(new Error(`${name} timeout`)); } }, 3000);
  });
}

async function request(method, path, { body, key, omitAuth } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (!omitAuth && key) headers.Authorization = `Bearer ${key}`;
  if (path.startsWith('/mcp/')) headers.Accept = 'application/json, text/event-stream';
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    const text = await res.text();
    const lines = text.split('\n').filter((l) => l.startsWith('data: '));
    data = lines.map((l) => JSON.parse(l.slice(6))).pop() || {};
  } else if (ct.includes('application/json')) {
    try { data = await res.json(); } catch { data = {}; }
  } else {
    data = await res.text();
  }
  return { status: res.status, data };
}

// ── Tests ────────────────────────────────────────────────────────────────

try {
  // Provision two non-admin user keys for the multi-tenant scenarios
  const [keyA, keyB] = await provisionKeys(2);
  const adminKey = 'admin-key-security-test';

  console.log('1️⃣  Cookie isolation across API keys');
  {
    const a = await connectBrowser('Alice', keyA);
    const b = await connectBrowser('Bob', keyB);
    await wait(200);

    // Alice sets a Twitter auth cookie
    a.ws.send(JSON.stringify({
      type: 'cookie_changed',
      change: {
        removed: false,
        cookie: {
          name: 'auth_token', value: 'ALICE_SECRET',
          domain: '.twitter.com', path: '/',
          secure: true, httpOnly: true, sameSite: 'lax',
        },
      },
    }));
    await wait(300);

    // Bob must NOT receive Alice's cookie via broadcast
    const bobGotAliceBroadcast = b.messages.some(
      (m) => (m.type === 'cookie_update' || m.type === 'cookie_sync') &&
        JSON.stringify(m).includes('ALICE_SECRET'),
    );
    assert(!bobGotAliceBroadcast, "Bob's WS did not receive Alice's cookie via broadcast");

    // GET /pool/cookies with Bob's key must not include Alice's cookie
    const bobJar = await request('GET', '/api/pool/cookies', { key: keyB });
    assert(bobJar.status === 200, 'Bob can query his own jar');
    const bobSeesAlice = (bobJar.data.cookies || []).some((c) => c.value === 'ALICE_SECRET');
    assert(!bobSeesAlice, "Bob's /pool/cookies does not contain Alice's cookie");

    // Alice's own jar still has it
    const aliceJar = await request('GET', '/api/pool/cookies', { key: keyA });
    const aliceSeesOwn = (aliceJar.data.cookies || []).some((c) => c.value === 'ALICE_SECRET');
    assert(aliceSeesOwn, "Alice's /pool/cookies contains her own cookie");

    // A newly-connecting Bob-browser should receive an empty (or Alice-free) cookie_sync
    const b2 = await connectBrowser('Bob-2', keyB);
    await wait(200);
    const initialSync = b2.messages.find((m) => m.type === 'cookie_sync');
    const hasAliceOnConnect = initialSync?.cookies?.some((c) => c.value === 'ALICE_SECRET') || false;
    assert(!hasAliceOnConnect, "New browser on Bob's key does NOT receive Alice's cookies on auth");

    // Admin sees everything, split per key
    const adminJar = await request('GET', '/api/pool/cookies', { key: adminKey });
    assert(adminJar.status === 200, 'Admin can query jar');
    assert(
      adminJar.data.cookies_by_key && typeof adminJar.data.cookies_by_key === 'object',
      'Admin response includes cookies_by_key breakdown',
    );

    a.ws.close(); b.ws.close(); b2.ws.close();
    await wait(150);
  }

  console.log('\n2️⃣  /mcp/:browserId rejects unauthenticated access');
  {
    const a = await connectBrowser('Alice', keyA);
    await wait(150);

    // No Authorization header at all — previously bypassed the ownership check
    const anon = await request('POST', `/mcp/${a.browserId}`, {
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      omitAuth: true,
    });
    assert(anon.status === 401, `Unauth MCP returns 401 (got ${anon.status})`);

    // Invalid bearer
    const bogus = await request('POST', `/mcp/${a.browserId}`, {
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      key: 'not-a-real-key',
    });
    assert(bogus.status === 401, `Invalid key returns 401 (got ${bogus.status})`);

    // Valid key but different tenant — must not see Alice's browser
    const crossTenant = await request('POST', `/mcp/${a.browserId}`, {
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      key: keyB,
    });
    assert(crossTenant.status === 404, `Cross-tenant MCP returns 404 (got ${crossTenant.status})`);

    // Owner succeeds
    const owner = await request('POST', `/mcp/${a.browserId}`, {
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      key: keyA,
    });
    assert(owner.status === 200, `Owner MCP returns 200 (got ${owner.status})`);

    a.ws.close();
    await wait(150);
  }

  console.log('\n3️⃣  /mcp/pool rejects unvalidated keys');
  {
    const anon = await request('POST', '/mcp/pool', {
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      omitAuth: true,
    });
    assert(anon.status === 401, `Unauth pool MCP returns 401 (got ${anon.status})`);

    const bogus = await request('POST', '/mcp/pool', {
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      key: 'garbage-string-not-a-real-key',
    });
    assert(bogus.status === 401, `Bogus key on pool MCP returns 401 (got ${bogus.status})`);

    const ok = await request('POST', '/mcp/pool', {
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      key: keyA,
    });
    assert(ok.status === 200, `Valid key on pool MCP returns 200 (got ${ok.status})`);
  }

  console.log('\n4️⃣  POST /config is admin-only');
  {
    const tenantGet = await request('GET', '/api/config', { key: keyA });
    assert(tenantGet.status === 403, `Tenant GET /config returns 403 (got ${tenantGet.status})`);

    const tenantPost = await request('POST', '/api/config', {
      key: keyA,
      body: { openai_api_key: 'attacker-key-aaaaaaaaaaaaaaaaaaaaaaaa' },
    });
    assert(tenantPost.status === 403, `Tenant POST /config returns 403 (got ${tenantPost.status})`);

    const adminGet = await request('GET', '/api/config', { key: adminKey });
    assert(adminGet.status === 200, `Admin GET /config returns 200 (got ${adminGet.status})`);
  }

  console.log('\n5️⃣  Public /register-key is gone');
  {
    const res = await request('POST', '/api/register-key', {
      omitAuth: true,
      body: { key: 'attacker-key-12345678901234567890123456789012' },
    });
    assert(res.status === 404, `/register-key returns 404 (got ${res.status})`);
  }

  console.log('\n6️⃣  validateApiKey fails closed');
  {
    assert(validateApiKey('') === false, 'Empty key rejected');
    assert(validateApiKey('never-registered-abcdef') === false, 'Unknown key rejected');
    assert(validateApiKey(adminKey) === true, 'Admin env key accepted');
    assert(validateApiKey(keyA) === true, 'Provisioned key accepted');
    assert(validateApiKey('fleet-token-security-test') === true, 'Fleet token accepted');
  }

  console.log('\n7️⃣  WebSocket browser_id cannot be hijacked by another key');
  {
    const alice = await connectBrowser('Alice', keyA);
    await wait(150);
    assert(alice.closed === null, 'Alice authenticated successfully');
    assert(registry.get(alice.browserId)?.apiKey === keyA, 'Registry shows Alice owns browser_id');

    // Bob attempts to take over Alice's browser_id
    const attacker = await connectBrowser('Attacker', keyB, alice.browserId);
    assert(attacker.closed !== null, 'Attacker WS was closed');
    assert(
      attacker.closed?.code === 4003,
      `Attacker rejected with code 4003 (got ${attacker.closed?.code})`,
    );
    assert(
      registry.get(alice.browserId)?.apiKey === keyA,
      'Registry still shows Alice owns browser_id after hijack attempt',
    );

    // Alice's own socket was NOT kicked
    assert(alice.ws.readyState === WebSocket.OPEN, "Alice's socket still open after hijack attempt");

    alice.ws.close();
    await wait(150);
  }

  // ── Summary ──
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(`${'─'.repeat(50)}\n`);

  server.close();
  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  console.error('\n💥 Test crashed:', err);
  server.close();
  process.exit(1);
}
