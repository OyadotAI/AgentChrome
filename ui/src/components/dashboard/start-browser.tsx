'use client';

import { useState } from 'react';
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
  const [error, setError] = useState('');
  const selectedProvider = provider || defaultProvider;
  const ready = providers.some((p) => p.id === selectedProvider && p.configured);
  const unavailable = selectedProvider === 'oya-cloud' || selectedProvider === 'oya-selfhosted'
    ? 'Cloud browsers are unavailable on this server. The server operator needs to finish cloud setup and provide a public connection address. You can keep using your connected desktop or choose a ready provider below.'
    : `${providerLabel(selectedProvider)} is not configured. Add its connection details in Settings, or choose a ready provider below.`;

  const start = async () => {
    if (busy || !ready) return;
    setError('');
    setBusy(true);
    let ok = 0, lastErr = '';
    for (let i = 0; i < count; i++) {
      try {
        await api('/browsers/start', { key: apiKey, method: 'POST', body: {
          persona, ...(provider ? { provider } : {}), ...(name ? { name: count > 1 ? `${name} ${i + 1}` : name } : {}),
        } });
        ok++;
      } catch (err) { lastErr = errorMessage(err); break; }
    }
    setBusy(false);
    if (ok) { toast(ok === 1 ? 'Browser starting' : `${ok} browsers starting`, 'success'); onStarted(); }
    if (lastErr) setError(ok ? `${ok} started. ${lastErr}` : lastErr);
    else if (ok) onClose();
  };

  const configured = providers.filter((p) => p.configured);

  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title="Start a browser" size="sm"
      description={`On ${providerLabel(provider || defaultProvider)} — change the default in Settings.`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={start} disabled={busy || !ready}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{count > 1 ? `Start ${count}` : 'Start'}
          </button>
        </>
      }>
      <fieldset className="space-y-4" disabled={busy}>
        {(!ready || error) && <p role="alert" className="rounded-md border border-yellow/30 bg-yellow/10 p-3 text-sm text-text-secondary">{error || unavailable}</p>}
        <div>
          <label className="label" htmlFor="sb-persona">Profile</label>
          <select id="sb-persona" className="field" value={persona} onChange={(e) => setPersona(e.target.value)}>
            <option value="default">Default profile</option>
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
        {configured.some((p) => p.id !== defaultProvider) && (
          <div>
            <label className="label" htmlFor="sb-provider">Provider <span className="normal-case tracking-normal text-text-dim">(this browser only)</span></label>
            <select id="sb-provider" className="field" value={provider} onChange={(e) => { setProvider(e.target.value); setError(''); }}>
              <option value="">Key default — {providerLabel(defaultProvider)}</option>
              {configured.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
        )}
      </fieldset>
    </Dialog>
  );
}
