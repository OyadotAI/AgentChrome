/**
 * MFA.
 *
 * An agent acting for someone on their own accounts hits second factors, and a
 * challenge nobody can answer is where automation stops. Four paths behind one
 * call: TOTP, email OTP, SMS OTP, and handing the session to a person.
 *
 * TOTP seeds are credential material of the same weight as a password. They are
 * encrypted at rest with the shared envelope scheme, never logged, and never
 * returned by the API — only whether one is configured.
 */

import { createHmac } from 'crypto';
import { sealText, openText } from './secrets.js';
import { metrics } from './metrics.js';

/** personaId -> sealed config */
const configs = new Map();

const scopeFor = (personaId) => `mfa:${personaId}`;

// ── TOTP (RFC 6238) ──

function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) throw Object.assign(new Error('TOTP secret is not valid base32'), { status: 400 });
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

/**
 * @param {string} secret base32, as printed under a QR code
 * @param {number} [at] unix seconds, for testing against known vectors
 */
export function totp(secret, at = Math.floor(Date.now() / 1000), { digits = 6, period = 30, algorithm = 'sha1' } = {}) {
  const counter = Math.floor(at / period);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac(algorithm, base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3])
    % 10 ** digits;
  return String(code).padStart(digits, '0');
}

// ── Configuration ──

export function set(personaId, config) {
  const { type } = config || {};
  if (!['totp', 'email', 'sms'].includes(type)) {
    throw Object.assign(new Error('mfa type must be totp, email or sms'), { status: 400 });
  }
  if (type === 'totp') {
    if (!config.secret) throw Object.assign(new Error('a TOTP secret is required'), { status: 400 });
    totp(config.secret);            // fail now, not at the login prompt
  }
  configs.set(personaId, sealText(scopeFor(personaId), config));
  return describe(personaId);
}

export function clear(personaId) { return configs.delete(personaId); }

/** Whether a factor is configured — never what it is. */
export function describe(personaId) {
  if (!configs.has(personaId)) return { configured: false };
  const { type } = openText(scopeFor(personaId), configs.get(personaId));
  return { configured: true, type };
}

function load(personaId) {
  const sealed = configs.get(personaId);
  if (!sealed) return null;
  return openText(scopeFor(personaId), sealed);
}

// ── Detection ──

/** Is the page asking for a second factor, and where does the code go? */
export const DETECT_JS = `(() => {
  const fields = [...document.querySelectorAll('input')].filter((el) => {
    if (el.type === 'hidden' || el.disabled || el.readOnly) return false;
    const hay = [el.name, el.id, el.autocomplete, el.placeholder, el.getAttribute('aria-label')]
      .filter(Boolean).join(' ').toLowerCase();
    if (/\\b(otp|one[- ]?time|2fa|two[- ]?factor|mfa|verification|auth(entication)?[- ]?code|security[- ]?code|passcode)\\b/.test(hay)) return true;
    if (el.autocomplete === 'one-time-code') return true;
    // A short numeric field on a page that talks about codes.
    const maxLen = Number(el.maxLength);
    return maxLen > 0 && maxLen <= 8 && /^(text|tel|number)$/.test(el.type)
      && /\\b(code|verify|verification)\\b/i.test(document.body.innerText || '');
  });
  if (!fields.length) return { present: false };
  const el = fields[0];
  el.setAttribute('data-oya-mfa-target', '1');
  return {
    present: true,
    segmented: fields.length > 1 && fields.every((f) => Number(f.maxLength) === 1),
    fieldCount: fields.length,
  };
})()`;

/** Type the code in, including the segmented one-box-per-digit style. */
export const fillCodeJS = (code, segmented) => `(() => {
  const code = ${JSON.stringify(String(code))};
  const fire = (el, v) => {
    el.focus();
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (${segmented ? 'true' : 'false'}) {
    const boxes = [...document.querySelectorAll('input')].filter((f) => Number(f.maxLength) === 1 && !f.disabled);
    if (boxes.length < code.length) return { filled: false, reason: 'not enough inputs' };
    code.split('').forEach((ch, i) => fire(boxes[i], ch));
    return { filled: true, segmented: true };
  }
  const el = document.querySelector('[data-oya-mfa-target]');
  if (!el) return { filled: false, reason: 'field not found' };
  fire(el, code);
  el.removeAttribute('data-oya-mfa-target');
  return { filled: true, segmented: false };
})()`;

// ── Code retrieval ──

/**
 * Read a one-time code from a mailbox or SMS endpoint.
 *
 * Both are polled with a bounded window: the code is sent in response to the
 * login attempt, so it does not exist yet when the prompt appears.
 */
async function fetchRelayCode(config) {
  const deadline = Date.now() + (Number(config.timeoutMs) || 90_000);
  const pattern = config.pattern ? new RegExp(config.pattern) : /\b(\d{4,8})\b/;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(config.url, {
        headers: config.headers || {},
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const body = await res.text();
        const match = body.match(pattern);
        if (match) return match[1] || match[0];
      }
    } catch { /* keep polling until the window closes */ }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw Object.assign(new Error('No one-time code arrived within the window'), { status: 504 });
}

/**
 * Complete a challenge.
 *
 * @param evaluate  runs a script in the page
 * @param personaId whose factor to use
 * @param liveViewUrl surfaced when nothing can answer it — a person finishing
 *        the challenge by hand is a real outcome, not a failure, and it is the
 *        only answer for push-approval factors.
 */
export async function complete(evaluate, personaId, { liveViewUrl = null } = {}) {
  const found = await evaluate(DETECT_JS);
  if (!found?.present) return { present: false, completed: false, method: 'none' };

  const config = load(personaId);
  if (!config) {
    metrics.mfaCompleted.inc({ method: 'handoff', outcome: 'needed' });
    return {
      present: true, completed: false, method: 'handoff', liveViewUrl,
      error: 'No MFA factor is configured for this persona. Open the live view to complete it by hand.',
    };
  }

  let code;
  try {
    code = config.type === 'totp' ? totp(config.secret) : await fetchRelayCode(config);
  } catch (err) {
    metrics.mfaCompleted.inc({ method: config.type, outcome: 'error' });
    return { present: true, completed: false, method: config.type, liveViewUrl, error: err.message };
  }

  const filled = await evaluate(fillCodeJS(code, found.segmented));
  metrics.mfaCompleted.inc({ method: config.type, outcome: filled?.filled ? 'ok' : 'unfilled' });
  return {
    present: true, completed: !!filled?.filled, method: config.type,
    ...(filled?.filled ? {} : { liveViewUrl, error: filled?.reason || 'Could not fill the code field' }),
  };
}

/** Test hook. */
export function reset() { configs.clear(); }
