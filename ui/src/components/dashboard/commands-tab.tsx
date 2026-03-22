'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Zap, Camera, ArrowUp, ArrowDown, Eye, List, ExternalLink,
  Square, RefreshCw, Globe, MousePointer, Keyboard,
  Clock, Copy, Check, ChevronRight, ChevronDown, Monitor,
  Terminal, Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface ResultEntry {
  id: number;
  label: string;
  ts: string;
  body: string;
  bodyHtml: string;
  type: 'pending' | 'success' | 'error' | 'image';
  collapsed: boolean;
}

interface CommandsTabProps {
  selectedBrowser: string | null;
  resultEntries: ResultEntry[];
  setResultEntries: React.Dispatch<React.SetStateAction<ResultEntry[]>>;
  buttonsDisabled: boolean;
  runCommand: (action: string, params?: Record<string, unknown>) => void;
  liveFrameSrc: string | null;
  liveFps: string;
  copyText: (text: string) => void;
}

export default function CommandsTab({
  selectedBrowser,
  resultEntries,
  setResultEntries,
  buttonsDisabled,
  runCommand,
  liveFrameSrc,
  liveFps,
  copyText,
}: CommandsTabProps) {
  const [navUrl, setNavUrl] = useState('');
  const [clickId, setClickId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [typeText, setTypeText] = useState('');
  const [pressKeyInput, setPressKeyInput] = useState('');
  const [waitSelector, setWaitSelector] = useState('');
  const [tabIdInput, setTabIdInput] = useState('');
  const [tabUrlInput, setTabUrlInput] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const resultAreaRef = useRef<HTMLDivElement>(null);
  const isUserScrollingRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    if (!isUserScrollingRef.current && resultAreaRef.current) {
      requestAnimationFrame(() => {
        if (resultAreaRef.current) {
          resultAreaRef.current.scrollTop = resultAreaRef.current.scrollHeight;
        }
      });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [resultEntries, scrollToBottom]);

  const handleResultScroll = useCallback(() => {
    if (resultAreaRef.current) {
      const el = resultAreaRef.current;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
      isUserScrollingRef.current = !atBottom;
    }
  }, []);

  const toggleCollapse = (id: number) => {
    setResultEntries(prev => prev.map(e =>
      e.id === id ? { ...e, collapsed: !e.collapsed } : e
    ));
  };

  const handleCopyEntry = (id: number, body: string) => {
    copyText(body);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  if (!selectedBrowser) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20">
        <Terminal className="w-5 h-5 text-text-dim mb-3" />
        <p className="text-text-muted text-sm font-medium">Select a browser to send commands</p>
      </div>
    );
  }

  const quickActions = [
    { cmd: 'analyze_page', label: 'Analyze', icon: Zap },
    { cmd: 'screenshot', label: 'Screenshot', icon: Camera },
    { cmd: 'scroll_down', label: 'Scroll Down', icon: ArrowDown },
    { cmd: 'scroll_up', label: 'Scroll Up', icon: ArrowUp },
    { cmd: 'read_page', label: 'Read Elements', icon: Eye },
  ];

  const tabActions = [
    { cmd: 'list_tabs', label: 'List', icon: List },
    { cmd: 'open_tab', label: 'Open', icon: ExternalLink },
    { cmd: 'switch_tab', label: 'Switch', icon: RefreshCw },
    { cmd: 'close_tab', label: 'Close', icon: Square },
  ];

  const handleQuickAction = (cmd: string) => {
    if (cmd === 'analyze_page') runCommand('analyze');
    else if (cmd === 'screenshot') runCommand('screenshot');
    else if (cmd === 'scroll_down') runCommand('scroll', { direction: 'down', amount: 500 });
    else if (cmd === 'scroll_up') runCommand('scroll', { direction: 'up', amount: 500 });
    else if (cmd === 'read_page') runCommand('read_page', { limit: 50 });
    else if (cmd === 'list_tabs') runCommand('list_tabs');
    else if (cmd === 'open_tab') {
      const url = tabUrlInput.trim();
      runCommand('open_tab', url ? { url } : {});
    } else if (cmd === 'switch_tab') {
      const id = parseInt(tabIdInput, 10);
      if (id >= 0) runCommand('switch_tab', { tab_id: id });
    } else if (cmd === 'close_tab') {
      const id = parseInt(tabIdInput, 10);
      runCommand('close_tab', id >= 0 ? { tab_id: id } : {});
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col gap-4 p-6 h-full"
    >
      {/* Controls Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left column: Actions */}
        <div className="space-y-4">
          {/* Quick Actions */}
          <div className="rounded-lg border border-border bg-bg-card p-4">
            <div className="text-xs font-medium text-text-dim uppercase tracking-wider mb-3">Page Actions</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {quickActions.map(({ cmd, label, icon: Icon }) => (
                <button
                  key={cmd}
                  disabled={buttonsDisabled}
                  onClick={() => handleQuickAction(cmd)}
                  className="h-9 px-3 rounded-md text-sm font-medium text-text-muted hover:bg-white/5 hover:text-text transition-colors border border-border flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Navigate */}
          <div className="rounded-lg border border-border bg-bg-card p-4">
            <div className="text-xs font-medium text-text-dim uppercase tracking-wider mb-3">Navigate</div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-dim" />
                <input
                  type="text"
                  className="w-full h-9 rounded-md border border-border bg-transparent pl-9 pr-3 text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-border-focus transition-colors"
                  placeholder="https://example.com"
                  spellCheck={false}
                  value={navUrl}
                  onChange={e => setNavUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && navUrl.trim()) runCommand('navigate', { url: navUrl.trim() }); }}
                />
              </div>
              <button
                disabled={buttonsDisabled}
                onClick={() => { if (navUrl.trim()) runCommand('navigate', { url: navUrl.trim() }); }}
                className="h-9 px-4 rounded-md bg-accent text-neutral-950 text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-30"
              >
                Go
              </button>
            </div>
          </div>

          {/* Interact */}
          <div className="rounded-lg border border-border bg-bg-card p-4">
            <div className="text-xs font-medium text-text-dim uppercase tracking-wider mb-3">Interact</div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <MousePointer className="w-4 h-4 text-text-dim shrink-0" />
                <input
                  type="number"
                  className="w-16 h-9 rounded-md border border-border bg-transparent px-3 text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-border-focus transition-colors"
                  placeholder="El #"
                  min={1}
                  value={clickId}
                  onChange={e => setClickId(e.target.value)}
                />
                <button
                  disabled={buttonsDisabled}
                  onClick={() => {
                    const id = parseInt(clickId, 10);
                    if (id) runCommand('click', { selector: `[data-ac-id="${id}"]` });
                  }}
                  className="h-9 px-4 rounded-md text-sm font-medium text-text-muted hover:bg-white/5 hover:text-text transition-colors border border-border disabled:opacity-30"
                >
                  Click
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Keyboard className="w-4 h-4 text-text-dim shrink-0" />
                <input
                  type="number"
                  className="w-16 h-9 rounded-md border border-border bg-transparent px-3 text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-border-focus transition-colors"
                  placeholder="#"
                  min={1}
                  value={typeId}
                  onChange={e => setTypeId(e.target.value)}
                />
                <input
                  type="text"
                  className="flex-1 h-9 rounded-md border border-border bg-transparent px-3 text-sm text-text placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-border-focus transition-colors"
                  placeholder="Text to type"
                  value={typeText}
                  onChange={e => setTypeText(e.target.value)}
                />
                <button
                  disabled={buttonsDisabled}
                  onClick={() => {
                    const id = parseInt(typeId, 10);
                    if (id && typeText) runCommand('type', { selector: `[data-ac-id="${id}"]`, text: typeText });
                  }}
                  className="h-9 px-4 rounded-md text-sm font-medium text-text-muted hover:bg-white/5 hover:text-text transition-colors border border-border disabled:opacity-30"
                >
                  Type
                </button>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-text-dim uppercase tracking-wider shrink-0 w-4 text-center">K</label>
                <input
                  type="text"
                  className="w-28 h-9 rounded-md border border-border bg-transparent px-3 text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-border-focus transition-colors"
                  placeholder="Enter, Escape..."
                  value={pressKeyInput}
                  onChange={e => setPressKeyInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { const k = pressKeyInput.trim(); if (k) runCommand('press_key', { key: k }); } }}
                />
                <button
                  disabled={buttonsDisabled}
                  onClick={() => { const k = pressKeyInput.trim(); if (k) runCommand('press_key', { key: k }); }}
                  className="h-9 px-4 rounded-md text-sm font-medium text-text-muted hover:bg-white/5 hover:text-text transition-colors border border-border disabled:opacity-30"
                >
                  Press
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-text-dim shrink-0" />
                <input
                  type="text"
                  className="flex-1 h-9 rounded-md border border-border bg-transparent px-3 text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-border-focus transition-colors"
                  placeholder="CSS selector to wait for"
                  value={waitSelector}
                  onChange={e => setWaitSelector(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { const s = waitSelector.trim(); if (s) runCommand('wait', { selector: s }); } }}
                />
                <button
                  disabled={buttonsDisabled}
                  onClick={() => { const s = waitSelector.trim(); if (s) runCommand('wait', { selector: s }); }}
                  className="h-9 px-4 rounded-md text-sm font-medium text-text-muted hover:bg-white/5 hover:text-text transition-colors border border-border disabled:opacity-30"
                >
                  Wait
                </button>
              </div>
            </div>
          </div>

          {/* Tab Management */}
          <div className="rounded-lg border border-border bg-bg-card p-4">
            <div className="text-xs font-medium text-text-dim uppercase tracking-wider mb-3">Tabs</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              {tabActions.map(({ cmd, label, icon: Icon }) => (
                <button
                  key={cmd}
                  disabled={buttonsDisabled}
                  onClick={() => handleQuickAction(cmd)}
                  className="h-9 px-3 rounded-md text-sm font-medium text-text-muted hover:bg-white/5 hover:text-text transition-colors border border-border flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-text-dim uppercase tracking-wider shrink-0">ID</label>
                <input
                  type="number"
                  className="w-16 h-9 rounded-md border border-border bg-transparent px-3 text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-border-focus transition-colors"
                  placeholder="#"
                  min={0}
                  value={tabIdInput}
                  onChange={e => setTabIdInput(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 flex-1">
                <label className="text-xs font-medium text-text-dim uppercase tracking-wider shrink-0">URL</label>
                <input
                  type="text"
                  className="flex-1 h-9 rounded-md border border-border bg-transparent px-3 text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-border-focus transition-colors"
                  placeholder="URL for open_tab"
                  value={tabUrlInput}
                  onChange={e => setTabUrlInput(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right column: Live view */}
        <div className="flex flex-col gap-4">
          <div className="relative rounded-lg border border-border bg-bg-card overflow-hidden aspect-video">
            {liveFrameSrc ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={liveFrameSrc} alt="Live view" className="w-full h-full object-contain" />
            ) : (
              <div className="flex items-center justify-center h-full">
                <Monitor className="w-5 h-5 text-text-dim" />
              </div>
            )}
            {liveFps && (
              <div className="absolute top-2 right-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-accent/10 text-accent font-mono">
                {liveFps}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 flex flex-col min-h-[180px]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-text-dim uppercase tracking-wider">Results</span>
          <button
            onClick={() => { setResultEntries([]); isUserScrollingRef.current = false; }}
            className="text-xs text-text-dim hover:text-text transition-colors"
          >
            Clear
          </button>
        </div>
        <div
          ref={resultAreaRef}
          onScroll={handleResultScroll}
          className="flex-1 overflow-y-auto rounded-lg border border-border bg-bg p-2 min-h-[160px]"
        >
          {resultEntries.length === 0 && (
            <p className="text-text-dim text-xs text-center py-6 font-mono">Results will appear here...</p>
          )}
          <AnimatePresence mode="popLayout">
            {resultEntries.map(entry => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className="mb-1.5 last:mb-0 border border-white/[0.06] rounded-md overflow-hidden"
              >
                <div
                  className="flex items-center justify-between px-3 py-2 bg-bg-card cursor-pointer hover:bg-white/5 transition-colors"
                  onClick={() => toggleCollapse(entry.id)}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {entry.collapsed ? (
                      <ChevronRight className="w-4 h-4 text-text-dim shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-text-dim shrink-0" />
                    )}
                    <span className="text-xs text-text-dim font-mono shrink-0">{entry.ts}</span>
                    <span className="text-sm text-text truncate">{entry.label}</span>
                    {entry.type === 'pending' && (
                      <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" />
                    )}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCopyEntry(entry.id, entry.body); }}
                    className="p-1 hover:bg-white/5 rounded text-text-dim hover:text-text transition-colors shrink-0"
                    title="Copy"
                  >
                    {copiedId === entry.id ? (
                      <Check className="w-4 h-4 text-accent" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {!entry.collapsed && (
                  <div className="px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all max-h-80 overflow-y-auto text-text-muted">
                    {entry.type === 'image' ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={entry.body} alt="screenshot" className="max-w-full rounded-md" />
                    ) : entry.bodyHtml ? (
                      <div dangerouslySetInnerHTML={{ __html: entry.bodyHtml }} />
                    ) : (
                      <span className={entry.type === 'error' ? 'text-red-400' : 'text-text-muted'}>
                        {entry.body || (entry.type === 'pending' ? '' : 'OK')}
                      </span>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
