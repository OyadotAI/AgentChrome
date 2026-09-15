'use client';

import { useCallback, useEffect, useState } from 'react';
import { Code, ExternalLink, Play, Trash2, Workflow } from 'lucide-react';
import { ago, api, errorMessage } from '@/lib/api-client';
import Dialog, { Confirm } from '@/components/ui/dialog';
import SyntaxCode from '@/components/ui/syntax-code';
import { useToast } from './toast';
import type { BrowserRow } from './types';

interface PlaybookBody { name: string; variables: string[]; steps: number; code: string }
interface PlaybookInfo extends PlaybookBody {
  createdAt: string | null;
  promotedAt: string | null;
  draft: (PlaybookBody & { healedAt: string; healedFrom: number }) | null;
}
interface RunInfo {
  id: string;
  status: 'running' | 'needs_attention' | 'succeeded' | 'failed';
  attention: { id: string; reason: 'captcha' | 'mfa' | 'agent' | 'heal_failed'; message: string; liveViewUrl?: string } | null;
  result?: { steps?: number; total?: number; fellBack?: boolean; healed?: boolean; draft?: string; text?: string };
  error?: string;
}

const RECORD_SNIPPET = `await browser.ask('Fill the order for {{name}}', { data: { name: 'Ada' } });
await browser.toPlaybook('order');           // saved here
await browser.play('order', { name: 'Alan' }); // replayed without the LLM`;

/**
 * Flows recorded from ask() runs. Each replays without the LLM; a replay that
 * breaks can heal itself into a draft, which waits here for review.
 */
export default function PlaybooksTab({ apiKey, browsers, now }: { apiKey: string; browsers: BrowserRow[]; now: number }) {
  const toast = useToast();
  const [playbooks, setPlaybooks] = useState<PlaybookInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState<PlaybookBody | null>(null);
  const [running, setRunning] = useState<PlaybookInfo | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!apiKey) return;
    try {
      setPlaybooks((await api<{ playbooks: PlaybookInfo[] }>('/playbooks', { key: apiKey })).playbooks);
      setLoadError(null);
    } catch (err) { setLoadError(errorMessage(err)); }
  }, [apiKey]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  const promote = async (name: string) => {
    try {
      await api(`/playbooks/${encodeURIComponent(name)}/promote`, { key: apiKey, method: 'POST', body: {} });
      toast(`${name} now uses the healed steps`, 'success');
      refresh();
    } catch (err) { toast(errorMessage(err), 'error'); }
  };

  const doRemove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api(`/playbooks/${encodeURIComponent(removing)}`, { key: apiKey, method: 'DELETE' });
      toast(removing.endsWith(':draft') ? 'Draft discarded' : `Deleted ${removing}`, 'success');
      refresh();
    } catch (err) { toast(errorMessage(err), 'error'); }
    finally { setBusy(false); setRemoving(null); }
  };

  const list = playbooks || [];

  return (
    <div className="workspace-list flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-4 py-5 lg:px-6">
        <div className="mr-auto">
          <h2 className="text-[22px] font-medium tracking-tight text-text">Playbooks <span className="ml-2 text-[14px] text-text-dim">{list.length}</span></h2>
          <p className="text-[12px] text-text-muted">Flows recorded from an ask() run, replayed without the LLM. Values stay out of them as variables.</p>
        </div>
      </div>

      {loadError && <div role="alert" className="mx-4 mb-3 rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-sm text-red lg:mx-6">Could not load playbooks: {loadError}</div>}

      <div className="data-scroll mx-4 mb-4 min-h-0 flex-initial overflow-auto rounded-xl border border-border bg-bg-card/25 lg:mx-6 lg:mb-6">
        <table className="data-table w-full table-fixed border-collapse text-[13px]" aria-label="Playbooks">
          <thead className="sticky top-0 z-10 bg-bg-elevated">
            <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-[0.1em] text-text-muted">
              <th className="w-[22%] px-4 py-3">Playbook</th>
              <th className="px-3 py-3">Variables</th>
              <th className="w-[70px] px-2 py-3 text-right">Steps</th>
              <th className="w-[28%] px-3 py-3">Healed draft</th>
              <th className="w-[90px] px-2 py-3 text-right">Created</th>
              <th className="w-[120px] px-2 py-3" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.name} className="border-b border-border/60 hover:bg-text/[0.035]">
                <td className="px-2 py-3 pl-4">
                  <div className="truncate font-medium text-text" title={p.name}>{p.name}</div>
                  {p.promotedAt && <div className="mt-1 text-[11px] text-text-dim">healed {ago(p.promotedAt, now)} ago</div>}
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-1">
                    {p.variables.length
                      ? p.variables.map((v) => <span key={v} className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-text-secondary">{v}</span>)
                      : <span className="text-text-dim">none</span>}
                  </div>
                </td>
                <td className="px-2 py-3 text-right num text-text-secondary">{p.steps}</td>
                <td className="px-3 py-3">
                  {p.draft ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] text-yellow" title={`The replay broke at step ${p.draft.healedFrom + 1}; the agent finished it.`}>
                        {p.draft.steps} steps · {ago(p.draft.healedAt, now)}
                      </span>
                      <button className="btn-ghost h-7 px-2 text-[12px]" onClick={() => setCode(p.draft)}>Review</button>
                      <button className="btn-primary h-7 px-2 text-[12px]" onClick={() => promote(p.name)}>Promote</button>
                      <button className="btn-ghost h-7 px-2 text-[12px]" onClick={() => setRemoving(`${p.name}:draft`)}>Discard</button>
                    </div>
                  ) : <span className="text-text-dim">—</span>}
                </td>
                <td className="px-2 py-3 text-right num text-text-muted">{ago(p.createdAt, now)}</td>
                <td className="px-2 py-3">
                  <div className="flex justify-end gap-1">
                    <button className="btn-icon" title="Playwright code" aria-label={`Playwright code for ${p.name}`} onClick={() => setCode(p)}><Code className="h-4 w-4" /></button>
                    <button className="btn-icon" title="Run" aria-label={`Run ${p.name}`} onClick={() => setRunning(p)}><Play className="h-4 w-4" /></button>
                    <button className="btn-icon" title="Delete" aria-label={`Delete ${p.name}`} onClick={() => setRemoving(p.name)}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {playbooks && list.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-bg-card"><Workflow className="h-5 w-5 text-text-muted" /></div>
            <p className="text-[15px] font-medium text-text">No playbooks yet</p>
            <p className="max-w-md text-[13px] text-text-muted">Run a task with ask(), then save it from code:</p>
            <pre className="max-w-full overflow-x-auto rounded-lg border border-border bg-bg-card px-4 py-3 text-left text-[12px]"><SyntaxCode code={RECORD_SNIPPET} language="typescript" /></pre>
          </div>
        )}
      </div>

      <Dialog open={!!code} onClose={() => setCode(null)} size="lg" title={code?.name} description="The same flow as a Playwright module. Pass the variables as vars.">
        {code && <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-bg-card px-4 py-3 text-[12px]"><SyntaxCode code={code.code} language="typescript" /></pre>}
      </Dialog>

      {running && <RunDialog apiKey={apiKey} playbook={running} browsers={browsers} onClose={() => setRunning(null)} onFinished={refresh} />}

      <Confirm open={!!removing} onClose={() => setRemoving(null)} onConfirm={doRemove} danger busy={busy}
        title={removing?.endsWith(':draft') ? 'Discard the healed draft?' : `Delete ${removing}?`}
        confirmLabel={removing?.endsWith(':draft') ? 'Discard' : 'Delete'}
        body={removing?.endsWith(':draft')
          ? 'The playbook keeps its current steps. The next replay that breaks will heal again.'
          : 'The playbook and any healed draft are gone. Code calling play() with this name will fail.'} />
    </div>
  );
}

const ATTENTION: Record<NonNullable<RunInfo['attention']>['reason'], string> = {
  captcha: 'CAPTCHA',
  mfa: 'MFA',
  agent: 'Agent question',
  heal_failed: 'Could not heal',
};

/** Run a playbook on a live browser and follow it, answering it if it stops for a person. */
function RunDialog({ apiKey, playbook, browsers, onClose, onFinished }: {
  apiKey: string; playbook: PlaybookInfo; browsers: BrowserRow[]; onClose: () => void; onFinished: () => void;
}) {
  const toast = useToast();
  const [browserId, setBrowserId] = useState(browsers[0]?.id || '');
  const [values, setValues] = useState<Record<string, string>>({});
  const [autoHeal, setAutoHeal] = useState(true);
  const [run, setRun] = useState<RunInfo | null>(null);
  const [reply, setReply] = useState('');
  const [starting, setStarting] = useState(false);

  const runId = run?.id;
  const ended = run?.status === 'succeeded' || run?.status === 'failed';
  useEffect(() => {
    if (!runId || ended) return;
    const timer = setInterval(async () => {
      try {
        const next = await api<RunInfo>(`/runs/${encodeURIComponent(runId)}`, { key: apiKey });
        setRun(next);
        if (next.status === 'succeeded' || next.status === 'failed') onFinished();
      } catch { /* keep following */ }
    }, 2000);
    return () => clearInterval(timer);
  }, [runId, ended, apiKey, onFinished]);

  const start = async () => {
    setStarting(true);
    try {
      setRun(await api<RunInfo>(`/browsers/${encodeURIComponent(browserId)}/runs`, {
        key: apiKey, method: 'POST', body: { playbook: playbook.name, data: values, autoHeal },
      }));
    } catch (err) { toast(errorMessage(err), 'error'); }
    finally { setStarting(false); }
  };

  const respond = async () => {
    if (!run) return;
    try {
      await api(`/runs/${encodeURIComponent(run.id)}/respond`, { key: apiKey, method: 'POST', body: { response: reply.trim() || 'done' } });
      setReply('');
      setRun({ ...run, status: 'running', attention: null });
    } catch (err) { toast(errorMessage(err), 'error'); }
  };

  const result = run?.result;

  return (
    <Dialog open onClose={onClose} title={`Run ${playbook.name}`} description="Replays on a running browser without the LLM."
      footer={run
        ? <button className="btn-ghost" onClick={onClose}>Close</button>
        : <>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={start} disabled={!browserId || starting}>{starting ? 'Starting…' : 'Run'}</button>
          </>}>
      {!run ? (
        <div className="flex flex-col gap-4">
          <div>
            <label className="label" htmlFor="pb-browser">Browser</label>
            {browsers.length
              ? <select id="pb-browser" className="field" value={browserId} onChange={(e) => setBrowserId(e.target.value)}>
                  {browsers.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.id}</option>)}
                </select>
              : <p className="text-sm text-text-muted">No browser is running. Start one from the Browsers tab.</p>}
          </div>
          {playbook.variables.map((v) => (
            <div key={v}>
              <label className="label" htmlFor={`pb-var-${v}`}>{v}</label>
              <input id={`pb-var-${v}`} className="field font-mono" value={values[v] || ''} autoComplete="off"
                onChange={(e) => setValues((cur) => ({ ...cur, [v]: e.target.value }))} />
            </div>
          ))}
          <label className="flex items-start gap-2 text-sm text-text-secondary">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={autoHeal} onChange={(e) => setAutoHeal(e.target.checked)} />
            <span>Auto-heal: if the page changed, the agent finishes the run and saves its fix as a draft to review.</span>
          </label>
        </div>
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <p>
            Status:{' '}
            <span className={run.status === 'failed' ? 'text-red' : run.status === 'needs_attention' ? 'text-yellow' : 'text-accent'}>
              {run.status === 'needs_attention' ? 'needs a person' : run.status}
            </span>
          </p>

          {run.attention && (
            <div className="flex flex-col gap-3 rounded-lg border border-yellow/40 bg-yellow/10 p-3">
              <div className="flex items-center gap-2">
                <span className="rounded border border-yellow/40 px-1.5 text-[11px] uppercase tracking-wider text-yellow">{ATTENTION[run.attention.reason]}</span>
                {run.attention.liveViewUrl && (
                  <a className="ml-auto inline-flex items-center gap-1 text-[12px] text-accent hover:underline" href={run.attention.liveViewUrl} target="_blank" rel="noreferrer">
                    Open live view <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <p className="text-text-secondary">{run.attention.message}</p>
              <div className="flex gap-2">
                <input className="field flex-1" value={reply} onChange={(e) => setReply(e.target.value)} aria-label="Reply"
                  placeholder={run.attention.reason === 'agent' ? 'Your answer' : 'done'} onKeyDown={(e) => { if (e.key === 'Enter') respond(); }} />
                <button className="btn-primary" onClick={respond}>{run.attention.reason === 'agent' ? 'Reply' : 'Done, continue'}</button>
              </div>
            </div>
          )}

          {run.status === 'succeeded' && result && (
            <div className="flex flex-col gap-1 text-text-secondary">
              {result.total !== undefined && <p>Replayed {result.steps} of {result.total} steps without the LLM.</p>}
              {result.healed && <p className="text-yellow">The page had changed. The agent finished the run and saved its fix as a draft for review.</p>}
              {result.fellBack && !result.healed && <p className="text-yellow">A person finished the run.</p>}
              {result.text && <p className="whitespace-pre-wrap">{result.text}</p>}
            </div>
          )}
          {run.status === 'failed' && <p className="text-red">{run.error}</p>}
        </div>
      )}
    </Dialog>
  );
}
