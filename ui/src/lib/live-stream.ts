import { apiUrl, apiKeyHeaders } from './api';
/** Each EventSource connection uses a fresh, one-use ticket, never a project credential in its URL. */
export function subscribeFrames(id: string, key: string, onFrame: (frame: string) => void, onError: () => void) {
  let closed = false, source: EventSource | undefined, retry: ReturnType<typeof setTimeout> | undefined;
  const abort = new AbortController();
  async function connect() {
    try {
      const res = await fetch(apiUrl(`/control/sessions/${encodeURIComponent(id)}/ticket`), { method: 'POST', headers: apiKeyHeaders(key), body: '{}', signal: abort.signal });
      if (!res.ok) throw new Error('Cannot obtain a live-view ticket');
      const { ticket } = await res.json();
      if (closed) return;
      source = new EventSource(apiUrl(`/live/${encodeURIComponent(id)}?ticket=${encodeURIComponent(ticket)}`));
      source.onmessage = e => onFrame(e.data);
      source.onerror = () => { source?.close(); onError(); if (!closed) retry = setTimeout(() => void connect(), 2000); };
    } catch { if (!closed) { onError(); retry = setTimeout(() => void connect(), 2000); } }
  }
  void connect();
  return () => { closed = true; abort.abort(); source?.close(); clearTimeout(retry); };
}
