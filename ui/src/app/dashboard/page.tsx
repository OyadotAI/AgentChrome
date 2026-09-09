'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Monitor, Users, Activity, HelpCircle } from 'lucide-react';
import { useToast } from '@/components/dashboard/toast';
import { api, errorMessage } from '@/lib/api-client';
import { useShortcuts, type Shortcut } from '@/lib/shortcuts';

import Header from '@/components/dashboard/header';
import FleetStrip, { type FleetFilter } from '@/components/dashboard/fleet-strip';
import FleetTable from '@/components/dashboard/fleet-table';
import BrowserPanel from '@/components/dashboard/browser-panel';
import PersonasTab from '@/components/dashboard/personas-tab';
import PersonaDrawer from '@/components/dashboard/persona-drawer';
import ControlTab from '@/components/dashboard/control-tab';
import SettingsDialog from '@/components/dashboard/settings-dialog';
import Onboarding from '@/components/dashboard/onboarding';
import StartBrowser from '@/components/dashboard/start-browser';
import DesktopBanner from '@/components/dashboard/desktop-banner';
import ShortcutHelp from '@/components/dashboard/shortcut-help';
import { Confirm } from '@/components/ui/dialog';
import { loadConfig, isOyaProvider, type KeyConfig } from '@/components/dashboard/config';
import type { BrowserRow, Fleet, Persona } from '@/components/dashboard/types';

type MainTab = 'browsers' | 'personas' | 'control';

const TABS: { key: MainTab; label: string; icon: typeof Monitor }[] = [
  { key: 'browsers', label: 'Browsers', icon: Monitor },
  { key: 'personas', label: 'Personas', icon: Users },
  { key: 'control', label: 'Control', icon: Activity },
];

const NO_FILTER: FleetFilter = { health: null, provider: null, persona: null, text: '' };

/**
 * The fleet console. A thousand browsers in a table with their health, one
 * of them open on the right, and a keyboard to move between them.
 */
export default function DashboardPage() {
  const toast = useToast();

  const [apiKey, setApiKey] = useState('');
  const [tab, setTab] = useState<MainTab>('browsers');
  const [browsers, setBrowsers] = useState<BrowserRow[]>([]);
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [config, setConfig] = useState<KeyConfig | null>(null);
  const [now, setNow] = useState(Date.now());

  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FleetFilter>(NO_FILTER);
  const [openPersona, setOpenPersona] = useState<string | null>(null);

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showStart, setShowStart] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [stopIds, setStopIds] = useState<string[] | null>(null);
  const [stopping, setStopping] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const filterRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const rateRef = useRef<{ at: number; commands: number; errors: number } | null>(null);
  const [rate, setRate] = useState<{ commandsPerMin: number; errorPct: number } | null>(null);
  const hidden = useRef(false);

  // ── Data ──
  const fetchBrowsers = useCallback(async () => {
    if (!apiKey || hidden.current) return;
    try { setBrowsers(await api<BrowserRow[]>('/browsers', { key: apiKey })); } catch { setBrowsers([]); }
  }, [apiKey]);

  const fetchFleet = useCallback(async () => {
    if (!apiKey || hidden.current) return;
    try {
      const f = await api<Fleet>('/fleet', { key: apiKey });
      setFleet(f);
      const prev = rateRef.current;
      const cur = { at: Date.now(), commands: f.browsers.commands, errors: f.browsers.errors };
      if (prev && cur.at > prev.at) {
        const dc = Math.max(0, cur.commands - prev.commands), de = Math.max(0, cur.errors - prev.errors);
        const mins = (cur.at - prev.at) / 60000;
        setRate({ commandsPerMin: Math.round(dc / mins), errorPct: dc ? (de / dc) * 100 : 0 });
      }
      rateRef.current = cur;
    } catch { /* strip shows dashes */ }
  }, [apiKey]);

  const fetchPersonas = useCallback(async () => {
    if (!apiKey || hidden.current) return;
    try { setPersonas((await api<{ personas: Persona[] }>('/personas', { key: apiKey })).personas || []); } catch { /* keep last */ }
  }, [apiKey]);

  // The wizard decision is made once per key, on first load. Later refreshes
  // (after Settings, after Skip) must not re-open it.
  const decidedFor = useRef<string | null>(null);
  const fetchConfig = useCallback(async () => {
    if (!apiKey) { setConfig(null); return; }
    try {
      const cfg = await loadConfig(apiKey);
      setConfig(cfg);
      if (decidedFor.current !== apiKey) { decidedFor.current = apiKey; setShowOnboarding(!cfg.onboarded); }
    } catch { /* an invalid key already shows as an empty fleet */ }
  }, [apiKey]);

  useEffect(() => {
    const saved = localStorage.getItem('oya_api_key') || '';
    if (saved) setApiKey(saved);
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  useEffect(() => {
    if (!apiKey) return;
    fetchBrowsers(); fetchFleet(); fetchPersonas();
    const a = setInterval(fetchBrowsers, 3000);
    const b = setInterval(fetchFleet, 5000);
    const c = setInterval(fetchPersonas, 10000);
    const d = setInterval(() => setNow(Date.now()), 1000);
    const onVis = () => { hidden.current = document.hidden; if (!document.hidden) { fetchBrowsers(); fetchFleet(); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(a); clearInterval(b); clearInterval(c); clearInterval(d); document.removeEventListener('visibilitychange', onVis); };
  }, [apiKey, fetchBrowsers, fetchFleet, fetchPersonas]);

  // A browser that leaves the fleet leaves the selection too.
  useEffect(() => {
    if (selected && browsers.length && !browsers.some((b) => b.id === selected)) setSelected(null);
    if (checked.size) {
      const alive = new Set(browsers.map((b) => b.id));
      const next = new Set([...checked].filter((id) => alive.has(id)));
      if (next.size !== checked.size) setChecked(next);
    }
  }, [browsers, selected, checked]);

  // ── Actions ──
  const requestStop = useCallback((ids: string[]) => { if (ids.length) setStopIds(ids); }, []);

  const doStop = async () => {
    if (!stopIds) return;
    setStopping(true);
    try {
      const r = await api<{ stopped: number; results: { id: string; ok: boolean; sandboxRemoved: boolean | null; error?: string }[] }>(
        '/browsers/stop', { key: apiKey, method: 'POST', body: { ids: stopIds } });
      const failedSandbox = r.results.filter((x) => x.sandboxRemoved === false).length;
      toast(`Stopped ${r.stopped}${failedSandbox ? ` — ${failedSandbox} sandbox${failedSandbox > 1 ? 'es' : ''} could not be removed` : ''}`, failedSandbox ? 'error' : 'success');
      if (selected && stopIds.includes(selected)) setSelected(null);
      setChecked(new Set());
      fetchBrowsers(); fetchFleet();
    } catch (err) { toast(errorMessage(err), 'error'); }
    finally { setStopping(false); setStopIds(null); }
  };

  const moveSelection = useCallback((dir: 1 | -1) => {
    const rows = [...document.querySelectorAll<HTMLElement>('tbody [data-id]')].map((el) => el.dataset.id!);
    if (!rows.length) return;
    const i = selected ? rows.indexOf(selected) : -1;
    const next = rows[Math.min(rows.length - 1, Math.max(0, i + dir))];
    setSelected(next);
  }, [selected]);

  const showBrowsersFor = useCallback((personaId: string) => {
    const p = personas.find((x) => x.id === personaId);
    setFilter({ ...NO_FILTER, persona: p?.name || personaId });
    setOpenPersona(null);
    setTab('browsers');
  }, [personas]);

  // ── Shortcuts ──
  const shortcuts = useMemo<Shortcut[]>(() => [
    { keys: 'mod+1', label: 'Browsers', group: 'Navigate', global: true, handler: () => setTab('browsers') },
    { keys: 'mod+2', label: 'Personas', group: 'Navigate', global: true, handler: () => setTab('personas') },
    { keys: 'mod+3', label: 'Control', group: 'Navigate', global: true, handler: () => setTab('control') },
    { keys: '?', label: 'This help', group: 'Navigate', handler: () => setShowHelp(true) },
    { keys: 'n', label: 'Start a browser', group: 'Fleet', handler: () => setShowStart(true) },
    { keys: '/', label: 'Filter the fleet', group: 'Fleet', handler: () => { setTab('browsers'); filterRef.current?.focus(); } },
    { keys: 'down', label: 'Next browser', group: 'Fleet', handler: () => moveSelection(1) },
    { keys: 'up', label: 'Previous browser', group: 'Fleet', handler: () => moveSelection(-1) },
    { keys: 'j', label: 'Next browser', group: 'Fleet', handler: () => moveSelection(1) },
    { keys: 'k', label: 'Previous browser', group: 'Fleet', handler: () => moveSelection(-1) },
    { keys: 'escape', label: 'Close panel / clear', group: 'Fleet', global: true, handler: () => {
      if (showStart || showHelp || showSettings || stopIds || openPersona) return;   // the dialog handles it
      if (selected) setSelected(null); else if (checked.size) setChecked(new Set());
    } },
    { keys: 'x', label: 'Stop selected', group: 'Browser', handler: () => requestStop(checked.size ? [...checked] : selected ? [selected] : []) },
    { keys: 'l', label: 'Focus the URL bar', group: 'Browser', handler: () => urlRef.current?.focus() },
    { keys: 'r', label: 'Reload', group: 'Browser', handler: () => { if (selected) document.querySelector<HTMLButtonElement>('[title^="Reload"]')?.click(); } },
    { keys: 's', label: 'Screenshot', group: 'Browser', handler: () => { if (selected) [...document.querySelectorAll<HTMLButtonElement>('aside button')].find((b) => /Screenshot/.test(b.textContent || ''))?.click(); } },
  ], [moveSelection, requestStop, selected, checked, showStart, showHelp, showSettings, stopIds, openPersona]);

  useShortcuts(shortcuts, !!apiKey && !showOnboarding);

  // ── Derived ──
  const onboarding = showOnboarding && config && apiKey;
  const cloudProvider = !!config && isOyaProvider(config.browser_provider);
  const needsDesktop = cloudProvider && !config?.desktop_seen_at && !bannerDismissed;
  const stopTargets = stopIds ? browsers.filter((b) => stopIds.includes(b.id)) : [];
  const stopCloud = stopTargets.filter((b) => b.provider === 'oya-cloud').length;
  const providersForStart = (config?.providers || []).map((p) => ({ id: p.id, label: p.label, configured: p.configured }));

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <Header apiKey={apiKey} setApiKey={setApiKey} onOpenSettings={() => setShowSettings(true)} />

      {onboarding ? (
        <Onboarding apiKey={apiKey} config={config} onDone={() => { setShowOnboarding(false); fetchConfig(); }} />
      ) : (
        <>
          {needsDesktop && <DesktopBanner apiKey={apiKey} onDismiss={() => setBannerDismissed(true)} />}

          {/* Tabs */}
          <div className="flex items-center gap-1 border-b border-border px-4 lg:px-6">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-[13.5px] font-medium transition-colors ${
                  tab === t.key ? 'border-accent text-text' : 'border-transparent text-text-muted hover:text-text-secondary'}`}>
                <t.icon className="h-4 w-4 shrink-0" />{t.label}
              </button>
            ))}
            <button className="btn-icon ml-auto" onClick={() => setShowHelp(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
              <HelpCircle className="h-4 w-4" />
            </button>
          </div>

          {tab === 'browsers' && <FleetStrip fleet={fleet} rate={rate} filter={filter} onFilter={(n) => setFilter((f) => ({ ...f, ...n }))} />}

          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1">
              {tab === 'browsers' && (
                <FleetTable rows={browsers} selectedId={selected} onSelect={setSelected} checked={checked} onChecked={setChecked}
                  filter={filter} onFilter={(n) => setFilter((f) => ({ ...f, ...n }))} onStop={requestStop} onStart={() => setShowStart(true)}
                  filterRef={filterRef} now={now} />
              )}
              {tab === 'personas' && (
                <PersonasTab apiKey={apiKey} browsers={browsers} personas={personas} refresh={fetchPersonas}
                  openId={openPersona} onOpen={setOpenPersona} onShowBrowsers={showBrowsersFor} now={now} />
              )}
              {tab === 'control' && <div className="h-full overflow-y-auto"><ControlTab apiKey={apiKey} /></div>}
            </div>

            {tab === 'browsers' && selected && (
              <div className="fixed inset-0 z-40 flex justify-end bg-black/50 lg:static lg:z-auto lg:bg-transparent" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
                <BrowserPanel apiKey={apiKey} browserId={selected} onClose={() => setSelected(null)} onStop={requestStop}
                  onOpenPersona={setOpenPersona} urlRef={urlRef} now={now} />
              </div>
            )}
          </div>
        </>
      )}

      {/* The persona drawer can open from the browser panel too. */}
      {tab !== 'personas' && (
        <PersonaDrawer persona={personas.find((p) => p.id === openPersona) || null} onClose={() => setOpenPersona(null)} apiKey={apiKey}
          browsers={browsers} onChanged={fetchPersonas} onShowBrowsers={showBrowsersFor} now={now} />
      )}

      <StartBrowser open={showStart} onClose={() => setShowStart(false)} apiKey={apiKey} personas={personas}
        defaultProvider={config?.browser_provider || 'cdp'} providers={providersForStart}
        onStarted={() => { fetchBrowsers(); fetchFleet(); }} />

      <Confirm open={!!stopIds} onClose={() => setStopIds(null)} onConfirm={doStop} danger busy={stopping}
        title={stopTargets.length === 1 ? `Stop ${stopTargets[0].name}?` : `Stop ${stopTargets.length} browsers?`}
        confirmLabel={stopTargets.length === 1 ? 'Stop browser' : `Stop ${stopTargets.length}`}
        body={stopCloud
          ? <>{stopCloud === stopTargets.length ? 'This' : `${stopCloud} of these`} {stopCloud === 1 ? 'is a cloud browser: its sandbox is destroyed' : 'are cloud browsers: their sandboxes are destroyed'} and billing stops. Anything unsaved in the page is gone.</>
          : <>The session ends now. A CDP browser is handed back to its provider; a desktop browser just disconnects.</>} />

      <ShortcutHelp open={showHelp} onClose={() => setShowHelp(false)} shortcuts={shortcuts} />

      <SettingsDialog open={showSettings} onClose={() => { setShowSettings(false); fetchConfig(); }} apiKey={apiKey} onRerunSetup={() => setShowOnboarding(true)} />
    </div>
  );
}
