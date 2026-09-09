'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, MousePointer2, Keyboard } from 'lucide-react';
import Kbd from '@/components/ui/kbd';

type Send = (action: string, params?: Record<string, unknown>) => Promise<unknown>;

interface Props {
  browserId: string;
  frameSrc: string | null;
  fps: number;
  frameAgeMs: number | null;
  send: Send;
  /** Called with a one-line description whenever the user does something, for the activity feed's optimistic row. */
  onInput?: (line: string) => void;
}

const SPECIAL: Record<string, string> = {
  Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Escape: 'Escape',
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ' ': 'Space',
};

/**
 * The frame, and a way to act on it. Clicks are scaled from the displayed
 * image to the page's own pixels; keys are batched so typing a word is one
 * command, not seven; Escape hands the keyboard back to the console.
 *
 * Bounded on purpose. The fleet is the page; this is a window into one row.
 */
export default function LiveView({ browserId, frameSrc, fps, frameAgeMs, send, onInput }: Props) {
  const img = useRef<HTMLImageElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [captured, setCaptured] = useState(false);
  const [fit, setFit] = useState<'fit' | 'actual'>('fit');
  const [hover, setHover] = useState(false);
  const [ripple, setRipple] = useState<{ x: number; y: number; id: number } | null>(null);
  const typed = useRef('');
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastMove = useRef(0);
  const lastWheel = useRef(0);

  // Displayed → page pixels. The frame is the page at its natural size.
  const toPage = useCallback((clientX: number, clientY: number) => {
    const el = img.current;
    if (!el || !el.naturalWidth) return null;
    const rect = el.getBoundingClientRect();
    // object-contain letterboxes: find the drawn image box inside the element.
    const scale = Math.min(rect.width / el.naturalWidth, rect.height / el.naturalHeight);
    const drawnW = el.naturalWidth * scale, drawnH = el.naturalHeight * scale;
    const offX = rect.left + (rect.width - drawnW) / 2, offY = rect.top + (rect.height - drawnH) / 2;
    const x = (clientX - offX) / scale, y = (clientY - offY) / scale;
    if (x < 0 || y < 0 || x > el.naturalWidth || y > el.naturalHeight) return null;
    return { x: Math.round(x), y: Math.round(y), localX: clientX - rect.left, localY: clientY - rect.top };
  }, []);

  const flushTyped = useCallback(() => {
    if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null; }
    const text = typed.current;
    typed.current = '';
    if (!text) return;
    onInput?.(`type ${text.length} chars`);
    void send('keyboard_type', { text });
  }, [send, onInput]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!captured) return;
    if (e.key === 'Escape') {
      // Ours alone. React flushes the state change before the native event
      // reaches document, so the console's own Escape binding would otherwise
      // see the keyboard as already released and close the whole panel.
      e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation();
      flushTyped(); setCaptured(false); wrap.current?.blur();
      return;
    }
    // Let the browser's own shortcuts through (copy, reload the dashboard, …).
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    if (e.key.length === 1) {
      typed.current += e.key;
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(flushTyped, 120);
      return;
    }
    const key = SPECIAL[e.key];
    if (!key) return;
    flushTyped();
    onInput?.(`press ${key}`);
    void send('press_key', { key });
  }, [captured, flushTyped, send, onInput]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const p = toPage(e.clientX, e.clientY);
    if (!p) return;
    down.current = { x: p.x, y: p.y, t: Date.now() };
  };

  const onMouseUp = (e: React.MouseEvent) => {
    const start = down.current;
    down.current = null;
    const p = toPage(e.clientX, e.clientY);
    wrap.current?.focus();
    setCaptured(true);
    if (!p || !start) return;
    const moved = Math.hypot(p.x - start.x, p.y - start.y);
    if (moved > 6) {
      onInput?.(`drag ${start.x},${start.y} → ${p.x},${p.y}`);
      void send('drag', { from_x: start.x, from_y: start.y, to_x: p.x, to_y: p.y });
      return;
    }
    setRipple({ x: p.localX, y: p.localY, id: Date.now() });
    onInput?.(`click ${p.x},${p.y}`);
    void send('click_coordinates', { x: p.x, y: p.y });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const p = toPage(e.clientX, e.clientY);
    if (!p) return;
    onInput?.(`double-click ${p.x},${p.y}`);
    void send('double_click', { x: p.x, y: p.y });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!hover) return;
    const now = Date.now();
    if (now - lastMove.current < 80) return;
    lastMove.current = now;
    const p = toPage(e.clientX, e.clientY);
    if (p) void send('mouse_move', { x: p.x, y: p.y });
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const now = Date.now();
    if (now - lastWheel.current < 100) return;
    lastWheel.current = now;
    const direction = e.deltaY > 0 ? 'down' : 'up';
    const amount = Math.min(800, Math.max(120, Math.round(Math.abs(e.deltaY) * 3)));
    onInput?.(`scroll ${direction} ${amount}`);
    void send('scroll', { direction, amount });
  };

  useEffect(() => () => { if (flushTimer.current) clearTimeout(flushTimer.current); }, []);
  useEffect(() => { setCaptured(false); typed.current = ''; }, [browserId]);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-black">
      <div className="flex h-8 items-center gap-2 border-b border-border bg-bg-card px-2 text-[11.5px] text-text-muted">
        <span className={`dot ${frameSrc ? 'dot-ok' : 'dot-dead'}`} />
        {/* An idle page paints ~1 frame/s from the screenshot fill; that is "live", not "0 fps". */}
        <span className="num">{!frameSrc ? 'connecting' : fps > 1 ? `${fps} fps` : (frameAgeMs !== null && frameAgeMs < 3000 ? 'live' : 'idle')}</span>
        {frameAgeMs !== null && frameAgeMs > 5000 && <span className="text-yellow num">last frame {Math.round(frameAgeMs / 1000)}s ago</span>}
        <span className="ml-auto" />
        <button className={`btn-icon h-6 w-6 ${hover ? 'text-accent' : ''}`} title="Stream mouse movement (uses bandwidth)" aria-pressed={hover} onClick={() => setHover(!hover)}>
          <MousePointer2 className="h-3.5 w-3.5" />
        </button>
        <button className="btn-icon h-6 w-6" title={fit === 'fit' ? 'Actual size' : 'Fit to panel'} onClick={() => setFit(fit === 'fit' ? 'actual' : 'fit')}>
          {fit === 'fit' ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
        </button>
      </div>

      <div
        ref={wrap}
        tabIndex={0}
        data-captures-keys={captured ? '' : undefined}
        onKeyDown={onKeyDown}
        onBlur={() => { flushTyped(); setCaptured(false); }}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onDoubleClick={onDoubleClick}
        onMouseMove={onMouseMove}
        onWheel={onWheel}
        className={`relative select-none outline-none ${fit === 'fit' ? 'max-h-[420px]' : 'max-h-[70vh] overflow-auto'} ${captured ? 'ring-1 ring-inset ring-accent/60' : ''}`}
        style={{ cursor: 'crosshair' }}
        aria-label="Live view — click to control, Esc to release the keyboard"
      >
        {frameSrc ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img ref={img} src={frameSrc} alt="" draggable={false}
            className={fit === 'fit' ? 'block h-auto max-h-[420px] w-full object-contain' : 'block max-w-none'} />
        ) : (
          <div className="flex h-[240px] items-center justify-center text-[13px] text-text-dim">Waiting for the first frame…</div>
        )}
        {ripple && (
          <span key={ripple.id} className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border-2 border-accent"
            style={{ left: ripple.x, top: ripple.y }} onAnimationEnd={() => setRipple(null)} />
        )}
        <div className={`pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-opacity ${
          captured ? 'border-accent/40 bg-black/70 text-text opacity-100' : 'border-border bg-black/60 text-text-muted opacity-0 group-hover:opacity-100'}`}>
          <Keyboard className="h-3 w-3" />
          {captured ? <>keyboard captured · <Kbd>Esc</Kbd> releases</> : 'click to control'}
        </div>
      </div>
    </div>
  );
}
