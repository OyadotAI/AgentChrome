'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import LiveView from '@/components/dashboard/live-view';
import { api, errorMessage } from '@/lib/api-client';
import { subscribeFrames } from '@/lib/live-stream';

export default function LiveBrowserPage() {
  const { browserId } = useParams<{ browserId: string }>();
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [name, setName] = useState('Live browser');
  const [frame, setFrame] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [age, setAge] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState('agent');

  useEffect(() => { setApiKey(sessionStorage.getItem('oya_project_credential') || localStorage.getItem('oya_api_key') || ''); }, []);
  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    let stopStream: (() => void) | undefined;
    let frames = 0, lastFrame = 0;
    setFrame(null); setError(''); setFps(0); setAge(null);
    api<{ name: string }>(`/browsers/${encodeURIComponent(browserId)}`, { key: apiKey }).then(browser => {
      if (cancelled) return;
      setName(browser.name);
      stopStream = subscribeFrames(browserId, apiKey, frame => { setFrame(frame); frames++; lastFrame = Date.now(); setError(''); }, () => { setFrame(null); setError('The live stream disconnected. Reconnecting…'); });
    }).catch(err => { if (!cancelled) setError(errorMessage(err)); });
    const timer = setInterval(() => { setFps(frames); frames = 0; setAge(lastFrame ? Date.now() - lastFrame : null); }, 1000);
    return () => { cancelled = true; stopStream?.(); clearInterval(timer); };
  }, [apiKey, browserId, attempt]);

  const send = useCallback(async (action: string, params: Record<string, unknown> = {}) => {
    if (!apiKey) return;
    try {
      const response = await api<{ ok: boolean; error?: string }>(`/control/sessions/${encodeURIComponent(browserId)}/input`, { key: apiKey, method: 'POST', body: { action, params } });
      if (!response.ok) throw new Error(response.error || 'Command failed');
      return response;
    } catch (err) { setError(errorMessage(err)); throw err; }
  }, [apiKey, browserId]);

  return <main className="mx-auto max-w-[1600px] p-4 sm:p-8">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div><Link href="/dashboard" className="inline-flex items-center gap-2 text-xs text-text-muted hover:text-text"><ArrowLeft className="h-3.5 w-3.5" />Dashboard</Link><h1 className="mt-3 text-2xl font-medium tracking-tight">{name}</h1></div>
      <button className="btn-ghost" onClick={async () => { if (!apiKey) return; try { const c = await api<{ mode: string }>(`/control/sessions/${browserId}/control`, { key: apiKey, method: 'POST', body: { action: mode === 'agent' ? 'acquire' : mode === 'human' ? 'release' : 'resume' } }); setMode(c.mode); } catch (e) { setError(errorMessage(e)); } }}>{mode === 'agent' ? 'Take control' : mode === 'human' ? 'Release control' : 'Resume agent'}</button>
      <button className="btn-ghost" onClick={() => setAttempt(a => a + 1)}><RefreshCw className="h-4 w-4" />Reconnect</button>
    </header>
    {apiKey === '' ? <p>Connect your Oya key in the <Link href="/dashboard" className="underline">dashboard</Link> to view this browser.</p> : <>
      {error && <p role="alert" className="mb-4 rounded-lg border border-red/20 bg-red/5 p-3 text-sm text-red">{error}</p>}
      <LiveView frameSrc={frame} fps={fps} frameAgeMs={age} send={send} />
    </>}
  </main>;
}
