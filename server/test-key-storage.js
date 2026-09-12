#!/usr/bin/env node
/**
 * The API key must never reach the database.
 *
 * api_keys used to store the bearer credential itself, so any read of that
 * table — a backup, a replica, a support export, an over-broad grant — handed
 * over working administrator credentials for every tenant. It now stores
 * sha256(key) plus an 8-character prefix.
 *
 * A unit test cannot catch a `.eq('key', …)` that should have been
 * `.eq('key_hash', …)`: those only fail against a real database. So this stands
 * a PostgREST-shaped stub in front of supabase-js, drives the real auth.js, and
 * asserts on the wire — every request, and every row written, is searched for
 * the key in the clear.
 *
 * Usage: node test-key-storage.js
 */

import { createServer } from 'http';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ── A PostgREST stub that records everything it is asked ──

/** Every request the server made: { method, url, body }. */
const seen = [];
let rows = [];

const stub = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, body });
    const send = (payload) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (!req.url.startsWith('/rest/v1/api_keys')) return send([]);
    if (req.method === 'POST') {
      const written = JSON.parse(body || '[]');
      rows.push(...(Array.isArray(written) ? written : [written]));
      return send(written);
    }
    if (req.method === 'DELETE') {
      const match = /key_hash=eq\.([0-9a-f]+)/.exec(req.url);
      rows = rows.filter((r) => r.key_hash !== match?.[1]);
      return send([{ key_hash: match?.[1] }]);
    }
    if (req.method === 'PATCH') return send([]);
    // GET: answer from what was written, filtered the way the caller asked.
    const match = /key_hash=eq\.([0-9a-f]+)/.exec(req.url);
    const user = /user_id=eq\.([^&]+)/.exec(req.url);
    let out = rows;
    if (match) out = out.filter((r) => r.key_hash === match[1]);
    if (user) out = out.filter((r) => r.user_id === decodeURIComponent(user[1]));
    send(out);
  });
});

const PORT = await new Promise((resolve) => stub.listen(0, '127.0.0.1', () => resolve(stub.address().port)));

process.env.SUPABASE_URL = `http://127.0.0.1:${PORT}`;
process.env.SUPABASE_SERVICE_KEY = 'stub-service-key';
process.env.OYA_DATA_DIR = mkdtempSync(join(tmpdir(), 'oya-keystore-'));
process.env.OYA_PROFILE_SECRET = 'test-secret-for-key-storage';

const auth = await import('./src/auth.js');
await auth.authReady;

const USER = '11111111-2222-3333-4444-555555555555';
const sha256 = (v) => createHash('sha256').update(v).digest('hex');

let passed = 0;
const check = (label, fn) => { fn(); console.log(`  ✅ ${label}`); passed++; };

// ── The key never appears on the wire ──

console.log('\n1️⃣  Registering a key sends only its digest');
const KEY = 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456';
// registerApiKey writes the row and then claims the project in the control
// store, which this stub is not pretending to be. The write is what is under
// test here; the claim is covered by test-control-api and test-login-flow.
await auth.registerApiKey(KEY, USER, 'Test project').catch(() => {});

check('a row was written', () => assert.equal(rows.length, 1));
check('it carries the digest, not the key', () => {
  assert.equal(rows[0].key_hash, sha256(KEY));
  assert.equal(rows[0].key, undefined);
});
check('it carries a prefix for display', () => assert.equal(rows[0].key_prefix, KEY.slice(0, 8)));
check('and the project the key opens', () => assert.match(rows[0].project, /^prj_[0-9a-f]{24}$/));

console.log('\n2️⃣  Nothing the server sent contains the key');
check(`${seen.length} requests, none carrying the key`, () => {
  for (const r of seen) {
    assert.ok(!r.url.includes(KEY), `key in URL: ${r.url}`);
    assert.ok(!r.body.includes(KEY), `key in body: ${r.body}`);
  }
});
check('and none of them names the old `key` column', () => {
  for (const r of seen) assert.ok(!/[?&]key=eq\./.test(r.url), `looked up by plaintext: ${r.url}`);
});

console.log('\n3️⃣  The key still authenticates, by digest');
const principal = await auth.authenticateToken(KEY);
check('a registered key is accepted', () => assert.equal(principal.role, 'administrator'));
check('and is still the credential downstream handlers get', () => assert.equal(principal.key, KEY));
await assert.rejects(auth.authenticateToken('never-registered-key-0123456789ab'), /Invalid API key/);
check('an unregistered key is refused', () => {});
check('validateApiKey works off the digest cache', () => {
  assert.equal(auth.validateApiKey(KEY), true);
  assert.equal(auth.validateApiKey('not-a-key'), false);
});

console.log('\n4️⃣  Listing keys returns metadata, never a key');
const listed = await auth.listApiKeys(USER);
check('one key is listed', () => assert.equal(listed.length, 1));
check('with an id, a prefix and a project', () => {
  assert.equal(listed[0].id, sha256(KEY));
  assert.equal(listed[0].prefix, KEY.slice(0, 8));
  assert.match(listed[0].project, /^prj_[0-9a-f]{24}$/);
});
check('and no key in the payload at all', () => {
  assert.ok(!JSON.stringify(listed).includes(KEY));
  assert.equal(listed[0].key, undefined);
});

console.log('\n5️⃣  Deleting works by digest');
await auth.deleteApiKey(listed[0].id, USER);
check('the row is gone', () => assert.equal(rows.length, 0));
check('and the digest no longer validates', () => assert.equal(auth.validateApiKey(KEY), false));

console.log(`\n  ${passed} passed, 0 failed\n`);
stub.close();
process.exit(0);
