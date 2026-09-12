'use client';

import { useState } from 'react';
import { Globe, Plus, ShieldCheck, Users } from 'lucide-react';
import { ago } from '@/lib/api-client';
import type { Persona, BrowserRow } from './types';
import { platformLabel } from './types';
import PersonaForm from './persona-form';
import PersonaDrawer from './persona-drawer';
import ProxiesDialog from './proxies-dialog';

interface Props {
  apiKey: string;
  browsers: BrowserRow[];
  personas: Persona[];
  refresh: () => void;
  openId: string | null;
  onOpen: (id: string | null) => void;
  onShowBrowsers: (personaId: string) => void;
  now: number;
}

/**
 * Every identity this key owns. One identity = one device, stable for its
 * life; rotation means choosing a different row here, never editing one.
 */
export default function PersonasTab({ apiKey, browsers, personas, refresh, openId, onOpen, onShowBrowsers, now }: Props) {
  const [creating, setCreating] = useState(false);
  const [proxies, setProxies] = useState(false);
  const open = personas.find((p) => p.id === openId) || null;

  return (
    <div className="workspace-list flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-4 py-5 lg:px-6">
        <div className="mr-auto">
          <h2 className="text-[22px] font-medium tracking-tight text-text">Profiles <span className="ml-2 text-[14px] text-text-dim">{personas.length}</span></h2>
          <p className="text-[12px] text-text-muted">Saved account sessions, a consistent device, and an optional second factor.</p>
        </div>
        <button className="btn-ghost h-9" onClick={() => setProxies(true)}><Globe className="h-3.5 w-3.5" /> Proxies</button>
        <button className="btn-primary h-9" onClick={() => setCreating(true)}><Plus className="h-3.5 w-3.5" /> New profile</button>
      </div>

      <div className="data-scroll mx-4 mb-4 min-h-0 flex-initial overflow-auto rounded-xl border border-border bg-bg-card/25 lg:mx-6 lg:mb-6">
        <table className="data-table profile-data w-full table-fixed border-collapse text-[13px]" aria-label="Profiles">
          <thead className="sticky top-0 z-10 bg-bg-elevated">
            <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-[0.1em] text-text-muted">
              <th className="w-[22%] px-4 py-3">Profile</th>
              <th className="w-[18%] px-3 py-3">Saved sites</th>
              <th className="w-[110px] px-2 py-3 text-right">Running</th>
              <th className="px-3 py-3">Device</th>
              <th className="w-[140px] px-2 py-3">Exit</th>
              <th className="w-[70px] px-2 py-3">MFA</th>
              <th className="w-[90px] px-2 py-3 text-right">Last used</th>
              <th className="w-[90px] px-2 py-3 text-right">Created</th>
            </tr>
          </thead>
          <tbody>
            {personas.map((p) => {
              const cap = p.maxConcurrent === null ? Infinity : p.maxConcurrent;
              const at = p.activeBrowsers >= cap;
              const running = browsers.filter((b) => b.persona === p.id).length || p.activeBrowsers;
              return (
                <tr key={p.id} className={`cursor-pointer border-b border-border/60 hover:bg-text/[0.035] ${openId === p.id ? 'bg-accent/[0.08]' : ''}`} onClick={() => onOpen(p.id)}>
                  <td className="px-2 py-3 pl-4">
                    <div className="flex min-w-0 items-center gap-2">
                      <button className="truncate text-left font-medium text-text hover:text-accent" title={p.name} onClick={e => { e.stopPropagation(); onOpen(p.id); }}>{p.name}</button>
                      {p.isDefault && <span className="shrink-0 rounded border border-border px-1 text-[10px] uppercase tracking-wider text-text-muted">default</span>}
                    </div>
                    <div className="mt-1 truncate font-mono text-[11px] text-text-dim">{p.id}</div>
                  </td>
                  <td className="max-w-[240px] px-2 py-3 text-text-secondary"><span className="block truncate" title={p.login?.sites.join(", ")}>{p.login?.sites.length ? p.login.sites.join(", ") : "No accounts saved"}</span></td>
                  <td className="px-2 py-3 text-right num">
                    <span className={at ? 'text-yellow' : running ? 'text-accent' : 'text-text-muted'}>{running}</span>
                    <span className="text-text-dim"> / {cap === Infinity ? '∞' : cap}</span>
                  </td>
                  <td className="truncate px-3 py-3 text-text-secondary">
                    <span className="block truncate">{platformLabel(p.fingerprint.platform)} · {p.fingerprint.screen}</span><span className="mt-1 block truncate text-[11px] text-text-dim">{p.fingerprint.timezone}</span>
                  </td>
                  <td className="truncate px-3 py-3 text-text-secondary">
                    {p.exit ? <span title={p.exit.label}>{p.exit.label}{p.exit.geo ? ` · ${p.exit.geo}` : ''}</span>
                      : p.proxy?.geo ? <span className="text-text-muted">{p.proxy.geo} (auto)</span> : <span className="text-text-dim">direct</span>}
                  </td>
                  <td className="px-2 py-3">{p.mfa?.configured ? <span className="inline-flex items-center gap-1 text-[12px] text-accent"><ShieldCheck className="h-3.5 w-3.5" />{p.mfa.type}</span> : <span className="text-text-dim">—</span>}</td>
                  <td className="px-2 py-3 text-right num text-text-muted">{p.lastUsedAt ? ago(p.lastUsedAt, now) : '—'}</td>
                  <td className="px-2 py-3 text-right num text-text-muted">{ago(p.createdAt, now)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {personas.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-34 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-bg-card"><Users className="h-5 w-5 text-text-muted" /></div>
            <p className="text-[15px] font-medium text-text">No profiles yet</p>
            <button className="btn-primary" onClick={() => setCreating(true)}>Create one</button>
          </div>
        )}
      </div>

      <ProxiesDialog open={proxies} onClose={() => setProxies(false)} apiKey={apiKey} onChanged={refresh} />
      <PersonaForm open={creating} onClose={() => setCreating(false)} apiKey={apiKey} onCreated={() => refresh()} />
      <PersonaDrawer persona={open} onClose={() => onOpen(null)} apiKey={apiKey} browsers={browsers} onChanged={refresh} onShowBrowsers={onShowBrowsers} now={now} />
    </div>
  );
}
