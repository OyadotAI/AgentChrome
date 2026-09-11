/**
 * CAPTCHA detection and solving.
 *
 * One API regardless of who does the work. Hosted providers (Anchor,
 * Browserbase, Steel) solve natively, so for those the job is to notice and
 * report rather than solve twice. For Oya Cloud, self-hosted and plain CDP
 * there is no native solver, so an external one is used.
 *
 * The result always says which path ran. A silent failure that leaves an agent
 * stuck in a loop is worse than a clear "not solved".
 */

import { metrics } from './metrics.js';

/**
 * Find a challenge and read what a solver needs from it. Runs in the page.
 * Deliberately read-only — it identifies, it does not interact.
 */
export const DETECT_JS = `(() => {
  const out = { present: false, type: null, sitekey: null, url: location.href, invisible: false };

  const frameKey = (src, param) => {
    const m = String(src).match(new RegExp('[?&]' + param + '=([^&]+)'));
    return m ? decodeURIComponent(m[1]) : null;
  };

  // Turnstile
  const ts = document.querySelector('[data-sitekey].cf-turnstile, .cf-turnstile[data-sitekey]')
    || [...document.querySelectorAll('iframe')].find((f) => /challenges\\.cloudflare\\.com/.test(f.src || ''));
  if (ts) {
    out.present = true; out.type = 'turnstile';
    out.sitekey = ts.dataset?.sitekey || frameKey(ts.src, 'k') || null;
    return out;
  }

  // hCaptcha
  const hc = document.querySelector('[data-sitekey].h-captcha, .h-captcha[data-sitekey]')
    || [...document.querySelectorAll('iframe')].find((f) => /hcaptcha\\.com/.test(f.src || ''));
  if (hc) {
    out.present = true; out.type = 'hcaptcha';
    out.sitekey = hc.dataset?.sitekey || frameKey(hc.src, 'sitekey') || null;
    return out;
  }

  // reCAPTCHA — v2 renders a checkbox frame, v3 runs invisibly
  const rc = document.querySelector('[data-sitekey].g-recaptcha, .g-recaptcha[data-sitekey]')
    || [...document.querySelectorAll('iframe')].find((f) => /google\\.com\\/recaptcha/.test(f.src || ''));
  if (rc) {
    out.present = true;
    out.sitekey = rc.dataset?.sitekey || frameKey(rc.src, 'k') || null;
    out.invisible = /size=invisible/.test(rc.src || '') || rc.dataset?.size === 'invisible';
    out.type = out.invisible ? 'recaptcha_v3' : 'recaptcha_v2';
    return out;
  }

  return out;
})()`;

/** Put a solved token where the page expects it and let the page proceed. */
export const applyTokenJS = (type, token) => `(() => {
  const token = ${JSON.stringify(token)};
  const setField = (name) => {
    let ok = false;
    for (const el of document.querySelectorAll('[name="' + name + '"], #' + name)) {
      el.value = token;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      ok = true;
    }
    return ok;
  };

  const type = ${JSON.stringify(type)};
  let placed = false;
  if (type === 'turnstile') placed = setField('cf-turnstile-response');
  if (type === 'hcaptcha') placed = setField('h-captcha-response') || setField('g-recaptcha-response');
  if (type.startsWith('recaptcha')) placed = setField('g-recaptcha-response');

  // Many integrations only act on the library's own callback, not the field.
  try {
    if (window.___grecaptcha_cfg?.clients) {
      for (const client of Object.values(window.___grecaptcha_cfg.clients)) {
        for (const v of Object.values(client || {})) {
          if (v && typeof v === 'object' && typeof v.callback === 'function') { v.callback(token); placed = true; }
        }
      }
    }
  } catch {}

  return { placed };
})()`;

const SOLVERS = {
  capsolver: {
    create: 'https://api.capsolver.com/createTask',
    result: 'https://api.capsolver.com/getTaskResult',
    body: (key, task) => ({ clientKey: key, task }),
    taskFor: (type, sitekey, url) => ({
      type: type === 'turnstile' ? 'AntiTurnstileTaskProxyLess'
        : type === 'hcaptcha' ? 'HCaptchaTaskProxyLess'
        : type === 'recaptcha_v3' ? 'ReCaptchaV3TaskProxyLess' : 'ReCaptchaV2TaskProxyLess',
      websiteURL: url, websiteKey: sitekey,
    }),
    taskId: (r) => r.taskId,
    poll: (key, taskId) => ({ clientKey: key, taskId }),
    done: (r) => (r.status === 'ready'
      ? (r.solution?.token || r.solution?.gRecaptchaResponse || null)
      : (r.status === 'failed' ? { error: r.errorDescription || 'solver failed' } : null)),
  },
};

const cfg = (env = process.env) => ({
  provider: env.OYA_CAPTCHA_PROVIDER || 'capsolver',
  key: env.OYA_CAPTCHA_API_KEY || '',
  timeoutMs: Number(env.OYA_CAPTCHA_TIMEOUT_MS) || 120_000,
});

export const isConfigured = (env = process.env) => !!cfg(env).key;

/**
 * Solve via the configured external service.
 * @returns {Promise<{ token: string }>}
 */
export async function solveExternally(type, sitekey, url, env = process.env) {
  const { provider, key, timeoutMs } = cfg(env);
  const solver = SOLVERS[provider];
  if (!solver) throw Object.assign(new Error(`Unknown CAPTCHA provider: ${provider}`), { status: 400 });
  if (!key) throw Object.assign(new Error('OYA_CAPTCHA_API_KEY is not set'), { status: 409 });
  if (!sitekey) throw Object.assign(new Error('No sitekey found for the challenge'), { status: 422 });

  const post = async (endpoint, body) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`${provider} returned ${res.status}`);
    return res.json();
  };

  const created = await post(solver.create, solver.body(key, solver.taskFor(type, sitekey, url)));
  const taskId = solver.taskId(created);
  if (!taskId) throw new Error(`${provider} did not return a task id`);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const polled = await post(solver.result, solver.poll(key, taskId));
    const done = solver.done(polled);
    if (typeof done === 'string') return { token: done };
    if (done?.error) throw new Error(done.error);
  }
  throw Object.assign(new Error('CAPTCHA solve timed out'), { status: 504 });
}

/**
 * Detect and, if asked, solve. `evaluate` runs a script in the page.
 * @returns {{ present, type, solved, method: 'provider'|'solver'|'none', error? }}
 */
export async function handle(evaluate, { solve = true, providerSolves = false, env = process.env } = {}) {
  const found = await evaluate(DETECT_JS);
  if (!found?.present) return { present: false, solved: false, method: 'none' };

  metrics.captchaSeen.inc({ type: found.type });

  // A provider that solves natively will clear it on its own; solving again
  // would pay twice and can race its own attempt.
  if (providerSolves) {
    return { ...found, solved: false, method: 'provider',
      note: 'This provider solves natively; poll for the challenge to clear.' };
  }

  if (!solve) return { ...found, solved: false, method: 'none' };
  if (!isConfigured(env)) {
    return { ...found, solved: false, method: 'none',
      error: 'No CAPTCHA solver configured. Set OYA_CAPTCHA_API_KEY, or use a provider that solves natively.' };
  }

  try {
    const { token } = await solveExternally(found.type, found.sitekey, found.url, env);
    const applied = await evaluate(applyTokenJS(found.type, token));
    metrics.captchaSolved.inc({ type: found.type, outcome: applied?.placed ? 'ok' : 'unplaced' });
    return { ...found, solved: !!applied?.placed, method: 'solver',
      ...(applied?.placed ? {} : { error: 'Solved, but no field accepted the token' }) };
  } catch (err) {
    metrics.captchaSolved.inc({ type: found.type, outcome: 'error' });
    return { ...found, solved: false, method: 'solver', error: err.message };
  }
}
