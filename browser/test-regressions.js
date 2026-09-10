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

// Auto-update fails silently when the release stops shipping what the feed
// needs — no error, clients just quietly stop updating. Guard the config.
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const build = pkg.build || {};
// The github provider reads releases over the API and AgentChrome is private,
// so every client got a 404 on releases.atom. The feed is served from the
// server's /downloads instead, which needs the channel files shipped there.
assert.strictEqual(build.publish?.provider, 'generic', 'update feed must not depend on a private repo');
assert.ok(/^https:\/\//.test(build.publish?.url || ''), 'publish url must be absolute');
const prodwf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy-prod.yaml'), 'utf8');
assert.ok(/--pattern 'latest\*\.yml'/.test(prodwf), 'deploy must ship latest*.yml to /downloads or updates 404');
assert.ok(/--pattern '\*\.zip'/.test(prodwf), 'deploy must ship the macOS zip to /downloads — Squirrel cannot use the dmg');
assert.ok(build.artifactName && !/\$\{productName\}/.test(build.artifactName),
  'artifactName must not use productName — GitHub rewrites the spaces and every update 404s');
assert.ok((build.mac?.target || []).some((t) => t.target === 'zip'),
  'macOS needs a zip target — Squirrel.Mac cannot update from a DMG');
assert.ok(pkg.dependencies?.['electron-updater'],
  'electron-updater must be a runtime dependency, not a devDependency');

// electron-builder publishes implicitly on a tag build once a publish config
// exists. No CI job has GH_TOKEN, so v1.0.50 died with "GitHub Personal Access
// Token is not set" and took the whole prod deploy with it.
for (const script of ['dist', 'dist:mac', 'dist:win', 'dist:linux']) {
  assert.ok(/--publish never/.test(pkg.scripts[script] || ''),
    `${script} must pass --publish never or a tag build tries to publish itself`);
}

// Each platform's feed names its artifact, so the asset must keep that exact
// name. ${arch} renders as x86_64 for AppImage, which matched neither.
assert.strictEqual(build.linux?.artifactName, 'Oya.Browser-${version}-x64.${ext}');
assert.strictEqual(build.win?.artifactName, 'Oya.Browser-${version}-x64.${ext}');

const release = fs.readFileSync(path.join(__dirname, '..', 'k8s', 'scripts', 'release.sh'), 'utf8');
assert.ok(/latest-mac\.yml/.test(release), 'release.sh must publish latest-mac.yml');
assert.ok(/gh release create[^\n]*SRC_ZIP/.test(release), 'release.sh must upload the update zip');

// DAYTONA_SNAPSHOT is the deploy's fallback, so it must only ever name a
// snapshot that exists. Setting it before registration succeeds would send a
// later deploy to a snapshot that was never created, instead of leaving cloud
// browsers on the last build that worked.
assert.ok(/if \[ "\$CONCLUSION" = "success" \]; then\s*\n\s*gh secret set DAYTONA_SNAPSHOT/.test(release),
  'release.sh moves DAYTONA_SNAPSHOT without first confirming the snapshot was registered');

// The renderer's script is inline, so a syntax error there is silent — the
// page just stops running. This caught a real collision with an existing
// updatePill() function.
const html = fs.readFileSync(path.join(__dirname, 'renderer', 'index.html'), 'utf8');
const inline = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || [];
assert.ok(inline.length, 'no inline renderer script found');
for (const block of inline) {
  const body = block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
  assert.doesNotThrow(() => new Function(body), 'renderer inline script does not parse');
}

// A tab whose first load never settles must not wedge every later command on
// it. Unbounded awaits here made a broken browser image look like a dead server.
assert.ok(!/await tabs\.find\(.*?\)\?\.ready/.test(src),
  'command handler awaits tab.ready unbounded — a wedged page will hang every command');
assert.ok(/Promise\.race\(\[tab\.ready\.catch/.test(src),
  'waitForTabReady must bound the wait');

// setupTabCDP hanging must not stop the tab's first page from loading.
assert.ok(/Promise\.race\(\[\s*\n\s*setupTabCDP\(view\)/.test(src),
  'setupTabCDP must be bounded — an unanswered CDP command otherwise stops the tab ever loading');

// Cloud browsers stream frames through viz CopyOutputResult, which needs more
// shared memory than a container's 64MB /dev/shm. Without this flag the GPU
// process dies repeatedly and Chromium SIGTRAPs the app after ~20s of streaming.
const entry = fs.readFileSync(path.join(__dirname, 'docker-entrypoint.sh'), 'utf8');
assert.ok(/electron \. .*--disable-dev-shm-usage/.test(entry),
  'container electron must run with --disable-dev-shm-usage or streaming kills the browser');

// A persona switch must not send the previous persona's queued cookies over a
// socket already authenticated as the new one — that files one identity's
// session in another's jar, and the site then demands a fresh login.
assert.ok(/dropPendingCookieChanges\(\);\n\s*while \(tabs\.length\) closeTab/.test(src),
  'persona switch must drop queued cookie changes, not flush them into the new persona');

console.log('ok — tabs, cookies, sends, updates, renderer, tab waits, CDP setup, shm and persona isolation guarded');
