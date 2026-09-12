'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, MousePointer2, Keyboard } from 'lucide-react';
import Kbd from '@/components/ui/kbd';

type Send = (action: string, params?: Record<string, unknown>) => Promise<unknown>;

interface Props {
  frameSrc: string | null;
  fps: number;
  frameAgeMs: number | null;
  send: Send;
  /** Called with a one-line description whenever the user does something, for the activity feed's optimistic row. */
  onInput?: (line: string) => void;
  /** False while the agent holds control: the view is watch-only, since human input is refused until taken. */
  interactive?: boolean;
  /** Fill the viewport instead of the panel's bounded 420px window — for the dedicated full-page live route. */
  large?: boolean;
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
export default function LiveView({ frameSrc, fps, frameAgeMs, send, onInput, interactive = true, large = false }: Props) {
  // The bounded panel window versus the full-page route, which fills the viewport.
  const fitCap = large ? 'max-h-[calc(100vh-9rem)]' : 'max-h-[420px]';
  const actualCap = large ? 'max-h-[calc(100vh-9rem)]' : 'max-h-[70vh]';
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
  const inputQueue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);

  // A click must finish before typing, and typing before Enter. Parallel HTTP
  // requests can arrive (and finish) in a different order from user input.
  const enqueue = useCallback((action: string, params?: Record<string, unknown>) => {
    const next = inputQueue.current.then(() => mounted.current ? send(action, params) : undefined);
    inputQueue.current = next.catch(() => undefined);
    return inputQueue.current;
  }, [send]);

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
    void enqueue('keyboard_type', { text });
  }, [enqueue, onInput]);

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
    void enqueue('press_key', { key });
  }, [captured, flushTyped, enqueue, onInput]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || !interactive) return;
    const p = toPage(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    flushTyped();
    wrap.current?.focus({ preventScroll: true });
    setCaptured(true);
    down.current = { x: p.x, y: p.y, t: Date.now() };
  };

  const onMouseUp = (e: React.MouseEvent) => {
    const start = down.current;
    down.current = null;
    const p = toPage(e.clientX, e.clientY);
    if (!p || !start) return;
    const moved = Math.hypot(p.x - start.x, p.y - start.y);
    if (moved > 6) {
      onInput?.(`drag ${start.x},${start.y} → ${p.x},${p.y}`);
      void enqueue('drag', { from_x: start.x, from_y: start.y, to_x: p.x, to_y: p.y });
      return;
    }
    setRipple({ x: p.localX, y: p.localY, id: Date.now() });
    onInput?.(`click ${p.x},${p.y}`);
    void enqueue('click_coordinates', { x: p.x, y: p.y });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!interactive) return;
    const p = toPage(e.clientX, e.clientY);
    if (!p) return;
    onInput?.(`double-click ${p.x},${p.y}`);
    void enqueue('double_click', { x: p.x, y: p.y });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!hover || !interactive) return;
    const now = Date.now();
    if (now - lastMove.current < 80) return;
    lastMove.current = now;
    const p = toPage(e.clientX, e.clientY);
    if (p) void send('mouse_move', { x: p.x, y: p.y });
  };

  useEffect(() => {
    const node = wrap.current;
    if (!node) return;
    let pending = 0, x = 0, y = 0, running = false, disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = async () => {
      timer = undefined;
      if (disposed || running || Math.abs(pending) < 1) return;
      const delta = Math.trunc(pending);
      pending -= delta;
      running = true;
      const direction = delta > 0 ? 'down' : 'up';
      const amount = Math.abs(delta);
      onInput?.(`scroll ${direction} ${amount}`);
      await enqueue('scroll', { direction, amount, x, y, smooth: false, analyze: false });
      running = false;
      if (!disposed && Math.abs(pending) >= 1) timer = setTimeout(flush, 40);
    };
    const wheel = (e: WheelEvent) => {
      // Watch-only: let the wheel scroll the dashboard instead of the page.
      if (!interactive || e.ctrlKey || !e.deltaY) return;
      const p = toPage(e.clientX, e.clientY);
      if (!p) return;
      e.preventDefault();
      e.stopPropagation();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? node.clientHeight : 1;
      pending += e.deltaY * unit;
      x = p.x; y = p.y;
      if (!running && !timer) timer = setTimeout(flush, 40);
    };
    // React's delegated wheel listener is passive, so preventDefault there
    // cannot stop the dashboard from scrolling underneath the remote page.
    node.addEventListener('wheel', wheel, { passive: false });
    return () => { disposed = true; clearTimeout(timer); node.removeEventListener('wheel', wheel); };
  }, [enqueue, onInput, toPage, interactive]);

  // Control handed back mid-capture: release the keyboard with it. Adjusted
  // during render rather than in an effect — the release lands in the same
  // pass that loses control, instead of one cascading render later.
  const [hadControl, setHadControl] = useState(interactive);
  if (hadControl !== interactive) {
    setHadControl(interactive);
    if (!interactive) setCaptured(false);
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (flushTimer.current) clearTimeout(flushTimer.current); };
  }, []);

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
        className={`relative select-none outline-none ${fit === 'fit' ? fitCap : `${actualCap} overflow-auto`} ${captured ? 'ring-1 ring-inset ring-accent/60' : ''}`}
        style={{ cursor: interactive ? 'crosshair' : 'default' }}
        aria-label={interactive ? 'Live view — click to control, Esc to release the keyboard' : 'Live view — watch only while the agent has control'}
      >
        {frameSrc ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img ref={img} src={frameSrc} alt="" draggable={false}
            className={fit === 'fit' ? `block h-auto ${fitCap} w-full object-contain` : 'block max-w-none'} />
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
          {captured ? <>keyboard captured · <Kbd>Esc</Kbd> releases</> : interactive ? 'click to control' : 'watching · take control to interact'}
        </div>
      </div>
    </div>
  );
}
