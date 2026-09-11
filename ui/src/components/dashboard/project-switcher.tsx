'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { apiUrl, authHeaders } from '@/lib/api';
import { useToast } from './toast';
export default function ProjectSwitcher({ onSelect }: { onSelect: (key: string) => void }) {
  const { token } = useAuth();
  const toast = useToast();
  const [projects, setProjects] = useState<{ id: string; name: string; role: string }[]>([]);
  const [selected, setSelected] = useState('');
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(apiUrl('/auth/projects'), { headers: authHeaders(token) }).then(r => r.ok ? r.json() : []).then(p => { if (!cancelled) setProjects(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [token, joining]);
  const select = useCallback(async (id: string, quiet = false) => {
    if (!token || !id) return;
    try {
      const res = await fetch(apiUrl(`/auth/projects/${id}/access`), { method: 'POST', headers: authHeaders(token), body: '{}' });
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      setSelected(id); onSelect(data.token); sessionStorage.setItem('oya_project_credential', data.token); sessionStorage.setItem('oya_project_id', id);
      if (!quiet) toast('Project selected', 'info');
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not switch project', 'error'); }
  }, [token, onSelect, toast]);
  useEffect(() => {
    const renew = () => { const id = sessionStorage.getItem('oya_project_id'); if (id && sessionStorage.getItem('oya_project_credential')) void select(id, true); };
    const timer = setInterval(renew, 45 * 60 * 1000);
    return () => clearInterval(timer);
  }, [select]);
  if (!token) return null;
  return <div className="relative flex items-center gap-2"><select aria-label="Switch project" className="max-w-44 rounded border border-border bg-bg px-2 py-1.5 text-xs" value={selected} onChange={e => void select(e.target.value)}><option value="">Select project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name} · {p.role}</option>)}</select><button className="text-xs text-text-muted" onClick={() => setJoining(!joining)}>Join</button>{joining && <form className="absolute left-0 top-full z-50 mt-2 flex w-80 gap-2 rounded border border-border bg-bg-card p-3 shadow-lg" onSubmit={async e => { e.preventDefault(); if (!token) return; try { const res = await fetch(apiUrl('/auth/projects/join'), { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ code }) }); const data = await res.json(); if (!res.ok) throw new Error(data.error); setJoining(false); setCode(''); await select(data.project); } catch (e) { toast(e instanceof Error ? e.message : 'Invitation failed', 'error'); } }}><input className="min-w-0 flex-1 rounded border border-border bg-bg p-2 text-xs" aria-label="Project invitation code" placeholder="Invitation code" value={code} onChange={e => setCode(e.target.value)}/><button className="text-xs">Join</button></form>}</div>;
}
