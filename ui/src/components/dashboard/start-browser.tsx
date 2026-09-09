'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Dialog from '@/components/ui/dialog';
import { api, errorMessage } from '@/lib/api-client';
import { useToast } from './toast';
import type { Persona } from './types';
import { providerLabel } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  apiKey: string;
  personas: Persona[];
  defaultProvider: string;
  providers: { id: string; label: string; configured: boolean }[];
  onStarted: () => void;
}

/** Which identity, how many, and — only if the key allows it — where. */
export default function StartBrowser({ open, onClose, apiKey, personas, defaultProvider, providers, onStarted }: Props) {
  const toast = useToast();
  const [persona, setPersona] = useState('default');
  const [provider, setProvider] = useState('');
  const [name, setName] = useState('');
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setProvider(''); setName(''); setCount(1); } }, [open]);

  const start = async () => {
    setBusy(true);
    let ok = 0, lastErr = '';
    for (let i = 0; i < count; i++) {
      try {
        await api('/browsers/start', { key: apiKey, method: 'POST', body: {
          persona, ...(provider ? { provider } : {}), ...(name ? { name: count > 1 ? `${name} ${i + 1}` : name } : {}),
        } });
        ok++;
      } catch (err) { lastErr = errorMessage(err); }
    }
    setBusy(false);
    if (ok) { toast(ok === 1 ? 'Browser starting' : `${ok} browsers starting`, 'success'); onStarted(); onClose(); }
    if (lastErr) toast(lastErr, 'error');
  };

  const configured = providers.filter((p) => p.configured);

  return (
    <Dialog open={open} onClose={onClose} title="Start a browser" size="sm"
      description={`On ${providerLabel(provider || defaultProvider)} — change the default in Settings.`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={start} disabled={busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{count > 1 ? `Start ${count}` : 'Start'}
          </button>
        </>
      }>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="sb-persona">Persona</label>
          <select id="sb-persona" className="field" value={persona} onChange={(e) => setPersona(e.target.value)}>
            <option value="default">Default persona</option>
            <option value="auto">Auto — least recently used under its cap</option>
            {personas.filter((p) => !p.isDefault).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.activeBrowsers}/{p.maxConcurrent === null ? '∞' : p.maxConcurrent} running
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-[1fr_88px] gap-3">
          <div>
            <label className="label" htmlFor="sb-name">Name <span className="normal-case tracking-normal text-text-dim">(optional)</span></label>
            <input id="sb-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. checkout-worker" />
          </div>
          <div>
            <label className="label" htmlFor="sb-count">How many</label>
            <input id="sb-count" type="number" min={1} max={50} className="field num" value={count} onChange={(e) => setCount(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} />
          </div>
        </div>
        {configured.length > 1 && (
          <div>
            <label className="label" htmlFor="sb-provider">Provider <span className="normal-case tracking-normal text-text-dim">(this browser only)</span></label>
            <select id="sb-provider" className="field" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="">Key default — {providerLabel(defaultProvider)}</option>
              {configured.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
        )}
      </div>
    </Dialog>
  );
}
