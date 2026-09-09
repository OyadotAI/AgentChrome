import type { Http } from './client.js';
import type { Analysis, CaptchaResult, Element, MfaResult, StartResult } from './types.js';

/** Navigation is slow and the server disables its own timeout for it. */
const NAVIGATE_TIMEOUT_MS = 120_000;

interface CommandResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * One running browser.
 *
 * Element ids come from `analyze()` and are only valid until the page changes —
 * the same contract the agent tools use. `click(13)` after a navigation is a
 * bug; call `analyze()` again.
 */
export class Browser {
  readonly id: string;
  readonly provider: string;
  readonly persona: string;
  /** Point Playwright, Puppeteer or browser-use here. */
  readonly cdpUrl?: string;

  constructor(
    private readonly http: Http,
    info: StartResult,
    private readonly autoCaptcha: boolean,
  ) {
    this.id = info.id;
    this.provider = info.provider;
    this.persona = info.persona;
    this.cdpUrl = info.cdpUrl;
  }

  private async command<T>(action: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    const result = await this.http.request<CommandResult<T>>(
      'POST', `/api/browsers/${this.id}/command`, { action, params }, timeoutMs);
    if (result.ok === false) throw new Error(result.error || `${action} failed`);
    return result.data as T;
  }

  async goto(url: string): Promise<void> {
    await this.command('navigate', { url }, NAVIGATE_TIMEOUT_MS);
    if (this.autoCaptcha) await this.solveCaptcha();
  }

  /** The page as markdown plus numbered elements to act on. */
  async analyze(): Promise<Analysis> {
    return this.command<Analysis>('analyze');
  }

  /** Only the visible elements, which is what an agent almost always wants. */
  async elements(): Promise<Element[]> {
    return (await this.analyze()).elements.filter((e) => e.visible);
  }

  async click(elementId: number | string): Promise<void> {
    await this.command('click', { selector: `[data-ac-id="${elementId}"]` });
  }

  async type(elementId: number | string, text: string): Promise<{ suggestions_visible?: boolean }> {
    return this.command('type', { selector: `[data-ac-id="${elementId}"]`, text });
  }

  async pressKey(key: string): Promise<void> {
    await this.command('press_key', { key });
  }

  async scroll(direction: 'up' | 'down' | 'top' | 'bottom', amount?: number): Promise<void> {
    await this.command('scroll', { direction, amount });
  }

  async waitFor(selector: string, timeout = 30_000): Promise<void> {
    await this.command('wait', { selector, timeout }, timeout + 5_000);
  }

  /** Base64 PNG. */
  async screenshot(): Promise<string> {
    const data = await this.command<{ screenshot: string }>('screenshot');
    return data.screenshot;
  }

  async url(): Promise<string> {
    const tabs = await this.tabs();
    return tabs.find((t) => t.active)?.url || '';
  }

  async tabs(): Promise<Array<{ id: string; url: string; title: string; active: boolean }>> {
    const data = await this.command<{ tabs: Array<{ id: string; url: string; title: string; active: boolean }> }>('list_tabs');
    return data.tabs || [];
  }

  async openTab(url?: string): Promise<string> {
    const data = await this.command<{ tab_id: string }>('open_tab', { url }, NAVIGATE_TIMEOUT_MS);
    return data.tab_id;
  }

  async switchTab(tabId: string): Promise<void> { await this.command('switch_tab', { tab_id: tabId }); }
  async closeTab(tabId: string): Promise<void> { await this.command('close_tab', { tab_id: tabId }); }

  /**
   * Detect and clear a CAPTCHA. Providers that solve natively are left to do
   * it; everything else goes to the configured solver.
   */
  solveCaptcha(): Promise<CaptchaResult> {
    return this.http.request<CaptchaResult>('POST', `/api/browsers/${this.id}/captcha`, {}, 180_000);
  }

  /**
   * Answer an MFA prompt with the persona's configured factor. When nothing can
   * answer it, `liveViewUrl` is where a person finishes by hand.
   */
  completeMfa(): Promise<MfaResult> {
    return this.http.request<MfaResult>('POST', `/api/browsers/${this.id}/mfa`, {}, 180_000);
  }

  /** Natural-language control, using this key's configured model. */
  async ask(prompt: string): Promise<string> {
    const res = await this.http.request<{ text: string }>(
      'POST', `/api/browsers/${this.id}/chat`, { messages: [{ role: 'user', content: prompt }] }, 600_000);
    return res.text;
  }

  /**
   * Watch it work: an SSE stream of JPEG frames. EventSource cannot set
   * headers, so the key travels as a query parameter — treat the URL itself as
   * a credential.
   */
  liveViewUrl(): string {
    return `${this.http.baseUrl}/api/live/${this.id}?key=${encodeURIComponent(this.http.apiKey)}`;
  }

  async close(): Promise<void> {
    await this.http.request('POST', `/api/browsers/${this.id}/disconnect`, {});
  }
}
