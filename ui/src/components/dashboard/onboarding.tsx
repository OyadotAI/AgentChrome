'use client';

import { useState } from 'react';
import { ArrowRight, Check, Copy, Download, Loader2, Monitor, Terminal } from 'lucide-react';
import { saveConfig, desktopSignInUrl, type KeyConfig } from './config';
import { apiOrigin } from '@/lib/api';
import { errorMessage } from '@/lib/api-client';
import { useToast } from './toast';
import type { Persona, BrowserRow } from './types';

interface Props { apiKey: string; config: KeyConfig; personas: Persona[]; browsers: BrowserRow[]; onDone: () => void }

export default function Onboarding({ apiKey, config, personas, browsers, onDone }: Props) {
  const toast = useToast();
  const [profileId, setProfileId] = useState('default');
  const [provider, setProvider] = useState(config.browser_provider || 'oya-cloud');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const profile = personas.find((p) => profileId === 'default' ? p.isDefault : p.id === profileId);
  const desktop = browsers.find((b) => b.provider === 'oya-desktop' && b.persona === profile?.id);
  const sites = profile?.login?.sites || [];
  const needs = config.providers.find((p) => p.id === provider)?.needs || [];
  const code = (key: string) => `import { Oya } from "@oya/browser";\nconst oya = new Oya({ apiKey: ${JSON.stringify(key)}, baseUrl: ${JSON.stringify(apiOrigin())} });\nconst browser = await oya.browser.start({ profile: ${JSON.stringify(profileId)}, captcha: "auto" });\nawait browser.goto("https://example.com");\nconst mfa = await browser.completeMfa();\nconsole.log(await browser.analyze());`;

  const pair = async () => {
    setBusy('pair');
    try { window.location.href = await desktopSignInUrl(apiKey, profileId); }
    catch (err) { toast(errorMessage(err), 'error'); }
    finally { setBusy(null); }
  };
  const finish = async () => {
    setBusy('save');
    try { await saveConfig(apiKey, { ...credentials, browser_provider: provider, onboarded: 'true' }); onDone(); }
    catch (err) { toast(errorMessage(err), 'error'); }
    finally { setBusy(null); }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
        <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-accent">Your browser control plane</p>
            <h1 className="font-display text-3xl tracking-tight text-text sm:text-4xl">Sign in once. Build from there.</h1>
            <p className="mt-3 max-w-xl text-sm text-text-secondary">One desktop browser saves your accounts to a profile. Start browsers with those sessions from your code.</p>
          </div>
          <button className="btn-ghost" onClick={finish} disabled={!!busy}>Go to console <ArrowRight className="h-4 w-4" /></button>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_1.12fr] lg:gap-12">
          <div className="space-y-7">
            <section>
              <div className="mb-3 flex items-center gap-3"><span className="font-mono text-xs text-accent">01</span><h2 className="text-base font-semibold">Connect your desktop</h2></div>
              <label htmlFor="setup-profile" className="label">Save accounts to</label>
              <select id="setup-profile" className="field mb-3" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                <option value="default">Default profile</option>
                {personas.filter((p) => !p.isDefault).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" onClick={pair} disabled={!!busy}>{busy === 'pair' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Monitor className="h-4 w-4" />}{desktop ? 'Open desktop' : 'Connect desktop'}</button>
                <a className="btn-ghost" href="/downloads" target="_blank" rel="noreferrer"><Download className="h-4 w-4" />Download</a>
              </div>
              <p className="mt-3 text-xs text-text-muted" role="status">{desktop ? 'Desktop connected. You can sign in now.' : 'Already installed? Connect opens your existing Oya window.'}</p>
            </section>

            <section className="border-t border-border pt-6">
              <div className="mb-3 flex items-center gap-3"><span className="font-mono text-xs text-accent">02</span><h2 className="text-base font-semibold">Sign in to your accounts</h2>{sites.length > 0 && <Check className="ml-auto h-4 w-4 text-accent" />}</div>
              <p className="text-sm text-text-secondary">Log in normally in Oya, including any CAPTCHA or MFA. Click <strong className="font-medium text-text">Save profile</strong> in the desktop toolbar when you’re done.</p>
              <div className="mt-3 rounded-md border border-border bg-bg-sunken px-4 py-3 text-sm" role="status">
                {sites.length ? <><span className="text-accent">Saved state for {sites.length} {sites.length === 1 ? 'site' : 'sites'}</span><p className="mt-1 break-words text-xs text-text-secondary">{sites.join(' · ')}</p></> : <span className="text-text-muted">Waiting for saved account sessions…</span>}
              </div>
              <p className="mt-2 text-xs text-text-muted">Cookies and local storage sync. A site may still ask you to verify a new session.</p>
            </section>

            <section className="border-t border-border pt-6">
              <div className="mb-3 flex items-center gap-3"><span className="font-mono text-xs text-accent">03</span><h2 className="text-base font-semibold">Choose where browsers run</h2></div>
              <label htmlFor="setup-provider" className="sr-only">Browser provider</label>
              <select id="setup-provider" className="field" value={provider} onChange={(e) => setProvider(e.target.value)}>
                {config.providers.map((p) => <option key={p.id} value={p.id}>{p.label}{p.configured ? ' · ready' : ' · setup needed'}</option>)}
              </select>
              {needs.map((name) => <div key={name} className="mt-3"><label className="label" htmlFor={`setup-${name}`}>{name.replace(/_/g, ' ')}</label><input id={`setup-${name}`} className="field" type="password" autoComplete="off" value={credentials[name] || ''} placeholder={config.providers.find((p) => p.id === provider)?.configured ? 'Already saved — leave blank to keep' : 'Enter credential'} onChange={(e) => setCredentials({ ...credentials, [name]: e.target.value })} /></div>)}
              <p className="mt-2 text-xs text-text-muted">CAPTCHA solver and MFA factors are optional settings in the console.</p>
              <button className="btn-primary mt-4" onClick={finish} disabled={!!busy}>{busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />}Save and open console <ArrowRight className="h-4 w-4" /></button>
            </section>
          </div>

          <aside className="min-w-0 self-start overflow-hidden rounded-lg border border-border bg-bg-sunken lg:sticky lg:top-6">
            <div className="flex items-center gap-2 border-b border-border px-5 py-4 text-sm"><Terminal className="h-4 w-4 text-accent" /><span className="font-medium">Your first browser, in six lines</span></div>
            <div className="border-b border-border px-5 py-3 font-mono text-xs text-text-muted">npm install @oya/browser</div>
            <pre className="overflow-x-auto p-5 font-mono text-xs leading-7 text-text-secondary">{code('<your-api-key>')}</pre>
            <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-4">
              <button className="btn-ghost" onClick={async () => { try { await navigator.clipboard.writeText(code(apiKey)); setCopied(true); } catch { toast('Could not copy. Select the code and copy it manually.', 'error'); } }}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? 'Copied with your key' : 'Copy with your key'}</button>
              <a className="ml-auto text-xs text-text-muted hover:text-text" href="/docs/">Read the API guide ↗</a>
            </div>
            <p className="border-t border-border px-5 py-4 text-xs leading-relaxed text-text-muted">A saved profile is reused automatically. Check the MFA result for a human handoff, and call <code>browser.stop()</code> when the job is done.</p>
          </aside>
        </div>
      </main>
    </div>
  );
}
