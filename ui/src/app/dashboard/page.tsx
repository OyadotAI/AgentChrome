'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Monitor, Zap, MessageSquare, Server, Wrench, LayoutGrid,
  Cookie
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiUrl, apiKeyHeaders } from '@/lib/api';
import { useAuth } from '@/components/auth-provider';
import { useToast } from '@/components/dashboard/toast';

import Header from '@/components/dashboard/header';
import BrowserList, { type BrowserInfo } from '@/components/dashboard/browser-list';
import OverviewTab from '@/components/dashboard/overview-tab';
import CommandsTab, { type ResultEntry } from '@/components/dashboard/commands-tab';
import ChatTab, { type ChatMessage } from '@/components/dashboard/chat-tab';
import McpTab from '@/components/dashboard/mcp-tab';
import PoolTab, { type PoolData, type CookieEntry } from '@/components/dashboard/pool-tab';
import SettingsDialog from '@/components/dashboard/settings-dialog';

// ── Utility ──
function escapeHtml(str: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return str.replace(/[&<>"']/g, c => map[c] || c);
}

function formatUptime(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null) return '--';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDuration(dateStr: string | undefined): string {
  if (!dateStr) return '--';
  const sec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  return formatUptime(sec);
}

function syntaxHighlightJson(json: string): string {
  return json
    .replace(/("(?:[^"\\]|\\.)*")\s*:/g, '<span style="color:#93c5fd">$1</span>:')
    .replace(/:\s*("(?:[^"\\]|\\.)*")/g, ': <span style="color:#86efac">$1</span>')
    .replace(/:\s*(\d+\.?\d*)/g, ': <span style="color:#fde68a">$1</span>')
    .replace(/:\s*(true|false)/g, ': <span style="color:#c4b5fd">$1</span>')
    .replace(/:\s*(null)/g, ': <span style="color:#71717a">$1</span>');
}

type MainTab = 'overview' | 'commands' | 'chat' | 'mcp' | 'pool';

let nextEntryId = 0;

export default function DashboardPage() {
  const { token } = useAuth();
  const toast = useToast();

  // ── State ──
  const [apiKey, setApiKey] = useState('');
  const [selectedBrowser, setSelectedBrowser] = useState<string | null>(null);
  const [browsers, setBrowsers] = useState<BrowserInfo[]>([]);
  const [currentTab, setCurrentTab] = useState<MainTab>('overview');
  const [showSettings, setShowSettings] = useState(false);

  // Stats
  const [statUptime, setStatUptime] = useState('--');
  const [statBrowsers, setStatBrowsers] = useState('0');
  const [statPool, setStatPool] = useState('--');
  const [statCookies, setStatCookies] = useState('--');

  // Overview info
  const [infoUrl, setInfoUrl] = useState('--');
  const [infoSession, setInfoSession] = useState('--');
  const [infoTabs, setInfoTabs] = useState('--');

  // Live view
  const [liveFrameSrc, setLiveFrameSrc] = useState<string | null>(null);
  const [liveFps, setLiveFps] = useState('');

  // Commands
  const [resultEntries, setResultEntries] = useState<ResultEntry[]>([]);
  const [buttonsDisabled, setButtonsDisabled] = useState(false);

  // Chat
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);

  // Pool & Cookies
  const [poolData, setPoolData] = useState<PoolData | null>(null);
  const [cookieData, setCookieData] = useState<CookieEntry[]>([]);

  // ── Refs ──
  const apiKeyRef = useRef(apiKey);
  const selectedBrowserRef = useRef(selectedBrowser);
  const currentTabRef = useRef(currentTab);
  const browsersRef = useRef(browsers);
  const pageVisibleRef = useRef(true);
  const liveEventSourceRef = useRef<EventSource | null>(null);
  const liveFrameCountRef = useRef(0);
  const liveFpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const healthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const browserTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const poolTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cookieTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep refs in sync
  useEffect(() => { apiKeyRef.current = apiKey; }, [apiKey]);
  useEffect(() => { selectedBrowserRef.current = selectedBrowser; }, [selectedBrowser]);
  useEffect(() => { currentTabRef.current = currentTab; }, [currentTab]);
  useEffect(() => { browsersRef.current = browsers; }, [browsers]);

  // ── Helpers ──
  const headers = useCallback(() => apiKeyHeaders(apiKeyRef.current), []);

  const copyText = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => toast('Copied!', 'success'));
  }, [toast]);

  // ── API: Health ──
  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/health'));
      if (!res.ok) throw new Error();
      const data = await res.json();
      setStatUptime(formatUptime(data.uptime));
      setStatBrowsers(String(data.browsers));
    } catch { /* noop */ }
  }, []);

  // ── API: Browsers ──
  const fetchBrowsers = useCallback(async () => {
    if (!apiKeyRef.current) return;
    try {
      const res = await fetch(apiUrl('/browsers'), { headers: headers() });
      if (!res.ok) { setBrowsers([]); return; }
      const data: BrowserInfo[] = await res.json();
      setStatBrowsers(String(data.length));
      setBrowsers(data);
    } catch { setBrowsers([]); }
  }, [headers]);

  // ── API: Pool ──
  const fetchPool = useCallback(async () => {
    if (!apiKeyRef.current) return;
    try {
      const res = await fetch(apiUrl('/pool'), { headers: headers() });
      if (!res.ok) return;
      const data: PoolData = await res.json();
      setPoolData(data);
      setStatPool(String(data.size));
    } catch { /* noop */ }
  }, [headers]);

  // ── API: Cookies ──
  const fetchCookies = useCallback(async () => {
    if (!apiKeyRef.current) return;
    try {
      const res = await fetch(apiUrl('/pool/cookies'), { headers: headers() });
      if (!res.ok) return;
      const data = await res.json();
      const cookies = data.cookies || [];
      setCookieData(cookies);
      setStatCookies(String(cookies.length));
    } catch { /* noop */ }
  }, [headers]);

  // ── Live View ──
  const stopLiveView = useCallback(() => {
    if (liveEventSourceRef.current) {
      liveEventSourceRef.current.close();
      liveEventSourceRef.current = null;
    }
    if (liveFpsTimerRef.current) {
      clearInterval(liveFpsTimerRef.current);
      liveFpsTimerRef.current = null;
    }
  }, []);

  const startLiveView = useCallback(() => {
    stopLiveView();
    const browserId = selectedBrowserRef.current;
    const key = apiKeyRef.current;
    if (!browserId || !key) return;

    liveFrameCountRef.current = 0;
    const url = apiUrl(`/live/${browserId}?key=${encodeURIComponent(key)}`);
    const es = new EventSource(url);
    liveEventSourceRef.current = es;

    es.onmessage = (e) => {
      setLiveFrameSrc(e.data);
      liveFrameCountRef.current++;
    };

    es.onerror = () => {
      setLiveFrameSrc(null);
      stopLiveView();
    };

    liveFpsTimerRef.current = setInterval(() => {
      setLiveFps(`${liveFrameCountRef.current} fps`);
      liveFrameCountRef.current = 0;
    }, 1000);
  }, [stopLiveView]);

  // ── Polling ──
  const stopPolling = useCallback(() => {
    if (healthTimerRef.current) { clearInterval(healthTimerRef.current); healthTimerRef.current = null; }
    if (browserTimerRef.current) { clearInterval(browserTimerRef.current); browserTimerRef.current = null; }
    if (poolTimerRef.current) { clearInterval(poolTimerRef.current); poolTimerRef.current = null; }
    if (cookieTimerRef.current) { clearInterval(cookieTimerRef.current); cookieTimerRef.current = null; }
  }, []);

  const startPoolPolling = useCallback(() => {
    if (poolTimerRef.current) clearInterval(poolTimerRef.current);
    if (cookieTimerRef.current) clearInterval(cookieTimerRef.current);
    fetchPool();
    fetchCookies();
    poolTimerRef.current = setInterval(fetchPool, 5000);
    cookieTimerRef.current = setInterval(fetchCookies, 10000);
  }, [fetchPool, fetchCookies]);

  const stopPoolPolling = useCallback(() => {
    if (poolTimerRef.current) { clearInterval(poolTimerRef.current); poolTimerRef.current = null; }
    if (cookieTimerRef.current) { clearInterval(cookieTimerRef.current); cookieTimerRef.current = null; }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    fetchHealth();
    fetchBrowsers();
    healthTimerRef.current = setInterval(fetchHealth, 5000);
    browserTimerRef.current = setInterval(fetchBrowsers, 3000);
    if (currentTabRef.current === 'pool') {
      startPoolPolling();
    }
  }, [stopPolling, fetchHealth, fetchBrowsers, startPoolPolling]);

  // ── Tab Count ──
  const fetchTabCount = useCallback(async () => {
    const browserId = selectedBrowserRef.current;
    const key = apiKeyRef.current;
    if (!browserId || !key) return;
    try {
      const res = await fetch(apiUrl(`/browsers/${browserId}/command`), {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ action: 'list_tabs', params: {} }),
      });
      const data = await res.json();
      if (data.data && Array.isArray(data.data)) {
        setInfoTabs(String(data.data.length));
      } else if (typeof data.data === 'string') {
        const count = (data.data.match(/\[tab/g) || []).length;
        setInfoTabs(count ? String(count) : '--');
      }
    } catch { /* noop */ }
  }, [headers]);

  // ── Run Command ──
  const runCommand = useCallback((action: string, params: Record<string, unknown> = {}) => {
    const browserId = selectedBrowserRef.current;
    if (!browserId) return;

    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    const paramStr = Object.keys(params).length
      ? ' ' + Object.entries(params).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
      : '';

    const entryId = nextEntryId++;
    const entry: ResultEntry = {
      id: entryId,
      label: `${action}${paramStr}`,
      ts,
      body: '',
      bodyHtml: '',
      type: 'pending',
      collapsed: false,
    };
    setResultEntries(prev => [...prev, entry]);
    setButtonsDisabled(true);

    (async () => {
      try {
        const res = await fetch(apiUrl(`/browsers/${browserId}/command`), {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ action, params }),
        });
        const data = await res.json();

        if (data.ok === false) {
          setResultEntries(prev => prev.map(e =>
            e.id === entryId ? { ...e, body: `Error: ${data.error || 'Failed'}`, bodyHtml: `<span style="color:var(--color-red)">${escapeHtml(data.error || 'Failed')}</span>`, type: 'error' as const } : e
          ));
        } else if (action === 'screenshot' && data.data?.screenshot) {
          setResultEntries(prev => prev.map(e =>
            e.id === entryId ? { ...e, body: data.data.screenshot, bodyHtml: '', type: 'image' as const } : e
          ));
        } else if (action === 'analyze' && data.data) {
          const d = data.data;
          const elements = d.elements || [];
          const vis = elements.filter((el: { visible: boolean }) => el.visible).length;
          let fullMd = d.markdown || '(empty)';
          if (elements.length > 0) {
            const visible = elements.filter((el: { visible: boolean }) => el.visible);
            const offscreen = elements.filter((el: { visible: boolean }) => !el.visible);
            fullMd += '\n\n## Element Index (' + elements.length + ' total, ' + vis + ' visible)\n';
            if (visible.length > 0) {
              fullMd += '\n### Visible\n' + visible.map((el: { id: string; type: string; text?: string; href?: string; value?: string; checked?: boolean; disabled?: boolean }) => {
                let line = '  [#' + el.id + '] ' + el.type;
                if (el.text) line += ': ' + el.text;
                if (el.href) line += ' -> ' + el.href;
                if (el.value) line += ' value="' + el.value + '"';
                if (el.checked) line += ' [checked]';
                if (el.disabled) line += ' (disabled)';
                return line;
              }).join('\n');
            }
            if (offscreen.length > 0) {
              fullMd += '\n\n### Off-screen\n' + offscreen.map((el: { id: string; type: string; text?: string; disabled?: boolean }) => {
                let line = '  [#' + el.id + '] ' + el.type;
                if (el.text) line += ': ' + el.text;
                if (el.disabled) line += ' (disabled)';
                return line;
              }).join('\n');
            }
            if (d.truncated) fullMd += '\n\n(truncated)';
          }
          setResultEntries(prev => prev.map(e =>
            e.id === entryId ? { ...e, body: fullMd, bodyHtml: '', type: 'success' as const } : e
          ));
          fetchBrowsers();
        } else {
          const text = typeof data.data === 'string' ? data.data : JSON.stringify(data.data, null, 2);
          let html = '';
          try {
            JSON.parse(text);
            html = syntaxHighlightJson(text);
          } catch { /* not JSON */ }
          setResultEntries(prev => prev.map(e =>
            e.id === entryId ? { ...e, body: text || 'OK', bodyHtml: html, type: 'success' as const } : e
          ));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setResultEntries(prev => prev.map(e =>
          e.id === entryId ? { ...e, body: msg, bodyHtml: `<span style="color:var(--color-red)">${escapeHtml(msg)}</span>`, type: 'error' as const } : e
        ));
      } finally {
        setButtonsDisabled(false);
      }
    })();
  }, [headers, fetchBrowsers]);

  // ── Chat ──
  const sendChatMessage = useCallback(async () => {
    const text = chatInput.trim();
    const browserId = selectedBrowserRef.current;
    if (!text || !browserId) return;
    setChatInput('');
    setChatSending(true);

    const userMsg: ChatMessage = { role: 'user', content: text };
    setChatHistory(prev => [...prev, userMsg]);

    try {
      const messages = [...chatHistory, userMsg].map(m => ({ role: m.role, content: m.content }));
      const res = await fetch(apiUrl(`/browsers/${browserId}/chat`), {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ messages }),
      });
      const data = await res.json();

      if (data.error) {
        setChatHistory(prev => [...prev, { role: 'assistant', content: `Error: ${data.error}` }]);
      } else {
        setChatHistory(prev => [...prev, { role: 'assistant', content: data.text, toolCalls: data.toolCalls || [] }]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setChatHistory(prev => [...prev, { role: 'assistant', content: `Error: ${msg}` }]);
    } finally {
      setChatSending(false);
    }
  }, [chatInput, chatHistory, headers]);

  // ── Pool Command ──
  const sendPoolCommand = useCallback(async (action: string, params: Record<string, unknown>) => {
    try {
      const res = await fetch(apiUrl('/pool/command'), {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ action, params }),
      });
      const data = await res.json();

      if (data.ok === false) {
        return { resultHtml: `<span style="color:var(--color-red)">${escapeHtml(data.error || 'Failed')}</span>`, resultText: null };
      } else if (action === 'screenshot' && data.data?.screenshot) {
        return {
          resultHtml: `<span style="color:var(--color-accent)">Screenshot captured (browser: ${escapeHtml(data._browser || '?')})</span><br><img src="${data.data.screenshot}" style="max-width:100%;margin-top:8px;border-radius:6px;">`,
          resultText: null
        };
      } else {
        const text = typeof data.data === 'string' ? data.data : JSON.stringify(data, null, 2);
        let html: string | null = null;
        try {
          JSON.parse(text);
          html = syntaxHighlightJson(text);
        } catch { /* not json */ }
        return { resultHtml: html, resultText: html ? null : text };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return { resultHtml: `<span style="color:var(--color-red)">${escapeHtml(msg)}</span>`, resultText: null };
    }
  }, [headers]);

  // ── Clear Cookies ──
  const clearCookies = useCallback(async () => {
    if (!confirm('Clear all shared cookies? This cannot be undone.')) return;
    try {
      const res = await fetch(apiUrl('/pool/cookies'), { method: 'DELETE', headers: headers() });
      if (res.ok) {
        setCookieData([]);
        setStatCookies('0');
        toast('Cookies cleared', 'success');
      } else {
        toast('Failed to clear cookies', 'error');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
    }
  }, [headers, toast]);

  // ── Fleet Provision ──
  const provisionFleet = useCallback(async (count: number) => {
    try {
      const res = await fetch(apiUrl(`/fleet/provision?count=${count}`), {
        method: 'POST',
        headers: headers(),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Provision failed (admin key required)', 'error');
        return [];
      }
      toast(`Provisioned ${data.count} key(s)`, 'success');
      return data.keys || [];
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
      return [];
    }
  }, [headers, toast]);

  // ── Browser Selection Side Effects ──
  useEffect(() => {
    if (selectedBrowser) {
      startLiveView();
      fetchTabCount();
      const b = browsers.find(x => x.id === selectedBrowser);
      if (b) {
        setInfoUrl(b.currentUrl || '--');
        setInfoSession(formatDuration(b.connectedAt));
      }
    } else {
      stopLiveView();
      setLiveFrameSrc(null);
      setLiveFps('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBrowser]);

  // Verify selected browser still exists
  useEffect(() => {
    if (selectedBrowser && browsers.length > 0 && !browsers.find(b => b.id === selectedBrowser)) {
      setSelectedBrowser(null);
    }
    if (selectedBrowser) {
      const b = browsers.find(x => x.id === selectedBrowser);
      if (b) {
        setInfoUrl(b.currentUrl || '--');
        setInfoSession(formatDuration(b.connectedAt));
      }
    }
  }, [browsers, selectedBrowser]);

  // ── Init: load API key from localStorage ──
  useEffect(() => {
    const savedKey = localStorage.getItem('oya_api_key') || '';
    if (savedKey) setApiKey(savedKey);
  }, []);

  // ── Start polling on mount ──
  useEffect(() => {
    startPolling();
    return () => { stopPolling(); stopLiveView(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restart polling when api key changes
  useEffect(() => {
    if (apiKey) {
      fetchBrowsers();
      if (currentTab === 'pool') {
        fetchPool();
        fetchCookies();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // ── Page Visibility ──
  useEffect(() => {
    const handler = () => {
      pageVisibleRef.current = !document.hidden;
      if (pageVisibleRef.current) {
        startPolling();
        if (selectedBrowserRef.current) startLiveView();
      } else {
        stopPolling();
        stopLiveView();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [startPolling, stopPolling, startLiveView, stopLiveView]);

  // ── Handle tab change side effects ──
  useEffect(() => {
    if (currentTab === 'pool') {
      startPoolPolling();
      stopLiveView();
    } else {
      stopPoolPolling();
      if ((currentTab === 'overview' || currentTab === 'commands') && selectedBrowser) {
        startLiveView();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTab]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const tabs: MainTab[] = ['overview', 'commands', 'chat', 'mcp', 'pool'];
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 5) {
          e.preventDefault();
          setCurrentTab(tabs[num - 1]);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // ── Tab Config ──
  const tabs: { key: MainTab; label: string; icon: typeof Monitor }[] = [
    { key: 'overview', label: 'Overview', icon: LayoutGrid },
    { key: 'commands', label: 'Commands', icon: Zap },
    { key: 'chat', label: 'Chat', icon: MessageSquare },
    { key: 'mcp', label: 'MCP', icon: Wrench },
    { key: 'pool', label: 'Pool', icon: Server },
  ];

  return (
    <div className="flex flex-col h-dvh bg-bg overflow-hidden pb-14 md:pb-0">
      {/* Header */}
      <Header
        apiKey={apiKey}
        setApiKey={setApiKey}
        onOpenSettings={() => setShowSettings(true)}
      />

      {/* Status Strip */}
      <div className="h-10 border-b border-border px-4 lg:px-6 flex items-center gap-6 text-xs text-text-dim">
        <span>Uptime <span className="text-text font-mono tabular-nums ml-1">{statUptime}</span></span>
        <span>Browsers <span className="text-text font-mono tabular-nums ml-1">{statBrowsers}</span></span>
        <span>Pool <span className="text-text font-mono tabular-nums ml-1">{statPool}</span></span>
        <span>Cookies <span className="text-text font-mono tabular-nums ml-1">{statCookies}</span></span>
      </div>

      {/* Desktop Tab Bar */}
      <div className="hidden md:flex border-b border-border px-4 lg:px-6 items-center gap-1">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setCurrentTab(tab.key)}
            className={`flex items-center gap-2 px-3 text-sm font-medium transition-colors ${
              currentTab === tab.key
                ? 'text-text border-b-2 border-accent pb-3 pt-3'
                : 'text-text-dim hover:text-text-muted pb-3 pt-3'
            }`}
          >
            <tab.icon className="w-4 h-4 shrink-0" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Browser Sidebar (desktop only, not on pool tab) */}
        {currentTab !== 'pool' && (
          <div className="hidden lg:flex w-60 border-r border-border bg-bg-card shrink-0">
            <BrowserList
              browsers={browsers}
              selectedBrowser={selectedBrowser}
              onSelect={setSelectedBrowser}
            />
          </div>
        )}

        {/* Mobile browser pills */}
        {currentTab !== 'pool' && (
          <div className="lg:hidden absolute top-auto z-10">
            {/* Rendered inside the tab content area on mobile */}
          </div>
        )}

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Mobile browser pills (rendered at top of content area) */}
          {currentTab !== 'pool' && (
            <div className="lg:hidden border-b border-border px-3 py-1.5 bg-bg-card">
              <BrowserList
                browsers={browsers}
                selectedBrowser={selectedBrowser}
                onSelect={setSelectedBrowser}
                mobile
              />
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            <AnimatePresence mode="wait">
              {currentTab === 'overview' && (
                <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                  <OverviewTab
                    selectedBrowser={selectedBrowser}
                    liveFrameSrc={liveFrameSrc}
                    liveFps={liveFps}
                    infoUrl={infoUrl}
                    infoSession={infoSession}
                    infoTabs={infoTabs}
                  />
                </motion.div>
              )}
              {currentTab === 'commands' && (
                <motion.div key="commands" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="h-full">
                  <CommandsTab
                    selectedBrowser={selectedBrowser}
                    resultEntries={resultEntries}
                    setResultEntries={setResultEntries}
                    buttonsDisabled={buttonsDisabled}
                    runCommand={runCommand}
                    liveFrameSrc={liveFrameSrc}
                    liveFps={liveFps}
                    copyText={copyText}
                  />
                </motion.div>
              )}
              {currentTab === 'chat' && (
                <motion.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="h-full">
                  <ChatTab
                    selectedBrowser={selectedBrowser}
                    chatHistory={chatHistory}
                    chatInput={chatInput}
                    setChatInput={setChatInput}
                    chatSending={chatSending}
                    onSendMessage={sendChatMessage}
                  />
                </motion.div>
              )}
              {currentTab === 'mcp' && (
                <motion.div key="mcp" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="h-full">
                  <McpTab
                    selectedBrowser={selectedBrowser}
                    apiKey={apiKey}
                  />
                </motion.div>
              )}
              {currentTab === 'pool' && (
                <motion.div key="pool" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="h-full">
                  <PoolTab
                    poolData={poolData}
                    cookieData={cookieData}
                    apiKey={apiKey}
                    sendPoolCommand={sendPoolCommand}
                    clearCookies={clearCookies}
                    provisionFleet={provisionFleet}
                    copyText={copyText}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Tab Bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-bg flex items-center justify-around h-14 md:hidden pb-[env(safe-area-inset-bottom)]">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setCurrentTab(tab.key)}
            className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-md transition-colors ${
              currentTab === tab.key
                ? 'text-text bg-white/10'
                : 'text-text-dim hover:text-text-muted'
            }`}
          >
            <tab.icon className="w-5 h-5" />
            <span className="text-xs font-medium">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Settings Dialog */}
      <SettingsDialog
        open={showSettings}
        onClose={() => setShowSettings(false)}
        apiKey={apiKey}
      />
    </div>
  );
}
