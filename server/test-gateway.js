#!/usr/bin/env node
/**
 * CDP gateway end to end against a real Chrome.
 *
 * Proves the thing that matters: a plain CDP client (what Playwright,
 * Puppeteer, Stagehand and browser-use all are underneath) can point at this
 * control plane and drive a browser, with routing, profiles, reconnection and
 * recording layered on without the client knowing.
 */

import { createServer } from 'http';
import express from 'express';
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WebSocket } from 'ws';

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => existsSync(p));
if (!CHROME) { console.log('⏭  No Chrome binary — skipping gateway test'); process.exit(0); }

const DATA = mkdtempSync(join(tmpdir(), 'oya-gw-'));
process.env.OYA_DATA_DIR = DATA;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
process.env.API_KEYS = 'admin-key';
process.env.FLEET_TOKEN = 'tenant-key';
process.env.OYA_PROFILE_SECRET = 'a'.repeat(64);
process.env.OYA_SESSION_GRACE_MS = '10000';
process.env.OYA_RECORD_EVERY_NTH = '1';

const { handleJsonVersion, handleJsonList, handleUpgrade, sessions } = await import('./src/gateway.js');
const { pool } = await import('./src/routing.js');
const { CDPConnection } = await import('./src/drivers/cdp.js');
const profiles = await import('./src/profiles.js');
const recorder = await import('./src/recorder.js');

let passed = 0, failed = 0;
const assert = (c, label) => {
  if (c) { console.log(`  ✅ ${label}`); passed++; }
  else { console.log(`  ❌ ${label}`); failed++; }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── A page to drive, and a real Chrome to drive it with ──
const site = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><title>Gateway fixture</title><h1>hello</h1><div style="height:2000px"></div>');
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const siteUrl = `http://127.0.0.1:${site.address().port}/`;

const profile = join(DATA, 'chrome');
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--no-first-run',
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const chromeWs = await new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error('Chrome did not report an endpoint')), 20000);
  chrome.stderr.on('data', (d) => {
    buf += d.toString();
    const m = buf.match(/ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-f0-9-]+/);
    if (m) { clearTimeout(t); resolve(m[0]); }
  });
});

pool.register({ name: 'local-chrome', type: 'cdp', wsUrl: chromeWs, maxConcurrent: 4, priority: 1 });

const app = express();
app.use(express.json());
app.get('/json/version', handleJsonVersion);
app.get('/json/list', handleJsonList);
const server = createServer(app);
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://x').pathname === '/connect') {
    handleUpgrade(req, socket, head).catch(() => socket.destroy());
  } else socket.destroy();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `127.0.0.1:${server.address().port}`;
const gwUrl = (qs = '') => `ws://${origin}/connect?token=tenant-key${qs}`;

/** Minimal CDP client — the same thing Playwright is underneath. */
async function client(qs = '') {
  const conn = await new CDPConnection(gwUrl(qs)).connect();
  const { targetInfos = [] } = await conn.send('Target.getTargets');
  let page = targetInfos.find((t) => t.type === 'page');
  if (!page) page = { targetId: (await conn.send('Target.createTarget', { url: 'about:blank' })).targetId };
  const { sessionId } = await conn.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  await conn.send('Page.enable', {}, sessionId).catch(() => {});
  await conn.send('Runtime.enable', {}, sessionId).catch(() => {});
  return { conn, sessionId, targetId: page.targetId };
}
const evaluate = (c, expr) => c.conn.send('Runtime.evaluate',
  { expression: expr, returnByValue: true, awaitPromise: true }, c.sessionId).then((r) => r.result?.value);

try {
  console.log('\n1️⃣  CDP discovery — this is what makes clients work unchanged...');
  const version = await (await fetch(`http://${origin}/json/version`)).json();
  assert(version['Protocol-Version'] === '1.3', 'reports a CDP protocol version');
  assert(/^Chrome\//.test(version.Browser), `identifies as a browser (${version.Browser})`);
  assert(version.webSocketDebuggerUrl?.includes('/connect'), 'points clients at the gateway socket');

  console.log('\n2️⃣  Auth...');
  const rejected = await new Promise((resolve) => {
    const bad = new WebSocket(`ws://${origin}/connect?token=nope`);
    bad.on('unexpected-response', (_, res) => resolve(res.statusCode));
    bad.on('error', () => resolve('error'));
    bad.on('open', () => { bad.close(); resolve('opened'); });
  });
  assert(rejected === 401, `an invalid token is refused at upgrade (got ${rejected})`);

  console.log('\n3️⃣  Drive a real browser through the gateway...');
  const c1 = await client();
  assert(sessions.size === 1, 'the gateway opened one session');
  const nav = await c1.conn.send('Page.navigate', { url: siteUrl }, c1.sessionId);
  assert(nav.frameId, 'Page.navigate is forwarded to the real browser');
  await wait(600);
  assert(await evaluate(c1, 'document.title') === 'Gateway fixture', 'the page really loaded');
  assert(await evaluate(c1, 'document.querySelector("h1").textContent') === 'hello', 'DOM is reachable through the pipe');

  const shot = await c1.conn.send('Page.captureScreenshot', { format: 'jpeg', quality: 40 }, c1.sessionId);
  assert(shot.data?.length > 1000, 'binary-ish payloads survive the pipe (screenshot)');

  const routed = pool.get('local-chrome');
  assert(routed.active === 1, 'the provider shows one active session');
  assert(routed.totalSessions === 1, 'the routing pool counted it');

  console.log('\n4️⃣  Profiles persist a login across sessions...');
  const p1 = await client('&profile=acme');
  await p1.conn.send('Page.navigate', { url: siteUrl }, p1.sessionId);
  await wait(600);
  await evaluate(p1, `document.cookie = "sid=profile-value; path=/"; localStorage.setItem('who','acme'); true`);

  const sessionId = [...sessions.values()].find((s) => s.profile === 'acme').id;
  p1.conn.close();
  await wait(300);
  await sessions.get(sessionId)?.destroy('test');   // capture on end
  await wait(400);

  // The same Chrome would keep this cookie by itself, which would make the
  // assertion below pass without the profile system doing anything. Wipe the
  // browser so the only way it can come back is a successful restore.
  const wipe = await client();
  await wipe.conn.send('Network.clearBrowserCookies', {}, wipe.sessionId);
  await wipe.conn.send('Page.navigate', { url: siteUrl }, wipe.sessionId);
  await wait(500);
  await evaluate(wipe, 'localStorage.clear(); sessionStorage.clear(); true');
  assert(await evaluate(wipe, 'document.cookie') === '', 'browser state is wiped before the restore check');
  const wipeId = [...sessions.values()].filter((s) => s.client).slice(-1)[0].id;
  wipe.conn.close();
  await wait(200);
  await sessions.get(wipeId)?.destroy('wipe done');

  const p2 = await client('&profile=acme');
  await p2.conn.send('Page.navigate', { url: siteUrl }, p2.sessionId);
  await wait(800);
  const cookie = await evaluate(p2, 'document.cookie');
  assert(/sid=profile-value/.test(cookie || ''), `the cookie came back in a new session (got "${cookie}")`);
  assert(await evaluate(p2, `localStorage.getItem('who')`) === 'acme', 'localStorage came back too');

  console.log('\n5️⃣  A profile cannot be used twice at once...');
  const conflict = await new Promise((resolve) => {
    const w = new WebSocket(gwUrl('&profile=acme'));
    w.on('unexpected-response', (_, res) => resolve(res.statusCode));
    w.on('error', () => resolve('error'));
    w.on('open', () => { w.close(); resolve('opened'); });
  });
  assert(conflict === 409, `a concurrent connect to the same profile is refused with 409 (got ${conflict})`);
  p2.conn.close();
  await wait(200);

  console.log('\n6️⃣  Encryption is bound to the profile name...');
  const sealed = profiles._internals.seal('acme', { secret: 'top' });
  assert(!sealed.toString('utf8').includes('top'), 'stored bytes do not contain the plaintext');
  assert(profiles._internals.open('acme', sealed).secret === 'top', 'it opens under its own name');
  let swapped = false;
  try { profiles._internals.open('other', sealed); } catch { swapped = true; }
  assert(swapped, "it cannot be opened as another tenant's profile");

  console.log('\n7️⃣  A dropped client resumes the same session...');
  const r1 = await client();
  const liveId = [...sessions.values()].filter((s) => s.client).slice(-1)[0].id;
  await r1.conn.send('Page.navigate', { url: siteUrl }, r1.sessionId);
  await wait(500);
  r1.conn.close();
  await wait(300);
  assert(sessions.has(liveId), 'the session survives the client going away');
  assert(sessions.get(liveId).client === null, 'it is held with no client attached');

  const resumed = await new CDPConnection(gwUrl(`&session=${liveId}`)).connect();
  const targets = await resumed.send('Target.getTargets');
  assert(targets.targetInfos.length > 0, 'a reconnect resumes against the same browser');
  assert(sessions.get(liveId).client !== null, 'the session shows a client again');
  resumed.close();
  await wait(200);

  console.log('\n8️⃣  Session recording...');
  const rec = await client('&record=1');
  const recId = [...sessions.values()].filter((s) => s.client).slice(-1)[0].id;
  assert(recorder.isRecording(recId), 'recording started for the session');
  await rec.conn.send('Page.navigate', { url: siteUrl }, rec.sessionId);
  await wait(1500);
  await evaluate(rec, 'window.scrollTo(0, 500)');
  await wait(1200);
  await sessions.get(recId).destroy('test done');
  await wait(400);

  const man = await recorder.manifest(recId);
  assert(man && man.frameCount > 0, `frames were captured (${man?.frameCount ?? 0})`);
  const frame0 = await recorder.frame(recId, 0);
  assert(frame0 && frame0[0] === 0xff && frame0[1] === 0xd8, 'stored frames are real JPEGs');
  assert(man.frames[0].t >= 0 && man.frames.every((f, i) => i === 0 || f.t >= man.frames[i - 1].t),
    'frame timestamps are monotonic, so a player can scrub');

  console.log('\n9️⃣  Routing and capacity...');
  const before = pool.stats();
  assert(before.capacity === 4, 'pool reports configured capacity');
  pool.register({ name: 'broken', type: 'cdp', wsUrl: 'ws://127.0.0.1:1/nope', priority: 0, maxConcurrent: 5 });
  const c2 = await client();   // priority 0 is tried first, fails, fails over
  assert(c2.conn, 'a dead provider is failed over rather than failing the client');
  assert(pool.get('broken').healthy === false, 'the dead provider is put in cooldown');
  assert(pool.get('local-chrome').active >= 1, 'the session landed on the healthy provider');
  c2.conn.close();
  c1.conn.close();
} catch (e) {
  console.log(`  ❌ threw: ${e.message}\n${e.stack?.split('\n').slice(0, 4).join('\n')}`);
  failed++;
} finally {
  for (const s of [...sessions.values()]) await s.destroy('teardown').catch(() => {});
  chrome.kill('SIGKILL');
  await new Promise((r) => server.close(r));
  await new Promise((r) => site.close(r));
  rmSync(DATA, { recursive: true, force: true });
}

console.log('\n──────────────────────────────────────────────────');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('──────────────────────────────────────────────────');
process.exit(failed ? 1 : 0);
