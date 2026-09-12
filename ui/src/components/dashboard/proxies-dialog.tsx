'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Trash2 } from 'lucide-react';
import Dialog from '@/components/ui/dialog';
import { api, errorMessage } from '@/lib/api-client';
import { useToast } from './toast';

export interface ProxyRow {
  id: string; label: string; kind: 'residential' | 'datacenter'; geo: string | null; shared: boolean;
  healthy: boolean; available: boolean; exitIp: string | null; lastCheckedAt: string | null;
  assigned: number; maxPersonas: number;
}

interface Props { open: boolean; onClose: () => void; apiKey: string; onChanged: () => void }

/**
 * The exits profiles can use. A proxy added here is picked by a profile's geo
 * hint at first connect, or pinned from the profile drawer, and then kept.
 */
export default function ProxiesDialog({ open, onClose, apiKey, onChanged }: Props) {
  const toast = useToast();
  const [rows, setRows] = useState<ProxyRow[]>([]);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [geo, setGeo] = useState('');
  const [kind, setKind] = useState<'residential' | 'datacenter'>('residential');
  const [max, setMax] = useState('1');
  const [busy, setBusy] = useState<'' | 'add' | 'check' | string>('');
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(() => api<{ proxies: ProxyRow[] }>('/proxies', { key: apiKey })
    .then((r) => setRows(r.proxies)).catch((e) => toast(errorMessage(e), 'error')), [apiKey, toast]);

  useEffect(() => {
    if (!open) return;
    load();
    setLabel(''); setUrl(''); setGeo(''); setKind('residential'); setMax('1'); setConfirming(null);
  }, [open, load]);

  const add = async () => {
    setBusy('add');
    try {
      const p = await api<ProxyRow>('/proxies', { key: apiKey, method: 'POST',
        body: { label: label || undefined, url, geo: geo || undefined, kind, maxPersonas: Number(max) || 1 } });
      toast(`Added ${p.label}`, 'success');
      setLabel(''); setUrl(''); setGeo('');
      await load(); onChanged();
    } catch (e) { toast(errorMessage(e), 'error'); }
    finally { setBusy(''); }
  };

  const check = async () => {
    setBusy('check');
    try {
      const { results } = await api<{ results: { id: string; ok: boolean; error?: string }[] }>('/proxies/check', { key: apiKey, method: 'POST', body: {} });
      const bad = results.filter((r) => !r.ok).length;
      toast(bad ? `${bad} of ${results.length} proxies failed` : `All ${results.length} proxies work`, bad ? 'error' : 'success');
      await load();
    } catch (e) { toast(errorMessage(e), 'error'); }
    finally { setBusy(''); }
  };

  const remove = async (p: ProxyRow) => {
    if (confirming !== p.id) return setConfirming(p.id);
    setBusy(p.id);
    try {
      await api(`/proxies/${p.id}`, { key: apiKey, method: 'DELETE' });
      toast(`Removed ${p.label}`, 'success');
      await load(); onChanged();
    } catch (e) { toast(errorMessage(e), 'error'); }
    finally { setBusy(''); setConfirming(null); }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Proxies" size="lg"
      description="Exits your profiles use. Each profile keeps the proxy it is given, because an IP that changes looks like a stolen login."
      footer={<button className="btn-ghost" onClick={onClose}>Done</button>}>
      <div className="space-y-5">
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-[13px]" aria-label="Proxies">
            <thead className="bg-bg-elevated">
              <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-[0.1em] text-text-muted">
                <th className="px-3 py-2">Proxy</th>
                <th className="px-2 py-2">Country</th>
                <th className="px-2 py-2">Exit IP</th>
                <th className="px-2 py-2 text-right">Profiles</th>
                <th className="px-2 py-2">Health</th>
                <th className="w-10 px-2 py-2"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-medium text-text">{p.label}</div>
                    <div className="text-[11px] text-text-dim">{p.kind}{p.shared ? ' · shared' : ''}</div>
                  </td>
                  <td className="px-2 py-2 text-text-secondary">{p.geo || 'any'}</td>
                  <td className="px-2 py-2 font-mono text-[12px] text-text-secondary">{p.exitIp || <span className="text-text-dim">not checked</span>}</td>
                  <td className="px-2 py-2 text-right num text-text-secondary">{p.assigned} / {p.maxPersonas}</td>
                  <td className="px-2 py-2">{p.available ? <span className="text-accent">ok</span> : <span className="text-yellow">{p.healthy ? 'cooling down' : 'failing'}</span>}</td>
                  <td className="px-2 py-2 text-right">
                    {!p.shared && (
                      <button className={confirming === p.id ? 'btn-ghost h-7 text-[12px] text-red' : 'btn-ghost h-7 w-7 p-0'} onClick={() => remove(p)}
                        disabled={busy === p.id} aria-label={`Remove ${p.label}`}>
                        {busy === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : confirming === p.id ? 'Remove?' : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-text-muted">No proxies yet. Profiles connect directly until you add one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && (
          <button className="btn-ghost h-8" onClick={check} disabled={busy === 'check'}>
            {busy === 'check' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Check all
          </button>
        )}

        <fieldset className="space-y-3 rounded-xl border border-border p-4">
          <legend className="label px-1">Add a proxy</legend>
          <div>
            <label className="label" htmlFor="px-url">Proxy URL</label>
            <input id="px-url" className="field font-mono" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="http://user:pass@gate.vendor.com:7000" autoComplete="off" spellCheck={false} />
            <p className="mt-1 text-[11.5px] text-text-muted">From your proxy vendor. Use http or https: Chromium ignores SOCKS5 passwords. Stored encrypted and never shown again.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className="label" htmlFor="px-label">Label</label>
              <input id="px-label" className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="us-home-1" />
            </div>
            <div>
              <label className="label" htmlFor="px-geo">Country</label>
              <input id="px-geo" className="field" value={geo} onChange={(e) => setGeo(e.target.value.toUpperCase())} placeholder="US" maxLength={8} />
            </div>
            <div>
              <label className="label" htmlFor="px-kind">Type</label>
              <select id="px-kind" className="field" value={kind} onChange={(e) => setKind(e.target.value as 'residential' | 'datacenter')}>
                <option value="residential">Residential</option>
                <option value="datacenter">Datacenter</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="px-max">Max profiles</label>
              <input id="px-max" className="field num" type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} />
            </div>
          </div>
          <p className="text-[11.5px] text-text-muted">Keep max profiles at 1 for a sticky session URL, so each profile keeps its own IP.</p>
          <button className="btn-primary h-9" onClick={add} disabled={!url || busy === 'add'}>
            {busy === 'add' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Add proxy
          </button>
        </fieldset>
      </div>
    </Dialog>
  );
}
