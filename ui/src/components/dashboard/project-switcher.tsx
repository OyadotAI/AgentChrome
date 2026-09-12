'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Copy, Pencil, Folder, Import, KeyRound, Loader2, LogIn, MoreHorizontal, Plus, Search, Trash2, X } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { apiUrl, authHeaders, listApiKeys, createApiKey, importApiKey } from '@/lib/api';
import { useToast } from './toast';

type Project = { id: string; name: string; role: string; owner?: boolean };
/** Key metadata; plaintext is fetched separately by an owner action. */
type OwnedKey = { id: string; prefix?: string; project?: string; label?: string };
type Failure = Error & { status?: number; code?: string };
const PROJECT_ID = 'oya_project_id', PROJECT_CREDENTIAL = 'oya_project_credential';
/** Answers that mean this account can no longer open the project, as opposed to a passing outage. */
const GONE = [401, 403, 404, 410];
const field = 'w-full h-9 rounded-md border border-border bg-transparent px-3 text-sm text-text placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-accent/50';

const message = (e: unknown, fallback = 'Something went wrong') => e instanceof Error ? e.message : fallback;

async function call<T>(token: string, path: string, init: RequestInit = {}, fallback = 'Project action failed'): Promise<T> {
  const res = await fetch(apiUrl(path), { ...init, headers: authHeaders(token) });
  // A proxy error page is not JSON; its status still says what happened.
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || fallback), { status: res.status, code: data.code });
  return data;
}

/** The project an API key opens: the server derives it the same way (service.js projectId). */
async function projectIdFor(key: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  return `prj_${Array.from(digest, b => b.toString(16).padStart(2, '0')).join('').slice(0, 24)}`;
}

/**
 * One switcher for every project, opened the same way whether you own it or it
 * was shared with you: a one-hour credential for your role there, renewed while
 * the tab stays open, held in sessionStorage.
 *
 * API key listings contain only digests and prefixes. The owner's explicit
 * copy action retrieves the encrypted project key; it stays in component
 * memory instead of being persisted as the console's credential.
 */
export default function ProjectSwitcher({ apiKey, setApiKey }: { apiKey: string; setApiKey: (credential: string, project: string | null) => void }) {
  const { token } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [keys, setKeys] = useState<OwnedKey[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [form, setForm] = useState<'new' | 'join' | 'import' | 'rename' | 'delete' | 'manage' | 'key' | null>(null);
  const [target, setTarget] = useState<Project | null>(null);
  const [revealedKey, setRevealedKey] = useState('');
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  // An owned project whose sealed key this server cannot open; its original API key repairs it.
  const [restore, setRestore] = useState<Project | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Every switch takes a number; a slower, older request (startup, renewal, a previous click) never overrides a newer one.
  const opening = useRef(0);

  /** Resolves false when a newer switch superseded this one. A renewal never supersedes a switch. */
  const openProject = useCallback(async (id: string, renew = false) => {
    if (!token) return false;
    const seq = renew ? opening.current : ++opening.current;
    const data = await call<{ token: string }>(token, `/auth/projects/${encodeURIComponent(id)}/access`, { method: 'POST', body: '{}' }, 'Could not open that project');
    if (seq !== opening.current) return false;
    sessionStorage.setItem(PROJECT_CREDENTIAL, data.token);
    sessionStorage.setItem(PROJECT_ID, id);
    setCurrentId(id);
    setApiKey(data.token, id);
    return true;
  }, [token, setApiKey]);

  const load = useCallback(async () => {
    if (!token) return [] as Project[];
    const [list, owned] = await Promise.all([
      call<Project[]>(token, '/auth/projects', {}, 'Could not load projects'),
      listApiKeys(token).then(d => (Array.isArray(d) ? d : d?.keys ?? []) as OwnedKey[]).catch(() => [] as OwnedKey[]),
    ]);
    setProjects(list);
    setKeys(owned);
    return list;
  }, [token]);

  const forget = useCallback(() => {
    ++opening.current;
    sessionStorage.removeItem(PROJECT_CREDENTIAL);
    sessionStorage.removeItem(PROJECT_ID);
    setCurrentId(null);
    setApiKey('', null);
  }, [setApiKey]);

  /** Open the first project that opens — yours before shared ones — so one unreadable project never leaves the console empty. */
  const openAny = useCallback(async (list: Project[]) => {
    let failure: unknown = null;
    for (const p of [...list.filter(p => p.owner), ...list.filter(p => !p.owner)]) {
      try { await openProject(p.id); return; } catch (e) { failure = e; }
    }
    if (!failure) return;
    forget();
    toast(`No project could be opened: ${message(failure)}`, 'error');
  }, [openProject, forget, toast]);

  const renew = useCallback(async (id: string) => {
    try { await openProject(id, true); }
    catch (e) {
      if (!GONE.includes((e as Failure).status ?? 0) || sessionStorage.getItem(PROJECT_ID) !== id) return;
      toast('You no longer have access to that project', 'info');
      forget();
      await openAny((await load()).filter(p => p.id !== id));
    }
  }, [openProject, forget, openAny, load, toast]);

  // Keep the open project across a reload, with a fresh credential (the stored one may have expired while the tab slept); otherwise open the first one that opens.
  useEffect(() => {
    // Key-only sign-in has no account and no projects; its console credential is not ours to replace.
    if (!token) return;
    void load().then(list => {
      const id = sessionStorage.getItem(PROJECT_ID), credential = sessionStorage.getItem(PROJECT_CREDENTIAL);
      if (id && credential && list.some(p => p.id === id)) { setCurrentId(id); setApiKey(credential, id); return renew(id); }
      return openAny(list);
    }).catch(e => toast(message(e, 'Could not load projects'), 'error'));
  }, [token, load, setApiKey, renew, openAny, toast]);

  // The credential expires in an hour; renew it well before that.
  useEffect(() => {
    if (!currentId) return;
    const timer = setInterval(() => void renew(currentId), 45 * 60 * 1000);
    return () => clearInterval(timer);
  }, [currentId, renew]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setRevealedKey(''); setSecret(''); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    if (open && form === 'manage') ref.current?.querySelector<HTMLButtonElement>('[data-management-action]')?.focus();
  }, [open, form]);

  /** Show a failure; an unreadable key on a project you own comes with the way to repair it. */
  function fail(e: unknown, project: Project | null = null) {
    if ((e as Failure).code !== 'project_key_unavailable') { setError(message(e)); setRestore(null); return; }
    setRestore(project?.owner ? project : null);
    setError(project?.owner
      ? `${project.name} was saved with a different server secret, so its key can’t be read here. Paste its original API key to restore access.`
      : 'This project’s key can’t be read on this server. Ask the project owner to restore access.');
  }

  async function submit() {
    if (!token) return;
    setBusy(true);
    setError(''); setRestore(null);
    try {
      if (form === 'rename' && target) {
        await projectRequest(target.id, 'PATCH', { name: name.trim() });
        await load();
        setTarget({ ...target, name: name.trim() });
        toast('Project renamed', 'success');
        show('manage', { ...target, name: name.trim() });
      } else if (form === 'delete' && target) {
        await remove(target);
        show(null);
      } else if (form === 'new') {
        const data = await createApiKey(token, name.trim() || undefined);
        // Show the key before anything else can fail, so it is never lost behind an error.
        setName(''); setCopied(false); setRevealedKey(data.key); setForm('key');
        await load();
        if (data.project) await openProject(data.project).catch(e => toast(message(e), 'error'));
        toast('Project created. Copy your API key below.', 'success');
      } else if (form === 'import') {
        const key = secret.trim();
        if (!key) throw new Error('Paste the API key first');
        // Restoring: a different key would silently add a second project instead of repairing this one.
        if (target && await projectIdFor(key) !== target.id) throw new Error(`That key doesn’t belong to ${target.name}. Paste the key it was created with.`);
        const data = await importApiKey(token, key, name.trim() || undefined);
        await load();
        if (data.project) await openProject(data.project);
        toast(target ? `Access to ${target.name} restored` : 'Project added', 'success');
        close();
      } else if (form === 'join') {
        const data = await call<{ project: string }>(token, '/auth/projects/join', { method: 'POST', body: JSON.stringify({ code: secret.trim() }) }, 'That invitation could not be used');
        const list = await load();
        await openProject(data.project);
        toast(`Joined ${list.find(p => p.id === data.project)?.name || 'project'}`, 'success');
        close();
      }
    } catch (e) { fail(e, target); }
    finally { setBusy(false); }
  }

  function projectRequest<T>(id: string, method: string, body?: object, suffix = '') {
    return call<T>(token!, `/auth/projects/${encodeURIComponent(id)}${suffix}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  }

  async function copyKey(project: Project) {
    setBusy(true);
    setError(''); setRestore(null);
    try {
      const data = await projectRequest<{ key: string }>(project.id, 'POST', {}, '/key');
      setRevealedKey(data.key);
      setForm('key');
      try { await navigator.clipboard.writeText(data.key); setCopied(true); }
      catch { toast('Select and copy the API key below.', 'info'); }
    } catch (e) { fail(e, project); }
    finally { setBusy(false); }
  }

  async function remove(project: Project) {
    // The confirmation already says running browsers stop with the project.
    await projectRequest(project.id, 'DELETE', { stopBrowsers: true });
    setRevealedKey('');
    const wasOpen = currentId === project.id;
    if (wasOpen) forget();
    const list = await load();
    toast(`${project.name} deleted`, 'success');
    if (wasOpen) await openAny(list);
  }

  function close() {
    setOpen(false); setForm(null); setTarget(null); setRevealedKey(''); setSecret(''); setError(''); setRestore(null); setQuery('');
    trigger.current?.focus();
  }

  function show(next: typeof form, project: Project | null = null) {
    setForm(next); setTarget(project); setName(next === 'rename' ? project?.name || '' : '');
    setSecret(''); setRevealedKey(''); setError(''); setRestore(null); setCopied(false);
  }

  async function select(project: Project) {
    if (project.id === currentId) return close();
    setBusy(true); setPending(project.id); setError(''); setRestore(null);
    try {
      if (await openProject(project.id)) toast(`Switched to ${project.name}`, 'info');
      close();
    } catch (e) { fail(e, project); }
    finally { setBusy(false); setPending(null); }
  }

  if (!token) return null;
  const matches = projects.filter(p => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  const owned = matches.filter(p => p.owner), shared = matches.filter(p => !p.owner);
  const label = projects.find(p => p.id === currentId)?.name || (apiKey ? 'Project' : 'Select project');
  const restoring = form === 'import' && !!target;
  const titles = { new: 'Create a project', join: 'Join a project', import: restoring ? 'Restore access' : 'Add an API key', rename: 'Rename project', delete: 'Delete project', manage: target?.name || 'Project options', key: 'Your API key' };
  const action = 'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors hover:bg-text/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50';
  const projectRow = (project: Project) => (
    <div key={project.id} className={`flex items-center rounded-lg transition-colors ${currentId === project.id ? 'bg-accent/8' : 'hover:bg-text/4'}`}>
      <button data-project-option disabled={busy} onClick={() => void select(project)} aria-current={currentId === project.id}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-3 pl-3 pr-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-wait">
        <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold ${currentId === project.id ? 'border-accent/20 bg-accent/10 text-accent' : 'border-border bg-text/3 text-text-muted'}`}>{project.name.slice(0, 2).toUpperCase()}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{project.name}</span>
        {pending === project.id ? <Loader2 aria-label="Opening" className="h-4 w-4 shrink-0 animate-spin text-text-dim" />
          : currentId === project.id && <Check aria-label="Selected" className="h-4 w-4 shrink-0 text-accent" />}
        {!project.owner && <span className="text-[11px] text-text-dim">{project.role}</span>}
      </button>
      {project.owner && <button disabled={busy} aria-label={`Options for ${project.name}`} title="Project options" onClick={() => show('manage', project)} className="mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-dim hover:bg-text/8 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"><MoreHorizontal className="h-4 w-4" /></button>}
    </div>
  );

  return (
    <div className="relative" ref={ref}>
      <button ref={trigger} aria-label="Switch project" aria-haspopup="dialog" aria-expanded={open} aria-controls="project-picker" onClick={() => { if (open) close(); else { show(null); setQuery(''); setOpen(true); } }}
        className={`flex h-8 items-center gap-2 rounded-lg border px-2.5 text-sm transition-colors ${open ? 'border-accent/30 bg-text/5 text-text' : 'border-border text-text-muted hover:bg-text/5 hover:text-text'}`}>
        <Folder className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden max-w-[160px] truncate text-xs sm:inline">{label}</span>
        <ChevronDown className={`h-3 w-3 text-text-dim transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div id="project-picker" role="dialog" aria-label={form ? titles[form] : 'Projects'} aria-busy={busy}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
            if (!form && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              const options = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-project-option]'));
              if (!options.length) return;
              e.preventDefault();
              const index = options.indexOf(document.activeElement as HTMLButtonElement);
              options[(index + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
            }
          }}
          className="fixed left-3 right-3 top-[58px] z-50 max-h-[calc(100dvh-76px)] overflow-y-auto rounded-xl border border-border bg-bg-card shadow-[0_16px_48px_-12px_rgba(0,0,0,0.45)] sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[360px]">
          <div className="flex min-h-14 items-center gap-2 border-b border-border px-4">
            {form && <button disabled={busy} aria-label="Back to projects" onClick={() => show(null)} className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-text/5"><ArrowLeft className="h-4 w-4" /></button>}
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-text">{form ? titles[form] : 'Projects'}</h2>
            {!form && <span className="font-mono text-xs text-text-dim">{projects.length}</span>}
            <button aria-label="Close projects" onClick={close} className="-mr-1 flex h-8 w-8 items-center justify-center rounded-md text-text-dim hover:bg-text/5 hover:text-text"><X className="h-4 w-4" /></button>
          </div>
          {error && <div role="alert" className="mx-4 mt-3 rounded-lg bg-red-500/8 px-3 py-2.5 text-xs leading-relaxed text-red-400">
            {error}
            {restore && <button onClick={() => show('import', restore)} className="mt-2 flex items-center gap-1.5 font-medium text-red-300 underline-offset-2 hover:underline"><KeyRound className="h-3.5 w-3.5" />Restore with API key</button>}
          </div>}
          {!form && <>
            <div className="relative mx-3 mb-1 mt-3">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-text-dim" />
              <input autoFocus aria-label="Search projects" placeholder="Find a project…" value={query} onChange={e => setQuery(e.target.value)} className={`${field} border-transparent bg-text/4 pl-9`} />
            </div>
            <div className="max-h-[min(340px,45dvh)] overflow-y-auto px-2 pb-2">
              {!!owned.length && <><p className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.12em] text-text-dim">Your projects</p>{owned.map(projectRow)}</>}
              {!!shared.length && <><p className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.12em] text-text-dim">Shared with you</p>{shared.map(projectRow)}</>}
              {!matches.length && <div className="px-4 py-8 text-center"><Folder className="mx-auto mb-3 h-6 w-6 text-text-dim" /><p className="text-sm text-text-muted">{query ? 'No matching projects' : 'Your first project starts here'}</p><p className="mt-1 text-xs text-text-dim">{query ? 'Try another name.' : 'Create a project to connect your browsers.'}</p></div>}
            </div>
            <div className="border-t border-border p-2">
              <button disabled={busy} onClick={() => show('new')} className={`${action} font-medium text-accent`}><Plus className="h-4 w-4" />Create project<ChevronRight className="ml-auto h-3.5 w-3.5 opacity-50" /></button>
              <div className="flex gap-1 px-1 pb-1">
                <button disabled={busy} onClick={() => show('join')} className="flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-xs text-text-muted hover:bg-text/5"><LogIn className="h-3.5 w-3.5" />Join with invite</button>
                <span className="my-2 w-px bg-border" />
                <button disabled={busy} onClick={() => show('import')} className="flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-xs text-text-muted hover:bg-text/5"><Import className="h-3.5 w-3.5" />Add API key</button>
              </div>
            </div>
          </>}
          {form === 'manage' && target && <div className="p-2">
            <p className="px-3 pb-3 pt-2 font-mono text-[11px] text-text-dim">{keys.find(k => k.project === target.id)?.prefix || target.id}{keys.some(k => k.project === target.id && k.prefix) && '…'}</p>
            <button data-management-action disabled={busy} aria-label={`Copy API key for ${target.name}`} onClick={() => void copyKey(target)} className={`${action} text-text-muted hover:text-text`}><KeyRound className="h-4 w-4" /><span className="flex-1">Copy API key</span>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-3.5 w-3.5 text-text-dim" />}</button>
            <button disabled={busy} aria-label={`Rename ${target.name}`} onClick={() => show('rename', target)} className={`${action} text-text-muted hover:text-text`}><Pencil className="h-4 w-4" />Rename project</button>
            <div className="mx-3 my-2 border-t border-border" />
            <button disabled={busy} aria-label={`Delete ${target.name}`} onClick={() => show('delete', target)} className={`${action} text-red-400 hover:bg-red-500/8 hover:text-red-400`}><Trash2 className="h-4 w-4" />Delete project</button>
          </div>}
          {form === 'key' && revealedKey && <div className="space-y-4 p-5">
            <p className="text-xs leading-relaxed text-text-muted">Use this key to connect your tools and browsers. Keep it private.</p>
            <label className="block space-y-2"><span className="text-xs font-medium text-text">API key</span><input autoFocus readOnly value={revealedKey} onFocus={e => e.target.select()} className={`${field} font-mono`} /></label>
            <button className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-accent-foreground hover:bg-accent-hover" onClick={async () => { try { await navigator.clipboard.writeText(revealedKey); setCopied(true); } catch { setError('Select the key above and copy it manually.'); } }}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? 'Copied to clipboard' : 'Copy API key'}</button>
          </div>}
          {form && form !== 'manage' && form !== 'key' && <form className="space-y-4 p-5" onSubmit={e => { e.preventDefault(); void submit(); }}>
            <p className="text-xs leading-relaxed text-text-muted">{form === 'new' ? 'A home for your browsers, API key, and team.' : form === 'rename' ? 'Choose a name that’s easy to find.' : form === 'join' ? 'Paste the invitation code shared by your team.' : restoring ? <>Paste the API key <strong className="font-medium text-text">{target?.name}</strong> was created with. Its browsers, profiles and settings are kept.</> : form === 'import' ? 'Connect an existing project or restore access with its original API key.' : <>Delete <strong className="font-medium text-text">{target?.name}</strong>? Its running browsers are stopped, and every API key, invite and member loses access. This can’t be undone.</>}</p>
            {(form === 'new' || (form === 'import' && !restoring) || form === 'rename') && <label className="block space-y-2"><span className="text-xs font-medium text-text">Project name {form === 'import' && <span className="font-normal text-text-dim">(optional)</span>}</span><input autoFocus maxLength={100} required={form === 'rename'} className={field} placeholder="e.g. Checkout agents" value={name} onChange={e => setName(e.target.value)} /></label>}
            {(form === 'join' || form === 'import') && <label className="block space-y-2"><span className="text-xs font-medium text-text">{form === 'join' ? 'Invitation code' : 'API key'}</span><input autoFocus={form === 'join' || restoring} required type={form === 'import' ? 'password' : 'text'} className={`${field} font-mono`} placeholder={form === 'join' ? 'Paste invitation code' : 'Paste your API key'} value={secret} onChange={e => setSecret(e.target.value)} /></label>}
            <div className="flex gap-2 pt-1">
              <button type="button" disabled={busy} onClick={() => show(target && !restoring ? 'manage' : null, target && !restoring ? target : null)} className="h-10 rounded-lg border border-border px-4 text-sm text-text-muted hover:bg-text/5">Cancel</button>
              <button disabled={busy} className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium disabled:opacity-50 ${form === 'delete' ? 'bg-red-500/12 text-red-400 hover:bg-red-500/20' : 'bg-accent text-accent-foreground hover:bg-accent-hover'}`}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}{form === 'rename' ? 'Save name' : form === 'delete' ? 'Delete project' : form === 'new' ? 'Create project' : form === 'join' ? 'Join project' : restoring ? 'Restore access' : 'Add project'}
              </button>
            </div>
          </form>}
        </div>
      )}
    </div>
  );
}
