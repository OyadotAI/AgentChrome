'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Folder, Import, Loader2, LogIn, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { apiUrl, authHeaders, listApiKeys, createApiKey, deleteApiKey, importApiKey } from '@/lib/api';
import { useToast } from './toast';

type OwnedProject = { key: string; label?: string };
type SharedProject = { id: string; name: string; role: string; owner?: boolean };
const PROJECT_ID = 'oya_project_id', PROJECT_CREDENTIAL = 'oya_project_credential';
const nameOf = (p: OwnedProject) => p.label || 'Untitled project';
const field = 'w-full h-9 rounded-md border border-border bg-transparent px-3 text-sm text-text placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-accent/50';

/**
 * One switcher for every project. Each API key you own is a project and is opened with that key; a project shared
 * with you is opened with a one-hour credential for your role there, renewed while the tab stays open.
 */
export default function ProjectSwitcher({ apiKey, setApiKey }: { apiKey: string; setApiKey: (key: string) => void }) {
  const { token } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [owned, setOwned] = useState<OwnedProject[]>([]);
  const [shared, setShared] = useState<SharedProject[]>([]);
  const [sharedId, setSharedId] = useState<string | null>(null);
  const [form, setForm] = useState<'new' | 'join' | 'import' | null>(null);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const selectKey = useCallback((key: string) => {
    sessionStorage.removeItem(PROJECT_CREDENTIAL);
    sessionStorage.removeItem(PROJECT_ID);
    localStorage.setItem('oya_api_key', key);
    setSharedId(null);
    setApiKey(key);
  }, [setApiKey]);

  const openShared = useCallback(async (id: string, quiet = false) => {
    if (!token) return;
    const res = await fetch(apiUrl(`/auth/projects/${encodeURIComponent(id)}/access`), { method: 'POST', headers: authHeaders(token), body: '{}' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not open that project');
    sessionStorage.setItem(PROJECT_CREDENTIAL, data.token);
    sessionStorage.setItem(PROJECT_ID, id);
    setSharedId(id);
    setApiKey(data.token);
    if (!quiet) toast('Project opened', 'info');
  }, [token, setApiKey, toast]);

  const load = useCallback(async () => {
    if (!token) return [] as OwnedProject[];
    const [keys, projects] = await Promise.all([
      listApiKeys(token).then(d => (Array.isArray(d) ? d : d?.keys ?? []) as OwnedProject[]).catch(() => [] as OwnedProject[]),
      fetch(apiUrl('/auth/projects'), { headers: authHeaders(token) }).then(r => (r.ok ? r.json() : [])).catch(() => []) as Promise<SharedProject[]>,
    ]);
    setOwned(keys);
    setShared(projects.filter(p => !p.owner));
    return keys;
  }, [token]);

  // Keep the current selection while it is still valid; otherwise open the first project you own.
  useEffect(() => {
    void load().then(keys => {
      const id = sessionStorage.getItem(PROJECT_ID), credential = sessionStorage.getItem(PROJECT_CREDENTIAL);
      if (id && credential) { setSharedId(id); setApiKey(credential); return; }
      const current = localStorage.getItem('oya_api_key');
      if (current && keys.some(k => k.key === current)) setApiKey(current);
      else if (keys[0]) selectKey(keys[0].key);
    });
  }, [load, setApiKey, selectKey]);

  useEffect(() => {
    if (!sharedId) return;
    const timer = setInterval(() => void openShared(sharedId, true).catch(() => {}), 45 * 60 * 1000);
    return () => clearInterval(timer);
  }, [sharedId, openShared]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  async function submit() {
    if (!token) return;
    setBusy(true);
    try {
      if (form === 'new') {
        const data = await createApiKey(token, name.trim() || undefined);
        await load();
        selectKey(data.key);
        navigator.clipboard.writeText(data.key).catch(() => {});
        toast('Project created; its API key is copied to your clipboard', 'success');
      } else if (form === 'import') {
        if (!secret.trim()) throw new Error('Paste the API key first');
        await importApiKey(token, secret.trim(), name.trim() || undefined);
        await load();
        selectKey(secret.trim());
        toast('Project added', 'success');
      } else if (form === 'join') {
        const res = await fetch(apiUrl('/auth/projects/join'), { method: 'POST', headers: authHeaders(token), body: JSON.stringify({ code: secret.trim() }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'That invitation could not be used');
        await load();
        await openShared(data.project);
      }
      setForm(null); setName(''); setSecret(''); setOpen(false);
    } catch (e) { toast(e instanceof Error ? e.message : 'Something went wrong', 'error'); }
    finally { setBusy(false); }
  }

  async function remove(key: string) {
    if (!token) return;
    try {
      await deleteApiKey(token, key);
      toast('API key deleted', 'success');
      if (apiKey === key) { setApiKey(''); localStorage.removeItem('oya_api_key'); }
      await load();
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not delete the key', 'error'); }
  }

  function copy(key: string) {
    navigator.clipboard.writeText(key).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  if (!token) return null;
  const selectedOwned = !sharedId && owned.find(k => k.key === apiKey);
  const label = sharedId ? shared.find(p => p.id === sharedId)?.name || 'Shared project' : selectedOwned ? nameOf(selectedOwned) : 'Select project';
  const row = (active: boolean) => `flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors ${active ? 'bg-text/10 text-text' : 'hover:bg-text/5'}`;

  return (
    <div className="relative" ref={ref}>
      <button aria-label="Switch project" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-text-muted transition-colors hover:bg-text/5 hover:text-text">
        <Folder className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden max-w-[160px] truncate text-xs sm:inline">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 text-text-dim" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-80 overflow-hidden rounded-lg border border-border bg-bg-card shadow-xl shadow-black/40">
          <div className="max-h-80 overflow-y-auto p-1">
            <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-text-dim">Your projects</p>
            {!owned.length && <p className="px-3 py-3 text-xs text-text-dim">No projects yet. Create one below.</p>}
            {owned.map(k => (
              <div key={k.key} className="group flex items-center gap-1">
                <button className={row(!sharedId && apiKey === k.key)} aria-current={!sharedId && apiKey === k.key} onClick={() => { selectKey(k.key); setOpen(false); }}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text">{nameOf(k)}</span>
                    <span className="block truncate font-mono text-xs text-text-dim">{k.key.slice(0, 12)}…</span>
                  </span>
                </button>
                <button aria-label={`Copy API key for ${nameOf(k)}`} title="Copy API key" onClick={() => copy(k.key)} className="rounded p-1 opacity-0 transition-colors hover:bg-text/5 focus:opacity-100 group-hover:opacity-100">
                  {copied === k.key ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5 text-text-dim" />}
                </button>
                <button aria-label={`Delete API key for ${nameOf(k)}`} title="Delete API key" onClick={() => void remove(k.key)} className="rounded p-1 opacity-0 transition-colors hover:bg-red-500/10 focus:opacity-100 group-hover:opacity-100">
                  <Trash2 className="h-3.5 w-3.5 text-red-400" />
                </button>
              </div>
            ))}
            {!!shared.length && <p className="px-3 pb-1 pt-3 text-xs font-medium uppercase tracking-wider text-text-dim">Shared with you</p>}
            {shared.map(p => (
              <button key={p.id} className={row(sharedId === p.id)} aria-current={sharedId === p.id}
                onClick={() => void openShared(p.id).then(() => setOpen(false)).catch(e => toast(e instanceof Error ? e.message : 'Could not open that project', 'error'))}>
                <span className="min-w-0 flex-1 truncate text-sm text-text">{p.name}</span>
                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-dim">{p.role}</span>
              </button>
            ))}
          </div>
          <div className="space-y-2 border-t border-border p-2">
            {form && (
              <form className="space-y-2" onSubmit={e => { e.preventDefault(); void submit(); }}>
                {form !== 'join' && <input autoFocus={form === 'new'} className={field} aria-label="Project name" placeholder="Project name (e.g. checkout agents)" value={name} onChange={e => setName(e.target.value)} />}
                {form !== 'new' && <input autoFocus className={`${field} font-mono`} aria-label={form === 'join' ? 'Invitation code' : 'API key'} placeholder={form === 'join' ? 'Invitation code' : 'Paste an existing API key'} value={secret} onChange={e => setSecret(e.target.value)} />}
                <div className="flex gap-2">
                  <button disabled={busy} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-50">
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}{form === 'new' ? 'Create project' : form === 'join' ? 'Join project' : 'Add project'}
                  </button>
                  <button type="button" onClick={() => { setForm(null); setName(''); setSecret(''); }} className="h-9 rounded-md border border-border px-3 text-sm text-text-muted hover:bg-text/5">Cancel</button>
                </div>
              </form>
            )}
            {!form && (
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => setForm('new')} className="flex h-9 items-center justify-center gap-1 rounded-md bg-accent text-xs font-medium text-accent-foreground hover:bg-accent-hover"><Plus className="h-3.5 w-3.5" />New</button>
                <button onClick={() => setForm('join')} className="flex h-9 items-center justify-center gap-1 rounded-md border border-border text-xs text-text-muted hover:bg-text/5 hover:text-text"><LogIn className="h-3.5 w-3.5" />Join</button>
                <button onClick={() => setForm('import')} className="flex h-9 items-center justify-center gap-1 rounded-md border border-border text-xs text-text-muted hover:bg-text/5 hover:text-text"><Import className="h-3.5 w-3.5" />Add key</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
