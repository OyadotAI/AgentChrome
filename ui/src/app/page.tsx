'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth-provider';
import {
  ArrowRight,
  Globe,
  Terminal,
  Monitor,
  MousePointer,
  Type,
  Keyboard,
  Camera,
  ArrowDown,
  Layout,
  Layers,
  X,
  Clock,
  Menu,
  Copy,
  Check,
  Shield,
  Fingerprint,
  UserPlus,
  RefreshCw,
  Lock,
} from 'lucide-react';

/* ─── Copy button ─── */
function CopyBtn({ text }: { text: string; variant?: 'default' | 'dark' }) {
  const [copied, setCopied] = useState(false);
  const base = 'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200';
  const colors =
    'text-text-muted hover:text-text border-border hover:border-accent/35 bg-bg-card hover:bg-bg-elevated';

  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className={`${base} ${colors}`}
    >
      {copied
        ? <><Check className="w-3 h-3 inline mr-1.5 align-middle text-accent" />Copied</>
        : <><Copy className="w-3 h-3 inline mr-1.5 align-middle" />Copy</>
      }
    </button>
  );
}

/* ─── Tools data ─── */
const tools = [
  { name: 'analyze_page', desc: 'Full page as structured markdown with numbered elements', icon: Layout },
  { name: 'navigate', desc: 'Navigate to any URL in the active tab', icon: Globe },
  { name: 'click', desc: 'Click any element by its number', icon: MousePointer },
  { name: 'type', desc: 'Type text into inputs and textareas', icon: Type },
  { name: 'press_key', desc: 'Send keyboard shortcuts and key combos', icon: Keyboard },
  { name: 'screenshot', desc: 'Capture full-page PNG screenshot', icon: Camera },
  { name: 'scroll', desc: 'Scroll up, down, or to elements', icon: ArrowDown },
  { name: 'open_tab', desc: 'Open a new browser tab', icon: Layers },
  { name: 'switch_tab', desc: 'Switch between open tabs', icon: Monitor },
  { name: 'list_tabs', desc: 'List all open browser tabs', icon: Terminal },
  { name: 'close_tab', desc: 'Close a specific tab', icon: X },
  { name: 'wait', desc: 'Wait for page loads and transitions', icon: Clock },
  { name: 'list_profiles', desc: 'List available anonymity profiles', icon: Fingerprint },
  { name: 'create_profile', desc: 'Create a new randomized fingerprint profile', icon: UserPlus },
  { name: 'set_profile', desc: 'Switch fingerprint, proxy, and cookie store', icon: RefreshCw },
];

/* ─── MCP config strings ─── */
/* ─── Terminal / code block ─── */
function CodeBlock({
  children,
  copyText,
  title,
}: {
  children: React.ReactNode;
  copyText?: string;
  title?: string;
}) {
  return (
    <div className="rounded-xl overflow-hidden border border-border bg-bg-card shadow-[var(--shadow-card)]">
      {/* Title bar */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border bg-bg-elevated/50">
        <div className="flex items-center gap-1.5">
          <span className="w-[9px] h-[9px] rounded-full bg-red/90" />
          <span className="w-[9px] h-[9px] rounded-full bg-accent" />
          <span className="w-[9px] h-[9px] rounded-full bg-indigo" />
        </div>
        <div className="flex items-center gap-3">
          {title && (
            <span className="text-[11px] text-text-dim font-mono tracking-tight">
              {title}
            </span>
          )}
          {copyText && <CopyBtn text={copyText} />}
        </div>
      </div>
      {/* Content */}
      <pre className="px-5 py-4 font-mono text-[12px] leading-[1.85] overflow-x-auto text-text-muted">
        {children}
      </pre>
    </div>
  );
}

/* ─── Use it from: SDK · CLI · Agents ─── */
const SNIPPETS: { id: string; label: string; title: string; code: string }[] = [
  {
    id: 'sdk', label: 'TypeScript', title: 'checkout.ts',
    code: `const browser = await oya.browser.start({ persona: "acme-ops" });
await browser.goto("https://shop.example/cart");

const page = await browser.analyze();      // markdown + numbered elements
await browser.click(13);                   // "Checkout"
await browser.type(9, "hello@example.com");
await browser.pressKey("Enter");

await browser.solveCaptcha();              // { solved, method }
await browser.completeMfa();               // TOTP · email · SMS · handoff
await browser.close();`,
  },
  {
    id: 'cli', label: 'CLI', title: 'terminal',
    code: `$ oya init                     # model · provider · solver · desktop sign-in
$ oya personas new acme-ops    # one device, chosen once
$ oya start --persona acme-ops
$ oya goto https://shop.example/cart
$ oya ask "add the first item to the cart and check out"
$ oya ls
$ oya rm --all`,
  },
  {
    id: 'mcp', label: 'Agents (MCP)', title: 'mcp.json',
    code: `{
  "mcpServers": {
    "oya-browser": {
      "url": "https://browser.getoya.ai/mcp/pool",
      "headers": { "Authorization": "Bearer <api-key>" }
    }
  }
}

// Claude, Cursor, Windsurf: analyze_page → click(13) → type(9, …)
// The pool hands each call to the next healthy browser.`,
  },
];

function UseItFrom() {
  const [active, setActive] = useState('sdk');
  const s = SNIPPETS.find((x) => x.id === active)!;
  return (
    <section className="py-12 sm:py-14 border-t border-border/80">
      <SectionLabel>Use it from</SectionLabel>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight text-text">
          Code, terminal, or an agent
        </h2>
        <div className="inline-flex rounded-lg border border-border p-1 bg-bg-card/70" role="tablist">
          {SNIPPETS.map((x) => (
            <button key={x.id} role="tab" aria-selected={active === x.id} onClick={() => setActive(x.id)}
              className={`px-3.5 py-1.5 rounded-md text-[13px] font-medium transition-colors ${active === x.id ? 'bg-accent/15 text-text' : 'text-text-muted hover:text-text'}`}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
      <CodeBlock title={s.title} copyText={s.code}>{s.code}</CodeBlock>
    </section>
  );
}

/* ─── Section label (small caps pill above headings) ─── */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent mb-3 font-mono">
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════ */
export default function Home() {
  const { user, loading } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen text-text font-sans antialiased relative">
      <div className="pointer-events-none fixed inset-0 landing-grid opacity-50 z-0" aria-hidden />
      <div className="relative z-10">
      {/* ─── NAV ─── */}
      <nav className="sticky top-0 z-50 border-b border-border/70 bg-bg/65 backdrop-blur-xl supports-[backdrop-filter]:bg-bg/45">
        <div className="max-w-5xl mx-auto px-6 h-[3.75rem] flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative w-9 h-9 rounded-lg bg-bg-card border border-border flex items-center justify-center shadow-[var(--shadow-card)] group-hover:border-accent/35 transition-colors">
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent shadow-[0_0_12px_rgba(57,237,53,0.55)]" />
              <Globe className="w-4 h-4 text-indigo" />
            </div>
            <span className="font-display text-[17px] font-bold tracking-tight">
              Oya <span className="text-text-muted font-medium">Browser</span>
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-1">
            <a href="#self-host" className="px-3 py-2 text-sm font-medium text-text-muted hover:text-text rounded-lg hover:bg-bg-card/80 transition-colors">
              Self-host
            </a>
            <a href="#download" className="px-3 py-2 text-sm font-medium text-text-muted hover:text-text rounded-lg hover:bg-bg-card/80 transition-colors">
              Desktop
            </a>
            <Link href="/docs" className="px-3 py-2 text-sm font-medium text-text-muted hover:text-text rounded-lg hover:bg-bg-card/80 transition-colors">
              Docs
            </Link>
            <Link
              href={user ? '/dashboard' : '/login'}
              className="ml-2 px-4 py-2 text-[13px] font-semibold rounded-lg bg-accent text-accent-foreground hover:bg-accent-hover shadow-[0_0_24px_-4px_rgba(57,237,53,0.35)]"
            >
              {loading ? '' : 'Dashboard'}
            </Link>
          </div>

          <button type="button" className="md:hidden p-2 -mr-2 text-text-muted hover:text-text rounded-lg" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen}>
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-border bg-bg-card/95 backdrop-blur-md p-3 space-y-0.5">
            <a href="#self-host" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm text-text-muted hover:text-text rounded-lg hover:bg-bg-elevated">
              Self-host
            </a>
            <a href="#download" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm text-text-muted hover:text-text rounded-lg hover:bg-bg-elevated">
              Desktop
            </a>
            <Link href="/docs" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm text-text-muted hover:text-text rounded-lg hover:bg-bg-elevated">
              Docs
            </Link>
            <Link
              href={user ? '/dashboard' : '/login'}
              onClick={() => setMenuOpen(false)}
              className="block px-4 py-2.5 text-sm font-semibold text-accent"
            >
              Dashboard
            </Link>
          </div>
        )}
      </nav>

      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-6">

          {/* ─── HERO ─── */}
          <section className="pt-14 sm:pt-20 pb-12 sm:pb-14">
            <div className="grid lg:grid-cols-12 gap-10 items-start">
              <div className="lg:col-span-7">
                <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-indigo mb-4">
                  One API · Every browser provider · Every identity
                </p>
                <h1 className="font-display text-[2.5rem] sm:text-[3.25rem] lg:text-[3.5rem] font-bold tracking-tight leading-[1.05] mb-5">
                  <span className="text-text">The OpenRouter</span>
                  <br />
                  <span className="text-accent">for browsers.</span>
                </h1>
                <p className="text-[17px] text-text-muted leading-relaxed max-w-xl mb-7">
                  One control plane in front of Oya Cloud, Browserbase, Steel, Anchor, Browser Use and
                  your own Chrome. Your agents get thousands of browsers, each a stable identity with its
                  own logins and exit IP, with CAPTCHA and MFA handled — and the provider is a setting,
                  not a rewrite.
                </p>
                <div className="flex flex-wrap gap-3 mb-2">
                  <Link href={user ? '/dashboard' : '/login'}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent text-accent-foreground text-[15px] font-semibold hover:bg-accent-hover shadow-[0_0_28px_-6px_rgba(57,237,53,0.4)]">
                    Open the console <ArrowRight className="w-4 h-4" />
                  </Link>
                  <Link href="/docs"
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-border bg-bg-card/60 text-text text-[15px] font-semibold hover:border-accent/30 hover:bg-bg-elevated/80 backdrop-blur-sm">
                    Read the docs
                  </Link>
                </div>
              </div>
              <div className="lg:col-span-5">
                <CodeBlock title="agent.ts" copyText={`import { Oya } from "@oya/browser";

const oya = new Oya();
const browser = await oya.browser.start({ persona: "auto", captcha: "auto" });
await browser.goto("https://example.com");`}>
{`import { Oya } from "@oya/browser";

const oya = new Oya();
const browser = await oya.browser.start({
  persona: "auto",   // a stable identity, rotated
  captcha: "auto",   // cleared as they appear
});
await browser.goto("https://example.com");`}
                </CodeBlock>
                <p className="mt-3 text-[12.5px] text-text-dim">
                  That is the whole surface. Which provider ran it is configuration on your API key.
                </p>
              </div>
            </div>

            {/* Providers */}
            <div className="mt-10 flex flex-wrap items-center gap-x-2 gap-y-2 text-[12.5px]">
              <span className="text-text-dim mr-1 font-mono uppercase tracking-[0.18em] text-[10px]">Runs on</span>
              {[
                ['Oya Cloud', 'fully managed'],
                ['Oya self-hosted', ''],
                ['Browserbase', ''],
                ['Steel', ''],
                ['Anchor', ''],
                ['Browser Use', ''],
                ['Your own Chrome', 'any CDP endpoint'],
              ].map(([name, note]) => (
                <span key={name} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-card/70 px-2.5 py-1 text-text-secondary">
                  {name}{note && <span className="text-text-dim">· {note}</span>}
                </span>
              ))}
            </div>
          </section>

          {/* ─── USE IT FROM ─── */}
          <UseItFrom />

          {/* ─── WHY A CONTROL PLANE ─── */}
          <section className="py-12 sm:py-14 border-t border-border/80">
            <SectionLabel>Why a control plane</SectionLabel>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight mb-8 text-text">
              Providers give you a browser. Oya gives you a fleet.
            </h2>
            <div className="grid md:grid-cols-3 gap-4">
              {[
                {
                  icon: Layers, title: 'One API, any provider',
                  body: 'Start on Oya Cloud, move to Browserbase for a region, fall back to your own Chrome — in Settings, not in code. Routing, profiles and recording travel with you, and the CDP URL you hand Playwright is ours, not the vendor\'s.',
                },
                {
                  icon: Fingerprint, title: 'Identities, not sessions',
                  body: 'A persona is a fingerprint, a cookie jar and an exit IP bound together and stable for its life. Rotation means choosing a different persona — never a new device under an old login, which is the tell that gets accounts flagged.',
                },
                {
                  icon: Monitor, title: 'A console built for a thousand',
                  body: 'Every browser with its health, persona, provider and current page in one table. Pick one: watch it live, see every command it ran, take the keyboard, stop it. Sandboxes actually die when you say stop.',
                },
              ].map((c) => (
                <div key={c.title} className="rounded-2xl border border-border bg-bg-card/80 p-6 hover:border-accent/30 transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-green-surface border border-green-border flex items-center justify-center mb-4">
                    <c.icon className="w-5 h-5 text-accent" />
                  </div>
                  <h3 className="text-[16px] font-bold text-text mb-2">{c.title}</h3>
                  <p className="text-[13.5px] text-text-muted leading-relaxed">{c.body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ─── WHAT YOU GET, WHATEVER RUNS THE BROWSER ─── */}
          <section className="py-12 sm:py-14 border-t border-border/80">
            <SectionLabel>On top of every provider</SectionLabel>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight mb-3 text-text">
              The same API, whatever is underneath
            </h2>
            <p className="text-text-muted mb-6 leading-relaxed text-[15px] max-w-2xl">
              Browserbase, Steel, Anchor and Browser Use each sell a browser. Oya sits above them and adds
              what a fleet needs — and does not double-patch what they already do well.
            </p>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-[13.5px]">
                <thead className="bg-bg-elevated/50 text-left text-[11px] uppercase tracking-[0.12em] text-text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">With Oya in front</th>
                    <th className="px-4 py-3 font-medium">On any provider</th>
                    <th className="px-4 py-3 font-medium">On Oya Cloud</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {[
                    ['One SDK, CLI and MCP surface; switch provider in Settings', '✓', '✓'],
                    ['Personas: stable fingerprint + cookie jar + exit IP, with a concurrency cap', '✓', '✓'],
                    ['Sign in once on your desktop; every browser inherits the logins', '—', '✓'],
                    ['CAPTCHA: provider-native where it exists, your solver elsewhere', '✓', '✓'],
                    ['MFA: TOTP, email and SMS codes, or a human handoff link', '✓', '✓'],
                    ['Fleet console: health, activity, live control, one-click stop', '✓', '✓'],
                    ['Stealth measured against real detectors — never layered on a vendor\'s own', 'theirs', 'ours'],
                    ['Per-key usage, audit trail, quotas, Prometheus metrics', '✓', '✓'],
                    ['Fully managed browsers that stop billing when you stop them', '—', '✓'],
                    ['Self-host the whole control plane with docker compose', '✓', '✓'],
                  ].map(([what, any, oya]) => (
                    <tr key={what} className="hover:bg-text/[0.02]">
                      <td className="px-4 py-2.5 text-text-secondary">{what}</td>
                      <td className={`px-4 py-2.5 num ${any === '✓' ? 'text-accent' : 'text-text-dim'}`}>{any}</td>
                      <td className={`px-4 py-2.5 num ${oya === '✓' || oya === 'ours' ? 'text-accent' : 'text-text-dim'}`}>{oya}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ─── SELF-HOST ─── */}
          <section id="self-host" className="py-12 sm:py-14 border-t border-border/80 scroll-mt-20">
            <SectionLabel>Self-host</SectionLabel>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight mb-3 text-text">
              Up in two commands. Configured from the dashboard.
            </h2>
            <p className="text-text-muted mb-6 leading-relaxed text-[15px] max-w-2xl">
              Nothing hides in an environment variable. The API key you create is the identity for
              everything — browsers, personas, cookies, settings, usage — and onboarding asks for your
              model, your provider and your solver, once.
            </p>
            <div className="grid md:grid-cols-2 gap-4">
              <CodeBlock title="terminal" copyText={`git clone https://github.com/oyadotai/oya-browser && cd oya-browser
docker compose up
# open http://localhost:3100, create an API key, walk through onboarding`}>
{`$ git clone https://github.com/oyadotai/oya-browser
$ cd oya-browser && docker compose up

# open http://localhost:3100
# create an API key → onboarding: model, provider, solver`}
              </CodeBlock>
              <CodeBlock title="terminal" copyText={`npm i -g @oya/browser oya
oya login --url http://localhost:3100
oya start && oya goto https://example.com
oya ls`}>
{`$ npm i -g @oya/browser oya
$ oya login --url http://localhost:3100
$ oya start && oya goto https://example.com
$ oya ls

40ab25d1…  cdp   Default   checkout-worker`}
              </CodeBlock>
            </div>
            <p className="mt-4 text-[12.5px] text-text-dim">
              Personas, settings and the secret that seals credentials live in a data volume; add Supabase for a database, or don&apos;t.
            </p>
          </section>

          {/* ─── PERSONAS ─── */}
          <section id="anonymity" className="py-12 sm:py-14 border-t border-border/80 scroll-mt-20">
            <SectionLabel>Personas</SectionLabel>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight mb-4 text-text">
              One persona is one device
            </h2>
            <p className="text-text-muted mb-6 leading-relaxed text-[15px] max-w-2xl">
              A persona is a fingerprint, a cookie jar and a proxy, bound together and stable for its
              life. That binding is the point: one account seen from many devices reads as a bot farm,
              and one device across many accounts reads as a device farm. Rotation means choosing a
              different persona — never giving one a new fingerprint.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {[
                { icon: Fingerprint, title: 'Stable fingerprints', desc: 'Derived from a stored seed and the device you chose at creation — byte-identical across restarts' },
                { icon: Shield, title: 'Stealth, measured', desc: 'Scored against real detectors rather than asserted. Run oya stealth-test and read the number' },
                { icon: Globe, title: 'Proxy per persona', desc: 'A sticky exit per identity, with a timezone-versus-geo coherence check. Credentials sealed at rest' },
                { icon: Lock, title: 'Capped concurrency', desc: 'One laptop cannot be in a thousand places at once, so each persona has a visible ceiling' },
              ].map((f) => (
                <div key={f.title} className="group rounded-xl border border-border bg-bg-card/80 p-4 hover:border-accent/30 hover:bg-bg-elevated/60 transition-all duration-300">
                  <f.icon className="w-4 h-4 text-accent mb-2.5" />
                  <p className="text-[13px] font-semibold text-text mb-1.5">{f.title}</p>
                  <p className="text-[11.5px] text-text-muted leading-snug">{f.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ─── TOOLS ─── */}
          <section id="tools" className="py-12 sm:py-14 border-t border-border/80 scroll-mt-20">
            <SectionLabel>For agents</SectionLabel>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight mb-3 text-text">
              {tools.length} tools. Pages as markdown, elements by number.
            </h2>
            <p className="text-text-muted mb-6 leading-relaxed text-[15px] max-w-2xl">
              Every browser is an MCP server. The agent reads <code className="px-1.5 py-0.5 rounded-md bg-bg-elevated border border-border font-mono text-[13px] text-text-muted">[#13 button &quot;Search&quot;]</code> and says <code className="px-1.5 py-0.5 rounded-md bg-bg-elevated border border-border font-mono text-[13px] text-text-muted">click(13)</code>. No vision model, no selectors.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              {tools.map((t) => (
                <div key={t.name} className="rounded-xl border border-border bg-bg-card/80 p-3.5 hover:border-accent/30 transition-colors">
                  <t.icon className="w-4 h-4 text-indigo mb-2" />
                  <p className="font-mono text-[12.5px] font-semibold text-text mb-1">{t.name}</p>
                  <p className="text-[11.5px] text-text-muted leading-snug">{t.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ─── FILM ─── */}
          <section className="py-12 sm:py-14 border-t border-border/80">
            <SectionLabel>In motion</SectionLabel>
            <div className="rounded-2xl border border-border overflow-hidden bg-bg-card shadow-[var(--shadow-card)] ring-1 ring-white/[0.04]">
              <div className="px-4 py-2 border-b border-border flex items-center justify-between bg-bg-elevated/40">
                <span className="text-[10px] font-mono uppercase tracking-widest text-text-dim">Product film</span>
                <span className="text-[10px] font-mono text-accent">REC</span>
              </div>
              <video autoPlay loop muted playsInline className="w-full block">
                <source src="/oya-browser.mp4" type="video/mp4" />
              </video>
            </div>
          </section>

          {/* ─── DESKTOP ─── */}
          <section id="download" className="py-12 sm:py-14 border-t border-border/80 scroll-mt-20">
            <SectionLabel>Desktop</SectionLabel>
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight mb-3 text-text">
              Sign in once, on your own machine
            </h2>
            <p className="text-text-muted mb-6 leading-relaxed text-[15px] max-w-2xl">
              For browsers on Oya Cloud, the desktop app is a one-time step: log into the sites your
              agents need. Those cookies move to the remote browsers, which run the same fingerprint —
              so the site sees one device returning, not a fleet sharing an account.
            </p>
            <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
              <a href="/downloads/Oya.Browser-1.0.46-universal.dmg"
                className="group rounded-2xl border border-border bg-bg-card/80 p-5 hover:border-accent/35 transition-colors">
                <Monitor className="w-5 h-5 text-accent mb-3" />
                <p className="text-[15px] font-bold text-text">macOS</p>
                <p className="text-[12.5px] text-text-muted">Universal · Intel and Apple Silicon</p>
              </a>
              <a href="/downloads/Oya.Browser-1.0.46-arm64.AppImage"
                className="group rounded-2xl border border-border bg-bg-card/80 p-5 hover:border-accent/35 transition-colors">
                <Terminal className="w-5 h-5 text-accent mb-3" />
                <p className="text-[15px] font-bold text-text">Linux</p>
                <p className="text-[12.5px] text-text-muted">AppImage · arm64</p>
              </a>
            </div>
          </section>

        </div>
      </main>

      <footer className="border-t border-border/80 py-12 mt-4">
        <div className="max-w-5xl mx-auto px-6 text-center text-[13px] text-text-dim">
          <a href="https://oya.ai" className="text-text-muted hover:text-accent transition-colors">Oya.ai</a>
          {' · '}
          <Link href="/docs" className="text-text-muted hover:text-accent transition-colors">Docs</Link>
          {' · '}
          <Link href="/dashboard" className="text-text-muted hover:text-accent transition-colors">Dashboard</Link>
        </div>
      </footer>
      </div>
    </div>
  );
}
