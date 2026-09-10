'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  Fingerprint,
  Globe2,
  Layers,
  Monitor,
  Terminal,
  Menu,
  X,
  ChevronRight,
  Command,
  Play,
  ShieldCheck,
  Network,
  RefreshCw,
  KeyRound,
  Sliders,
  CheckCircle2,
  XCircle,
  ExternalLink,
} from 'lucide-react';
import { OyaWordmark, OyaLogo } from '@/components/oya-logo';
import ThemeToggle from '@/components/theme-toggle';
import SyntaxCode from '@/components/ui/syntax-code';

const examples = [
  {
    label: 'TypeScript SDK',
    language: 'typescript' as const,
    file: 'agent.ts',
    code: `import { Oya } from "@oya/browser";

const oya = new Oya();                                    // Reads OYA_API_KEY
// Provider (Oya Cloud, Browserbase, Steel, Anchor, Browser Use) is a setting, not code
const browser = await oya.browser.start({
  persona: "acme-ops",                                    // Byte-identical seeded identity
  captcha: "auto",                                        // Solves natively or via solver
});

await browser.goto("https://app.example.com");
const page = await browser.analyze();                     // Markdown + numbered element IDs
await browser.click(page.elements[0].id);`,
  },
  {
    label: 'Standard Playwright CDP',
    language: 'typescript' as const,
    file: 'playwright.ts',
    code: `import { chromium } from "playwright";
import { Oya } from "@oya/browser";

const oya = new Oya();
const oyaBrowser = await oya.browser.start({ persona: "auto" });

// Connect native Playwright directly through the Oya Control Plane gateway.
// Zero SDK lock-in — routing, persona injection, and session recording are automatic.
const browser = await chromium.connectOverCDP(oyaBrowser.cdpUrl);
const page = await browser.newPage();
await page.goto("https://github.com");`,
  },
  {
    label: 'Terminal CLI',
    language: 'bash' as const,
    file: 'Terminal',
    code: `npm install -g oya
oya login
oya init                               # Model, provider, solver, desktop pairing

oya personas new acme-ops --platform MacIntel --tz America/New_York
oya start --persona acme-ops
oya goto https://app.example.com
oya ask "Download the latest invoice report"
oya stealth-test --live                # Score evasion against CreepJS and Sannysoft
oya ls`,
  },
  {
    label: 'Model Context Protocol (MCP)',
    language: 'json' as const,
    file: 'mcp.json',
    code: `{
  "mcpServers": {
    "oya-browser": {
      "url": "https://browser.getoya.ai/mcp/pool",
      "headers": {
        "Authorization": "Bearer <your-oya-api-key>"
      }
    }
  }
}`,
  },
];

const demoBrowsers = [
  {
    name: 'Production Analyst',
    provider: 'Oya Cloud',
    profile: 'us-east-finance',
    page: 'app.snowflake.com/query',
    action: 'Executing SQL aggregation',
    health: 'Running',
    routing: 'Primary route · 14ms',
  },
  {
    name: 'Procurement Automation',
    provider: 'Steel',
    profile: 'eu-buyer-persona',
    page: 'procure.corp.de/orders',
    action: 'Turnstile challenge auto-bypassed',
    health: 'Ready',
    routing: 'Failover route · 28ms',
  },
  {
    name: 'Executive Assistant',
    provider: 'Desktop Paired',
    profile: 'exec-gsuite',
    page: 'mail.google.com',
    action: 'Authenticated via 1-click desktop session',
    health: 'Ready',
    routing: 'Direct workstation · 0ms',
  },
];

function ProductPreview() {
  const [selected, setSelected] = useState(0);
  const browser = demoBrowsers[selected];
  return (
    <div className="product-preview" aria-label="Interactive browser console preview">
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <OyaLogo size={19} />
          <span className="text-[12px] font-medium">Control Plane</span>
          <ChevronRight size={13} className="text-text-dim" />
          <span className="text-[12px] text-text-muted">Fleet Console (1,000+ capacity)</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-0.5 font-mono text-[10px] text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            CONTROL PLANE ACTIVE
          </span>
        </div>
      </div>
      <div className="grid min-w-0 md:grid-cols-[1.45fr_1fr]">
        <div className="min-w-0 md:border-r border-border">
          <div className="flex items-center justify-between px-5 py-5">
            <div>
              <span className="text-[15px] font-semibold">Active Fleet Browsers</span>
              <span className="ml-2 text-text-dim font-mono text-[12px]">03 / 1,000</span>
            </div>
            <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Multi-Provider Auto-Routing
            </span>
          </div>
          <div className="preview-columns border-y border-border bg-bg-sunken/60 py-2 text-[10px] uppercase tracking-widest text-text-dim">
            <span>Browser / Persona</span>
            <span>Provider</span>
            <span>Status</span>
          </div>
          {demoBrowsers.map((row, index) => (
            <button
              key={row.name}
              onClick={() => setSelected(index)}
              aria-pressed={index === selected}
              className={`preview-columns w-full border-b border-border/60 py-4 text-left transition-colors ${
                index === selected ? 'bg-accent/[0.08]' : 'hover:bg-text/[0.03]'
              }`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <Monitor
                  size={15}
                  className={index === selected ? 'text-accent shrink-0' : 'text-text-dim shrink-0'}
                />
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium">{row.name}</span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-text-dim">
                    persona: {row.profile}
                  </span>
                </span>
              </span>
              <span className="text-[11px] font-mono text-text-muted">{row.provider}</span>
              <span className="text-[10px] font-semibold text-accent">{row.health}</span>
            </button>
          ))}
          <div className="flex items-center justify-between px-5 py-4 text-[10px] text-text-dim">
            <span className="flex items-center gap-1.5">
              <Command size={11} /> Unified Gateway: One API key controls every provider
            </span>
            <span className="font-mono">Failover: ENABLED</span>
          </div>
        </div>
        <div className="flex min-w-0 flex-col p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="truncate text-[13px] font-semibold block">{browser.name}</span>
              <span className="text-[10px] text-text-dim font-mono">{browser.routing}</span>
            </div>
            <span className="eyebrow text-accent shrink-0">Live Inspection</span>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-md border border-border bg-bg-sunken px-3 py-2 font-mono text-[11px] text-text-muted">
            <ShieldCheck size={13} className="text-accent shrink-0" />
            <span className="truncate">{browser.page}</span>
          </div>
          <div className="my-4 flex flex-1 flex-col items-center justify-center rounded-lg border border-border bg-bg-sunken p-6 text-center">
            <Globe2 size={28} strokeWidth={1.2} className="mx-auto mb-3 text-text-dim" />
            <p className="text-[13px] font-medium">Sub-second Interactive Live View</p>
            <p className="mt-1.5 text-[11px] text-text-dim max-w-[220px]">
              Click, drag, scroll, or type directly. Step in when 2FA hits; hand control back to the agent.
            </p>
          </div>
          <p aria-live="polite" className="flex items-center gap-2 text-[11px] text-text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            {browser.action}
          </p>
        </div>
      </div>
    </div>
  );
}

const comparisonRows = [
  {
    feature: 'Architecture & Lock-In',
    raw: 'Single-vendor point solution. Hardcoded to one proprietary API, cloud, and billing tier. Outages or bans break all agents.',
    oya: 'True Control Plane. Route dynamically across Oya Cloud, Browserbase, Steel, Anchor, Browser Use, or private Chrome.',
    advantage: 'Zero vendor lock-in & automatic multi-provider failover.',
  },
  {
    feature: 'Device Identity & Anti-Ban',
    raw: 'Ephemeral dumb sessions or randomized fingerprint spoofing. Anti-bot engines flag bot farms (1 account, 40 devices) or device farms.',
    oya: 'Deterministic Seeded Personas. Byte-identical hardware fingerprints (canvas, WebGL, audio) bound to a persistent cookie jar, proxy, and concurrency cap.',
    advantage: 'Persistent device memory. Returning weeks later looks like the same workstation.',
  },
  {
    feature: 'Authentication & SSO',
    raw: 'Brittle scripted login automation that breaks on Google OAuth, Okta, passkeys, WebAuthn, and Cloudflare managed challenges.',
    oya: 'Sign-In-Once Desktop Pairing. Log in once in real desktop Chrome/Electron with passkeys; cookies securely sync to cloud personas via encrypted pairing codes.',
    advantage: 'Instant authenticated sessions without writing fragile login scripts.',
  },
  {
    feature: 'Challenge Resolution & 2FA',
    raw: 'Fails, errors, or hangs indefinitely when encountering unexpected push approvals, phone notifications, or complex CAPTCHAs.',
    oya: 'Two-Tier Engine + Sub-Second Live Takeover. Native provider solving + CapSolver/2Captcha + automated TOTP/SMS relay + interactive live stream.',
    advantage: '100% task completion. Humans can take over with real clicks and resume the run.',
  },
  {
    feature: 'Fleet Observability & Governance',
    raw: 'Opaque session IDs, black-box execution, static post-mortem logs, zero real-time intervention.',
    oya: 'High-density 1,000+ browser console. Real-time health strip, command-by-command audit stream, Prometheus metrics (/metrics), and hourly spend per key.',
    advantage: 'Full operational control with emergency bulk kill switches (POST /browsers/stop).',
  },
  {
    feature: 'Protocol & Ecosystem Freedom',
    raw: 'Proprietary SDK wrappers requiring bespoke framework integrations and code rewrites.',
    oya: 'Universal Gateway: Native CDP (/connect), MCP streamable HTTP (/mcp/:id), TypeScript SDK, and terminal CLI.',
    advantage: 'Works natively with Playwright, Puppeteer, Stagehand, browser-use, Claude Code, and Cursor.',
  },
  {
    feature: 'Stealth Verification',
    raw: 'Unverifiable marketing claims ("100% undetectable") that fail on modern CreepJS and Bot.Sannysoft.',
    oya: 'Open Benchmark Suite (oya stealth-test --live). Scored live against CreepJS and Sannysoft with exact delta reporting.',
    advantage: 'Honest, measured evasion engineering with attributable deltas.',
  },
];

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [example, setExample] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const snippet = examples[example];

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(snippet.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError('Select the code below to copy it.');
    }
  }

  return (
    <div className="marketing-page min-h-screen bg-bg text-text">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur-md">
        <div className="site-width flex h-[72px] items-center justify-between gap-5">
          <OyaWordmark />
          <nav
            aria-label="Main navigation"
            className="hidden items-center gap-7 text-[13px] text-text-muted md:flex"
          >
            <a href="#product" className="hover:text-text transition-colors">Product</a>
            <a href="#architecture" className="hover:text-text transition-colors">Architecture</a>
            <a href="#comparison" className="hover:text-text transition-colors flex items-center gap-1">
              Why Oya <span className="rounded bg-accent/15 px-1 py-0.2 font-mono text-[10px] text-accent font-semibold">10x</span>
            </a>
            <a href="#developers" className="hover:text-text transition-colors">Developers</a>
            <Link href="/docs" className="hover:text-text transition-colors">Documentation</Link>
          </nav>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link href="/dashboard" className="btn-primary h-9 px-4 text-[12px]">
              Open console <ArrowUpRight size={13} />
            </Link>
            <button
              className="btn-icon md:hidden"
              aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X size={19} /> : <Menu size={19} />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav
            aria-label="Mobile navigation"
            className="site-width flex flex-col gap-4 border-t border-border py-5 text-sm md:hidden"
          >
            <a href="#product" onClick={() => setMenuOpen(false)}>Product</a>
            <a href="#architecture" onClick={() => setMenuOpen(false)}>Architecture</a>
            <a href="#comparison" onClick={() => setMenuOpen(false)}>Why Oya (10x Comparison)</a>
            <a href="#developers" onClick={() => setMenuOpen(false)}>Developers</a>
            <Link href="/docs">Documentation</Link>
          </nav>
        )}
      </header>

      <main>
        {/* Hero Section */}
        <section className="site-width pt-16 pb-12 sm:pt-24 sm:pb-20">
          <div className="grid items-end gap-8 lg:grid-cols-[1.35fr_1fr] lg:gap-16">
            <div>
              <p className="eyebrow mb-6 flex items-center gap-2 text-text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                The Browser Control Plane for AI Agents
              </p>
              <h1 className="marketing-title">
                Stop building on <span className="text-text-dim">dumb browsers.</span><br />
                <span className="text-accent">Orchestrate</span> your fleet.
              </h1>
            </div>
            <div className="pb-1 lg:max-w-[420px]">
              <p className="text-[17px] leading-[1.75] text-text-muted">
                Browserbase, Steel, Anchor, and Browser Use run isolated browsers. Oya is the{' '}
                <strong className="text-text font-semibold">Control Plane</strong> sitting above them:
                deterministic personas, zero-rewrite failover, desktop auth pairing, and live fleet orchestration.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-4">
                <Link href="/dashboard" className="btn-primary h-11 px-5">
                  Open console <ArrowRight size={15} />
                </Link>
                <a href="#comparison" className="btn-ghost h-11 px-4 text-[13px]">
                  The 10x difference
                </a>
                <Link
                  href="/docs"
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-muted hover:text-accent ml-2"
                >
                  Read the docs <ArrowUpRight size={14} />
                </Link>
              </div>
            </div>
          </div>

          {/* Interactive Console Preview */}
          <div id="product" className="mt-14 scroll-mt-24 sm:mt-16">
            <ProductPreview />
          </div>

          {/* Supported Runners Strip */}
          <div className="mt-7 flex flex-wrap items-center justify-between gap-x-7 gap-y-4 text-[12px] text-text-muted">
            <span className="eyebrow text-text-dim">One Control Plane. Every Execution Target:</span>
            {['Oya Cloud Sandboxes', 'Browserbase', 'Steel', 'Anchor', 'Browser Use', 'Self-Hosted Chrome'].map((p) => (
              <span key={p} className="flex items-center gap-1.5 font-medium text-text-secondary">
                <CheckCircle2 size={12} className="text-accent" />
                {p}
              </span>
            ))}
          </div>
        </section>

        {/* Architecture Section */}
        <section id="architecture" className="site-width section-space scroll-mt-20 border-t border-border">
          <div className="grid gap-6 lg:grid-cols-[1fr_1.35fr]">
            <div>
              <p className="eyebrow mb-4 text-accent">Control Plane Architecture</p>
              <h2 className="marketing-heading max-w-sm">
                The missing layer in AI browser infrastructure.
              </h2>
            </div>
            <p className="max-w-xl text-[17px] leading-[1.75] text-text-muted lg:pt-9">
              Don&apos;t hardcode your agents to a single cloud runner. Oya sits between your agents and whoever executes the browsers, solving identity, authentication, challenge handling, and failover in one place.
            </p>
          </div>

          {/* Visual Architecture Diagram */}
          <div className="mt-12 rounded-2xl border border-border bg-bg-card p-6 md:p-9">
            {/* Top Layer */}
            <div className="text-center">
              <span className="eyebrow text-text-dim">Layer 1: Your Agents & Frameworks</span>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
                {['Claude Code', 'Cursor', 'Playwright', 'Puppeteer', 'Stagehand', 'browser-use', 'LangChain'].map((item) => (
                  <span
                    key={item}
                    className="rounded-lg border border-border bg-bg-sunken px-3.5 py-1.5 font-mono text-[12px] font-medium"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>

            {/* Connecting Pipe */}
            <div className="my-5 flex flex-col items-center justify-center">
              <div className="h-6 w-px bg-accent/60" />
              <span className="rounded-full bg-accent/10 border border-accent/25 px-3 py-1 font-mono text-[10px] text-accent">
                Universal Protocols: CDP (/connect) · MCP (/mcp) · TS SDK · CLI · REST
              </span>
              <div className="h-6 w-px bg-accent/60" />
            </div>

            {/* Middle Layer - OYA CONTROL PLANE */}
            <div className="rounded-xl border-2 border-accent/40 bg-accent/[0.03] p-6 md:p-8 relative">
              <div className="flex items-center justify-between border-b border-accent/20 pb-4 mb-6">
                <div className="flex items-center gap-2">
                  <OyaLogo size={22} />
                  <span className="text-[16px] font-bold tracking-tight">OYA BROWSER CONTROL PLANE</span>
                </div>
                <span className="eyebrow text-accent font-semibold">Core Orchestration Engine</span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-lg border border-border bg-bg/80 p-4">
                  <div className="flex items-center gap-2 text-[13px] font-semibold mb-1.5 text-text">
                    <Network size={15} className="text-accent" />
                    Unified Router & Failover
                  </div>
                  <p className="text-[12px] text-text-muted leading-relaxed">
                    Set provider priorities and capacities. Automatic zero-rewrite failover when a vendor throttles or fails.
                  </p>
                </div>

                <div className="rounded-lg border border-border bg-bg/80 p-4">
                  <div className="flex items-center gap-2 text-[13px] font-semibold mb-1.5 text-text">
                    <Fingerprint size={15} className="text-accent" />
                    Deterministic Personas
                  </div>
                  <p className="text-[12px] text-text-muted leading-relaxed">
                    Mathematically seeded byte-identical fingerprints across restarts. Bound to cookie jars and pinned proxies.
                  </p>
                </div>

                <div className="rounded-lg border border-border bg-bg/80 p-4">
                  <div className="flex items-center gap-2 text-[13px] font-semibold mb-1.5 text-text">
                    <KeyRound size={15} className="text-accent" />
                    Sign-In-Once Desktop Pairing
                  </div>
                  <p className="text-[12px] text-text-muted leading-relaxed">
                    Sign into sites on real desktop Chrome with passkeys; cookies cryptographically sync to cloud agent personas.
                  </p>
                </div>

                <div className="rounded-lg border border-border bg-bg/80 p-4">
                  <div className="flex items-center gap-2 text-[13px] font-semibold mb-1.5 text-text">
                    <Sliders size={15} className="text-accent" />
                    Two-Tier Challenges
                  </div>
                  <p className="text-[12px] text-text-muted leading-relaxed">
                    Native CAPTCHA delegation + solver fallback + automated TOTP/SMS relay + human takeover handoffs.
                  </p>
                </div>

                <div className="rounded-lg border border-border bg-bg/80 p-4">
                  <div className="flex items-center gap-2 text-[13px] font-semibold mb-1.5 text-text">
                    <Monitor size={15} className="text-accent" />
                    Interactive Live Takeover
                  </div>
                  <p className="text-[12px] text-text-muted leading-relaxed">
                    Sub-second SSE live stream with real click/keyboard input. Humans step in when 2FA hits; agents resume.
                  </p>
                </div>

                <div className="rounded-lg border border-border bg-bg/80 p-4">
                  <div className="flex items-center gap-2 text-[13px] font-semibold mb-1.5 text-text">
                    <ShieldCheck size={15} className="text-accent" />
                    Fleet Governance & Audit
                  </div>
                  <p className="text-[12px] text-text-muted leading-relaxed">
                    1,000+ browser console, hourly spend attribution per tenant key, Prometheus metrics (/metrics), immutable audit log.
                  </p>
                </div>
              </div>
            </div>

            {/* Connecting Pipe */}
            <div className="my-5 flex flex-col items-center justify-center">
              <div className="h-6 w-px bg-border" />
              <span className="font-mono text-[10px] text-text-dim">Dispatches to underlying execution targets</span>
              <div className="h-6 w-px bg-border" />
            </div>

            {/* Bottom Layer - RUNNERS */}
            <div className="text-center">
              <span className="eyebrow text-text-dim">Layer 3: Browser Execution Engines</span>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  { name: 'Oya Cloud', note: 'Isolated sandboxes' },
                  { name: 'Browserbase', note: 'CDP runner' },
                  { name: 'Steel', note: 'CDP runner' },
                  { name: 'Anchor', note: 'CDP runner' },
                  { name: 'Browser Use', note: 'CDP runner' },
                  { name: 'Private Chrome', note: 'Bare metal / Daytona' },
                ].map((item) => (
                  <div key={item.name} className="rounded-lg border border-border bg-bg-sunken p-3 text-center">
                    <div className="text-[12px] font-medium text-text">{item.name}</div>
                    <div className="text-[10px] text-text-dim mt-0.5">{item.note}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 10x Comparison Section */}
        <section id="comparison" className="site-width section-space scroll-mt-20 border-t border-border">
          <div className="grid gap-6 lg:grid-cols-[1fr_1.35fr]">
            <div>
              <p className="eyebrow mb-4 text-accent">The 10x Difference</p>
              <h2 className="marketing-heading max-w-md">
                Control Plane vs.<br />Single-Vendor Runners.
              </h2>
            </div>
            <p className="max-w-xl text-[17px] leading-[1.75] text-text-muted lg:pt-9">
              Why build on point solutions like Browserbase, Steel, Anchor, or Browser Use when you can orchestrate them all? Here is how Oya gives you a 10x architectural leap.
            </p>
          </div>

          {/* Comparison Table */}
          <div className="mt-12 overflow-hidden rounded-2xl border border-border bg-bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg-sunken/80 text-[11px] font-semibold uppercase tracking-wider text-text-dim">
                    <th className="py-4 px-6 w-[20%]">Dimension</th>
                    <th className="py-4 px-6 w-[35%] text-text-muted">
                      Raw Runners (Browserbase, Steel, Anchor, Browser Use)
                    </th>
                    <th className="py-4 px-6 w-[45%] text-accent bg-accent/[0.04]">
                      Oya Browser Control Plane (10x Better)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70 font-sans">
                  {comparisonRows.map((row, i) => (
                    <tr key={i} className="hover:bg-text/[0.02] transition-colors">
                      <td className="py-4 px-6 font-medium text-[13px] text-text align-top">
                        {row.feature}
                      </td>
                      <td className="py-4 px-6 text-[12.5px] leading-relaxed text-text-muted align-top">
                        <div className="flex items-start gap-2">
                          <XCircle size={15} className="text-red shrink-0 mt-0.5" />
                          <span>{row.raw}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-[12.5px] leading-relaxed text-text align-top bg-accent/[0.02]">
                        <div className="flex items-start gap-2">
                          <CheckCircle2 size={15} className="text-accent shrink-0 mt-0.5" />
                          <div>
                            <span className="font-medium text-text">{row.oya}</span>
                            <span className="mt-1 block text-[11.5px] text-accent font-mono font-medium">
                              → {row.advantage}
                            </span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Feature Pillars */}
        <section className="site-width section-space border-t border-border">
          <div className="grid gap-6 lg:grid-cols-[1fr_1.35fr]">
            <div>
              <p className="eyebrow mb-4 text-accent">Pillars of the Control Plane</p>
              <h2 className="marketing-heading max-w-sm">
                Engineered for fleets that cannot fail.
              </h2>
            </div>
            <p className="max-w-xl text-[17px] leading-[1.75] text-text-muted lg:pt-9">
              Everything built into Oya exists because real production agent fleets break on bot detectors, auth walls, and single-provider outages.
            </p>
          </div>

          <div className="mt-12 grid gap-8 md:grid-cols-3 md:gap-10">
            <div className="rounded-xl border border-border bg-bg-card p-6">
              <div className="mb-6 flex items-center justify-between">
                <Fingerprint size={24} strokeWidth={1.5} className="text-accent" />
                <span className="font-mono text-[10px] text-text-dim">PILLAR 01</span>
              </div>
              <h3 className="text-[18px] font-semibold tracking-tight text-text">
                Personas: Device identity, not ephemeral sessions.
              </h3>
              <p className="mt-3 text-[14px] leading-relaxed text-text-muted">
                Anti-bot engines look for two telltales: one account seen from 50 device fingerprints (bot farm), or one device seen on 1,000 accounts (device farm).
              </p>
              <p className="mt-2 text-[14px] leading-relaxed text-text-muted">
                Oya personas bind a mathematically seeded, byte-identical hardware profile to a cookie jar, proxy, and concurrency cap. When your agent returns next week, target sites see the exact same MacBook Pro or Windows desktop returning.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-bg-card p-6">
              <div className="mb-6 flex items-center justify-between">
                <RefreshCw size={24} strokeWidth={1.5} className="text-accent" />
                <span className="font-mono text-[10px] text-text-dim">PILLAR 02</span>
              </div>
              <h3 className="text-[18px] font-semibold tracking-tight text-text">
                Multi-Provider Routing: Zero-rewrite failover.
              </h3>
              <p className="mt-3 text-[14px] leading-relaxed text-text-muted">
                Never lock your agent to a single browser vendor. If Browserbase has a regional outage or Steel throttles your quota, your agent should not crash.
              </p>
              <p className="mt-2 text-[14px] leading-relaxed text-text-muted">
                Oya routes traffic dynamically across providers based on configured priority and session capacity. A failing runner triggers instant failover to the next healthy runner in milliseconds.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-bg-card p-6">
              <div className="mb-6 flex items-center justify-between">
                <KeyRound size={24} strokeWidth={1.5} className="text-accent" />
                <span className="font-mono text-[10px] text-text-dim">PILLAR 03</span>
              </div>
              <h3 className="text-[18px] font-semibold tracking-tight text-text">
                Sign In Once: Desktop pairing with passkeys & SSO.
              </h3>
              <p className="mt-3 text-[14px] leading-relaxed text-text-muted">
                Automating logins to Google, Okta, or Salesforce with headless scripts fails 90% of the time and triggers fraud alerts.
              </p>
              <p className="mt-2 text-[14px] leading-relaxed text-text-muted">
                With Oya&apos;s desktop app, a human signs in ONCE using real passkeys, WebAuthn, or phone push MFA. Oya extracts and cryptographically synchronizes the session state to the cloud persona. Your agent wakes up already signed in.
              </p>
            </div>
          </div>
        </section>

        {/* Developer First Section */}
        <section id="developers" className="site-width section-space scroll-mt-16 border-t border-border">
          <div className="grid items-start gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
            <div>
              <p className="eyebrow mb-4 text-accent">Universal Integration</p>
              <h2 className="marketing-heading">
                Zero SDK Lock-In.<br />Speak your own stack.
              </h2>
              <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-text-muted">
                Whether you use standard Playwright over CDP, Claude Code via Model Context Protocol, the TypeScript SDK, or the terminal CLI — the Oya Control Plane handles routing, personas, and challenge solving identically.
              </p>
              <div className="mt-8 flex flex-col gap-3">
                <Link
                  href="/docs"
                  className="inline-flex items-center gap-2 text-[13px] font-medium text-accent hover:underline"
                >
                  Explore full documentation & API reference <ArrowRight size={14} />
                </Link>
                <div className="mt-4 flex items-center gap-3 border-t border-border pt-5 text-[12px] text-text-dim font-mono">
                  <Terminal size={15} />
                  <code>npm install @oya/browser</code>
                </div>
              </div>
            </div>

            <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-bg-card shadow-lg">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 bg-bg-sunken/50">
                <div role="tablist" aria-label="Integration language" className="flex gap-1 overflow-x-auto">
                  {examples.map((item, i) => (
                    <button
                      key={item.label}
                      role="tab"
                      aria-selected={example === i}
                      aria-controls="integration-code"
                      onClick={() => {
                        setExample(i);
                        setCopied(false);
                        setCopyError('');
                      }}
                      className={`rounded-md px-3 py-1.5 text-[12px] whitespace-nowrap transition-colors ${
                        example === i
                          ? 'bg-text/10 text-text font-medium'
                          : 'text-text-dim hover:text-text'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <button
                  aria-label="Copy example"
                  onClick={copyCode}
                  className="btn-icon shrink-0"
                >
                  {copied ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
                </button>
              </div>
              <div id="integration-code" role="tabpanel" aria-label={snippet.label}>
                <div className="px-5 pt-4 font-mono text-[10px] text-text-dim flex items-center justify-between">
                  <span>{snippet.file}</span>
                  {copied && <span className="text-accent text-[11px]">Copied to clipboard!</span>}
                </div>
                <pre className="min-h-[300px] overflow-x-auto p-5 font-mono text-[12px] leading-[1.85]">
                  <SyntaxCode code={snippet.code} language={snippet.language} />
                </pre>
              </div>
              {copyError && <p role="status" className="px-5 pb-4 text-xs text-text-muted">{copyError}</p>}
            </div>
          </div>
        </section>

        {/* Video Walkthrough Section */}
        <section className="site-width section-space border-t border-border">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="eyebrow mb-3 text-accent">Console Walkthrough</p>
              <h2 className="marketing-heading">Orchestrating 1,000 browsers.</h2>
            </div>
            <span className="flex items-center gap-2 text-[12px] text-text-dim font-mono">
              <Play size={12} className="text-accent" />
              Watch control plane live stream in action
            </span>
          </div>
          <video
            controls
            playsInline
            preload="none"
            poster="/oya-browser-poster.jpg"
            aria-label="Oya Browser product walkthrough"
            className="aspect-video w-full rounded-2xl border border-border bg-bg-card shadow-2xl"
          >
            <source src="/oya-browser.mp4" type="video/mp4" />
          </video>
        </section>

        {/* Desktop App & Self-Hosting */}
        <section className="site-width section-space grid gap-10 border-t border-border md:grid-cols-2 md:gap-16">
          <div id="download" className="scroll-mt-24 rounded-2xl border border-border bg-bg-card p-8">
            <Monitor size={24} strokeWidth={1.5} className="mb-5 text-accent" />
            <h2 className="text-[24px] font-semibold tracking-tight text-text">
              Sign In Once on Desktop.
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-text-muted">
              Download the native Oya desktop browser. Log into your company’s target services with real passkeys and WebAuthn. Oya synchronizes your active session directly to your agent personas.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <a
                className="btn-primary h-10 px-4 text-[12px]"
                href="/downloads/Oya.Browser-1.0.46-universal.dmg"
              >
                Download macOS (.dmg) <ArrowUpRight size={14} />
              </a>
              <a
                className="btn-ghost h-10 px-4 text-[12px]"
                href="/downloads/Oya.Browser-1.0.46-x64.AppImage"
              >
                Linux (.AppImage)
              </a>
            </div>
            <p className="mt-3 text-[11px] text-text-dim font-mono">
              Universal binary (Apple Silicon + Intel) · Sandboxed Electron
            </p>
          </div>

          <div id="self-host" className="scroll-mt-24 rounded-2xl border border-border bg-bg-card p-8">
            <Layers size={24} strokeWidth={1.5} className="mb-5 text-accent" />
            <h2 className="text-[24px] font-semibold tracking-tight text-text">
              Self-Hostable & Air-Gapped.
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-text-muted">
              Run the full control plane on your own Kubernetes cluster, Docker host, or cloud VMs. Complete data sovereignty — credentials and session tokens are encrypted with your own master key.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Link href="/docs#self-host" className="btn-ghost h-10 px-4 text-[12px]">
                Deploy Docker Compose <ArrowUpRight size={14} />
              </Link>
              <Link href="/docs#settings" className="btn-ghost h-10 px-4 text-[12px]">
                Config reference
              </Link>
            </div>
            <p className="mt-3 text-[11px] text-text-dim font-mono">
              <code>docker compose up</code> · Single container deployment on :3100
            </p>
          </div>
        </section>

        {/* Bottom CTA Banner */}
        <section className="border-y border-border bg-bg-card/60">
          <div className="site-width flex flex-col items-start justify-between gap-8 py-16 sm:flex-row sm:items-center">
            <div>
              <p className="eyebrow mb-3 text-accent font-semibold">Ready for production</p>
              <h2 className="marketing-heading">
                Take control of your browser fleet.
              </h2>
              <p className="text-[15px] text-text-muted mt-2 max-w-md">
                Deploy your first deterministic persona, connect your agents, and route across providers in under 3 minutes.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="btn-primary h-12 shrink-0 px-6 text-[14px]">
                Open console <ArrowRight size={16} />
              </Link>
              <Link href="/docs#quickstart" className="btn-ghost h-12 shrink-0 px-5 text-[14px]">
                Quickstart Guide
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="site-width flex flex-wrap items-center justify-between gap-6 py-10">
        <div className="flex items-center gap-3">
          <OyaWordmark />
          <span className="text-[12px] text-text-dim border-l border-border pl-3">
            The Browser Control Plane for AI Employees
          </span>
        </div>
        <div className="flex items-center gap-6 text-[12px] text-text-muted">
          <Link href="/docs" className="hover:text-text transition-colors">Documentation</Link>
          <a href="#comparison" className="hover:text-text transition-colors">10x Comparison</a>
          <Link href="/dashboard" className="hover:text-text transition-colors">Console</Link>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="hover:text-text transition-colors flex items-center gap-1"
          >
            GitHub <ExternalLink size={11} />
          </a>
        </div>
      </footer>
    </div>
  );
}
