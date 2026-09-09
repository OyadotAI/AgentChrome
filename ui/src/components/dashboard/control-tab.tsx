'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, Circle, Clock, Film, Gauge, HardDrive, Play, Pause,
  RefreshCw, Server, ShieldCheck, Trash2, Users, X, Zap,
} from 'lucide-react';
import { apiUrl, apiKeyHeaders } from '@/lib/api';

type View = 'health' | 'sessions' | 'providers' | 'usage' | 'audit' | 'recordings';

type Series = { labels: Record<string, string>; value?: number; count?: number; sum?: number; avg?: number; p50?: number | null; p95?: number | null; p99?: number | null };
type Metrics = Record<string, Series[]>;
type Health = { at: string; uptimeSeconds: number; browsers: { total: number; byClient: Record<string, number>; byProvider: Record<string, number> }; metrics: Metrics };
type Session = { id: string; provider: string; profile: string | null; connected: boolean; seconds: number; bytesUp: number; bytesDown: number; recording: boolean };
type Provider = { name: string; type: string; active: number; maxConcurrent: number; priority: number; weight: number; healthy: boolean; available: boolean; latencyMs: number | null; cooldownMsRemaining: number; totalSessions: number; totalFailures: number };
type Routing = { strategy: string; queueDepth: number; capacity: number; active: number; healthy: number; providers: Provider[] };
type UsageRow = { actor: string; hour: string; openBrowsers: number; commands: number; command_errors: number; chat_requests: number; chat_input_tokens: number; chat_output_tokens: number; browser_seconds: number; rate_limited: number; quota_denied: number };
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

/** Sum one metric across its label sets. */
const total = (m: Metrics | undefined, name: string, match?: (l: Record<string, string>) => boolean) =>
  (m?.[name] || []).filter((s) => !match || match(s.labels)).reduce((n, s) => n + (s.value ?? s.count ?? 0), 0);

const single = (m: Metrics | undefined, name: string) => m?.[name]?.[0]?.value ?? null;

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
  const [health, setHealth] = useState<Health | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [routing, setRouting] = useState<Routing | null>(null);
  const [usageRows, setUsageRows] = useState<UsageRow[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [player, setPlayer] = useState<string | null>(null);
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
      // Session and provider views are useful to any key; the rest are admin.
      const [s, r] = await Promise.all([get('/gateway/sessions'), get('/gateway/providers')]);
      setSessions(s.sessions || []);
      setRouting(r);
      try {
        const [h, u, a, rec] = await Promise.all([
          get('/admin/metrics'), get('/admin/usage'), get('/admin/audit?limit=200'), get('/gateway/recordings'),
        ]);
        setHealth(h); setUsageRows(u.keys || []); setAudit(a.events || []); setRecordings(rec.recordings || []);
      } catch {
        // Not an admin key — the operator views stay empty rather than erroring.
        setHealth(null);
      }
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

  const m = health?.metrics;
  const commandsOk = total(m, 'oya_commands_total', (l) => l.outcome === 'ok');
  const commandsBad = total(m, 'oya_commands_total', (l) => l.outcome !== 'ok');
  const errorRate = commandsOk + commandsBad ? (commandsBad / (commandsOk + commandsBad)) * 100 : 0;
  const loopLag = single(m, 'oya_event_loop_lag_p99_ms');
  const cmdLatency = (m?.oya_command_duration_ms || []).reduce<{ p95: number | null; n: number }>(
    (acc, s) => ({ p95: Math.max(acc.p95 ?? 0, s.p95 ?? 0), n: acc.n + (s.count || 0) }), { p95: null, n: 0 });

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
          !health ? (
            <p className="text-text-dim text-sm">Fleet health needs an admin key.</p>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="Browsers" value={num(health.browsers.total)} icon={Users}
                  sub={Object.entries(health.browsers.byClient).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none connected'} />
                <Stat label="Gateway sessions" value={num(single(m, 'oya_gateway_sessions') ?? 0)} icon={Zap}
                  sub={`${routing?.queueDepth ?? 0} queued`} />
                <Stat label="Command errors" value={`${errorRate.toFixed(1)}%`} icon={AlertTriangle}
                  tone={errorRate > 10 ? 'bad' : errorRate > 2 ? 'warn' : 'good'}
                  sub={`${num(commandsBad)} of ${num(commandsOk + commandsBad)}`} />
                <Stat label="Event loop p99" value={loopLag == null ? '—' : `${loopLag.toFixed(1)} ms`} icon={Activity}
                  tone={(loopLag ?? 0) > 100 ? 'bad' : (loopLag ?? 0) > 30 ? 'warn' : 'good'}
                  sub="above ~100ms means saturated" />
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="Command p95" value={cmdLatency.p95 ? `${num(cmdLatency.p95)} ms` : '—'} icon={Clock}
                  sub={`${num(cmdLatency.n)} sampled`} />
                <Stat label="Memory" value={bytes(single(m, 'oya_process_rss_bytes') ?? 0)} icon={HardDrive}
                  sub={`heap ${bytes(single(m, 'oya_process_heap_used_bytes') ?? 0)}`} />
                <Stat label="Rate limited" value={num(total(m, 'oya_rate_limited_total'))} icon={ShieldCheck}
                  tone={total(m, 'oya_rate_limited_total') > 0 ? 'warn' : 'normal'}
                  sub={`${num(total(m, 'oya_quota_exceeded_total'))} quota denials`} />
                <Stat label="Uptime" value={duration(health.uptimeSeconds)} icon={Clock}
                  sub={new Date(health.at).toLocaleTimeString()} />
              </div>

              <div>
                <h3 className="text-xs uppercase tracking-wider text-text-dim mb-2">Command latency by action</h3>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-bg-elevated/60 text-text-dim text-xs">
                      <tr><th className="text-left px-3 py-2">Action</th><th className="text-right px-3 py-2">Count</th>
                        <th className="text-right px-3 py-2">p50</th><th className="text-right px-3 py-2">p95</th><th className="text-right px-3 py-2">p99</th></tr>
                    </thead>
                    <tbody>
                      {(m?.oya_command_duration_ms || []).filter((s) => s.count).sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 12).map((s, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-3 py-2 font-mono text-xs">{s.labels.action}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{num(s.count)}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{num(s.p50)}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{num(s.p95)}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{num(s.p99)}</td>
                        </tr>
                      ))}
                      {!(m?.oya_command_duration_ms || []).some((s) => s.count) && (
                        <tr><td colSpan={5} className="px-3 py-6 text-center text-text-dim text-xs">No commands yet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
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

            <div className="grid gap-3 md:grid-cols-2">
              {routing.providers.map((p) => (
                <div key={p.name} className="border border-border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Circle className={`w-2.5 h-2.5 shrink-0 fill-current ${p.healthy ? 'text-accent' : 'text-red-400'}`} />
                      <span className="font-medium truncate">{p.name}</span>
                      <span className="text-text-dim text-xs">{p.type}</span>
                    </div>
                    <button
                      disabled={!!busy}
                      onClick={() => void act(p.name, () => del(`/gateway/providers/${p.name}`))}
                      className="text-text-dim hover:text-red-400 disabled:opacity-40"
                      title="Remove provider"
                    ><Trash2 className="w-3.5 h-3.5" /></button>
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
                <p className="text-text-dim text-sm">No providers registered. Add one with POST /api/gateway/providers, or set OYA_PROVIDERS.</p>
              )}
            </div>
          </div>
        )}

        {view === 'usage' && (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-bg-elevated/60 text-text-dim text-xs">
                <tr>
                  <th className="text-left px-3 py-2">Key</th><th className="text-right px-3 py-2">Browsers</th>
                  <th className="text-right px-3 py-2">Commands</th><th className="text-right px-3 py-2">Errors</th>
                  <th className="text-right px-3 py-2">Browser time</th><th className="text-right px-3 py-2">Tokens</th>
                  <th className="text-right px-3 py-2">Throttled</th>
                </tr>
              </thead>
              <tbody>
                {usageRows.map((u) => (
                  <tr key={u.actor} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{u.actor}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{num(u.openBrowsers)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{num(u.commands)}</td>
                    <td className={`px-3 py-2 text-right font-mono tabular-nums text-xs ${u.command_errors ? 'text-amber-400' : ''}`}>{num(u.command_errors)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{duration(u.browser_seconds)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{num(u.chat_input_tokens + u.chat_output_tokens)}</td>
                    <td className={`px-3 py-2 text-right font-mono tabular-nums text-xs ${u.rate_limited + u.quota_denied ? 'text-red-400' : ''}`}>{num(u.rate_limited + u.quota_denied)}</td>
                  </tr>
                ))}
                {!usageRows.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-text-dim text-xs">No usage recorded this hour (admin key required).</td></tr>}
              </tbody>
            </table>
          </div>
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
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-bg border border-border rounded-lg max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <span className="font-mono text-xs">{sessionId.slice(0, 16)}</span>
          <button onClick={onClose} className="text-text-dim hover:text-text"><X className="w-4 h-4" /></button>
        </div>
        <div className="bg-black flex items-center justify-center min-h-[300px]">
          {error ? <p className="text-text-dim text-sm p-8">{error}</p>
            : src ? <img src={src} alt={`Frame ${index + 1}`} className="max-h-[70vh] w-auto" />
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
    </div>
  );
}
