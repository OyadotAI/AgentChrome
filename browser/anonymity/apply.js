/**
 * Apply a persona to a Chrome target over CDP, the same way in every runtime
 * (the CDP driver, the stealth harness, the desktop app).
 *
 * Order matters:
 *   1. Native emulation. A value Chrome reports itself cannot be caught lying.
 *   2. The injection, for what emulation cannot reach (stealth.js, fingerprint.js).
 *   3. Every child target. Dedicated workers, cross-site iframes, and service
 *      and shared workers are separate targets that
 *      addScriptToEvaluateOnNewDocument never reaches, so a detector reads the
 *      real machine there: CreepJS compares its service worker against the
 *      page, and CAPTCHA and Turnstile widgets live in cross-site iframes.
 *      Each starts paused, gets the persona, then runs.
 *
 * Transport-agnostic: send(method, params, sessionId) → Promise, and
 * on(event, (params, sessionId) => void).
 */

const { buildInjectionScript, buildWorkerScript } = require('./inject');

/** Page-level emulation. Commands an older Chrome lacks fail quietly. */
function emulationFor(profile, { screen = true } = {}) {
  const cmds = [
    ['Emulation.setAutomationOverride', { enabled: false }],
    ['Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: profile.navigator.hardwareConcurrency }],
  ];
  if (profile.timezone) cmds.push(['Emulation.setTimezoneOverride', { timezoneId: profile.timezone }]);
  if (profile.locale) cmds.push(['Emulation.setLocaleOverride', { locale: profile.locale }]);
  // The screen only: width, height and deviceScaleFactor 0 leave the
  // viewport and pixel ratio alone.
  if (screen) {
    cmds.push(['Emulation.setDeviceMetricsOverride', {
      width: 0, height: 0, deviceScaleFactor: 0, mobile: false,
      screenWidth: profile.screen.width, screenHeight: profile.screen.height,
    }]);
  }
  return cmds;
}

const PAGE_CHILDREN = [{ type: 'worker' }, { type: 'iframe' }, { exclude: true }];
const BROWSER_WORKERS = [{ type: 'service_worker' }, { type: 'shared_worker' }, { exclude: true }];

/**
 * @param {object} o
 * @param {Function} o.send
 * @param {Function} o.on
 * @param {object} o.profile - anonymity profile
 * @param {object|null} [o.userAgent] - params for Emulation/Network.setUserAgentOverride
 * @param {boolean} [o.screen] - emulate the screen (off where the host window owns it)
 * @param {Function} [o.onError] - (what, err), for failures that leave a surface unprotected
 */
function createPersonaApplier({ send, on, profile, userAgent = null, screen = true, onError = () => {} }) {
  const pageSource = buildInjectionScript(profile);
  const workerSource = buildWorkerScript(profile, { userAgent: userAgent?.userAgent || null });
  const covered = new Set();
  const report = (what) => (err) => onError(what, err);

  async function page(sessionId) {
    if (userAgent) await send('Emulation.setUserAgentOverride', userAgent, sessionId).catch(report('user agent override'));
    for (const [method, params] of emulationFor(profile, { screen })) {
      await send(method, params, sessionId).catch(() => {});
    }
    await send('Page.addScriptToEvaluateOnNewDocument', { source: pageSource }, sessionId).catch(report('injection'));
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: PAGE_CHILDREN }, sessionId)
      .catch(report('child target coverage'));
  }

  async function worker(sessionId) {
    if (userAgent) await send('Network.setUserAgentOverride', userAgent, sessionId).catch(() => {});
    await send('Runtime.evaluate', { expression: workerSource }, sessionId).catch(report('worker injection'));
  }

  on('Target.attachedToTarget', ({ sessionId, targetInfo, waitingForDebugger } = {}) => {
    const type = targetInfo?.type || '';
    const setup = type === 'iframe' ? page : type.endsWith('worker') ? worker : null;
    const first = setup && !covered.has(sessionId);
    if (first) covered.add(sessionId);
    Promise.resolve(first ? setup(sessionId) : null).catch(report(`${type} setup`)).finally(() => {
      // Whatever happened above, a paused target must run: a stuck worker breaks the site.
      if (waitingForDebugger) send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
    });
  });
  on('Target.detachedFromTarget', ({ sessionId } = {}) => { covered.delete(sessionId); });

  return {
    /** A page (or cross-site iframe) session. Undefined for a page-level debugger. */
    page,
    /** Service and shared workers belong to the browser: needs a browser-level connection. */
    browser: () => send('Target.setAutoAttach',
      { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: BROWSER_WORKERS })
      .catch(report('service worker coverage')),
  };
}

module.exports = { createPersonaApplier, emulationFor };
