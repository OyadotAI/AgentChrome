'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Square, Search, X, Monitor, Code2, Plug, Copy, Camera, PanelRightOpen, ExternalLink } from 'lucide-react';
import ContextMenu, { type MenuItem } from '@/components/ui/context-menu';
import type { BrowserRow, Health } from './types';
import { providerLabel } from './types';
import type { FleetFilter } from './fleet-strip';
import { ago, shortId } from '@/lib/api-client';
import Kbd from '@/components/ui/kbd';

type SortKey = 'name' | 'health' | 'persona' | 'provider' | 'currentUrl' | 'commands' | 'errors' | 'lastSeen' | 'connectedAt';

interface Props {
  rows: BrowserRow[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  checked: Set<string>;
  onChecked: (next: Set<string>) => void;
  filter: FleetFilter;
  onFilter: (next: Partial<FleetFilter>) => void;
  onStop: (ids: string[]) => void;
  onStart: () => void;
  onConnect: (id: string) => void;
  onScreenshot: (id: string) => void;
  onCode: () => void;
  apiKey: string;
  filterRef: React.RefObject<HTMLInputElement | null>;
  now: number;
}

const HEALTH_RANK: Record<Health, number> = { errors: 0, dead: 1, stale: 2, ok: 3 };
const PAGE = 500;

const COLS: { key: SortKey; label: string; className: string }[] = [
  { key: 'health', label: '', className: 'w-6' },
  { key: 'name', label: 'Browser', className: 'min-w-[160px]' },
  { key: 'persona', label: 'Persona', className: 'min-w-[120px]' },
  { key: 'provider', label: 'Provider', className: 'w-[120px]' },
  { key: 'currentUrl', label: 'Current page', className: 'min-w-[200px]' },
  { key: 'commands', label: 'Cmds · Err', className: 'w-[100px] text-right' },
  { key: 'lastSeen', label: 'Seen', className: 'w-[64px] text-right' },
  { key: 'connectedAt', label: 'Up', className: 'w-[72px] text-right' },
];

function matches(r: BrowserRow, f: FleetFilter): boolean {
  if (f.health && r.health !== f.health) return false;
  if (f.provider && r.provider !== f.provider) return false;
  if (f.persona && (r.personaName || r.persona || '—') !== f.persona) return false;
  if (f.text) {
    const q = f.text.toLowerCase();
    if (![r.name, r.id, r.currentUrl, r.personaName, r.persona, r.provider].some((v) => (v || '').toLowerCase().includes(q))) return false;
  }
  return true;
}

/**
 * The fleet. Dense on purpose: a thousand rows should fit the eye, not the
 * scroll bar. Rows paint lazily; the selection is keyboard-driven.
 */
export default function FleetTable({
  rows, selectedId, onSelect, checked, onChecked, filter, onFilter, onStop, onStart, onConnect, onScreenshot, onCode, apiKey, filterRef, now,
}: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'health', dir: 1 });
  const [limit, setLimit] = useState(PAGE);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; row: BrowserRow } | null>(null);

  // Right-click: everything you can do to one browser, without hunting for a button.
  const menuItems = (r: BrowserRow): MenuItem[] => {
    const http = typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}` : '';
    const ws = http.replace(/^http/, 'ws');
    const copy = (t: string) => navigator.clipboard.writeText(t);
    return [
      { label: 'Open', icon: <PanelRightOpen />, shortcut: '↵', onSelect: () => onSelect(r.id) },
      { label: 'Connect… (code, Playwright, MCP)', icon: <Plug />, onSelect: () => onConnect(r.id) },
      { label: 'Screenshot', icon: <Camera />, shortcut: 'S', onSelect: () => onScreenshot(r.id) },
      { label: 'Open live stream in a tab', icon: <ExternalLink />, onSelect: () => window.open(`${http}/api/live/${r.id}?key=${encodeURIComponent(apiKey)}`, '_blank') },
      { label: 'Copy browser id', icon: <Copy />, separator: true, onSelect: () => copy(r.id) },
      { label: 'Copy MCP URL', icon: <Copy />, onSelect: () => copy(`${http}/mcp/${r.id}`) },
      { label: r.clientType === 'cdp' ? 'Copy CDP attach URL (with key)' : 'Copy CDP attach URL — not a CDP browser', icon: <Copy />,
        disabled: r.clientType !== 'cdp', onSelect: () => copy(`${ws}/connect?token=${encodeURIComponent(apiKey)}&browser=${r.id}`) },
      { label: r.provider === 'oya-cloud' ? 'Stop — destroys the sandbox' : 'Stop', icon: <Square />, shortcut: 'X', danger: true, separator: true, onSelect: () => onStop([r.id]) },
    ];
  };

  const visible = useMemo(() => {
    const out = rows.filter((r) => matches(r, filter));
    const { key, dir } = sort;
    out.sort((a, b) => {
      let av: string | number, bv: string | number;
      if (key === 'health') { av = HEALTH_RANK[a.health]; bv = HEALTH_RANK[b.health]; }
      else if (key === 'persona') { av = a.personaName || a.persona || ''; bv = b.personaName || b.persona || ''; }
      else if (key === 'commands' || key === 'errors') { av = a[key]; bv = b[key]; }
      else if (key === 'lastSeen' || key === 'connectedAt') { av = a[key]; bv = b[key]; }
      else { av = (a[key] || '') as string; bv = (b[key] || '') as string; }
      const c = av < bv ? -1 : av > bv ? 1 : 0;
      return c * dir || a.name.localeCompare(b.name);
    });
    return out;
  }, [rows, filter, sort]);

  const shown = visible.slice(0, limit);

  // Keep the selected row in view as the selection moves by keyboard.
  useEffect(() => {
    if (!selectedId) return;
    bodyRef.current?.querySelector<HTMLElement>(`[data-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const allChecked = shown.length > 0 && shown.every((r) => checked.has(r.id));
  const toggleAll = () => onChecked(allChecked ? new Set() : new Set(shown.map((r) => r.id)));
  const toggle = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChecked(next);
  };

  const th = (c: typeof COLS[number]) => {
    const active = sort.key === c.key;
    return (
      <th key={c.key} className={`${c.className} px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-[0.1em] text-text-muted select-none`}>
        {c.label ? (
          <button className="inline-flex items-center gap-1 hover:text-text" onClick={() => setSort({ key: c.key, dir: active ? (sort.dir === 1 ? -1 : 1) : 1 })}>
            {c.label}
            {active && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
          </button>
        ) : null}
      </th>
    );
  };

  const anyFilter = filter.health || filter.provider || filter.persona || filter.text;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 lg:px-6">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-dim" />
          <input
            ref={filterRef}
            value={filter.text}
            onChange={(e) => onFilter({ text: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Escape') { onFilter({ text: '' }); (e.target as HTMLInputElement).blur(); } }}
            placeholder="Filter by name, url, persona, provider…"
            className="field pl-8 pr-12"
            aria-label="Filter browsers"
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"><Kbd>/</Kbd></span>
        </div>
        {anyFilter && (
          <button className="btn-ghost h-7 px-2 text-[12px]" onClick={() => onFilter({ health: null, provider: null, persona: null, text: '' })}>
            <X className="h-3 w-3" /> Clear
          </button>
        )}
        <span className="ml-1 text-[12px] num text-text-muted">{visible.length}{visible.length !== rows.length ? ` of ${rows.length}` : ''}</span>
        <div className="ml-auto flex items-center gap-2">
          {checked.size > 0 && (
            <button className="btn-danger h-7" onClick={() => onStop([...checked])}>
              <Square className="h-3 w-3" /> Stop {checked.size}
            </button>
          )}
          {rows.length > 0 && checked.size === 0 && (
            <button className="btn-ghost h-7 text-[12px]" onClick={() => onStop(rows.map((r) => r.id))}>Stop all</button>
          )}
          <button className="btn-ghost h-7" onClick={onCode} title="Code that starts browsers here"><Code2 className="h-3.5 w-3.5" /> Code</button>
          <button className="btn-primary h-7" onClick={onStart}>Start browser <Kbd>N</Kbd></button>
        </div>
      </div>
      <ContextMenu at={menu?.at ?? null} items={menu ? menuItems(menu.row) : []} onClose={() => setMenu(null)} label={menu ? `Actions for ${menu.row.name}` : 'Actions'} />

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <Empty onStart={onStart} />
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 z-10 bg-bg">
              <tr className="border-b border-border">
                <th className="w-8 px-2 py-1.5">
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all shown" className="accent-accent" />
                </th>
                {COLS.map(th)}
                <th className="w-[80px]" />
              </tr>
            </thead>
            <tbody ref={bodyRef}>
              {shown.map((r) => {
                const selected = r.id === selectedId;
                return (
                  <tr
                    key={r.id}
                    data-id={r.id}
                    onClick={() => onSelect(selected ? null : r.id)}
                    onContextMenu={(e) => { e.preventDefault(); setMenu({ at: { x: e.clientX, y: e.clientY }, row: r }); }}
                    className={`row-lazy group cursor-pointer border-b border-border/60 transition-colors ${
                      selected ? 'bg-accent/[0.08]' : 'hover:bg-text/[0.035]'}`}
                    aria-selected={selected}
                  >
                    <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={checked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} className="accent-accent" />
                    </td>
                    <td className="px-2 py-1.5"><span className={`dot dot-${r.health}`} title={r.health} /></td>
                    <td className="px-2 py-1.5">
                      <div className="truncate font-medium text-text">{r.name}</div>
                      <div className="truncate font-mono text-[11px] text-text-dim">{shortId(r.id)}</div>
                    </td>
                    <td className="truncate px-2 py-1.5 text-text-secondary" title={r.persona || ''}>{r.personaName || (r.persona ? shortId(r.persona) : '—')}</td>
                    <td className="px-2 py-1.5 text-text-secondary">{providerLabel(r.provider)}</td>
                    <td className="max-w-0 truncate px-2 py-1.5 font-mono text-[12px] text-text-secondary" title={r.currentUrl}>
                      {r.currentUrl ? r.currentUrl.replace(/^https?:\/\//, '') : <span className="text-text-dim">—</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right num text-text-secondary">
                      {r.commands} · <span className={r.errors ? 'text-red' : ''}>{r.errors}</span>
                      {r.pending > 0 && <span className="ml-1 text-yellow">+{r.pending}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right num text-text-muted">{ago(r.lastSeen, now)}</td>
                    <td className="px-2 py-1.5 text-right num text-text-muted">{ago(r.connectedAt, now)}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      <button
                        className="btn-icon h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        title="Connect (code, Playwright, MCP)" aria-label={`Connect to ${r.name}`}
                        onClick={(e) => { e.stopPropagation(); onConnect(r.id); }}
                      >
                        <Plug className="h-3 w-3" />
                      </button>
                      <button
                        className="btn-icon h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        title="Stop" aria-label={`Stop ${r.name}`}
                        onClick={(e) => { e.stopPropagation(); onStop([r.id]); }}
                      >
                        <Square className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {visible.length > limit && (
          <div className="flex items-center justify-center gap-3 py-3 text-[12.5px] text-text-muted">
            Showing {limit} of {visible.length}
            <button className="btn-ghost h-7" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, visible.length - limit)} more</button>
            <button className="btn-ghost h-7" onClick={() => setLimit(visible.length)}>Show all</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Empty({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-24 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-bg-card">
        <Monitor className="h-5 w-5 text-text-muted" />
      </div>
      <div>
        <p className="text-[15px] font-medium text-text">No browsers running</p>
        <p className="mt-1 text-[13px] text-text-muted">Start one here, from the CLI with <code className="font-mono">oya start</code>, or from the SDK.</p>
      </div>
      <button className="btn-primary mt-1" onClick={onStart}>Start a browser</button>
    </div>
  );
}
