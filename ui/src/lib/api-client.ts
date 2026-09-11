import { apiUrl, apiKeyHeaders } from './api';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Every dashboard request goes through here, so a failure always carries the
 * server's own reason — "Persona is in use", not "Request failed (409)".
 */
export async function api<T = unknown>(
  path: string,
  { key, method = 'GET', body, signal }: { key: string; method?: string; body?: unknown; signal?: AbortSignal },
): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method,
    headers: apiKeyHeaders(key),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!res.ok) {
    const reason = (payload as { error?: string } | null)?.error || `${method} ${path} failed (${res.status})`;
    throw new ApiError(reason, res.status, payload);
  }
  return payload as T;
}

export const errorMessage = (err: unknown, fallback = 'Something went wrong'): string =>
  err instanceof Error ? err.message : fallback;

/** Relative time that reads like a person wrote it, for tables that refresh every few seconds. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const sec = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (sec < 5) return 'now';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d`;
}

export function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…` : id;
}
