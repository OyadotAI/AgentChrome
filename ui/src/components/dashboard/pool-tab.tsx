'use client';

import { useState } from 'react';
import {
  Server, Search, Trash2, Copy, Check, Send, ChevronDown,
  Cookie, Loader2, Key
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useToast } from './toast';

export interface PoolData {
  size: number;
  browsers: {
    id: string;
    name: string;
    lastSeen: string;
    connectedAt: string;
    currentUrl?: string;
  }[];
}

export interface CookieEntry {
  domain?: string;
  name?: string;
  value?: string;
  path?: string;
  expirationDate?: number;
}

function escapeHtml(str: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return str.replace(/[&<>"']/g, c => map[c] || c);
}

function syntaxHighlightJson(json: string): string {
  return json
    .replace(/("(?:[^"\\]|\\.)*")\s*:/g, '<span style="color:#93c5fd">$1</span>:')
    .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span style="color:#86efac">$1</span>')
    .replace(/:\s*(\d+\.?\d*)/g, ': <span style="color:#fde68a">$1</span>')
    .replace(/:\s*(true|false)/g, ': <span style="color:#c4b5fd">$1</span>')
    .replace(/:\s*(null)/g, ': <span style="color:#71717a">$1</span>');
}

interface PoolTabProps {
  poolData: PoolData | null;
  cookieData: CookieEntry[];
  apiKey: string;
  sendPoolCommand: (action: string, params: Record<string, unknown>) => Promise<{
    resultHtml: string | null;
    resultText: string | null;
  }>;
  clearCookies: () => void;
  provisionFleet: (count: number) => Promise<string[]>;
  copyText: (text: string) => void;
}

export default function PoolTab({
  poolData,
  cookieData,
  apiKey,
  sendPoolCommand,
  clearCookies,
  provisionFleet,
  copyText,
}: PoolTabProps) {
  const toast = useToast();

  const [cookieSearch, setCookieSearch] = useState('');
  const [poolAction, setPoolAction] = useState('analyze');
  const [poolParams, setPoolParams] = useState('');
  const [poolResult, setPoolResult] = useState<string | null>(null);
  const [poolResultHtml, setPoolResultHtml] = useState<string | null>(null);
  const [poolCmdDisabled, setPoolCmdDisabled] = useState(false);
  const [fleetCount, setFleetCount] = useState('1');
  const [fleetKeys, setFleetKeys] = useState<string[]>([]);
  const [fleetDisabled, setFleetDisabled] = useState(false);
  const [copiedFleetKey, setCopiedFleetKey] = useState<string | null>(null);

  const handleSendPoolCommand = async () => {
    let params: Record<string, unknown> = {};
    try {
      const raw = poolParams.trim();
      if (raw) params = JSON.parse(raw);
    } catch {
      toast('Invalid JSON params', 'error');
      return;
    }

    setPoolCmdDisabled(true);
    setPoolResult('Running...');
    setPoolResultHtml(null);

    try {
      const result = await sendPoolCommand(poolAction, params);
      setPoolResultHtml(result.resultHtml);
      setPoolResult(result.resultText);
    } finally {
      setPoolCmdDisabled(false);
    }
  };

  const handleProvisionFleet = async () => {
    const count = parseInt(fleetCount, 10) || 1;
    setFleetDisabled(true);
    try {
      const keys = await provisionFleet(count);
      setFleetKeys(keys);
    } finally {
      setFleetDisabled(false);
    }
  };

  const handleCopyFleetKey = (key: string) => {
    copyText(key);
    setCopiedFleetKey(key);
    setTimeout(() => setCopiedFleetKey(null), 1500);
  };

  const filteredCookies = cookieData.filter(c => {
    if (!cookieSearch) return true;
    const q = cookieSearch.toLowerCase();
    return (c.domain || '').toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q);
  });

  const poolActions = [
    { value: 'analyze', label: 'analyze_page' },
    { value: 'navigate', label: 'navigate' },
    { value: 'screenshot', label: 'screenshot' },
    { value: 'scroll', label: 'scroll' },
    { value: 'click', label: 'click' },
    { value: 'type', label: 'type' },
    { value: 'press_key', label: 'press_key' },
    { value: 'wait', label: 'wait' },
    { value: 'list_tabs', label: 'list_tabs' },
    { value: 'open_tab', label: 'open_tab' },
    { value: 'switch_tab', label: 'switch_tab' },
    { value: 'close_tab', label: 'close_tab' },
    { value: 'read_page', label: 'read_elements' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-6 h-full overflow-y-auto"
    >
      {/* Pool Half */}
      <div className="flex flex-col gap-4">
        {/* Pool Stats */}
        <div className="rounded-lg border border-border bg-bg-card p-4">
          <div className="text-xs font-medium text-text-dim uppercase tracking-wider mb-3">Pool Status</div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="rounded-lg border border-border bg-bg p-4">
              <div className="text-xs font-medium text-text-dim uppercase tracking-wider">Pool Size</div>
              <div className="text-2xl font-bold text-text font-mono mt-1">{poolData?.size ?? 0}</div>
            </div>
            <div className="rounded-lg border border-border bg-bg p-4">
              <div className="text-xs font-medium text-text-dim uppercase tracking-wider">Online</div>
              <div className="text-2xl font-bold text-accent font-mono mt-1">{poolData?.browsers.length ?? 0}</div>
            </div>
          </div>

          {/* Browser Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-dim uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-dim uppercase tracking-wider">ID</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-dim uppercase tracking-wider hidden sm:table-cell">URL</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-text-dim uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {(!poolData || poolData.browsers.length === 0) ? (
                  <tr>
                    <td colSpan={4} className="text-center text-text-dim py-6 text-xs">
                      No browsers in pool
                    </td>
                  </tr>
                ) : (
                  poolData.browsers.map(b => (
                    <tr key={b.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3 text-text text-sm">{b.name || '--'}</td>
                      <td className="px-4 py-3 text-text-dim font-mono text-xs" title={b.id}>{b.id.slice(0, 8)}...</td>
                      <td className="px-4 py-3 text-text-dim text-xs truncate max-w-[180px] hidden sm:table-cell" title={b.currentUrl || ''}>{b.currentUrl || '--'}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-accent/10 text-accent">
                          <span className="w-2 h-2 rounded-full bg-accent mr-1.5" />
                          online
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pool Command */}
        <div className="rounded-lg border border-border bg-bg-card p-4">
          <div className="text-xs font-medium text-text-dim uppercase tracking-wider mb-3">Pool Command</div>
          <div className="flex flex-col sm:flex-row gap-2 mb-2">
            <div className="relative">
              <select
                value={poolAction}
                onChange={e => setPoolAction(e.target.value)}
                className="appearance-none h-9 rounded-md border border-border bg-transparent px-3 pr-8 text-sm text-text font-mono focus:outline-none focus:ring-1 focus:ring-border-focus transition-colors"
              >
                {poolActions.map(a => (
                  <option key={a.value} value={a.value} className="bg-bg-card text-text">{a.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-dim pointer-events-none" />
            </div>
            <input
              type="text"
              className="flex-1 h-9 rounded-md border border-border bg-transparent px-3 text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-border-focus transition-colors"
              placeholder='{"url":"https://..."}'
              value={poolParams}
              onChange={e => setPoolParams(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSendPoolCommand();
                }
              }}
            />
            <button
              disabled={poolCmdDisabled}
              onClick={handleSendPoolCommand}
              className="h-9 px-4 rounded-md bg-accent text-neutral-950 text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-30 flex items-center gap-2"
            >
              {poolCmdDisabled ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send
            </button>
          </div>
          {(poolResult !== null || poolResultHtml !== null) && (
            <div className="rounded-lg bg-bg border border-border p-4 text-sm font-mono overflow-x-auto max-h-56 overflow-y-auto whitespace-pre-wrap text-text-muted">
              {poolResultHtml ? (
                <span dangerouslySetInnerHTML={{ __html: poolResultHtml }} />
              ) : (
                poolResult
              )}
            </div>
          )}
        </div>

        {/* Fleet Provisioning */}
        <div className="rounded-lg border border-border bg-bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Key className="w-4 h-4 text-text-dim shrink-0" />
            <span className="text-xs font-medium text-text-dim uppercase tracking-wider">Fleet Key Provisioning</span>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <label className="text-xs font-medium text-text-dim uppercase tracking-wider">Count</label>
            <input
              type="number"
              className="w-16 h-9 rounded-md border border-border bg-transparent px-3 text-sm text-text font-mono focus:outline-none focus:ring-1 focus:ring-border-focus transition-colors"
              value={fleetCount}
              onChange={e => setFleetCount(e.target.value)}
              min={1}
              max={10000}
            />
            <button
              disabled={fleetDisabled}
              onClick={handleProvisionFleet}
              className="h-9 px-4 rounded-md bg-accent text-neutral-950 text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-30 flex items-center gap-2"
            >
              {fleetDisabled && <Loader2 className="w-4 h-4 animate-spin" />}
              Provision
            </button>
          </div>
          {fleetKeys.length > 0 && (
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {fleetKeys.map((key, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border border-border bg-bg px-3 py-2 group">
                  <code className="text-xs text-text-muted font-mono truncate">{key}</code>
                  <button
                    onClick={() => handleCopyFleetKey(key)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/5 rounded transition-colors text-text-dim hover:text-text"
                  >
                    {copiedFleetKey === key ? <Check className="w-4 h-4 text-accent" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cookies Half */}
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-bg-card p-4 flex-1 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Cookie className="w-4 h-4 text-text-dim shrink-0" />
              <span className="text-xs font-medium text-text-dim uppercase tracking-wider">Shared Cookies</span>
            </div>
            <button
              onClick={clearCookies}
              className="h-9 px-3 rounded-md text-sm text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              Clear All
            </button>
          </div>

          {/* Cookie Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-dim" />
            <input
              type="text"
              placeholder="Filter by domain or name..."
              value={cookieSearch}
              onChange={e => setCookieSearch(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-transparent pl-9 pr-3 text-sm text-text placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-border-focus transition-colors"
            />
          </div>

          {/* Cookie Table -- becomes card list on mobile */}
          <div className="flex-1 overflow-y-auto">
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    <th className="text-left px-4 py-3 text-xs font-medium text-text-dim uppercase tracking-wider">Domain</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-text-dim uppercase tracking-wider">Name</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-text-dim uppercase tracking-wider">Value</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-text-dim uppercase tracking-wider">Path</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-text-dim uppercase tracking-wider">Expires</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {filteredCookies.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center text-text-dim py-6 text-xs">
                        No cookies
                      </td>
                    </tr>
                  ) : (
                    filteredCookies.map((c, i) => (
                      <tr key={i} className="hover:bg-white/5 transition-colors">
                        <td className="px-4 py-3 text-text-muted text-xs font-mono" title={c.domain || ''}>{c.domain || '--'}</td>
                        <td className="px-4 py-3 text-text text-xs font-mono" title={c.name || ''}>{c.name || '--'}</td>
                        <td className="px-4 py-3 text-text-dim text-xs font-mono max-w-[140px] truncate" title={c.value || ''}>
                          {(c.value || '').slice(0, 40)}{(c.value || '').length > 40 ? '...' : ''}
                        </td>
                        <td className="px-4 py-3 text-text-dim text-xs font-mono">{c.path || '/'}</td>
                        <td className="px-4 py-3 text-text-dim text-xs font-mono">
                          {c.expirationDate ? new Date(c.expirationDate * 1000).toLocaleDateString() : 'session'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className="sm:hidden space-y-2">
              {filteredCookies.length === 0 ? (
                <p className="text-center text-text-dim py-6 text-xs">No cookies</p>
              ) : (
                filteredCookies.map((c, i) => (
                  <div key={i} className="rounded-lg border border-border bg-bg p-3 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-text font-mono">{c.name || '--'}</span>
                      <span className="text-text-dim font-mono">{c.domain || '--'}</span>
                    </div>
                    <div className="text-text-dim truncate font-mono">{(c.value || '').slice(0, 60)}</div>
                    <div className="flex items-center gap-2 mt-1 text-text-dim font-mono">
                      <span>{c.path || '/'}</span>
                      <span className="text-xs">&middot;</span>
                      <span>{c.expirationDate ? new Date(c.expirationDate * 1000).toLocaleDateString() : 'session'}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
