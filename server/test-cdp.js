#!/usr/bin/env node
/**
 * CDP driver against a real Chrome.
 *
 * Verifies that a browser the control plane dials out to answers the same
 * action vocabulary as the Oya client that dials in — including analyze and
 * click-by-element_id, which depend on the injected analyzer.
 *
 * Skipped when no Chrome binary is present.
 */

import { createServer } from 'http';
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CDPDriver } from './src/drivers/cdp.js';

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => existsSync(p));

if (!CHROME) {
  console.log('⏭  No Chrome binary found — skipping CDP driver test');
  process.exit(0);
}

let passed = 0, failed = 0;
const assert = (c, label) => {
  if (c) { console.log(`  ✅ ${label}`); passed++; }
  else { console.log(`  ❌ ${label}`); failed++; }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><title>CDP fixture</title>
<button onclick="document.title='clicked'">Press me</button>
<input placeholder="name">
<div style="height:3000px"></div>`;

const site = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(PAGE);
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const siteUrl = `http://127.0.0.1:${site.address().port}/`;

const profile = mkdtempSync(join(tmpdir(), 'oya-cdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

// Chrome prints the DevTools endpoint on stderr when the port is 0.
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  const timer = setTimeout(() => reject(new Error('Chrome did not report a DevTools endpoint')), 20000);
  chrome.stderr.on('data', (d) => {
    buf += d.toString();
    const m = buf.match(/ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[a-f0-9-]+/);
    if (m) { clearTimeout(timer); resolve(m[0]); }
  });
  chrome.on('exit', () => { clearTimeout(timer); reject(new Error('Chrome exited early')); });
});

let driver;
try {
  console.log('\n1️⃣  Connect and drive a real Chrome over CDP...');
  driver = await new CDPDriver({ wsUrl, provider: 'chrome' }).connect();
  assert(driver.isAlive(), 'Driver connected and attached to a page target');

  const nav = await driver.send('navigate', { url: siteUrl });
  assert(nav.ok, 'navigate succeeds');
  assert(nav.data.title === 'CDP fixture', `navigate returns the page title (got "${nav.data.title}")`);

  const read = await driver.send('read_page');
  assert(read.data.url.startsWith('http://127.0.0.1'), 'read_page returns the current URL');

  const shot = await driver.send('screenshot');
  assert(/^data:image\/jpeg;base64,/.test(shot.data.screenshot), 'screenshot returns a JPEG data URL');
  assert(shot.data.screenshot.length > 1000, 'screenshot is non-trivial in size');

  console.log('\n2️⃣  Analyzer parity with the Oya client...');
  const analyzed = await driver.send('analyze', {});
  assert(analyzed?.ok === true, 'analyze succeeds against a CDP browser');
  const elements = analyzed.data?.elements || [];
  assert(elements.length >= 2, `the injected analyzer indexed the page (${elements.length} elements)`);

  // Same element shape the Oya client produces, so an agent cannot tell the
  // two client types apart.
  const button = elements.find((e) => e.tag === 'button');
  const input = elements.find((e) => e.tag === 'input');
  assert(button?.text === 'Press me', 'analyzer returns the button with its text');
  assert(typeof button?.id === 'number', 'elements carry the numeric ids click expects');

  console.log('\n3️⃣  Real input reaches the real page...');
  const clicked = await driver.send('click', { element_id: button.id });
  assert(clicked.ok, 'click by analyzer element id resolves and dispatches');
  await wait(200);
  assert((await driver.send('read_page')).data.title === 'clicked', 'the click actually fired the page handler');

  await driver.send('type', { element_id: input.id, text: 'hello fleet' });
  const typed = await driver.evaluate(`document.querySelector('[data-ac-id="${input.id}"]').value`);
  assert(typed === 'hello fleet', `type lands in the real input (got "${typed}")`);

  const before = await driver.evaluate('window.scrollY');
  await driver.send('scroll-down', {});
  await wait(300);
  assert(await driver.evaluate('window.scrollY') > before, 'scroll-down moves the page');

  console.log('\n4️⃣  Tab management...');
  const tabs = await driver.send('list-tabs');
  assert(Array.isArray(tabs.data.tabs) && tabs.data.tabs.length >= 1, 'list-tabs enumerates page targets');
  const opened = await driver.send('new-tab', { url: siteUrl });
  assert(opened.ok && opened.data.id, 'new-tab creates and attaches to a target');
  assert((await driver.send('list-tabs')).data.tabs.length >= 2, 'the new tab is listed');
  assert((await driver.send('close-tab', { id: opened.data.id })).ok, 'close-tab closes it');

  console.log('\n5️⃣  Unsupported actions fail cleanly...');
  const bogus = await driver.send('teleport', {});
  assert(bogus.ok === false && /Unsupported action/.test(bogus.error), 'an unknown action returns a clear error, not a throw');

  console.log('\n6️⃣  element_id cannot smuggle code into the page...');
  // Driving a browser means evaluating source in it; a caller-supplied id must
  // never reach that source. Analyzer ids are integers, so anything else is out.
  await driver.send('navigate', { url: siteUrl });
  const hostile = [
    `1"]); window.__pwned = 1; //`,
    `1'); window.__pwned = 1; //`,
    '1]); window.__pwned = 1; //',
    '__proto__',
    { toString() { return '1'; } },
  ];
  let rejected = 0;
  for (const id of hostile) {
    for (const action of ['click', 'select', 'hover', 'type']) {
      try { await driver.send(action, { element_id: id, value: 'x', text: 'x' }); }
      catch (e) { if (e.status === 400) rejected++; }
    }
  }
  assert(rejected === hostile.length * 4, `every hostile element_id is rejected (${rejected}/${hostile.length * 4})`);
  assert(await driver.evaluate('window.__pwned === undefined'), 'nothing was injected into the page');

  const evalAttempt = await driver.send('evaluate', { expression: 'window.__pwned = 1' });
  assert(evalAttempt.ok === false, 'arbitrary evaluate is not exposed as a command');
  assert(await driver.evaluate('window.__pwned === undefined'), 'the evaluate attempt changed nothing');
} catch (e) {
  console.log(`  ❌ threw: ${e.message}`);
  failed++;
} finally {
  driver?.close();
  chrome.kill('SIGKILL');
  await new Promise((r) => site.close(r));
  rmSync(profile, { recursive: true, force: true });
}

console.log('\n──────────────────────────────────────────────────');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('──────────────────────────────────────────────────');
process.exit(failed ? 1 : 0);
