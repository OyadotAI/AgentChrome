'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Dialog from '@/components/ui/dialog';
import { api, errorMessage } from '@/lib/api-client';
import { useToast } from './toast';
import type { Persona } from './types';
import { platformLabel } from './types';

interface Options { platforms: string[]; timezones: Record<string, string[]>; locales: Record<string, string[]> }
type Fingerprint = Persona['fingerprint'];

interface Props {
  open: boolean;
  onClose: () => void;
  apiKey: string;
  onCreated: (p: Persona) => void;
}

/**
 * A persona is one device. This is the only moment its device is chosen —
 * afterwards those fields are locked, because a device that changes under an
 * existing cookie jar is the tell the whole model exists to avoid.
 */
export default function PersonaForm({ open, onClose, apiKey, onCreated }: Props) {
  const toast = useToast();
  const [opts, setOpts] = useState<Options | null>(null);
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('auto');
  const [timezone, setTimezone] = useState('auto');
  const [locale, setLocale] = useState('auto');
  const [geo, setGeo] = useState('');
  const [cap, setCap] = useState<string>('2');
  const [mfaType, setMfaType] = useState<'' | 'totp' | 'email' | 'sms'>('');
  const [mfaValue, setMfaValue] = useState('');
  const [preview, setPreview] = useState<Fingerprint | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api<Options>('/personas/options', { key: apiKey }).then(setOpts).catch((e) => toast(errorMessage(e), 'error'));
    setName(''); setPlatform('auto'); setTimezone('auto'); setLocale('auto'); setGeo(''); setCap('2'); setMfaType(''); setMfaValue(''); setPreview(null);
  }, [open, apiKey, toast]);

  const prefs = useMemo(() => ({
    ...(platform !== 'auto' ? { platform } : {}),
    ...(timezone !== 'auto' ? { timezone } : {}),
    ...(locale !== 'auto' ? { locale } : {}),
  }), [platform, timezone, locale]);

  // A timezone only makes sense for the platform that carries it.
  useEffect(() => { setTimezone('auto'); setLocale('auto'); }, [platform]);

  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api<{ fingerprint: Fingerprint }>('/personas/preview', { key: apiKey, method: 'POST', body: { prefs }, signal: ctl.signal })
        .then((r) => setPreview(r.fingerprint)).catch(() => {});
    }, 150);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [open, apiKey, prefs]);

  const tzChoices = platform !== 'auto' ? opts?.timezones[platform] || [] : [];
  const locChoices = platform !== 'auto' ? opts?.locales[platform] || [] : [];

  const create = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: name || undefined, prefs, maxConcurrent: cap === '' ? null : Number(cap) };
      if (geo) body.proxy = { geo };
      const p = await api<Persona>('/personas', { key: apiKey, method: 'POST', body });
      if (mfaType && mfaValue) {
        await api(`/personas/${p.id}/mfa`, { key: apiKey, method: 'PUT',
          body: mfaType === 'totp' ? { type: 'totp', secret: mfaValue } : { type: mfaType, url: mfaValue } });
      }
      toast(`Created ${p.name}`, 'success');
      onCreated(p);
      onClose();
    } catch (err) { toast(errorMessage(err), 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} title="New profile" size="lg"
      description="One identity: a fingerprint, a cookie jar and a proxy, bound together and stable for its life."
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={create} disabled={busy}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Create profile</button>
        </>
      }>
      <div className="grid gap-6 md:grid-cols-[1fr_260px]">
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="pf-name">Name</label>
            <input id="pf-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. acme-ops" autoFocus />
          </div>

          <fieldset>
            <legend className="label">Device</legend>
            <div className="grid grid-cols-3 gap-2">
              <select className="field" value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform">
                <option value="auto">Platform: auto</option>
                {opts?.platforms.map((p) => <option key={p} value={p}>{platformLabel(p)}</option>)}
              </select>
              <select className="field" value={timezone} onChange={(e) => setTimezone(e.target.value)} aria-label="Timezone" disabled={platform === 'auto'}>
                <option value="auto">Timezone: auto</option>
                {tzChoices.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
              <select className="field" value={locale} onChange={(e) => setLocale(e.target.value)} aria-label="Locale" disabled={platform === 'auto'}>
                <option value="auto">Locale: auto</option>
                {locChoices.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <p className="mt-1.5 text-[11.5px] text-text-muted">
              Auto picks a coherent set. Choose a platform to pick its timezone and locale — only combinations a real machine reports are offered.
            </p>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="pf-cap">Concurrent browsers</label>
              <input id="pf-cap" className="field num" type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} placeholder="∞" />
              <p className="mt-1 text-[11.5px] text-text-muted">{cap === '' ? 'Uncapped — one device in many places at once is a signal.' : 'A phone and a laptop is plausible; a hundred is not.'}</p>
            </div>
            <div>
              <label className="label" htmlFor="pf-geo">Proxy geo</label>
              <input id="pf-geo" className="field" value={geo} onChange={(e) => setGeo(e.target.value.toUpperCase())} placeholder="any, or e.g. US, DE" maxLength={8} />
              <p className="mt-1 text-[11.5px] text-text-muted">Picked from your proxies at first connect, then kept.</p>
            </div>
          </div>

          <fieldset>
            <legend className="label">Second factor <span className="normal-case tracking-normal text-text-dim">(optional)</span></legend>
            <div className="grid grid-cols-[140px_1fr] gap-2">
              <select className="field" value={mfaType} onChange={(e) => setMfaType(e.target.value as typeof mfaType)} aria-label="MFA type">
                <option value="">None</option>
                <option value="totp">TOTP</option>
                <option value="email">Email code</option>
                <option value="sms">SMS code</option>
              </select>
              {mfaType && (
                <input className="field font-mono" type={mfaType === 'totp' ? 'password' : 'url'} autoComplete="off" value={mfaValue} onChange={(e) => setMfaValue(e.target.value)}
                  placeholder={mfaType === 'totp' ? 'Base32 secret from the QR code' : 'https://relay.example/latest — polled for the code'} />
              )}
            </div>
          </fieldset>
        </div>

        <Preview fp={preview} />
      </div>
    </Dialog>
  );
}

export function Preview({ fp, title = 'This device' }: { fp: Fingerprint | null; title?: string }) {
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-3 border-b border-border/60 py-1.5 last:border-0">
      <span className="text-text-muted">{k}</span><span className="truncate text-right text-text" title={typeof v === 'string' ? v : undefined}>{v}</span>
    </div>
  );
  return (
    <div className="rounded-lg border border-border bg-bg p-3 text-[12.5px]">
      <div className="mb-2 flex items-center justify-between">
        <span className="label mb-0">{title}</span>
        {!fp && <Loader2 className="h-3 w-3 animate-spin text-text-dim" />}
      </div>
      {fp ? (
        <>
          {row('Platform', platformLabel(fp.platform))}
          {row('Timezone', fp.timezone)}
          {row('Locale', fp.locale)}
          {row('Screen', fp.screen)}
          {row('GPU', <span className="font-mono text-[11px]">{fp.webgl}</span>)}
          {row('Cores · RAM', `${fp.hardwareConcurrency} · ${fp.deviceMemory} GB`)}
        </>
      ) : <div className="py-6 text-center text-text-dim">Preview…</div>}
    </div>
  );
}
