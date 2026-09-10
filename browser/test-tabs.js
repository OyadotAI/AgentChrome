/**
 * closeTab() recreates a tab when it removes the last one, so any bulk close
 * that loops on `tabs.length` spins forever — one BrowserView per turn until
 * the app dies. That froze the desktop app on sign-in. Guard the contract.
 *
 * Run: node test-tabs.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const has = (re, msg) => assert.ok(re.test(src), msg);

// The bulk close must opt out of the "always keep one tab" rule.
const bulk = src.match(/while \(tabs\.length\) closeTab\([^\n]*\)/g) || [];
assert.ok(bulk.length, 'bulk close loop not found — did closeTab move?');
for (const call of bulk) {
  assert.ok(/keepOne: false/.test(call), `bulk close would never terminate: ${call}`);
}

// ...and closeTab must actually honour that opt-out.
has(/function closeTab\(id, \{ keepOne = true \} = \{\}\)/, 'closeTab lost its keepOne parameter');
has(/if \(keepOne\) createTab\(/, 'closeTab recreates unconditionally — bulk close loops forever');

// The other half of the sign-in freeze: the jar must not go in one await at a time.
assert.ok(!/for \(const c of cookies\) \{/.test(src),
  'applyCookieSync is back to a sequential await per cookie');

// A second declaration of the same name silently replaces the first — that is
// how waitForLoad(view) ended up calling waitForLoad(timeout) and resolving
// instantly instead of waiting for the page.
const names = (src.match(/^(?:async )?function [A-Za-z0-9_]+/gm) || [])
  .map((d) => d.replace(/^(?:async )?function /, ''));
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
assert.deepStrictEqual(dupes, [], `duplicate function declarations shadow each other: ${dupes}`);

// Sends must go through wsSend — a raw send throws when the socket is down.
const rawSends = (src.match(/ws\.send\(/g) || []).length;
assert.strictEqual(rawSends, 1, 'ws.send() outside the wsSend helper — a dropped socket will throw');

console.log('ok — tab close terminates, cookie sync batched, no shadowed functions, sends guarded');
