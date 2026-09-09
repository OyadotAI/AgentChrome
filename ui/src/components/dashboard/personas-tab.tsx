'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, Fingerprint, Shield } from 'lucide-react';
import { apiUrl, apiKeyHeaders } from '@/lib/api';
import { useToast } from './toast';

export interface Persona {
  id: string;
  name: string;
  isDefault: boolean;
  activeBrowsers: number;
  maxConcurrent: number | null;
  proxy: { label?: string; geo?: string } | null;
  fingerprint?: { platform?: string; timezone?: string; screen?: { width: number; height: number }; gpu?: string };
  mfa?: { configured: boolean; type?: string };
  lastUsedAt: string | null;
}

/**
 * A persona is one identity: fingerprint, cookie jar and proxy bound together
 * and stable for its life. That binding is the point — one account seen from
 * many devices is a bot-farm signal, and so is many accounts from one device.
 * Rotation means choosing a different persona, never re-rolling one.
 */
export default function PersonasTab({ apiKey }: { apiKey: string }) {
  const toast = useToast();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    if (!apiKey) return;
    try {
      const res = await fetch(apiUrl('/personas'), { headers: apiKeyHeaders(apiKey) });
      if (!res.ok) return;
      const data = await res.json();
      setPersonas(data.personas || []);
    } catch { /* the poll will retry */ } finally { setLoading(false); }
  }, [apiKey]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const res = await fetch(apiUrl('/personas'), {
        method: 'POST',
        headers: apiKeyHeaders(apiKey),
        body: JSON.stringify({ name: name || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not create');
      setName('');
      toast(`Created ${body.name}`, 'success');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
    } finally { setCreating(false); }
  };

  const remove = async (p: Persona) => {
    if (!confirm(`Delete ${p.name}? Its cookie jar goes with it.`)) return;
    try {
      const res = await fetch(apiUrl(`/personas/${p.id}`), { method: 'DELETE', headers: apiKeyHeaders(apiKey) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not delete');
      toast('Deleted', 'success');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-text-dim" /></div>;
  }

  return (
    <div className="p-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-sm font-semibold text-text">Personas</h2>
          <p className="mt-0.5 text-xs text-text-dim">
            One identity each: fingerprint, cookies and proxy, stable for its life.
          </p>
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
          placeholder="Name (optional)"
          className="rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
        />
        <button onClick={create} disabled={creating}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-black disabled:opacity-60">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} New persona
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {personas.map((p) => {
          const cap = p.maxConcurrent === null ? Infinity : p.maxConcurrent;
          const atCap = p.activeBrowsers >= cap;
          return (
            <div key={p.id} className="rounded-lg border border-border bg-bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-text">{p.name}</div>
                  <div className="truncate font-mono text-xs text-text-dim" title={p.id}>{p.id}</div>
                </div>
                {!p.isDefault && (
                  <button onClick={() => remove(p)} className="text-text-dim hover:text-red-400" title="Delete">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="mt-3 flex items-center gap-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-mono ${atCap ? 'bg-amber-500/10 text-amber-400' : 'bg-accent/10 text-accent'}`}>
                  {p.activeBrowsers}/{cap === Infinity ? '∞' : cap} running
                </span>
                {p.isDefault && <span className="text-text-dim">default</span>}
                {p.mfa?.configured && (
                  <span className="inline-flex items-center gap-1 text-text-dim"><Shield className="h-3 w-3" />{p.mfa.type}</span>
                )}
              </div>

              <div className="mt-3 space-y-1 text-xs text-text-dim">
                <div className="flex items-center gap-1.5">
                  <Fingerprint className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    {p.fingerprint?.platform || '—'}
                    {p.fingerprint?.timezone ? ` · ${p.fingerprint.timezone}` : ''}
                    {p.fingerprint?.screen ? ` · ${p.fingerprint.screen.width}×${p.fingerprint.screen.height}` : ''}
                  </span>
                </div>
                <div className="truncate">
                  {p.proxy ? `via ${p.proxy.label || p.proxy.geo || 'proxy'}` : 'direct connection'}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!personas.length && (
        <p className="py-16 text-center text-sm text-text-dim">No personas yet.</p>
      )}
    </div>
  );
}
