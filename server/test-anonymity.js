#!/usr/bin/env node
/**
 * Anti-detection unit checks against a real Chrome.
 *
 * These are the signals a detector reads first. Each assertion is written as
 * "what a real browser does", so a regression shows up as a lie rather than a
 * missing feature.
 *
 * Skipped when no Chrome binary is present.
 */

import { spawn } from 'child_process';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';
import { CDPConnection } from './src/drivers/cdp.js';

const require = createRequire(import.meta.url);
const { buildStealthScript } = require('../browser/anonymity/stealth.js');

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => existsSync(p));
if (!CHROME) { console.log('⏭  No Chrome binary — skipping anonymity test'); process.exit(0); }

let passed = 0, failed = 0;
const assert = (c, label) => {
  if (c) { console.log(`  ✅ ${label}`); passed++; }
  else { console.log(`  ❌ ${label}`); failed++; }
};

const profile = mkdtempSync(join(tmpdir(), 'oya-anon-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--no-first-run',
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error('Chrome did not report an endpoint')), 20000);
  chrome.stderr.on('data', (d) => {
    buf += d.toString();
    const m = buf.match(/ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-f0-9-]+/);
    if (m) { clearTimeout(t); resolve(m[0]); }
  });
});

let conn;
try {
  conn = await new CDPConnection(wsUrl).connect();
  const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
  await conn.send('Page.enable', {}, sessionId);
  await conn.send('Runtime.enable', {}, sessionId);
  await conn.send('Page.addScriptToEvaluateOnNewDocument', { source: buildStealthScript() }, sessionId);
  await conn.send('Page.navigate', { url: 'about:blank' }, sessionId);
  await new Promise((r) => setTimeout(r, 400));

  const evaluate = async (expr) => {
    const res = await conn.send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || expr);
    return res.result?.value;
  };

  console.log('\n1️⃣  toString masking — without this every patch below is readable...');
  assert(await evaluate(`Function.prototype.toString.toString().includes('[native code]')`),
    'Function.prototype.toString itself reports native');
  assert(await evaluate(
    `Object.getOwnPropertyDescriptor(Navigator.prototype,'webdriver').get.toString()`)
    === 'function get webdriver() { [native code] }',
    'a patched accessor reports as a native getter');
  assert(await evaluate(`(function realOne(){}).toString().includes('realOne')`),
    'unpatched functions still report their real source');

  console.log('\n2️⃣  navigator.webdriver...');
  assert(await evaluate('navigator.webdriver') === false,
    'is false (undefined is itself the tell)');
  assert(await evaluate(`Object.getOwnPropertyNames(navigator).includes('webdriver')`) === false,
    'is not an own property of navigator — real Chrome has it on the prototype');
  assert(await evaluate(`Object.getOwnPropertyNames(Navigator.prototype).includes('webdriver')`),
    'is on Navigator.prototype');

  console.log('\n3️⃣  plugins and mimeTypes carry the right types...');
  assert(await evaluate(`Object.prototype.toString.call(navigator.plugins)`) === '[object PluginArray]',
    'navigator.plugins is a PluginArray, not [object Object]');
  assert(await evaluate(`Object.prototype.toString.call(navigator.mimeTypes)`) === '[object MimeTypeArray]',
    'navigator.mimeTypes is a MimeTypeArray');
  assert(await evaluate('navigator.plugins instanceof PluginArray'), 'instanceof PluginArray holds');
  assert(await evaluate('navigator.plugins.length') === 5, 'five plugins, matching modern Chrome');
  assert(await evaluate(`Object.prototype.toString.call(navigator.plugins[0])`) === '[object Plugin]',
    'entries are Plugin instances');
  assert(await evaluate(`navigator.plugins['PDF Viewer'] !== undefined`), 'named access works');

  console.log('\n4️⃣  window.chrome shape...');
  assert(await evaluate('typeof window.chrome.app') === 'object', 'chrome.app exists');
  assert(await evaluate('typeof window.chrome.csi') === 'function', 'chrome.csi exists');
  assert(await evaluate('typeof window.chrome.loadTimes') === 'function', 'chrome.loadTimes exists');
  assert(await evaluate('window.chrome.runtime') === undefined,
    'chrome.runtime is absent — defining it on a normal page is evidence of automation');

  console.log('\n5️⃣  No self-inflicted flags...');
  assert(await evaluate('typeof Error.prepareStackTrace') === 'undefined',
    'Error.prepareStackTrace is undefined, as on a real page');
  assert(await evaluate('window.outerWidth > 0 && window.outerHeight > 0'),
    'outerWidth/outerHeight are non-zero');

  console.log('\n6️⃣  Nothing identifies the product...');
  const globals = await evaluate(`JSON.stringify(Object.getOwnPropertyNames(window).filter(k => /^__(ac|oya)/i.test(k) || k === 'analyzePage'))`);
  assert(globals === '[]', `no product globals on window (found ${globals})`);
} catch (e) {
  console.log(`  ❌ threw: ${e.message}`);
  failed++;
} finally {
  conn?.close();
  chrome.kill('SIGKILL');
  // Chrome holds the profile briefly after SIGKILL; retry rather than throw
  // over a temp directory and mask the test result.
  await new Promise((r) => setTimeout(r, 300));
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}

console.log('\n──────────────────────────────────────────────────');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('──────────────────────────────────────────────────');
process.exit(failed ? 1 : 0);
