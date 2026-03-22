'use client';

import { useState } from 'react';
import { Search, Monitor, Globe, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface BrowserInfo {
  id: string;
  name: string;
  lastSeen: string;
  connectedAt: string;
  currentUrl?: string;
}

interface BrowserListProps {
  browsers: BrowserInfo[];
  selectedBrowser: string | null;
  onSelect: (id: string) => void;
  className?: string;
  /** Mobile mode: horizontal pills instead of vertical list */
  mobile?: boolean;
}

function timeSince(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return sec + 's ago';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
  return Math.floor(sec / 86400) + 'd ago';
}

function formatDuration(dateStr: string | undefined): string {
  if (!dateStr) return '--';
  const sec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d`;
}

export default function BrowserList({ browsers, selectedBrowser, onSelect, className = '', mobile }: BrowserListProps) {
  const [search, setSearch] = useState('');
  const filtered = browsers.filter(b => {
    if (!search) return true;
    const q = search.toLowerCase();
    return b.name.toLowerCase().includes(q) || b.id.toLowerCase().includes(q);
  });

  if (mobile) {
    return (
      <div className={`flex gap-1.5 overflow-x-auto scrollbar-none ${className}`}>
        {browsers.length === 0 && (
          <div className="text-text-dim text-xs whitespace-nowrap px-3 py-2">No browsers connected</div>
        )}
        {browsers.map(b => (
          <button
            key={b.id}
            onClick={() => onSelect(b.id)}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              b.id === selectedBrowser
                ? 'bg-white/10 text-text'
                : 'text-text-muted hover:bg-white/5 hover:text-text'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-accent" />
            {b.name}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full w-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-dim uppercase tracking-wider">Browsers</span>
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-white/10 text-text-muted">
            {browsers.length}
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-dim" />
          <input
            type="text"
            placeholder="Filter..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-transparent pl-8 pr-8 text-sm text-text placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-border-focus transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-dim hover:text-text transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2">
        <AnimatePresence mode="popLayout">
          {filtered.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-10 px-3 text-center"
            >
              <Monitor className="w-5 h-5 text-text-dim mb-2" />
              <p className="text-sm text-text-dim font-medium">No browsers connected</p>
              <p className="text-xs text-text-dim mt-1">
                Install the extension and open Chrome
              </p>
            </motion.div>
          ) : (
            filtered.map(b => (
              <motion.div
                key={b.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.12 }}
              >
                <button
                  onClick={() => onSelect(b.id)}
                  className={`w-full text-left rounded-md mb-0.5 transition-colors ${
                    b.id === selectedBrowser
                      ? 'flex items-start gap-3 px-3 py-2 bg-white/10 text-text'
                      : 'flex items-start gap-3 px-3 py-2 text-text-muted hover:bg-white/5 hover:text-text'
                  }`}
                >
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
                      <span className="text-sm font-medium text-text truncate">{b.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 ml-4">
                      <span className="text-xs text-text-dim font-mono">{b.id.slice(0, 8)}</span>
                      <span className="text-text-dim text-xs">&middot;</span>
                      <span className="text-xs text-text-dim">{timeSince(new Date(b.lastSeen))}</span>
                      <span className="text-text-dim text-xs">&middot;</span>
                      <span className="text-xs text-text-dim">up {formatDuration(b.connectedAt)}</span>
                    </div>
                    {b.currentUrl && (
                      <div className="flex items-center gap-1 mt-0.5 ml-4">
                        <Globe className="w-3 h-3 text-text-dim shrink-0" />
                        <span className="text-xs text-text-dim truncate">{b.currentUrl}</span>
                      </div>
                    )}
                  </div>
                </button>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
