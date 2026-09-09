'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Monitor, Users, Activity, Plus, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiUrl, apiKeyHeaders } from '@/lib/api';
import { useToast } from '@/components/dashboard/toast';

import Header from '@/components/dashboard/header';
import BrowserList, { type BrowserInfo } from '@/components/dashboard/browser-list';
import OverviewTab from '@/components/dashboard/overview-tab';
import PersonasTab from '@/components/dashboard/personas-tab';
import ControlTab from '@/components/dashboard/control-tab';
import SettingsDialog from '@/components/dashboard/settings-dialog';
import Onboarding from '@/components/dashboard/onboarding';
import { loadConfig, type KeyConfig } from '@/components/dashboard/config';

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
  return formatUptime(Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000));
}

type MainTab = 'browsers' | 'personas' | 'control';

const TABS: { key: MainTab; label: string; icon: typeof Monitor }[] = [
  { key: 'browsers', label: 'Browsers', icon: Monitor },
  { key: 'personas', label: 'Personas', icon: Users },
  { key: 'control', label: 'Control', icon: Activity },
];

export default function DashboardPage() {
  const toast = useToast();

  const [apiKey, setApiKey] = useState('');
  const [selectedBrowser, setSelectedBrowser] = useState<string | null>(null);
  const [browsers, setBrowsers] = useState<BrowserInfo[]>([]);
  const [currentTab, setCurrentTab] = useState<MainTab>('browsers');
  const [showSettings, setShowSettings] = useState(false);

  const [config, setConfig] = useState<KeyConfig | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const [statUptime, setStatUptime] = useState('--');
  const [starting, setStarting] = useState(false);

  const [infoUrl, setInfoUrl] = useState('--');
  const [infoSession, setInfoSession] = useState('--');
  const [infoTabs, setInfoTabs] = useState('--');

  const [liveFrameSrc, setLiveFrameSrc] = useState<string | null>(null);
  const [liveFps, setLiveFps] = useState('');

  const apiKeyRef = useRef(apiKey);
  const selectedBrowserRef = useRef(selectedBrowser);
  const liveEventSourceRef = useRef<EventSource | null>(null);
  const liveFrameCountRef = useRef(0);
  const liveFpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const healthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const browserTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { apiKeyRef.current = apiKey; }, [apiKey]);
  useEffect(() => { selectedBrowserRef.current = selectedBrowser; }, [selectedBrowser]);

  const headers = useCallback(() => apiKeyHeaders(apiKeyRef.current), []);

  // ── Data ──
  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/health'));
      if (!res.ok) return;
      setStatUptime(formatUptime((await res.json()).uptime));
    } catch { /* the poll will retry */ }
  }, []);

  const fetchBrowsers = useCallback(async () => {
    if (!apiKeyRef.current) return;
    try {
      const res = await fetch(apiUrl('/browsers'), { headers: headers() });
      if (!res.ok) { setBrowsers([]); return; }
      setBrowsers(await res.json());
    } catch { setBrowsers([]); }
  }, [headers]);

  // First run: a key that has never been through setup gets the wizard.
  useEffect(() => {
    if (!apiKey) { setConfig(null); return; }
    let cancelled = false;
    loadConfig(apiKey)
      .then((cfg) => {
        if (cancelled) return;
        setConfig(cfg);
        setShowOnboarding(!cfg.onboarded);
      })
      .catch(() => { /* an invalid key already shows as an empty browser list */ });
    return () => { cancelled = true; };
  }, [apiKey]);

  // ── Start a browser ──
  const startBrowser = useCallback(async () => {
    setStarting(true);
    try {
      const res = await fetch(apiUrl('/browsers/start'), {
        method: 'POST', headers: headers(), body: JSON.stringify({ persona: 'default' }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not start a browser');
      toast(body.status === 'starting' ? 'Starting — it will appear shortly' : 'Browser ready', 'success');
      fetchBrowsers();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
    } finally { setStarting(false); }
  }, [headers, toast, fetchBrowsers]);

  // ── Live view ──
  const stopLiveView = useCallback(() => {
    liveEventSourceRef.current?.close();
    liveEventSourceRef.current = null;
    if (liveFpsTimerRef.current) { clearInterval(liveFpsTimerRef.current); liveFpsTimerRef.current = null; }
  }, []);

  const startLiveView = useCallback(() => {
    stopLiveView();
    const browserId = selectedBrowserRef.current;
    const key = apiKeyRef.current;
    if (!browserId || !key) return;

    liveFrameCountRef.current = 0;
    const es = new EventSource(apiUrl(`/live/${browserId}?key=${encodeURIComponent(key)}`));
    liveEventSourceRef.current = es;
    es.onmessage = (e) => { setLiveFrameSrc(e.data); liveFrameCountRef.current++; };
    es.onerror = () => { setLiveFrameSrc(null); stopLiveView(); };

    liveFpsTimerRef.current = setInterval(() => {
      setLiveFps(`${liveFrameCountRef.current} fps`);
      liveFrameCountRef.current = 0;
    }, 1000);
  }, [stopLiveView]);

  const fetchTabCount = useCallback(async () => {
    const browserId = selectedBrowserRef.current;
    if (!browserId || !apiKeyRef.current) return;
    try {
      const res = await fetch(apiUrl(`/browsers/${browserId}/command`), {
        method: 'POST', headers: headers(), body: JSON.stringify({ action: 'list_tabs', params: {} }),
      });
      const data = await res.json();
      const tabs = data?.data?.tabs;
      setInfoTabs(Array.isArray(tabs) ? String(tabs.length) : '--');
    } catch { /* a browser that cannot list tabs just shows -- */ }
  }, [headers]);

  // ── Polling ──
  const stopPolling = useCallback(() => {
    if (healthTimerRef.current) { clearInterval(healthTimerRef.current); healthTimerRef.current = null; }
    if (browserTimerRef.current) { clearInterval(browserTimerRef.current); browserTimerRef.current = null; }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    fetchHealth();
    fetchBrowsers();
    healthTimerRef.current = setInterval(fetchHealth, 5000);
    browserTimerRef.current = setInterval(fetchBrowsers, 3000);
  }, [stopPolling, fetchHealth, fetchBrowsers]);

  useEffect(() => {
    startPolling();
    return () => { stopPolling(); stopLiveView(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (apiKey) fetchBrowsers(); }, [apiKey, fetchBrowsers]);

  useEffect(() => {
    const savedKey = localStorage.getItem('oya_api_key') || '';
    if (savedKey) setApiKey(savedKey);
  }, []);

  useEffect(() => {
    if (selectedBrowser) { startLiveView(); fetchTabCount(); }
    else { stopLiveView(); setLiveFrameSrc(null); setLiveFps(''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBrowser]);

  // Keep the selection honest: a browser that goes away must not stay selected.
  useEffect(() => {
    if (selectedBrowser && browsers.length && !browsers.find((b) => b.id === selectedBrowser)) {
      setSelectedBrowser(null);
      return;
    }
    const b = browsers.find((x) => x.id === selectedBrowser);
    if (b) { setInfoUrl(b.currentUrl || '--'); setInfoSession(formatDuration(b.connectedAt)); }
  }, [browsers, selectedBrowser]);

  // Live views and polls are pointless in a hidden tab, and expensive at fleet scale.
  useEffect(() => {
    const handler = () => {
      if (!document.hidden) {
        startPolling();
        if (selectedBrowserRef.current && currentTab === 'browsers') startLiveView();
      } else { stopPolling(); stopLiveView(); }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [startPolling, stopPolling, startLiveView, stopLiveView, currentTab]);

  useEffect(() => {
    if (currentTab === 'browsers' && selectedBrowser) startLiveView();
    else stopLiveView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTab]);

  const onboarding = showOnboarding && config && apiKey;

  return (
    <div className="flex flex-col h-dvh bg-bg overflow-hidden pb-14 md:pb-0">
      <Header apiKey={apiKey} setApiKey={setApiKey} onOpenSettings={() => setShowSettings(true)} />

      <div className="h-10 border-b border-border px-4 lg:px-6 flex items-center gap-6 text-xs text-text-dim">
        <span>Uptime <span className="text-text font-mono tabular-nums ml-1">{statUptime}</span></span>
        <span>Browsers <span className="text-text font-mono tabular-nums ml-1">{browsers.length}</span></span>
        {config && (
          <span className="truncate">
            Provider <span className="text-text font-mono ml-1">{config.browser_provider || 'cdp'}</span>
          </span>
        )}
      </div>

      {onboarding ? (
        <Onboarding
          apiKey={apiKey}
          config={config}
          onDone={() => { setShowOnboarding(false); loadConfig(apiKey).then(setConfig).catch(() => {}); }}
        />
      ) : (
        <>
          <div className="hidden md:flex border-b border-border px-4 lg:px-6 items-center gap-1">
            {TABS.map((tab) => (
              <button key={tab.key} onClick={() => setCurrentTab(tab.key)}
                className={`flex items-center gap-2 px-3 py-3 text-sm font-medium transition-colors ${
                  currentTab === tab.key ? 'text-text border-b-2 border-accent' : 'text-text-dim hover:text-text-muted'}`}>
                <tab.icon className="w-4 h-4 shrink-0" />
                {tab.label}
              </button>
            ))}
            <button onClick={startBrowser} disabled={starting || !apiKey}
              className="ml-auto my-1.5 inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-black disabled:opacity-60">
              {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Start browser
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {currentTab === 'browsers' && (
              <div className="hidden lg:flex w-60 border-r border-border bg-bg-card shrink-0">
                <BrowserList browsers={browsers} selectedBrowser={selectedBrowser} onSelect={setSelectedBrowser} />
              </div>
            )}

            <div className="flex-1 overflow-hidden flex flex-col">
              {currentTab === 'browsers' && (
                <div className="lg:hidden border-b border-border px-3 py-1.5 bg-bg-card">
                  <BrowserList browsers={browsers} selectedBrowser={selectedBrowser} onSelect={setSelectedBrowser} mobile />
                </div>
              )}

              <div className="flex-1 overflow-y-auto">
                <AnimatePresence mode="wait">
                  {currentTab === 'browsers' && (
                    <motion.div key="browsers" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
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
                  {currentTab === 'personas' && (
                    <motion.div key="personas" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="h-full">
                      <PersonasTab apiKey={apiKey} />
                    </motion.div>
                  )}
                  {currentTab === 'control' && (
                    <motion.div key="control" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="h-full">
                      <ControlTab apiKey={apiKey} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Mobile tab bar */}
          <div className="md:hidden fixed bottom-0 inset-x-0 h-14 border-t border-border bg-bg-card flex">
            {TABS.map((tab) => (
              <button key={tab.key} onClick={() => setCurrentTab(tab.key)}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-xs ${
                  currentTab === tab.key ? 'text-accent' : 'text-text-dim'}`}>
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </>
      )}

      <SettingsDialog
        open={showSettings}
        onClose={() => { setShowSettings(false); if (apiKey) loadConfig(apiKey).then(setConfig).catch(() => {}); }}
        apiKey={apiKey}
        onRerunSetup={() => setShowOnboarding(true)}
      />
    </div>
  );
}
