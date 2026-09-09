'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type Size = 'sm' | 'md' | 'lg' | 'drawer';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  size?: Size;
  children: ReactNode;
  footer?: ReactNode;
}

const SIZES: Record<Size, string> = {
  sm: 'w-full max-w-md',
  md: 'w-full max-w-lg',
  lg: 'w-full max-w-3xl',
  drawer: 'h-full w-full max-w-xl',
};

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * The one overlay. Focus is trapped inside, Escape and the backdrop close it,
 * and focus returns to whatever opened it — the three things every hand-rolled
 * modal in this app forgot.
 */
export default function Dialog({ open, onClose, title, description, size = 'md', children, footer }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const node = panel.current;
    // First focusable, or the panel itself so keys still land inside.
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) { e.preventDefault(); return; }
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      opener.current?.focus?.();
    };
  }, [open, onClose]);

  const drawer = size === 'drawer';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="backdrop"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}
          className={`fixed inset-0 z-50 flex bg-black/60 ${drawer ? 'justify-end' : 'items-start justify-center overflow-y-auto p-4 pt-[8vh]'}`}
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            tabIndex={-1}
            initial={drawer ? { x: 24, opacity: 0 } : { y: 8, opacity: 0 }}
            animate={{ x: 0, y: 0, opacity: 1 }}
            exit={drawer ? { x: 24, opacity: 0 } : { y: 8, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={`${SIZES[size]} flex flex-col border border-border bg-bg-card shadow-[var(--shadow-elevated)] outline-none ${drawer ? 'border-y-0 border-r-0' : 'rounded-xl'}`}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-text">{title}</h2>
                {description && <p className="mt-0.5 text-[13px] text-text-muted">{description}</p>}
              </div>
              <button onClick={onClose} aria-label="Close" className="-mr-1 rounded-md p-1 text-text-muted hover:bg-white/5 hover:text-text">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className={`min-h-0 flex-1 px-5 py-4 ${drawer ? 'overflow-y-auto' : ''}`}>{children}</div>
            {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A yes/no with the consequence spelled out. */
export function Confirm({
  open, onClose, onConfirm, title, body, confirmLabel = 'Confirm', danger = false, busy = false,
}: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  title: ReactNode; body: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} size="sm"
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={onConfirm} disabled={busy} className={danger ? 'btn-danger' : 'btn-primary'}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }>
      <div className="text-sm leading-relaxed text-text-secondary">{body}</div>
    </Dialog>
  );
}
