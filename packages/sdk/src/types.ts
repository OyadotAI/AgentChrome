/** Everything the API returns or accepts, in one place. */

/** Where a browser comes from. Configuration, not something a caller must know. */
export type Provider =
  | 'oya-cloud'
  | 'oya-selfhosted'
  | 'browseruse'
  | 'browserbase'
  | 'steel'
  | 'anchor'
  | 'cdp';

export interface StartOptions {
  /**
   * Which identity to run as. A persona is one device: fingerprint, cookie jar
   * and proxy bound together and stable for its life.
   *   'default' — this key's own persona (the default)
   *   'auto'    — the least recently used persona under its concurrency cap
   *   <id>      — a specific persona
   */
  persona?: 'default' | 'auto' | (string & {});
  /** Solve CAPTCHAs as they appear rather than waiting to be asked. */
  captcha?: 'auto' | 'off';
  /** Override the key's configured provider for this browser only. */
  provider?: Provider;
  /** Required only for the 'cdp' provider. */
  wsUrl?: string;
  name?: string;
  /** How long to wait for a cloud browser to dial in. Default 120s. */
  readyTimeoutMs?: number;
}

export interface StartResult {
  id: string;
  provider: string;
  persona: string;
  status: 'ready' | 'starting';
  /** Point Playwright, Puppeteer or browser-use at this. */
  cdpUrl?: string;
  note?: string;
}

export interface Element {
  id: number;
  type: string;
  text?: string;
  href?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  visible: boolean;
}

export interface Analysis {
  /** The page as markdown. */
  markdown: string;
  elements: Element[];
  viewport?: { width: number; height: number };
  scroll?: { x: number; y: number };
  truncated?: boolean;
}

export interface CaptchaResult {
  present: boolean;
  solved: boolean;
  /** 'provider' when the vendor solved it, 'solver' when we did, 'none' otherwise. */
  method: 'provider' | 'solver' | 'none';
  type?: string;
  error?: string;
}

export interface MfaResult {
  present: boolean;
  completed: boolean;
  method?: 'totp' | 'email' | 'sms' | 'handoff';
  /** Open this to finish by hand when nothing automated can. */
  liveViewUrl?: string | null;
  error?: string;
}

export interface Fingerprint {
  platform: string; timezone: string; locale: string; screen: string; webgl: string;
  hardwareConcurrency: number; deviceMemory: number; canvasSeed: number;
}

/** Device choices made at creation. Fixed for the persona's life. */
export interface PersonaPrefs { platform?: 'Win32' | 'MacIntel' | 'Linux x86_64'; timezone?: string; locale?: string }

export interface PersonaInfo {
  id: string;
  name: string;
  isDefault: boolean;
  activeBrowsers: number;
  maxConcurrent: number | null;
  proxy: { geo: string | null } | null;
  /** The proxy it is actually on, once assigned or pinned. */
  exit: { id: string; label: string; geo: string | null; healthy: boolean } | null;
  prefs: PersonaPrefs | null;
  fingerprint: Fingerprint;
  mfa: { configured: boolean; type?: string };
  createdAt: string;
  lastUsedAt: string | null;
}

export type Health = 'ok' | 'stale' | 'errors' | 'dead';

export interface Activity { ts: string; action: string; summary: string; ok: boolean; ms: number; error?: string }

export interface StopResult { id: string; ok: boolean; provider?: string | null; sandboxRemoved?: boolean | null; error?: string }

export type MfaConfig =
  | { type: 'totp'; secret: string }
  | { type: 'email' | 'sms'; url: string; headers?: Record<string, string>; pattern?: string; timeoutMs?: number };

export interface BrowserInfo {
  id: string;
  name: string;
  clientType: 'oya' | 'cdp';
  provider: string | null;
  persona: string | null;
  personaName: string | null;
  health: Health;
  connectedAt: string;
  lastSeen: string;
  currentUrl: string;
  commands: number;
  errors: number;
  pending: number;
  lastCommandAt: string | null;
  lastError: string | null;
}

export interface BrowserDetail extends BrowserInfo { activity: Activity[] }

export interface OyaOptions {
  /** Defaults to OYA_API_KEY. */
  apiKey?: string;
  /** Defaults to OYA_BASE_URL, then http://localhost:3100. */
  baseUrl?: string;
  /** Per-request timeout. Navigation gets its own, longer budget. */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export class OyaError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'OyaError';
    this.status = status;
    this.body = body;
  }
}
