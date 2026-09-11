import { OyaError } from './types.js';

/** The one HTTP path. Everything else in this package is a wrapper over it. */
export class Http {
  constructor(
    readonly baseUrl: string,
    readonly apiKey: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof globalThis.fetch,
  ) {}

  async request<T>(method: string, path: string, body?: unknown, timeoutMs = this.timeoutMs, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...headers,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await res.text();
    let payload: unknown;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }

    if (!res.ok) {
      const message = (payload as { error?: string })?.error || `${method} ${path} failed (${res.status})`;
      throw new OyaError(message, res.status, payload);
    }
    return payload as T;
  }
}
