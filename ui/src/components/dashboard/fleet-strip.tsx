'use client';

import { useMemo } from 'react';
import type { Fleet, Health } from './types';
import { HEALTH_LABEL, providerLabel } from './types';

export interface FleetFilter {
  health: Health | null;
  provider: string | null;
  persona: string | null;
  text: string;
}

interface Props {
  fleet: Fleet | null;
  /** Command counters from the previous poll, for a per-minute rate. */
  rate: { commandsPerMin: number; errorPct: number } | null;
  filter: FleetFilter;
  onFilter: (next: Partial<FleetFilter>) => void;
}

const HEALTH_ORDER: Health[] = ['ok', 'stale', 'errors', 'dead'];

/**
 * The fleet at a glance, and every number is a filter. "errors 12" is not a
 * statistic to admire — click it and the table shows those twelve.
 */
export default function FleetStrip({ fleet, rate, filter, onFilter }: Props) {
  const b = fleet?.browsers;
  const providers = useMemo(() => Object.entries(b?.byProvider || {}).sort((x, y) => y[1] - x[1]), [b]);
  const personas = useMemo(() => Object.entries(b?.byPersona || {}).sort((x, y) => y[1] - x[1]), [b]);
  const topPersonas = personas.slice(0, 5);
  const restPersonas = personas.length - topPersonas.length;

  const chip = (active: boolean, extra = '') =>
    `inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12.5px] num transition-colors ${
      active ? 'border-accent/50 bg-accent/10 text-text' : 'border-border bg-transparent text-text-secondary hover:border-text/20 hover:text-text'} ${extra}`;

  return (
    <div className="border-b border-border bg-bg-card/40">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 lg:px-6">
        {/* Total */}
        <div className="flex items-baseline gap-2">
          <span className="font-display text-2xl font-bold num text-text">{b?.total ?? '—'}</span>
          <span className="text-[12px] uppercase tracking-[0.12em] text-text-muted">browsers</span>
        </div>

        {/* Health */}
        <div className="flex max-w-full flex-wrap items-center gap-1.5" role="group" aria-label="Filter by health">
          {HEALTH_ORDER.map((h) => {
            const n = b?.byHealth?.[h] ?? 0;
            const active = filter.health === h;
            return (
              <button key={h} className={chip(active)} onClick={() => onFilter({ health: active ? null : h })}
                title={`${n} ${HEALTH_LABEL[h]}`} aria-pressed={active}>
                <span className={`dot dot-${h}`} />
                <span>{n}</span>
                <span className="text-text-muted">{HEALTH_LABEL[h]}</span>
              </button>
            );
          })}
        </div>

        {/* Throughput */}
        <div className="flex items-center gap-4 text-[12.5px] num text-text-secondary">
          <span><span className="text-text">{rate ? rate.commandsPerMin : '—'}</span> cmd/min</span>
          <span>
            <span className={rate && rate.errorPct >= 5 ? 'text-red' : 'text-text'}>{rate ? `${rate.errorPct.toFixed(1)}%` : '—'}</span> errors
          </span>
          {b && b.pending > 0 && <span><span className="text-yellow">{b.pending}</span> in flight</span>}
        </div>

        <div className="ml-auto" />

        {/* Providers */}
        {providers.length > 0 && (
          <div className="flex max-w-full flex-wrap items-center gap-1.5" role="group" aria-label="Filter by provider">
            {providers.map(([p, n]) => {
              const active = filter.provider === p;
              return (
                <button key={p} className={chip(active)} onClick={() => onFilter({ provider: active ? null : p })} aria-pressed={active}>
                  <span>{n}</span><span className="text-text-muted">{providerLabel(p)}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Personas */}
        {topPersonas.length > 0 && (
          <div className="flex max-w-full flex-wrap items-center gap-1.5" role="group" aria-label="Filter by persona">
            {topPersonas.map(([p, n]) => {
              const active = filter.persona === p;
              return (
                <button key={p} className={chip(active, 'max-w-[180px]')} onClick={() => onFilter({ persona: active ? null : p })} aria-pressed={active} title={p}>
                  <span>{n}</span><span className="truncate text-text-muted">{p}</span>
                </button>
              );
            })}
            {restPersonas > 0 && <span className="text-[12px] text-text-dim">+{restPersonas} more</span>}
          </div>
        )}
      </div>
    </div>
  );
}
