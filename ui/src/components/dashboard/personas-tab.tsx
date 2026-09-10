'use client';

import { useState } from 'react';
import { Plus, ShieldCheck, Users } from 'lucide-react';
import { ago } from '@/lib/api-client';
import type { Persona, BrowserRow } from './types';
import { platformLabel } from './types';
import PersonaForm from './persona-form';
import PersonaDrawer from './persona-drawer';

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
  const open = personas.find((p) => p.id === openId) || null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2 lg:px-6">
        <div className="mr-auto">
          <h2 className="text-[14px] font-semibold text-text">Profiles</h2>
          <p className="text-[12px] text-text-muted">Saved account sessions, a consistent device, and an optional second factor.</p>
        </div>
        <span className="text-[12px] num text-text-muted">{personas.length}</span>
        <button className="btn-primary h-7" onClick={() => setCreating(true)}><Plus className="h-3.5 w-3.5" /> New profile</button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-bg">
            <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-[0.1em] text-text-muted">
              <th className="px-2 py-1.5 lg:pl-6">Profile</th>
              <th className="px-2 py-1.5">Saved sites</th>
              <th className="w-[110px] px-2 py-1.5 text-right">Running</th>
              <th className="px-2 py-1.5">Device</th>
              <th className="w-[140px] px-2 py-1.5">Exit</th>
              <th className="w-[70px] px-2 py-1.5">MFA</th>
              <th className="w-[90px] px-2 py-1.5 text-right">Last used</th>
              <th className="w-[90px] px-2 py-1.5 text-right">Created</th>
            </tr>
          </thead>
          <tbody>
            {personas.map((p) => {
              const cap = p.maxConcurrent === null ? Infinity : p.maxConcurrent;
              const at = p.activeBrowsers >= cap;
              const running = browsers.filter((b) => b.persona === p.id).length || p.activeBrowsers;
              return (
                <tr key={p.id} className={`row-lazy cursor-pointer border-b border-border/60 hover:bg-text/[0.035] ${openId === p.id ? 'bg-accent/[0.08]' : ''}`} onClick={() => onOpen(p.id)}>
                  <td className="px-2 py-2 lg:pl-6">
                    <div className="flex items-center gap-2">
                      <button className="text-left font-medium text-text" onClick={() => onOpen(p.id)}>{p.name}</button>
                      {p.isDefault && <span className="rounded border border-border px-1 text-[10px] uppercase tracking-wider text-text-muted">default</span>}
                    </div>
                    <div className="font-mono text-[11px] text-text-dim">{p.id}</div>
                  </td>
                  <td className="max-w-[240px] px-2 py-2 text-text-secondary"><span className="block truncate" title={p.login?.sites.join(", ")}>{p.login?.sites.length ? p.login.sites.join(", ") : "No accounts saved"}</span></td>
                  <td className="px-2 py-2 text-right num">
                    <span className={at ? 'text-yellow' : running ? 'text-accent' : 'text-text-muted'}>{running}</span>
                    <span className="text-text-dim"> / {cap === Infinity ? '∞' : cap}</span>
                  </td>
                  <td className="px-2 py-2 text-text-secondary">
                    {platformLabel(p.fingerprint.platform)} · {p.fingerprint.timezone} · {p.fingerprint.screen}
                  </td>
                  <td className="px-2 py-2 text-text-secondary">
                    {p.exit ? <span title={p.exit.label}>{p.exit.label}{p.exit.geo ? ` · ${p.exit.geo}` : ''}</span>
                      : p.proxy?.geo ? <span className="text-text-muted">{p.proxy.geo} (auto)</span> : <span className="text-text-dim">direct</span>}
                  </td>
                  <td className="px-2 py-2">{p.mfa?.configured ? <span className="inline-flex items-center gap-1 text-[12px] text-accent"><ShieldCheck className="h-3.5 w-3.5" />{p.mfa.type}</span> : <span className="text-text-dim">—</span>}</td>
                  <td className="px-2 py-2 text-right num text-text-muted">{p.lastUsedAt ? ago(p.lastUsedAt, now) : '—'}</td>
                  <td className="px-2 py-2 text-right num text-text-muted">{ago(p.createdAt, now)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {personas.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-bg-card"><Users className="h-5 w-5 text-text-muted" /></div>
            <p className="text-[15px] font-medium text-text">No profiles yet</p>
            <button className="btn-primary" onClick={() => setCreating(true)}>Create one</button>
          </div>
        )}
      </div>

      <PersonaForm open={creating} onClose={() => setCreating(false)} apiKey={apiKey} onCreated={() => refresh()} />
      <PersonaDrawer persona={open} onClose={() => onOpen(null)} apiKey={apiKey} browsers={browsers} onChanged={refresh} onShowBrowsers={onShowBrowsers} now={now} />
    </div>
  );
}
