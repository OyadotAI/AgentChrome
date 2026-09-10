/**
 * @oya/browser — thousands of browsers, one API.
 *
 *   import { Oya } from '@oya/browser';
 *
 *   const oya = new Oya();                                    // OYA_API_KEY
 *   const browser = await oya.browser.start({ persona: 'auto', captcha: 'auto' });
 *   await browser.goto('https://example.com');
 *
 * Which provider actually runs the browser — Oya Cloud, your own machines,
 * Browser Use, Browserbase, Steel, Anchor, or a CDP URL you hand us — is
 * configuration on your API key, not something this code has to know.
 */

import { Http } from './client.js';
import { Browser } from './browser.js';
import {
  OyaError,
  type BrowserInfo, type Fingerprint, type MfaConfig, type OyaOptions,
  type PersonaInfo, type PersonaPrefs, type StartOptions, type StartResult, type StopResult,
} from './types.js';

export { Browser, OyaError };
export * from './types.js';

const DEFAULT_BASE_URL = 'http://localhost:3100';
const READY_POLL_MS = 2_000;

const env = (name: string): string | undefined =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];

export class Oya {
  private readonly http: Http;

  constructor(options: OyaOptions = {}) {
    const apiKey = options.apiKey || env('OYA_API_KEY');
    if (!apiKey) {
      throw new Error('No API key. Pass { apiKey } or set OYA_API_KEY — run `oya login` to get one.');
    }
    const baseUrl = (options.baseUrl || env('OYA_BASE_URL') || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const fetchImpl = options.fetch || globalThis.fetch;
    if (!fetchImpl) throw new Error('No fetch available — pass { fetch } or use Node 18+.');
    this.http = new Http(baseUrl, apiKey, options.timeoutMs ?? 60_000, fetchImpl.bind(globalThis));
  }

  readonly browser = {
    /** Start a browser and wait until it can take commands. */
    start: async (options: StartOptions = {}): Promise<Browser> => {
      const started = await this.http.request<StartResult>('POST', '/api/browsers/start', {
        profile: options.profile || options.persona,
        provider: options.provider,
        wsUrl: options.wsUrl,
        name: options.name,
      }, 120_000);

      // Cloud browsers dial in themselves, so 'starting' means "not yet".
      if (started.status === 'starting') {
        await this.waitUntilConnected(started.id, options.readyTimeoutMs ?? 120_000);
      }
      return new Browser(this.http, started, options.captcha === 'auto');
    },

    /** Reattach to a browser that is already running. */
    get: async (id: string): Promise<Browser> => {
      const found = await this.http.request<BrowserInfo & { cdpUrl?: string }>('GET', `/api/browsers/${encodeURIComponent(id)}`);
      return new Browser(this.http, {
        id: found.id, provider: found.provider || 'cdp', persona: found.persona || 'default', status: 'ready', cdpUrl: found.cdpUrl,
      }, false);
    },

    list: (): Promise<BrowserInfo[]> => this.http.request<BrowserInfo[]>('GET', '/api/browsers'),

    /** Stop some (`ids`) or every browser on this key. Each reports separately. */
    stop: (ids: string[] | 'all'): Promise<{ stopped: number; results: StopResult[] }> =>
      this.http.request('POST', '/api/browsers/stop', ids === 'all' ? { all: true } : { ids }, 120_000),

    stopAll: async (): Promise<number> => (await this.browser.stop('all')).stopped,
  };

  readonly personas = {
    list: async (): Promise<PersonaInfo[]> =>
      (await this.http.request<{ personas: PersonaInfo[] }>('GET', '/api/personas')).personas,
    get: (id: string): Promise<PersonaInfo> => this.http.request<PersonaInfo>('GET', `/api/personas/${id}`),

    /**
     * Create an identity. The device — platform, timezone, locale — is chosen
     * here and fixed for its life; `preview()` shows what a choice produces.
     */
    create: (options: { name?: string; prefs?: PersonaPrefs; proxy?: { geo?: string }; maxConcurrent?: number | null } = {}): Promise<PersonaInfo> =>
      this.http.request<PersonaInfo>('POST', '/api/personas', options),

    /** Name, concurrency cap and proxy hint. Never the device — clone for that. */
    update: (id: string, changes: { name?: string; maxConcurrent?: number | null; proxy?: { geo?: string } | null }): Promise<PersonaInfo> =>
      this.http.request<PersonaInfo>('PUT', `/api/personas/${id}`, changes),

    /** A new persona of the same kind of device: same choices, fresh identity, empty jar. */
    clone: (id: string, options: { name?: string } = {}): Promise<PersonaInfo> =>
      this.http.request<PersonaInfo>('POST', `/api/personas/${id}/clone`, options),

    /** The fingerprint these choices would produce. Persists nothing. */
    preview: async (prefs: PersonaPrefs = {}): Promise<Fingerprint> =>
      (await this.http.request<{ fingerprint: Fingerprint }>('POST', '/api/personas/preview', { prefs })).fingerprint,

    /** Platforms, and the timezones and locales each may coherently claim. */
    options: (): Promise<{ platforms: string[]; timezones: Record<string, string[]>; locales: Record<string, string[]> }> =>
      this.http.request('GET', '/api/personas/options'),

    /** Pin the persona to one of your proxies, or `null` to let assignment happen at connect. */
    pinProxy: (id: string, proxyId: string | null) =>
      this.http.request<{ ok: boolean; proxy: { id: string; label: string } | null }>('PUT', `/api/personas/${id}/proxy`, { proxyId }),

    remove: async (id: string): Promise<void> => { await this.http.request('DELETE', `/api/personas/${id}`); },

    /** Store the second factor for this identity. Sealed at rest, never read back. */
    setMfa: (id: string, config: MfaConfig): Promise<{ configured: boolean; type: string }> =>
      this.http.request('PUT', `/api/personas/${id}/mfa`, config),

    clearMfa: async (id: string): Promise<void> => { await this.http.request('DELETE', `/api/personas/${id}/mfa`); },
  };

  /** This key's settings: LLM credentials, browser provider, solver. */
  readonly config = {
    get: <T = Record<string, unknown>>(): Promise<T> => this.http.request<T>('GET', '/api/config'),
    set: <T = Record<string, unknown>>(values: Record<string, unknown>): Promise<T> =>
      this.http.request<T>('POST', '/api/config', values),
  };

  /** Saved profiles. `personas` is retained as an alias for existing clients. */
  readonly profiles = this.personas;

  usage(): Promise<unknown> { return this.http.request('GET', '/api/usage'); }

  private async waitUntilConnected(id: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const all = await this.browser.list();
      if (all.some((b) => b.id === id)) return;
      await new Promise((r) => setTimeout(r, READY_POLL_MS));
    }
    throw new OyaError(`Browser ${id} did not come up within ${Math.round(timeoutMs / 1000)}s`, 504, null);
  }
}

export default Oya;
