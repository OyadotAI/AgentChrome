#!/usr/bin/env node
/**
 * End-to-end test: starts the server, launches 5 real Oya Browser instances,
 * then runs pool + cookie sync + round-robin tests you can watch.
 *
 * Usage:
 *   node test-e2e.js
 */

import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { setTimeout as sleep } from 'timers/promises';

const ROOT = import.meta.dirname;
const SERVER_DIR = join(ROOT, 'server');
const BROWSER_DIR = join(ROOT, 'browser');
const ELECTRON = join(BROWSER_DIR, 'node_modules', '.bin', 'electron');
const PORT = 13500;
const FLEET_TOKEN = 'test-fleet-e2e-token-' + Date.now();
const ADMIN_KEY = 'admin-e2e-key-' + Date.now();
const NUM_BROWSERS = 2;
const TMP_DIR = join(ROOT, '.test-e2e-tmp');

const procs = [];
let passed = 0, failed = 0;

// ── Helpers ──────────────────────────────────────────────────────────────

function log(icon, msg) { console.log(`  ${icon}  ${msg}`); }
function header(msg) { console.log(`\n${'━'.repeat(60)}\n  ${msg}\n${'━'.repeat(60)}`); }

function assert(cond, label) {
  if (cond) { log('✅', label); passed++; }
  else { log('❌', label); failed++; }
}

async function api(method, path, body, key = FLEET_TOKEN) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(95000), // navigate can take 90s
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}${path}`, opts);
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch (e) {
    return { status: 0, data: { ok: false, error: e.message } };
  }
}

async function waitFor(fn, label, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(500);
  }
  log('⏰', `Timeout: ${label}`);
  return false;
}

// ── Cleanup ──────────────────────────────────────────────────────────────

function cleanup() {
  for (const p of procs) {
    try { p.kill('SIGTERM'); } catch {}
  }
  // Give processes a moment, then force kill
  setTimeout(() => {
    for (const p of procs) {
      try { p.kill('SIGKILL'); } catch {}
    }
    try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
  }, 2000);
}

process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('uncaughtException', (e) => { console.error('\n💥', e); cleanup(); process.exit(1); });

// ── Start Server ─────────────────────────────────────────────────────────

header('Starting server');

const serverProc = spawn('node', ['src/index.js'], {
  cwd: SERVER_DIR,
  env: {
    ...process.env,
    PORT: String(PORT),
    FLEET_TOKEN,
    API_KEYS: ADMIN_KEY,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
procs.push(serverProc);

serverProc.stdout.on('data', d => {
  const line = d.toString().trim();
  if (line) log('🖥️', `server: ${line}`);
});
serverProc.stderr.on('data', d => {
  const line = d.toString().trim();
  if (line) log('🖥️', `server err: ${line}`);
});

// Wait for server to be ready
const serverReady = await waitFor(async () => {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`);
    return r.ok;
  } catch { return false; }
}, 'server ready', 15000);

if (!serverReady) {
  console.error('Server failed to start');
  cleanup();
  process.exit(1);
}
log('🟢', `Server running on port ${PORT}`);

// ── Launch 5 Browsers ────────────────────────────────────────────────────

header(`Launching ${NUM_BROWSERS} browsers`);

// Create temp user data dirs with pre-written config
mkdirSync(TMP_DIR, { recursive: true });

for (let i = 1; i <= NUM_BROWSERS; i++) {
  const dataDir = join(TMP_DIR, `browser-${i}`);
  mkdirSync(dataDir, { recursive: true });

  // Pre-write config so the browser auto-connects
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
    serverUrl: `ws://127.0.0.1:${PORT}/ws`,
    apiKey: FLEET_TOKEN,
    browserName: `Browser-${i}`,
  }));

  const browserProc = spawn(ELECTRON, ['.', `--user-data-dir=${dataDir}`], {
    cwd: BROWSER_DIR,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    stdio: 'ignore',
  });
  procs.push(browserProc);
  log('🌐', `Launched Browser-${i} (pid ${browserProc.pid})`);
}

// Wait for all browsers to connect
log('⏳', 'Waiting for all browsers to connect...');
const allConnected = await waitFor(async () => {
  try {
    const r = await api('GET', '/pool');
    return r.data?.size === NUM_BROWSERS;
  } catch { return false; }
}, `${NUM_BROWSERS} browsers connected`, 30000);

if (!allConnected) {
  const r = await api('GET', '/pool');
  log('⚠️', `Only ${r.data?.size || 0}/${NUM_BROWSERS} browsers connected — continuing anyway`);
}

const poolRes = await api('GET', '/pool');
const poolSize = poolRes.data?.size || 0;
log('🟢', `Pool ready: ${poolSize} browsers connected`);

// ── Tests ────────────────────────────────────────────────────────────────

header('Test 1: Pool Status');
{
  const r = await api('GET', '/pool');
  assert(r.status === 200, 'GET /pool returns 200');
  assert(r.data.size >= 3, `Pool has ${r.data.size} browsers`);
  for (const b of r.data.browsers) {
    log('   ', `${b.name} (${b.id.slice(0, 8)})`);
  }
}

header('Test 2: Screenshot (browsers still have google.com)');
{
  // Don't try to navigate — google.com is already loaded. Take a screenshot.
  log('⏳', 'Waiting 12s for google.com to finish loading...');
  await sleep(12000);

  // Screenshot uses CDP Page.captureScreenshot — doesn't need content scripts
  const pool = await api('GET', '/pool');
  const bid = pool.data?.browsers?.[0]?.id;
  if (bid) {
    const r = await api('POST', `/browsers/${bid}/command`, { action: 'screenshot' });
    if (r.data?.ok) {
      const img = r.data?.data?.screenshot || '';
      assert(img.startsWith('data:image/png'), `Screenshot from ${bid.slice(0, 12)}: ${Math.round(img.length / 1024)}KB PNG`);
    } else {
      assert(false, `Screenshot failed: ${r.data?.error}`);
    }
  }
}

header('Test 3: Round-Robin via pool/command (list_tabs)');
{
  // list_tabs is fast — it doesn't need content scripts, just chrome.tabs.query
  const results = [];
  for (let i = 0; i < 5; i++) {
    const r = await api('POST', '/pool/command', { action: 'list_tabs' });
    if (r.data?.ok) {
      const tabs = r.data?.data?.tabs || [];
      assert(true, `list_tabs ${i + 1} → ${r.data?._browser?.slice(0, 12)} (${tabs.length} tabs)`);
    } else {
      assert(false, `list_tabs ${i + 1} failed: ${r.data?.error}`);
    }
    results.push(r.data?._browser);
  }

  const unique = new Set(results.filter(Boolean));
  assert(unique.size >= 3, `Commands hit ${unique.size} different browsers (round-robin)`);

  // 6th command wraps
  const r6 = await api('POST', '/pool/command', { action: 'list_tabs' });
  assert(r6.data?._browser === results[0], `Round-robin wraps back to first browser`);
}

header('Test 4: Navigate to example.com + Analyze');
{
  // Navigate ONE browser sequentially (not parallel)
  const pool = await api('GET', '/pool');
  const bid = pool.data?.browsers?.[0]?.id;
  log('   ', `Navigating ${bid?.slice(0, 12)} to example.com...`);

  const nav = await api('POST', `/browsers/${bid}/command`, { action: 'navigate', params: { url: 'https://example.com' } });
  if (nav.data?.ok) {
    assert(true, `Navigated to example.com`);
    await sleep(2000);

    const r = await api('POST', `/browsers/${bid}/command`, { action: 'analyze' });
    if (r.data?.ok) {
      const md = r.data?.data?.markdown || '';
      assert(md.length > 20, `Analyze returned ${md.length} chars of markdown`);
      log('   ', `Preview: ${md.slice(0, 100).replace(/\n/g, ' ')}...`);
      const els = r.data?.data?.elements || [];
      assert(els.length > 0, `Found ${els.length} interactive elements`);
    } else {
      assert(false, `Analyze failed: ${r.data?.error}`);
    }
  } else {
    assert(false, `Navigate failed: ${nav.data?.error}`);
  }
}

header('Test 5: Cookie Sync');
{
  // Cookies from google.com should already be in the shared jar
  const jar = await api('GET', '/pool/cookies');
  const cookies = jar.data?.cookies || [];
  assert(cookies.length > 0, `Cookie jar has ${cookies.length} cookies synced across pool`);
  if (cookies.length > 0) {
    log('🍪', `Cookies: ${cookies.slice(0, 5).map(c => `${c.name}@${c.domain}`).join(', ')}${cookies.length > 5 ? '...' : ''}`);
  }
}

header('Test 6: Fleet Provision');
{
  const r = await api('POST', '/fleet/provision?count=10', null, ADMIN_KEY);
  assert(r.status === 200, 'Provision returns 200');
  assert(r.data?.keys?.length === 10, `Generated ${r.data?.keys?.length} keys`);
  log('   ', `Sample key: ${r.data?.keys?.[0]?.slice(0, 16)}...`);
}

header('Test 7: Swagger & Docs');
{
  const sw = await fetch(`http://127.0.0.1:${PORT}/swagger/`);
  assert(sw.status === 200, 'Swagger UI loads');

  const docs = await fetch(`http://127.0.0.1:${PORT}/docs`);
  assert(docs.status === 200, 'Docs page loads');

  const llms = await fetch(`http://127.0.0.1:${PORT}/llms.txt`);
  const llmsText = await llms.text();
  assert(llmsText.includes('/mcp/pool'), 'llms.txt has pool docs');

  const spec = await (await fetch(`http://127.0.0.1:${PORT}/openapi.json`)).json();
  assert('/pool' in spec.paths, 'OpenAPI has /pool endpoint');
  assert('/mcp/pool' in spec.paths, 'OpenAPI has /mcp/pool endpoint');
}

header('Test 8: Landing Page');
{
  const r = await fetch(`http://127.0.0.1:${PORT}/`);
  const html = await r.text();
  assert(html.includes('id="pool"'), 'Landing page has pool section');
  assert(html.includes('FLEET_TOKEN'), 'Landing page mentions FLEET_TOKEN');
  assert(html.includes('/mcp/pool'), 'Landing page shows pool MCP endpoint');
}

// ── Summary ──────────────────────────────────────────────────────────────

header('Results');
console.log(`  ${passed} passed, ${failed} failed\n`);

if (failed === 0) {
  log('🎉', 'All tests passed!');
} else {
  log('💔', `${failed} test(s) failed`);
}

console.log('\n  Browsers are still running — press Ctrl+C to close everything.\n');

// Keep running so user can see the browsers
// Ctrl+C triggers cleanup via SIGINT handler above
await new Promise(() => {}); // hang forever
