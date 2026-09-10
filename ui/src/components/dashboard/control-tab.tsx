'use client';

import Image from 'next/image';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, Circle, Clock, Film, Gauge, Play, Pause,
  Plus, RefreshCw, Server, ShieldCheck, Trash2, Users, X, Zap,
} from 'lucide-react';
import { apiUrl, apiKeyHeaders } from '@/lib/api';
import Dialog from '@/components/ui/dialog';

type View = 'health' | 'sessions' | 'providers' | 'usage' | 'audit' | 'recordings';

type Fleet = {
  at: string; uptimeSeconds: number;
  browsers: { total: number; byClient: Record<string, number>; byProvider: Record<string, number> };
  sessions: { total: number; attached: number; recording: number };
  routing: Routing;
  usage: Record<string, number> & { hour: string; openBrowsers: number };
  limits: Record<string, { limit: number; burst?: number; remaining: number; disabled?: boolean }>;
  quotas: Record<string, number>;
};
type Session = { id: string; provider: string; profile: string | null; connected: boolean; seconds: number; bytesUp: number; bytesDown: number; recording: boolean };
type Provider = { name: string; type: string; shared?: boolean; owner?: string | null; active: number; maxConcurrent: number; priority: number; weight: number; healthy: boolean; available: boolean; latencyMs: number | null; cooldownMsRemaining: number; totalSessions: number; totalFailures: number };
type Routing = { strategy: string; queueDepth: number; capacity: number; active: number; healthy: number; providers: Provider[] };
type AuditEvent = { ts: string; action: string; actor: string | null; target_type: string | null; target_id: string | null; outcome: string; ip: string | null; meta: Record<string, unknown> | null };
type Recording = { sessionId: string; provider?: string; profile?: string | null; startedAt?: string; durationMs?: number; frameCount?: number; bytes?: number; live?: boolean; truncated?: boolean };

const STRATEGIES = ['priority', 'round-robin', 'least-connections', 'latency', 'weighted'];

const num = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: digits });

const bytes = (n: number) => {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
};

const duration = (s: number) => {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

function Stat({ label, value, sub, tone = 'normal', icon: Icon }: {
  label: string; value: string; sub?: string; tone?: 'normal' | 'warn' | 'bad' | 'good'; icon?: typeof Activity;
}) {
  const toneClass = tone === 'bad' ? 'text-red-400' : tone === 'warn' ? 'text-amber-400' : tone === 'good' ? 'text-accent' : 'text-text';
  return (
    <div className="border border-border rounded-lg p-4 bg-bg-elevated/40">
      <div className="flex items-center gap-2 text-text-dim text-xs uppercase tracking-wider mb-2">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </div>
      <div className={`font-mono tabular-nums text-2xl ${toneClass}`}>{value}</div>
      {sub && <div className="text-text-dim text-xs mt-1">{sub}</div>}
    </div>
  );
}

function Bar({ used, capacity }: { used: number; capacity: number }) {
  const pct = capacity ? Math.min(100, (used / capacity) * 100) : 0;
  const tone = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-accent';
  return (
    <div className="h-1.5 bg-border rounded-full overflow-hidden w-full" title={`${used} of ${capacity}`}>
      <div className={`h-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function ControlTab({ apiKey }: { apiKey: string }) {
  const [view, setView] = useState<View>('health');
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [routing, setRouting] = useState<Routing | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [player, setPlayer] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ name: '', type: 'cdp', wsUrl: '', maxConcurrent: '5', priority: '100', weight: '1' });
  const polling = useRef(false);

  const headers = useMemo(() => apiKeyHeaders(apiKey), [apiKey]);

  const get = useCallback(async (path: string) => {
    const res = await fetch(apiUrl(path), { headers });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `${path} → ${res.status}`);
    return res.json();
  }, [headers]);

  const refresh = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      // Everything here is scoped to the connected API key. There is no admin
      // tier: the key is the identity.
      const [f, s, a, rec] = await Promise.all([
        get('/fleet'), get('/gateway/sessions'), get('/audit?limit=200'), get('/gateway/recordings'),
      ]);
      setFleet(f);
      setRouting(f.routing);
      setSessions(s.sessions || []);
      setAudit(a.events || []);
      setRecordings(rec.recordings || []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load control plane data');
    } finally {
      polling.current = false;
    }
  }, [get]);

  useEffect(() => {
    if (!apiKey) return;
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [apiKey, refresh]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setError(''); setNotice('');
    try { await fn(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(''); }
  };

  const post = (path: string, body?: unknown) =>
    fetch(apiUrl(path), { method: 'POST', headers, ...(body ? { body: JSON.stringify(body) } : {}) })
      .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `${r.status}`); return r.json(); });

  const del = (path: string) =>
    fetch(apiUrl(path), { method: 'DELETE', headers })
      .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `${r.status}`); return r.json(); });

  const u = fleet?.usage;
  const commands = u?.commands ?? 0;
  const errors = u?.command_errors ?? 0;
  const errorRate = commands ? (errors / commands) * 100 : 0;
  const throttled = (u?.rate_limited ?? 0) + (u?.quota_denied ?? 0);

  const views: { key: View; label: string; icon: typeof Activity }[] = [
    { key: 'health', label: 'Health', icon: Activity },
    { key: 'sessions', label: 'Sessions', icon: Users },
    { key: 'providers', label: 'Providers', icon: Server },
    { key: 'usage', label: 'Usage', icon: Gauge },
    { key: 'audit', label: 'Audit', icon: ShieldCheck },
    { key: 'recordings', label: 'Recordings', icon: Film },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-1 px-4 lg:px-6 py-2 border-b border-border overflow-x-auto shrink-0">
        {views.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors ${
              view === v.key ? 'bg-bg-elevated text-text' : 'text-text-dim hover:text-text-muted'
            }`}
          >
            <v.icon className="w-3.5 h-3.5" />
            {v.label}
          </button>
        ))}
        <button
          onClick={() => void refresh()}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-text-dim hover:text-text"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {(error || notice) && (
        <div className={`px-4 lg:px-6 py-2 text-xs flex items-center gap-2 shrink-0 ${error ? 'text-red-400' : 'text-accent'}`}>
          {error ? <AlertTriangle className="w-3.5 h-3.5" /> : <Circle className="w-3 h-3 fill-current" />}
          {error || notice}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 lg:p-6">
        {view === 'health' && (
          !fleet ? (
            <p className="text-text-dim text-sm">Loading…</p>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="Your browsers" value={num(fleet.browsers.total)} icon={Users}
                  sub={Object.entries(fleet.browsers.byClient).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none connected'} />
                <Stat label="Gateway sessions" value={num(fleet.sessions.total)} icon={Zap}
                  sub={`${fleet.sessions.attached} attached · ${fleet.sessions.recording} recording`} />
                <Stat label="Command errors" value={`${errorRate.toFixed(1)}%`} icon={AlertTriangle}
                  tone={errorRate > 10 ? 'bad' : errorRate > 2 ? 'warn' : 'good'}
                  sub={`${num(errors)} of ${num(commands)} this hour`} />
                <Stat label="Throttled" value={num(throttled)} icon={ShieldCheck}
                  tone={throttled > 0 ? 'warn' : 'good'}
                  sub={`${num(u?.rate_limited)} rate · ${num(u?.quota_denied)} quota`} />
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="Browser time" value={duration(u?.browser_seconds ?? 0)} icon={Clock}
                  sub={`${num(u?.browsers_started)} started this hour`} />
                <Stat label="Model tokens" value={num((u?.chat_input_tokens ?? 0) + (u?.chat_output_tokens ?? 0))} icon={Gauge}
                  sub={`quota ${num(fleet.quotas.chatTokensPerHour)}/hr`} />
                <Stat label="Provider capacity" value={`${num(fleet.routing.active)}/${num(fleet.routing.capacity)}`} icon={Server}
                  tone={fleet.routing.healthy ? 'normal' : 'bad'}
                  sub={`${fleet.routing.healthy} healthy · queue ${fleet.routing.queueDepth}`} />
                <Stat label="Host uptime" value={duration(fleet.uptimeSeconds)} icon={Activity}
                  sub={new Date(fleet.at).toLocaleTimeString()} />
              </div>

              <div>
                <h3 className="text-xs uppercase tracking-wider text-text-dim mb-2">Your remaining allowance</h3>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-bg-elevated/60 text-text-dim text-xs">
                      <tr><th className="text-left px-3 py-2">Limit</th><th className="text-right px-3 py-2">Per minute</th>
                        <th className="text-right px-3 py-2">Burst</th><th className="text-right px-3 py-2">Remaining</th></tr>
                    </thead>
                    <tbody>
                      {Object.entries(fleet.limits).map(([name, l]) => (
                        <tr key={name} className="border-t border-border">
                          <td className="px-3 py-2 font-mono text-xs">{name}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{l.disabled ? 'off' : num(l.limit)}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{num(l.burst)}</td>
                          <td className={`px-3 py-2 text-right font-mono tabular-nums text-xs ${
                            !l.disabled && l.remaining < (l.burst ?? 0) * 0.2 ? 'text-amber-400' : ''}`}>
                            {l.disabled ? '∞' : num(l.remaining)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-text-dim text-xs mt-2">
                  Everything here is scoped to the API key you are connected with — its browsers, sessions,
                  providers, usage and audit trail.
                </p>
              </div>
            </div>
          )
        )}

        {view === 'sessions' && (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-elevated/60 text-text-dim text-xs">
                <tr>
                  <th className="text-left px-3 py-2">Session</th><th className="text-left px-3 py-2">Provider</th>
                  <th className="text-left px-3 py-2">Profile</th><th className="text-right px-3 py-2">Age</th>
                  <th className="text-right px-3 py-2">Traffic</th><th className="text-left px-3 py-2">State</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{s.id.slice(0, 8)}</td>
                    <td className="px-3 py-2 text-xs">{s.provider}</td>
                    <td className="px-3 py-2 text-xs">{s.profile || <span className="text-text-dim">—</span>}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{duration(s.seconds)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{bytes(s.bytesUp + s.bytesDown)}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className={s.connected ? 'text-accent' : 'text-amber-400'}>
                        {s.connected ? 'attached' : 'held for resume'}
                      </span>
                      {s.recording && <span className="ml-2 text-text-dim">● rec</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        disabled={!!busy}
                        onClick={() => void act(s.id, () => del(`/gateway/sessions/${s.id}`))}
                        className="text-text-dim hover:text-red-400 disabled:opacity-40"
                        title="End session"
                      ><X className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}
                {!sessions.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-text-dim text-xs">No gateway sessions. Point a CDP client at /connect to start one.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {view === 'providers' && routing && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setShowAdd((v) => !v)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium bg-accent text-bg hover:opacity-90"
              >
                <Plus className="w-3.5 h-3.5" /> Add provider
              </button>
              <span className="text-xs text-text-dim uppercase tracking-wider">Strategy</span>
              <select
                value={routing.strategy}
                onChange={(e) => void act('strategy', () => post('/gateway/strategy', { strategy: e.target.value }))}
                className="bg-bg-elevated border border-border rounded px-2 py-1 text-sm"
              >
                {STRATEGIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="text-xs text-text-dim">
                {routing.active} of {routing.capacity} slots · {routing.healthy} healthy · queue {routing.queueDepth}
              </span>
            </div>

            {showAdd && (
              <form
                className="border border-border rounded-lg p-4 space-y-3 bg-bg-elevated/30"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act('add-provider', async () => {
                    await post('/gateway/providers', {
                      name: draft.name.trim(),
                      type: draft.type,
                      ...(draft.type === 'cdp' ? { wsUrl: draft.wsUrl.trim() } : {}),
                      maxConcurrent: Number(draft.maxConcurrent) || 5,
                      priority: Number(draft.priority) || 100,
                      weight: Number(draft.weight) || 1,
                    });
                    setShowAdd(false);
                    setDraft({ name: '', type: 'cdp', wsUrl: '', maxConcurrent: '5', priority: '100', weight: '1' });
                    setNotice('Provider added.');
                  });
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-text-dim space-y-1 block">
                    <span>Name</span>
                    <input
                      required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      placeholder="my-chrome"
                      className="w-full bg-bg border border-border rounded px-2 py-1.5 text-sm text-text"
                    />
                  </label>
                  <label className="text-xs text-text-dim space-y-1 block">
                    <span>Type</span>
                    <select
                      value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}
                      className="w-full bg-bg border border-border rounded px-2 py-1.5 text-sm text-text"
                    >
                      <option value="cdp">cdp — your own CDP endpoint</option>
                      <option value="anchor">anchor</option>
                      <option value="browserbase">browserbase</option>
                      <option value="steel">steel</option>
                    </select>
                  </label>
                </div>

                {draft.type === 'cdp' ? (
                  <label className="text-xs text-text-dim space-y-1 block">
                    <span>CDP WebSocket URL</span>
                    <input
                      required value={draft.wsUrl} onChange={(e) => setDraft({ ...draft, wsUrl: e.target.value })}
                      placeholder="ws://127.0.0.1:9222/devtools/browser/…"
                      className="w-full bg-bg border border-border rounded px-2 py-1.5 text-sm font-mono text-text"
                    />
                    <span className="block text-text-dim">
                      From <code className="font-mono">http://host:9222/json/version</code> →{' '}
                      <code className="font-mono">webSocketDebuggerUrl</code>. Private and loopback
                      addresses need <code className="font-mono">OYA_ALLOW_PRIVATE_TARGETS=true</code> on the host.
                    </span>
                  </label>
                ) : (
                  <p className="text-xs text-text-dim">
                    A session is opened per connection using the host&apos;s{' '}
                    <code className="font-mono">{draft.type.toUpperCase()}_API_KEY</code>.
                  </p>
                )}

                <div className="grid gap-3 sm:grid-cols-3">
                  {([['maxConcurrent', 'Max sessions'], ['priority', 'Priority (lower wins)'], ['weight', 'Weight']] as const).map(([k, label]) => (
                    <label key={k} className="text-xs text-text-dim space-y-1 block">
                      <span>{label}</span>
                      <input
                        type="number" min={0} value={draft[k]}
                        onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                        className="w-full bg-bg border border-border rounded px-2 py-1.5 text-sm font-mono text-text"
                      />
                    </label>
                  ))}
                </div>

                <div className="flex gap-2">
                  <button type="submit" disabled={!!busy}
                    className="px-3 py-1.5 rounded text-xs font-medium bg-accent text-bg disabled:opacity-40">
                    {busy === 'add-provider' ? 'Adding…' : 'Add provider'}
                  </button>
                  <button type="button" onClick={() => setShowAdd(false)}
                    className="px-3 py-1.5 rounded text-xs text-text-dim hover:text-text">Cancel</button>
                </div>
              </form>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              {routing.providers.map((p) => (
                <div key={p.name} className="border border-border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Circle className={`w-2.5 h-2.5 shrink-0 fill-current ${p.healthy ? 'text-accent' : 'text-red-400'}`} />
                      <span className="font-medium truncate">{p.name}</span>
                      <span className="text-text-dim text-xs">{p.type}</span>
                    </div>
                    {p.shared ? (
                      <span className="text-text-dim text-xs" title="Declared by the host via OYA_PROVIDERS">shared</span>
                    ) : (
                      <button
                        disabled={!!busy}
                        onClick={() => void act(p.name, () => del(`/gateway/providers/${p.name}`))}
                        className="text-text-dim hover:text-red-400 disabled:opacity-40"
                        title="Remove provider"
                      ><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                  <Bar used={p.active} capacity={p.maxConcurrent} />
                  <div className="grid grid-cols-2 gap-y-1 text-xs text-text-dim">
                    <span>Slots <span className="text-text font-mono">{p.active}/{p.maxConcurrent}</span></span>
                    <span>Priority <span className="text-text font-mono">{p.priority}</span></span>
                    <span>Latency <span className="text-text font-mono">{p.latencyMs == null ? '—' : `${p.latencyMs}ms`}</span></span>
                    <span>Sessions <span className="text-text font-mono">{num(p.totalSessions)}</span></span>
                    {p.totalFailures > 0 && <span className="text-amber-400">Failures <span className="font-mono">{p.totalFailures}</span></span>}
                    {p.cooldownMsRemaining > 0 && <span className="text-red-400">Cooldown <span className="font-mono">{Math.ceil(p.cooldownMsRemaining / 1000)}s</span></span>}
                  </div>
                </div>
              ))}
              {!routing.providers.length && (
                <p className="text-text-dim text-sm">
                  No providers yet. Add one above — a CDP endpoint you run, or a hosted vendor.
                  The host can also declare shared providers with OYA_PROVIDERS.
                </p>
              )}
            </div>
          </div>
        )}

        {view === 'usage' && (
          !u ? <p className="text-text-dim text-sm">Loading…</p> : (
            <div className="space-y-4">
              <p className="text-text-dim text-xs">Hour beginning {new Date(u.hour).toLocaleString()}</p>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-bg-elevated/60 text-text-dim text-xs">
                    <tr><th className="text-left px-3 py-2">Metric</th><th className="text-right px-3 py-2">This hour</th></tr>
                  </thead>
                  <tbody>
                    {([
                      ['Browsers started', u.browsers_started], ['Browsers open now', u.openBrowsers],
                      ['Browser time', null], ['Commands', u.commands], ['Command errors', u.command_errors],
                      ['Chat requests', u.chat_requests],
                      ['Model tokens in', u.chat_input_tokens], ['Model tokens out', u.chat_output_tokens],
                      ['Cookie pulls', u.cookie_pulls], ['Frames', u.frames],
                      ['Sandboxes created', u.sandboxes_created],
                      ['Rate limited', u.rate_limited], ['Quota denied', u.quota_denied],
                      ['Bytes out', null],
                    ] as [string, number | null][]).map(([label, value]) => (
                      <tr key={label} className="border-t border-border">
                        <td className="px-3 py-2 text-xs">{label}</td>
                        <td className={`px-3 py-2 text-right font-mono tabular-nums text-xs ${
                          /limited|denied|errors/.test(label) && (value ?? 0) > 0 ? 'text-amber-400' : ''}`}>
                          {label === 'Browser time' ? duration(u.browser_seconds ?? 0)
                            : label === 'Bytes out' ? bytes(u.bytes_out ?? 0)
                            : num(value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}

        {view === 'audit' && (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-elevated/60 text-text-dim text-xs">
                <tr>
                  <th className="text-left px-3 py-2">When</th><th className="text-left px-3 py-2">Action</th>
                  <th className="text-left px-3 py-2">Actor</th><th className="text-left px-3 py-2">Target</th>
                  <th className="text-left px-3 py-2">From</th><th className="text-left px-3 py-2">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((e, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-2 text-xs text-text-dim whitespace-nowrap">{new Date(e.ts).toLocaleTimeString()}</td>
                    <td className="px-3 py-2 font-mono text-xs">{e.action}</td>
                    <td className="px-3 py-2 font-mono text-xs text-text-dim">{e.actor?.slice(0, 10) || '—'}</td>
                    <td className="px-3 py-2 text-xs text-text-dim truncate max-w-[16rem]">
                      {e.target_type ? `${e.target_type}${e.target_id ? ` ${String(e.target_id).slice(0, 12)}` : ''}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-dim">{e.ip || '—'}</td>
                    <td className={`px-3 py-2 text-xs ${e.outcome === 'ok' ? 'text-accent' : e.outcome === 'denied' ? 'text-amber-400' : 'text-red-400'}`}>{e.outcome}</td>
                  </tr>
                ))}
                {!audit.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-text-dim text-xs">No audit events (admin key required).</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {view === 'recordings' && (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {recordings.map((r) => (
              <div key={r.sessionId} className="border border-border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs truncate">{r.sessionId.slice(0, 12)}</span>
                  {r.live && <span className="text-accent text-xs">● live</span>}
                </div>
                <div className="text-xs text-text-dim space-y-0.5">
                  <div>{num(r.frameCount)} frames · {bytes(r.bytes || 0)}</div>
                  <div>{r.durationMs ? duration(r.durationMs / 1000) : '—'} · {r.provider || 'unknown'}</div>
                  {r.truncated && <div className="text-amber-400">truncated at the frame cap</div>}
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setPlayer(r.sessionId)} disabled={!r.frameCount}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-bg-elevated hover:bg-border disabled:opacity-40">
                    <Play className="w-3 h-3" /> Play
                  </button>
                  <button onClick={() => void act(r.sessionId, () => del(`/gateway/recordings/${r.sessionId}`))}
                    disabled={!!busy}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded text-text-dim hover:text-red-400 disabled:opacity-40">
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                </div>
              </div>
            ))}
            {!recordings.length && <p className="text-text-dim text-sm">No recordings. Add <code className="font-mono">?record=1</code> when connecting to capture one.</p>}
          </div>
        )}
      </div>

      {player && <Player sessionId={player} headers={headers} onClose={() => setPlayer(null)} />}
    </div>
  );
}

/** Frame scrubber. Frames are fetched individually and cached by the browser. */
function Player({ sessionId, headers, onClose }: { sessionId: string; headers: HeadersInit; onClose: () => void }) {
  const [frames, setFrames] = useState<{ i: number; t: number }[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  const objectUrl = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl(`/gateway/recordings/${sessionId}`), { headers })
      .then((r) => r.json())
      .then((m) => { if (!cancelled) setFrames(m.frames || []); })
      .catch(() => { if (!cancelled) setError('Could not load the recording'); });
    return () => { cancelled = true; };
  }, [sessionId, headers]);

  useEffect(() => {
    let cancelled = false;
    if (!frames.length) return;
    fetch(apiUrl(`/gateway/recordings/${sessionId}/frames/${frames[index]?.i ?? 0}`), { headers })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('frame'))))
      .then((blob) => {
        if (cancelled) return;
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = URL.createObjectURL(blob);
        setSrc(objectUrl.current);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [frames, index, sessionId, headers]);

  // Revoke the last object URL on unmount, not on every frame change.
  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const gap = Math.max(80, Math.min(1000, (frames[index + 1]?.t ?? 0) - (frames[index]?.t ?? 0) || 200));
    const t = setTimeout(() => setIndex((i) => (i + 1 < frames.length ? i + 1 : 0)), gap);
    return () => clearTimeout(t);
  }, [playing, index, frames]);

  return (
    <Dialog open onClose={onClose} title="Recording" size="lg" description={<span className="font-mono">{sessionId.slice(0, 16)}</span>}>
      <div className="-mx-5 -my-4">
        <div className="bg-black flex items-center justify-center min-h-[300px]">
          {error ? <p className="text-text-dim text-sm p-8">{error}</p>
            : src ? <Image unoptimized src={src} alt={`Frame ${index + 1}`} width={1920} height={1080} className="max-h-[70vh] w-auto object-contain" />
            : <p className="text-text-dim text-sm p-8">Loading…</p>}
        </div>
        <div className="flex items-center gap-3 px-4 py-3 border-t border-border">
          <button onClick={() => setPlaying((p) => !p)} className="text-text-dim hover:text-text">
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <input
            type="range" min={0} max={Math.max(0, frames.length - 1)} value={index}
            onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }}
            className="flex-1 accent-accent"
            aria-label="Recording position"
          />
          <span className="font-mono text-xs text-text-dim tabular-nums whitespace-nowrap">
            {index + 1}/{frames.length} · {((frames[index]?.t ?? 0) / 1000).toFixed(1)}s
          </span>
        </div>
      </div>
    </Dialog>
  );
}
