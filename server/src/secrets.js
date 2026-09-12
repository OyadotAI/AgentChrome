/**
 * Envelope encryption for anything stored at rest that a leak would matter for:
 * profile snapshots, proxy credentials, MFA seeds.
 *
 * A random data key per record, wrapped by a KEK derived from
 * OYA_PROFILE_SECRET with scrypt. The caller-supplied scope is the AAD on both
 * layers, so a ciphertext copied into another scope — another tenant's
 * namespace, another record type — fails to open rather than decrypting.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SECRET_FILE = join(process.env.OYA_DATA_DIR || join(__dirname, '..', 'data'), '.secret');

/**
 * A self-hoster's first action is onboarding, which stores an LLM key — so a
 * missing OYA_PROFILE_SECRET generates one on disk rather than refusing.
 * An operator-supplied secret is still better (the key then lives somewhere
 * other than next to the ciphertext), but a generated one beats the two
 * alternatives: plaintext credentials, or a product that cannot be set up.
 */
function fileSecret() {
  try { return readFileSync(SECRET_FILE, 'utf8').trim(); } catch {}
  const generated = randomBytes(32).toString('hex');
  try {
    mkdirSync(dirname(SECRET_FILE), { recursive: true });
    writeFileSync(SECRET_FILE, generated, { mode: 0o600, flag: 'wx' });
    console.warn(`[secrets] OYA_PROFILE_SECRET not set — generated one at ${SECRET_FILE}. `
      + 'Back it up: losing it makes stored credentials unrecoverable.');
    return generated;
  } catch (e) {
    // Lost a race with another worker, or the directory is read-only.
    try { return readFileSync(SECRET_FILE, 'utf8').trim(); } catch {}
    throw Object.assign(
      new Error(`Cannot store secrets: set OYA_PROFILE_SECRET (${e.message})`), { status: 409 });
  }
}

const SECRET = process.env.OYA_PROFILE_SECRET || '';
const SALT = Buffer.from(process.env.OYA_PROFILE_SALT || 'oya-profile-kek-v1');

let kek = null;

/** Always true now — kept because callers guard on it before storing credentials. */
export function haveSecret() {
  try { return !!(SECRET || fileSecret()); } catch { return false; }
}

function key() {
  if (kek) return kek;
  const secret = SECRET || fileSecret();
  // scrypt is deliberate: the secret may be operator-chosen rather than random.
  // N=2^15,r=8 needs 32MB, exactly Node's default maxmem ceiling, so maxmem is
  // raised explicitly rather than left to trip at runtime.
  kek = scryptSync(secret, SALT, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
  return kek;
}

/** @returns {Buffer} version | wrapNonce | wrapTag | wrappedDek | nonce | tag | body */
export function seal(scope, value) {
  const dek = randomBytes(32);
  const aad = Buffer.from(scope);

  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', dek, nonce);
  c.setAAD(aad);
  const body = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);

  const wrapNonce = randomBytes(12);
  const w = createCipheriv('aes-256-gcm', key(), wrapNonce);
  w.setAAD(aad);
  const wrapped = Buffer.concat([w.update(dek), w.final()]);

  return Buffer.concat([
    Buffer.from([1]),
    wrapNonce, w.getAuthTag(), wrapped,
    nonce, c.getAuthTag(), body,
  ]);
}

export function open(scope, buf) {
  if (buf[0] !== 1) throw new Error('Unsupported sealed format');
  const aad = Buffer.from(scope);
  let o = 1;
  const wrapNonce = buf.subarray(o, o += 12);
  const wrapTag = buf.subarray(o, o += 16);
  const wrapped = buf.subarray(o, o += 32);
  const nonce = buf.subarray(o, o += 12);
  const tag = buf.subarray(o, o += 16);
  const body = buf.subarray(o);

  const w = createDecipheriv('aes-256-gcm', key(), wrapNonce);
  w.setAAD(aad); w.setAuthTag(wrapTag);
  const dek = Buffer.concat([w.update(wrapped), w.final()]);

  const c = createDecipheriv('aes-256-gcm', dek, nonce);
  c.setAAD(aad); c.setAuthTag(tag);
  return JSON.parse(Buffer.concat([c.update(body), c.final()]).toString('utf8'));
}

/** Base64 for records that live in JSON rather than as raw files. */
export const sealText = (scope, value) => seal(scope, value).toString('base64');
export const openText = (scope, text) => open(scope, Buffer.from(text, 'base64'));
