'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Square, RotateCw, ArrowLeft, ArrowRight, Camera, ScanSearch, ExternalLink, Copy, Check } from 'lucide-react';
import { api, ago, errorMessage, shortId } from '@/lib/api-client';
import { apiUrl } from '@/lib/api';
import { useToast } from './toast';
import type { BrowserDetail } from './types';
import { providerLabel, HEALTH_LABEL } from './types';
import LiveView from './live-view';
import ActivityLog from './activity-log';
import Dialog from '@/components/ui/dialog';
import Kbd from '@/components/ui/kbd';

interface Props {
  apiKey: string;
  browserId: string;
  onClose: () => void;
  onStop: (ids: string[]) => void;
  onOpenPersona: (id: string) => void;
  urlRef: React.RefObject<HTMLInputElement | null>;
  now: number;
}

interface Element { id: number; type: string; text?: string; visible: boolean }

/**
 * One browser, close up: what it is looking at, what it has been doing, and a
 * way to act on it. Polled every 2s while open.
 */
export default function BrowserPanel({ apiKey, browserId, onClose, onStop, onOpenPersona, urlRef, now }: Props) {
  const toast = useToast();
  const [detail, setDetail] = useState<BrowserDetail | null>(null);
  const [url, setUrl] = useState('');
  const [urlDirty, setUrlDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<{ ts: string; line: string }[]>([]);
  const [shot, setShot] = useState<string | null>(null);
  const [elements, setElements] = useState<Element[] | null>(null);
  const [copied, setCopied] = useState(false);

  // Live frames
  const [frame, setFrame] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [frameAt, setFrameAt] = useState<number | null>(null);
  const frames = useRef(0);

  useEffect(() => {
    setDetail(null); setFrame(null); setUrl(''); setUrlDirty(false); setOptimistic([]); setElements(null);
    const es = new EventSource(apiUrl(`/live/${browserId}?key=${encodeURIComponent(apiKey)}`));
    es.onmessage = (e) => { setFrame(e.data); frames.current++; setFrameAt(Date.now()); };
    es.onerror = () => { setFrame(null); };
    const fpsTimer = setInterval(() => { setFps(frames.current); frames.current = 0; }, 1000);
    return () => { es.close(); clearInterval(fpsTimer); };
  }, [browserId, apiKey]);

  const refresh = useCallback(async () => {
    try {
      const d = await api<BrowserDetail>(`/browsers/${browserId}`, { key: apiKey });
      setDetail(d);
      setUrl((u) => (urlDirty ? u : d.currentUrl || u));
      // The server has caught up with whatever we did; drop the placeholders.
      setOptimistic((o) => o.filter((x) => Date.now() - new Date(x.ts).getTime() < 3000));
    } catch (err) {
      if ((err as { status?: number }).status === 404) onClose();
    }
  }, [browserId, apiKey, urlDirty, onClose]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const send = useCallback(async (action: string, params: Record<string, unknown> = {}) => {
    try {
      const r = await api<{ ok: boolean; data?: unknown; error?: string }>(`/browsers/${browserId}/command`, { key: apiKey, method: 'POST', body: { action, params } });
      if (r.ok === false) toast(r.error || `${action} failed`, 'error');
      return r;
    } catch (err) {
      toast(errorMessage(err), 'error');
      return { ok: false };
    }
  }, [browserId, apiKey, toast]);

  const onInput = useCallback((line: string) => {
    setOptimistic((o) => [{ ts: new Date().toISOString(), line }, ...o].slice(0, 5));
  }, []);

  const go = async (target = url) => {
    const t = target.trim();
    if (!t) return;
    setBusy('navigate'); setUrlDirty(false);
    onInput(`navigate ${t}`);
    await send('navigate', { url: t });
    setBusy(null);
    refresh();
  };

  const reload = async () => {
    // The Oya client has no reload over the socket; navigating to the same
    // URL is the same thing from the page's point of view.
    setBusy('reload');
    onInput('reload');
    if (detail?.clientType === 'cdp') await send('reload'); else if (detail?.currentUrl) await send('navigate', { url: detail.currentUrl });
    setBusy(null);
  };

  const screenshot = async () => {
    setBusy('screenshot');
    const r = await send('screenshot');
    setBusy(null);
    const data = (r as { data?: { screenshot?: string } }).data?.screenshot;
    if (data) setShot(data);
  };

  const analyze = async () => {
    setBusy('analyze');
    const r = await send('analyze');
    setBusy(null);
    const els = (r as { data?: { elements?: Element[] } }).data?.elements;
    if (els) setElements(els.filter((e) => e.visible));
  };

  const copyId = () => {
    navigator.clipboard.writeText(browserId).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
  };

  const d = detail;
  const cloud = d?.provider === 'oya-cloud';

  return (
    <aside className="flex h-full w-full flex-col border-l border-border bg-bg-card lg:w-[540px]" aria-label="Browser detail">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {d && <span className={`dot dot-${d.health}`} title={HEALTH_LABEL[d.health]} />}
            <h2 className="truncate text-[15px] font-semibold text-text">{d?.name || '…'}</h2>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-text-muted">
            <button className="font-mono hover:text-text" onClick={copyId} title="Copy id">
              {shortId(browserId)} {copied ? <Check className="inline h-3 w-3 text-accent" /> : <Copy className="inline h-3 w-3" />}
            </button>
            {d && <span>{providerLabel(d.provider)}</span>}
            {d?.persona && (
              <button className="hover:text-text" onClick={() => onOpenPersona(d.persona!)} title="Open persona">
                {d.personaName || shortId(d.persona)} ↗
              </button>
            )}
          </div>
        </div>
        <button className="btn-danger h-7" onClick={() => onStop([browserId])} title={cloud ? 'Destroys the sandbox' : 'Stops this browser'}>
          <Square className="h-3 w-3" /> Stop <Kbd>X</Kbd>
        </button>
        <button className="btn-icon" onClick={onClose} aria-label="Close panel"><X className="h-4 w-4" /></button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {/* URL bar */}
        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); go(); }}>
          {d?.clientType === 'cdp' && (
            <>
              <button type="button" className="btn-icon" title="Back" onClick={() => send('back')}><ArrowLeft className="h-4 w-4" /></button>
              <button type="button" className="btn-icon" title="Forward" onClick={() => send('forward')}><ArrowRight className="h-4 w-4" /></button>
            </>
          )}
          <button type="button" className="btn-icon" title="Reload (R)" onClick={reload} disabled={busy === 'reload'}>
            <RotateCw className={`h-4 w-4 ${busy === 'reload' ? 'animate-spin' : ''}`} />
          </button>
          <input
            ref={urlRef}
            value={url}
            onChange={(e) => { setUrl(e.target.value); setUrlDirty(true); }}
            onKeyDown={(e) => { if (e.key === 'Escape') { setUrl(d?.currentUrl || ''); setUrlDirty(false); (e.target as HTMLInputElement).blur(); } }}
            placeholder="Enter a URL and press Enter"
            className="field flex-1 font-mono text-[12.5px]"
            aria-label="Navigate to URL"
            spellCheck={false}
          />
          <button type="submit" className="btn-primary h-8" disabled={busy === 'navigate'}>{busy === 'navigate' ? 'Going…' : 'Go'}</button>
        </form>

        {/* Live view */}
        <div className="group">
          <LiveView browserId={browserId} frameSrc={frame} fps={fps} frameAgeMs={frameAt ? now - frameAt : null} send={send} onInput={onInput} />
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost" onClick={screenshot} disabled={busy === 'screenshot'}><Camera className="h-3.5 w-3.5" /> Screenshot <Kbd>S</Kbd></button>
          <button className="btn-ghost" onClick={analyze} disabled={busy === 'analyze'}><ScanSearch className="h-3.5 w-3.5" /> Elements</button>
          <a className="btn-ghost" href={apiUrl(`/live/${browserId}?key=${encodeURIComponent(apiKey)}`)} target="_blank" rel="noreferrer" title="Raw frame stream">
            <ExternalLink className="h-3.5 w-3.5" /> Stream
          </a>
        </div>

        {/* Stats */}
        {d && (
          <dl className="grid grid-cols-3 gap-x-4 gap-y-2 rounded-md border border-border bg-bg px-3 py-2 text-[12.5px]">
            <Stat k="Status" v={HEALTH_LABEL[d.health]} tone={d.health} />
            <Stat k="Uptime" v={ago(d.connectedAt, now)} />
            <Stat k="Last seen" v={ago(d.lastSeen, now)} />
            <Stat k="Commands" v={String(d.commands)} />
            <Stat k="Errors" v={String(d.errors)} tone={d.errors ? 'errors' : undefined} />
            <Stat k="In flight" v={String(d.pending)} />
          </dl>
        )}
        {d?.lastError && <p className="truncate text-[12px] text-red" title={d.lastError}>Last error: {d.lastError}</p>}

        {/* Elements from analyze */}
        {elements && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="label mb-0">Elements ({elements.length} visible)</h3>
              <button className="text-[11.5px] text-text-muted hover:text-text" onClick={() => setElements(null)}>hide</button>
            </div>
            <div className="max-h-[200px] overflow-y-auto rounded-md border border-border bg-bg font-mono text-[12px]">
              {elements.map((e) => (
                <button key={e.id} className="flex w-full items-center gap-2 border-b border-border/60 px-2 py-1 text-left hover:bg-white/5"
                  onClick={() => { onInput(`click #${e.id}`); send('click', { selector: `[data-ac-id="${e.id}"]` }); }}>
                  <span className="w-8 shrink-0 text-right text-accent">#{e.id}</span>
                  <span className="w-14 shrink-0 text-text-muted">{e.type}</span>
                  <span className="truncate text-text-secondary">{e.text || ''}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Activity */}
        <ActivityLog items={d?.activity || []} optimistic={optimistic} now={now} />
      </div>

      <Dialog open={!!shot} onClose={() => setShot(null)} title="Screenshot" size="lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {shot && <img src={shot} alt="Screenshot" className="w-full rounded-md border border-border" />}
      </Dialog>
    </aside>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: string }) {
  const color = tone === 'ok' ? 'text-accent' : tone === 'errors' ? 'text-red' : tone === 'stale' ? 'text-yellow' : tone === 'dead' ? 'text-text-muted' : 'text-text';
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] uppercase tracking-[0.12em] text-text-dim">{k}</dt>
      <dd className={`truncate num ${color}`}>{v}</dd>
    </div>
  );
}
