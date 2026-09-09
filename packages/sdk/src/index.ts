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
  type BrowserInfo, type MfaConfig, type OyaOptions,
  type PersonaInfo, type StartOptions, type StartResult,
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
        persona: options.persona,
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
      const all = await this.browser.list();
      const found = all.find((b) => b.id === id);
      if (!found) throw new OyaError(`No such browser: ${id}`, 404, null);
      return new Browser(this.http, {
        id: found.id, provider: found.provider || 'cdp', persona: found.persona || 'default', status: 'ready',
      }, false);
    },

    list: (): Promise<BrowserInfo[]> => this.http.request<BrowserInfo[]>('GET', '/api/browsers'),

    stopAll: async (): Promise<number> => {
      const res = await this.http.request<{ disconnected: number }>('POST', '/api/browsers/disconnect-all', {});
      return res.disconnected ?? 0;
    },
  };

  readonly personas = {
    list: async (): Promise<PersonaInfo[]> =>
      (await this.http.request<{ personas: PersonaInfo[] }>('GET', '/api/personas')).personas,
    get: (id: string): Promise<PersonaInfo> => this.http.request<PersonaInfo>('GET', `/api/personas/${id}`),

    create: (options: { name?: string; proxy?: string; maxConcurrent?: number } = {}): Promise<PersonaInfo> =>
      this.http.request<PersonaInfo>('POST', '/api/personas', options),

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
