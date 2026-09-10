'use client';

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Kbd from './kbd';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** A thin rule above this item. */
  separator?: boolean;
  onSelect: () => void;
}

interface Props {
  at: { x: number; y: number } | null;
  items: MenuItem[];
  onClose: () => void;
  /** Read out by assistive tech; also the menu's aria-label. */
  label: string;
}

/**
 * A right-click menu. Opens at the cursor, stays on screen, arrows move,
 * Enter picks, Escape and any click outside close it.
 */
export default function ContextMenu({ at, items, onClose, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const [active, setActive] = useState(0);
  const firstEnabled = useEffectEvent(() => items.findIndex((i) => !i.disabled));

  useLayoutEffect(() => {
    if (!at || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8)),
    });
    setActive(firstEnabled());
  }, [at]);

  const closeOutside = useEffectEvent((e: MouseEvent) => {
    if (!ref.current?.contains(e.target as Node)) onClose();
  });
  const handleKey = useEffectEvent((e: KeyboardEvent) => {
    const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onClose(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!enabled.length) return;
      const cur = enabled.indexOf(active);
      setActive(enabled[(cur + (e.key === 'ArrowDown' ? 1 : enabled.length - 1)) % enabled.length]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!items[active] || items[active].disabled) return;
      items[active].onSelect(); onClose();
    }
  });

  useEffect(() => {
    if (!at) return;
    const close = (e: MouseEvent) => closeOutside(e);
    const key = (e: KeyboardEvent) => handleKey(e);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key, true);
    ref.current?.focus({ preventScroll: true });
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key, true); };
  }, [at]);

  if (!at) return null;
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={{ left: pos?.x ?? at.x, top: pos?.y ?? at.y }}
      className="fixed z-[60] min-w-[220px] rounded-lg border border-border bg-bg-card py-1 shadow-[var(--shadow-elevated)] outline-none"
    >
      {items.map((it, i) => (
        <div key={it.label + i}>
          {it.separator && <div className="my-1 h-px bg-border" />}
          <button
            role="menuitem"
            disabled={it.disabled}
            onMouseEnter={() => !it.disabled && setActive(i)}
            onClick={() => { if (it.disabled) return; it.onSelect(); onClose(); }}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] ${
              it.disabled ? 'text-text-dim' : it.danger ? 'text-red' : 'text-text'} ${active === i && !it.disabled ? (it.danger ? 'bg-red/10' : 'bg-text/[0.06]') : ''}`}
          >
            {it.icon && <span className="w-4 text-text-muted [&>svg]:h-3.5 [&>svg]:w-3.5">{it.icon}</span>}
            <span className="flex-1">{it.label}</span>
            {it.shortcut && <Kbd>{it.shortcut}</Kbd>}
          </button>
        </div>
      ))}
    </div>
  );
}
