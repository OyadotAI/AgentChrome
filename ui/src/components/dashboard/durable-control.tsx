'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiUrl, apiKeyHeaders } from '@/lib/api';

type Session = { id: string; provider: string; state: string; managed: boolean; costUsd: number; control: { mode: string }; cleanupError?: string };
type Settings = { maxConcurrent: number | null; budgetUsd: number | null; recordingDays: number; auditDays: number; rates: Record<string, number>; policy: Record<string, unknown> };
type Overview = {
  project: { id: string; name: string; settings: Settings; costUsd?: number };
  sessions: Session[]; draining: boolean;
  events: { id: number; type: string; sessionId: string | null; at: number }[];
  credentials?: { id: string; role: string; label: string; revokedAt: number | null }[];
  webhooks?: { id: string; url: string; enabled: boolean }[];
  deliveries?: { id: string; state: string; attempts: number }[];
};
const button = 'rounded border border-border px-3 py-1.5 text-xs hover:bg-bg-elevated disabled:opacity-40';
const field = 'w-full rounded border border-border bg-bg p-2 text-sm';

export default function DurableControl({ apiKey }: { apiKey: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState('');
  const [filter, setFilter] = useState('');
  const [role, setRole] = useState('operator');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rates, setRates] = useState('{}');
  const [policy, setPolicy] = useState('{}');
  const [members, setMembers] = useState<{ userId: string; role: string }[]>([]);
  const request = useCallback(async (path = '', method = 'GET', body?: unknown) => {
    const res = await fetch(apiUrl(`/control${path}`), {
      method, headers: { ...apiKeyHeaders(apiKey), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await res.json();
    if (!res.ok) throw new Error(value.error || `Request failed (${res.status})`);
    return value;
  }, [apiKey]);
  const refresh = useCallback(async () => {
    const value = await request() as Overview;
    setData(value);
    if (value.credentials) { const team = await request('/members'); setMembers(team.members); }
    return value;
  }, [request]);
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const value = await request() as Overview;
        const team = value.credentials ? await request('/members') : null;
        if (mounted) {
          setMembers(team?.members || []);
          setData(value);
          setSettings(current => current || value.project.settings);
          setPolicy(current => current === '{}' ? JSON.stringify(value.project.settings.policy, null, 2) : current);
          setRates(current => current === '{}' ? JSON.stringify(value.project.settings.rates, null, 2) : current);
        }
      } catch (e) { if (mounted) setError(e instanceof Error ? e.message : 'Control data unavailable'); }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => { mounted = false; clearInterval(timer); };
  }, [request]);
  async function act(path: string, method = 'POST', body?: unknown) {
    setBusy(true); setError('');
    try {
      const result = await request(path, method, body);
      if (result.token || result.secret || result.code) setSecret(result.token || result.secret || result.code);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(false); }
  }
  if (!data) return <div className="p-6 text-sm text-text-muted" role="status">{error || 'Loading durable session inventory…'}</div>;
  const sessions = data.sessions.filter(s => !filter || s.state === filter);
  const pending = data.sessions.filter(s => ['cleanup_pending', 'unknown_outcome'].includes(s.state)).length;
  const active = data.sessions.filter(s => !['stopped', 'failed'].includes(s.state)).length;
  return (
    <div className="space-y-8 p-5 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">Project operations</p>
          <h2 className="mt-1 text-xl font-medium">{data.project.name}</h2>
          <p className="mt-1 font-mono text-xs text-text-dim">{data.project.id}</p></div>
        <span className={`rounded border px-3 py-1 text-xs ${data.draining ? 'border-yellow text-yellow' : 'border-border text-text-muted'}`}>{data.draining ? 'Admission paused · draining' : 'Accepting sessions'}</span>
      </header>
      {error && <p role="alert" className="rounded border border-red/40 p-3 text-sm text-red">{error}</p>}
      {secret && <div role="status" className="space-y-2 rounded border border-accent p-4"><p className="text-sm">Save this secret now. It is shown once.</p><code className="block break-all select-all text-xs">{secret}</code><button className={button} onClick={() => setSecret('')}>Dismiss secret</button></div>}
      <div className="grid grid-cols-3 divide-x divide-border border-y border-border py-4">
        <div><p className="text-xs text-text-dim">Active and reserved</p><p className="mt-1 text-3xl tabular-nums">{active}</p></div>
        <div className="pl-5"><p className="text-xs text-text-dim">Needs reconciliation</p><p className={`mt-1 text-3xl tabular-nums ${pending ? 'text-yellow' : ''}`}>{pending}</p></div>
        <div className="pl-5"><p className="text-xs text-text-dim">Estimated browser cost</p><p className="mt-1 text-3xl tabular-nums">${(data.project.costUsd || 0).toFixed(2)}</p></div>
      </div>
      <section>
        <div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-medium">Session inventory</h3><select aria-label="Filter sessions by state" className={`${field} max-w-48`} value={filter} onChange={e => setFilter(e.target.value)}><option value="">All states</option>{['queued', 'provisioning', 'ready', 'disconnected', 'cleanup_pending', 'unknown_outcome', 'stopped', 'failed'].map(s => <option key={s}>{s}</option>)}</select></div>
        <div className="overflow-x-auto rounded border border-border"><table className="w-full text-left text-xs"><thead className="bg-bg-elevated text-text-dim"><tr>{['Session', 'Provider', 'State', 'Control', 'Actions'].map(h => <th key={h} className="px-3 py-2 font-normal">{h}</th>)}</tr></thead><tbody>{sessions.map(s => <tr key={s.id} className="border-t border-border"><td className="max-w-48 truncate px-3 py-3 font-mono" title={s.id}>{s.id.slice(0, 12)}</td><td className="px-3 py-3">{s.provider}<span className="mt-1 block text-[10px] text-text-dim">{s.managed ? 'Managed provisioning' : 'Legacy · limited guarantees'}</span></td><td className="px-3 py-3" title={s.cleanupError}>{s.state.replaceAll('_', ' ')}</td><td className="px-3 py-3">{s.control.mode}</td><td className="px-3 py-3"><div className="flex flex-wrap gap-2">{s.state === 'ready' && <button disabled={busy} className={button} onClick={() => void act(`/sessions/${s.id}/control`, 'POST', { action: s.control.mode === 'agent' ? 'acquire' : s.control.mode === 'human' ? 'release' : 'resume' })}>{s.control.mode === 'agent' ? 'Take control' : s.control.mode === 'human' ? 'Release' : 'Resume agent'}</button>}{['stopped', 'failed'].includes(s.state) && s.managed && <button disabled={busy} className={button} onClick={() => void act(`/sessions/${s.id}/recover`, 'POST', { replace: true })}>Replace from profile</button>}{!['stopped', 'failed'].includes(s.state) && <><button disabled={busy} className={button} onClick={() => void act(`/sessions/${s.id}/stop`, 'POST', {})}>Stop</button><button disabled={busy} className={`${button} text-red`} onClick={() => void act(`/sessions/${s.id}/stop`, 'POST', { force: true })}>Force stop</button></>}</div></td></tr>)}</tbody></table>{!sessions.length && <p className="p-5 text-sm text-text-dim">No sessions match this view.</p>}</div>
      </section>
      {data.credentials && settings && <section className="grid gap-8 xl:grid-cols-2">
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); try { void act('/project', 'PATCH', { ...settings, rates: JSON.parse(rates), policy: JSON.parse(policy) }); } catch { setError('Rate cards and policy must be valid JSON'); } }}>
          <h3 className="text-sm font-medium">Limits and retention</h3>
          <div className="grid grid-cols-2 gap-3">{(['maxConcurrent', 'budgetUsd', 'recordingDays', 'auditDays'] as const).map(k => <label className="space-y-1 text-xs text-text-muted" key={k}><span>{({ maxConcurrent: 'Concurrent browsers', budgetUsd: 'Project budget · USD', recordingDays: 'Recording retention · days', auditDays: 'Audit retention · days' })[k]}</span><input className={field} type="number" min="0.01" step={k === 'budgetUsd' ? '0.01' : '1'} value={settings[k] ?? ''} placeholder="No project override" onChange={e => setSettings({ ...settings, [k]: e.target.value === '' ? null : Number(e.target.value) })}/></label>)}</div>
          <label className="block space-y-1 text-xs text-text-muted"><span>Rate cards · USD per browser hour</span><textarea className={`${field} h-24 font-mono`} value={rates} onChange={e => setRates(e.target.value)}/></label>
          <label className="block space-y-1 text-xs text-text-muted"><span>Managed policy · allowedHosts, humanHosts, region, redactRecording</span><textarea className={`${field} h-28 font-mono`} value={policy} onChange={e => setPolicy(e.target.value)}/></label>
          <p className="text-xs text-text-dim">Hard budgets require managed browsers and a configured rate. Costs are estimates; provider billing may lag.</p>
          <button disabled={busy} className={button}>Save settings</button>
        </form>
        <div className="space-y-4"><h3 className="text-sm font-medium">Service credentials</h3><button disabled={busy} className={button} onClick={() => void act('/members/invite', 'POST', { role })}>Create {role} invitation</button>{members.map(m => <div key={m.userId} className="flex justify-between text-xs"><span>{m.userId.slice(0, 12)} · {m.role}</span><button disabled={busy} className={button} onClick={() => void act(`/members/${m.userId}`, 'DELETE')}>Remove member</button></div>)}<form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); void act('/credentials', 'POST', { role, label }); }}><input aria-label="Credential label" className={`${field} flex-1`} value={label} onChange={e => setLabel(e.target.value)} placeholder="Credential label"/><select aria-label="Credential role" className={`${field} max-w-40`} value={role} onChange={e => setRole(e.target.value)}>{['viewer', 'operator', 'administrator'].map(r => <option key={r}>{r}</option>)}</select><button disabled={busy} className={button}>Create</button></form>{data.credentials.map(c => <div className="flex items-center justify-between border-b border-border py-2 text-xs" key={c.id}><span>{c.label} <span className="text-text-dim">· {c.role}</span></span>{c.revokedAt ? <span className="text-text-dim">Revoked</span> : <button disabled={busy} className={button} onClick={() => void act(`/credentials/${c.id}`, 'DELETE')}>Revoke</button>}</div>)}</div>
      </section>}
      {data.webhooks && <section className="space-y-3"><h3 className="text-sm font-medium">Event delivery</h3><form className="flex gap-2" onSubmit={e => { e.preventDefault(); void act('/webhooks', 'POST', { url }); }}><input aria-label="Webhook URL" type="url" required className={field} placeholder="https://your-service.example/events" value={url} onChange={e => setUrl(e.target.value)}/><button disabled={busy} className={`${button} shrink-0`}>Add webhook</button></form>{data.webhooks.map(h => <div key={h.id} className="flex justify-between gap-3 text-xs"><span className="truncate">{h.url}</span><button disabled={busy || !h.enabled} className={button} onClick={() => void act(`/webhooks/${h.id}`, 'DELETE')}>{h.enabled ? 'Disable' : 'Disabled'}</button></div>)}{data.deliveries?.filter(d => d.state !== 'delivered').slice(0, 20).map(d => <div key={d.id} className="flex justify-between text-xs"><span>{d.state} · {d.attempts} attempts</span><button disabled={busy} className={button} onClick={() => void act(`/deliveries/${encodeURIComponent(d.id)}/replay`, 'POST', {})}>Replay</button></div>)}</section>}
      <section><h3 className="mb-3 text-sm font-medium">Durable activity</h3><div className="divide-y divide-border border-y border-border">{data.events.slice(-30).reverse().map(e => <div key={e.id} className="flex justify-between gap-4 py-2 text-xs"><span>{e.type}<span className="ml-3 font-mono text-text-dim">{e.sessionId?.slice(0, 12)}</span></span><time className="shrink-0 text-text-dim">{new Date(e.at).toLocaleString()}</time></div>)}{!data.events.length && <p className="py-3 text-xs text-text-dim">No events yet.</p>}</div></section>
    </div>
  );
}
