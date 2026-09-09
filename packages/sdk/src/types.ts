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

export interface PersonaInfo {
  id: string;
  name: string;
  isDefault: boolean;
  activeBrowsers: number;
  maxConcurrent: number | null;
  proxy: { label?: string; geo?: string } | null;
  fingerprint: Record<string, unknown>;
  mfa?: { configured: boolean; type?: string };
  createdAt: string;
  lastUsedAt: string | null;
}

export type MfaConfig =
  | { type: 'totp'; secret: string }
  | { type: 'email' | 'sms'; url: string; headers?: Record<string, string>; pattern?: string; timeoutMs?: number };

export interface BrowserInfo {
  id: string;
  name: string;
  provider?: string;
  persona?: string;
  connectedAt?: string;
  url?: string;
  title?: string;
}

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
