/**
 * Server-side fingerprint generation — single source of truth.
 * Generates deterministic fingerprint profiles from API keys and caches them.
 * Sent to browsers on auth_ok so every instance gets the exact same profile.
 */

import { createHash, randomBytes } from 'crypto';

// ── Realistic GPU databases by platform ──

const GPU_DB = {
  Win32: [
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', unmaskedVendor: 'NVIDIA Corporation', unmaskedRenderer: 'NVIDIA GeForce RTX 3060/PCIe/SSE2' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)', unmaskedVendor: 'NVIDIA Corporation', unmaskedRenderer: 'NVIDIA GeForce RTX 3070/PCIe/SSE2' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)', unmaskedVendor: 'NVIDIA Corporation', unmaskedRenderer: 'NVIDIA GeForce GTX 1660 SUPER/PCIe/SSE2' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', unmaskedVendor: 'ATI Technologies Inc.', unmaskedRenderer: 'AMD Radeon RX 6700 XT' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)', unmaskedVendor: 'Intel Inc.', unmaskedRenderer: 'Intel(R) UHD Graphics 630' },
  ],
  MacIntel: [
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M1, OpenGL 4.1)', unmaskedVendor: 'Apple', unmaskedRenderer: 'Apple M1' },
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)', unmaskedVendor: 'Apple', unmaskedRenderer: 'Apple M1 Pro' },
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)', unmaskedVendor: 'Apple', unmaskedRenderer: 'Apple M2' },
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M3, OpenGL 4.1)', unmaskedVendor: 'Apple', unmaskedRenderer: 'Apple M3' },
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M2 Pro, OpenGL 4.1)', unmaskedVendor: 'Apple', unmaskedRenderer: 'Apple M2 Pro' },
  ],
  'Linux x86_64': [
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080/PCIe/SSE2, OpenGL 4.5)', unmaskedVendor: 'NVIDIA Corporation', unmaskedRenderer: 'NVIDIA GeForce RTX 3080/PCIe/SSE2' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)', unmaskedVendor: 'Intel', unmaskedRenderer: 'Mesa Intel(R) UHD Graphics 630 (CFL GT2)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.6)', unmaskedVendor: 'ATI Technologies Inc.', unmaskedRenderer: 'AMD Radeon RX 580' },
  ],
};

const SCREEN_RESOLUTIONS = {
  Win32: [
    { width: 1920, height: 1080, dpr: 1 },
    { width: 2560, height: 1440, dpr: 1 },
    { width: 1366, height: 768, dpr: 1 },
    { width: 1680, height: 1050, dpr: 1 },
    { width: 3840, height: 2160, dpr: 1.5 },
  ],
  MacIntel: [
    { width: 1440, height: 900, dpr: 2 },
    { width: 1680, height: 1050, dpr: 2 },
    { width: 1920, height: 1080, dpr: 2 },
    { width: 2560, height: 1440, dpr: 2 },
    { width: 1280, height: 800, dpr: 2 },
  ],
  'Linux x86_64': [
    { width: 1920, height: 1080, dpr: 1 },
    { width: 2560, height: 1440, dpr: 1 },
    { width: 1366, height: 768, dpr: 1 },
  ],
};

const FONT_SETS = {
  Win32: ['Arial', 'Arial Black', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Impact', 'Lucida Console', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'],
  MacIntel: ['Arial', 'Arial Black', 'Courier New', 'Georgia', 'Helvetica', 'Helvetica Neue', 'Impact', 'Lucida Grande', 'Menlo', 'Monaco', 'SF Pro', 'Times New Roman', 'Trebuchet MS', 'Verdana'],
  'Linux x86_64': ['Arial', 'Courier New', 'DejaVu Sans', 'DejaVu Serif', 'FreeMono', 'FreeSans', 'FreeSerif', 'Liberation Mono', 'Liberation Sans', 'Liberation Serif', 'Noto Sans', 'Times New Roman', 'Ubuntu', 'Verdana'],
};

const HARDWARE_CONCURRENCY = [4, 6, 8, 12, 16];
const DEVICE_MEMORY = [4, 8, 16];

const TIMEZONES = {
  Win32: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Detroit', 'America/Indianapolis'],
  MacIntel: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'Pacific/Honolulu'],
  'Linux x86_64': ['America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'UTC'],
};

const LOCALES = {
  Win32: ['en-US', 'en-US', 'en-US', 'en-GB'],
  MacIntel: ['en-US', 'en-US', 'en-US', 'en-GB'],
  'Linux x86_64': ['en-US', 'en-US', 'en-GB', 'de-DE', 'ja-JP'],
};

// ── Seeded PRNG (LCG) — same implementation as browser side ──

function createPRNG(seed) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function seedFromString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

// ── Profile Generation ──

/**
 * @param {{ id: string, seed: number, proxy?: object|null }} identity
 *   An explicit id and numeric seed, so a persona's fingerprint is stable for
 *   its whole life and independent of what created it. Seeding from the API key
 *   made every browser on that key one device; seeding from an ephemeral
 *   browser id would give one account a new device on every restart. Neither is
 *   what a persona needs.
 */
/** What a persona may choose about its device. Everything else follows the seed. */
export const PLATFORMS = ['Win32', 'MacIntel', 'Linux x86_64'];

/**
 * Explicit choices, open to every platform: a Windows machine in Berlin is
 * ordinary. Wider than TIMEZONES/LOCALES above, which stay exactly as they
 * are — they drive the seeded pick, and changing them would move existing
 * fingerprints under their cookie jars.
 */
const TIMEZONE_CHOICES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix',
  'America/Detroit', 'America/Indianapolis', 'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto',
  'America/Vancouver', 'America/Mexico_City', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
  'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Europe/Rome', 'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Zurich', 'Europe/Vienna', 'Europe/Stockholm',
  'Europe/Oslo', 'Europe/Copenhagen', 'Europe/Helsinki', 'Europe/Warsaw', 'Europe/Prague', 'Europe/Athens',
  'Europe/Istanbul', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Cairo', 'Asia/Dubai', 'Asia/Kolkata',
  'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Jakarta',
  'Asia/Manila', 'Australia/Sydney', 'Australia/Melbourne', 'Pacific/Auckland', 'UTC',
];
const LOCALE_CHOICES = [
  'en-US', 'en-GB', 'en-CA', 'en-AU', 'en-IN', 'de-DE', 'de-AT', 'de-CH', 'fr-FR', 'fr-CA', 'es-ES', 'es-MX',
  'it-IT', 'nl-NL', 'pt-BR', 'pt-PT', 'sv-SE', 'da-DK', 'nb-NO', 'fi-FI', 'pl-PL', 'cs-CZ', 'tr-TR', 'ru-RU',
  'ja-JP', 'ko-KR', 'zh-CN', 'zh-TW', 'hi-IN', 'id-ID',
];

export const PREF_OPTIONS = {
  platforms: PLATFORMS,
  timezones: Object.fromEntries(PLATFORMS.map((p) => [p, TIMEZONE_CHOICES])),
  locales: Object.fromEntries(PLATFORMS.map((p) => [p, LOCALE_CHOICES])),
};

/**
 * Why these prefs cannot be honoured, or null. Checked at creation, so a
 * persona never silently gets a device other than the one it asked for.
 */
export function prefsError(prefs) {
  if (!prefs || typeof prefs !== 'object') return null;
  const bad = (key, value, list) => (typeof value === 'string' && value && value !== 'auto' && !list.includes(value)
    ? `${key} "${value}" is not offered for personas; GET /api/personas/options lists the choices` : null);
  return bad('platform', prefs.platform, PLATFORMS)
    || bad('timezone', prefs.timezone, TIMEZONE_CHOICES)
    || bad('locale', prefs.locale, LOCALE_CHOICES);
}

/**
 * Personas created before prefs were validated (no `prefs.checked`) keep the
 * rule they were created under: a timezone or locale outside the platform's
 * seeded table falls back to the seeded pick. Widening it for them would
 * change their device under an existing cookie jar.
 */
function prefsFor(identity) {
  const p = identity?.prefs || {};
  const platform = PLATFORMS.includes(p.platform) ? p.platform : null;
  return { platform, timezone: p.timezone || null, locale: p.locale || null };
}

function generateProfile(identity) {
  const { id, seed } = identity;
  const rng = createPRNG(seed);
  const prefs = prefsFor(identity);

  // The seeded picks still happen even when a preference overrides them, so
  // the rest of the stream — GPU, screen, noise seeds — is identical whether
  // or not a preference was given. A persona's fingerprint must depend on its
  // seed and its prefs only, never on the order they were applied.
  const platform = prefs.platform || pick(PLATFORMS, rng);
  if (prefs.platform) pick(PLATFORMS, rng);
  const gpu = pick(GPU_DB[platform] || GPU_DB.Win32, rng);
  const screen = pick(SCREEN_RESOLUTIONS[platform] || SCREEN_RESOLUTIONS.Win32, rng);
  const fonts = FONT_SETS[platform] || FONT_SETS.Win32;
  const hardwareConcurrency = pick(HARDWARE_CONCURRENCY, rng);
  const deviceMemory = pick(DEVICE_MEMORY, rng);
  const canvasNoise = rng() * 0.01;
  const audioNoise = rng() * 0.01;
  const rectsNoise = rng() * 0.001;
  const tzPick = pick(TIMEZONES[platform] || TIMEZONES.Win32, rng);
  const checked = identity.prefs?.checked === true;
  const timezone = (checked ? TIMEZONE_CHOICES : TIMEZONES[platform] || []).includes(prefs.timezone) ? prefs.timezone : tzPick;
  const locPick = pick(LOCALES[platform] || LOCALES.Win32, rng);
  const locale = (checked ? LOCALE_CHOICES : LOCALES[platform] || []).includes(prefs.locale) ? prefs.locale : locPick;
  const lang = locale.split('-')[0];

  return {
    id,
    navigator: {
      platform,
      hardwareConcurrency,
      deviceMemory,
      maxTouchPoints: 0,
      languages: [locale, lang],
      vendor: 'Google Inc.',
    },
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.width,
      availHeight: screen.height - 40,
      colorDepth: 24,
      pixelDepth: 24,
      devicePixelRatio: screen.dpr,
    },
    canvas: { noiseSeed: canvasNoise },
    webgl: gpu,
    audio: { noiseSeed: audioNoise },
    rects: { noiseSeed: rectsNoise },
    fonts: { available: fonts },
    timezone,
    locale,
    // Chrome-shaped WebGL strings for personas made under the current rules;
    // older ones keep reporting what they always have (fingerprint.js, browser).
    webglChrome: checked,
    proxy: identity.proxy || null,
  };
}

// ── Cache: one profile per persona, generated once ──

const cache = new Map();

/** The seed and id a key's default persona uses. */
export function defaultPersonaSeed(apiKey) {
  return {
    id: 'apikey-' + createHash('sha256').update(apiKey).digest('hex').slice(0, 12),
    seed: seedFromString(apiKey),
  };
}

/** A fresh persona's seed, independent of any key. */
export function newPersonaSeed() {
  const id = 'p-' + randomBytes(8).toString('hex');
  return { id, seed: seedFromString(id) };
}

/**
 * Stable fingerprint for a persona. Same persona in, same fingerprint out,
 * for the life of the persona — that stability is what keeps the fingerprint
 * coherent with the cookies it is paired with.
 */
/** Unmemoised: for previews, which must not accumulate in the cache. */
export function previewProfile(identity) {
  return generateProfile(identity);
}

export function getFingerprintForPersona(identity) {
  if (!identity?.id) return null;
  let profile = cache.get(identity.id);
  if (!profile) {
    profile = generateProfile(identity);
    cache.set(identity.id, profile);
    console.log(`[fingerprint] Generated ${profile.id} (${profile.navigator.platform}, ${profile.timezone})`);
  }
  return profile;
}

/**
 * Back-compat for callers that still think in API keys: resolves to that key's
 * default persona, preserving the exact fingerprint it had before personas
 * existed — same id, same seed, same output.
 */
export function getFingerprintForKey(apiKey) {
  if (!apiKey) return null;
  return getFingerprintForPersona(defaultPersonaSeed(apiKey));
}
