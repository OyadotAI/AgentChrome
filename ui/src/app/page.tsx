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
  Cookie,
  Lock,
  Eye,
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
const mcpConfig = `{
  "mcpServers": {
    "oya-browser": {
      "url": "https://browser.getoya.ai/mcp/YOUR_BROWSER_ID",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`;

const poolConfig = `{
  "mcpServers": {
    "oya-pool": {
      "url": "https://browser.getoya.ai/mcp/pool",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer YOUR_FLEET_TOKEN"
      }
    }
  }
}`;

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
            <a href="#pool" className="px-3 py-2 text-sm font-medium text-text-muted hover:text-text rounded-lg hover:bg-bg-card/80 transition-colors">
              Pool
            </a>
            <a href="#download" className="px-3 py-2 text-sm font-medium text-text-muted hover:text-text rounded-lg hover:bg-bg-card/80 transition-colors">
              Download
            </a>
            <Link href="/docs" className="px-3 py-2 text-sm font-medium text-text-muted hover:text-text rounded-lg hover:bg-bg-card/80 transition-colors">
              Docs
            </Link>
            <Link
              href={user ? '/dashboard' : '/login'}
              className="ml-2 px-4 py-2 text-[13px] font-semibold rounded-lg bg-accent text-[#0c0c0a] hover:bg-accent-hover shadow-[0_0_24px_-4px_rgba(57,237,53,0.35)]"
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
            <a href="#pool" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm text-text-muted hover:text-text rounded-lg hover:bg-bg-elevated">
              Pool
            </a>
            <a href="#download" onClick={() => setMenuOpen(false)} className="block px-4 py-2.5 text-sm text-text-muted hover:text-text rounded-lg hover:bg-bg-elevated">
              Download
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
          <section className="pt-14 sm:pt-20 pb-12 sm:pb-16">
            <div className="grid lg:grid-cols-12 gap-10 lg:gap-8 items-center">
              <div className="lg:col-span-7 reveal-stagger">
                <p className="text-[10px] font-mono uppercase tracking-[0.28em] text-indigo mb-4">
                  Personas · Rotation · CAPTCHA &amp; MFA · Cookie sync
                </p>
                <h1 className="font-display text-[2.5rem] sm:text-[3.25rem] lg:text-[3.5rem] font-bold tracking-tight leading-[1.05] mb-5">
                  <span className="text-text">Thousands of browsers. One API.</span>
                  <br />
                  <span className="text-accent">
                    Every one a different identity.
                  </span>
                </h1>
                <p className="text-[17px] text-text-muted leading-relaxed max-w-xl mb-6">
                  A control plane for browser fleets. Rotate across personas, keep sessions signed in,
                  and clear CAPTCHA and MFA — behind four lines of TypeScript. Oya Cloud, your own
                  machines, Browser Use, Browserbase, Steel or Anchor: one setting, not a rewrite.
                </p>
                <div className="mb-8 rounded-xl border border-border bg-bg-card/70 px-4 py-3 font-mono text-[12px] leading-relaxed text-text-muted overflow-x-auto">
                  <span className="text-text-dim select-none">$ </span>npm i @oya/browser<br />
                  <br />
                  <span className="text-indigo">const</span> oya = <span className="text-indigo">new</span> Oya();<br />
                  <span className="text-indigo">const</span> browser = <span className="text-indigo">await</span> oya.browser.start({'{'} persona: <span className="text-accent">&apos;auto&apos;</span> {'}'});<br />
                  <span className="text-indigo">await</span> browser.goto(<span className="text-accent">&apos;https://example.com&apos;</span>);
                </div>
                <div className="flex flex-wrap gap-3">
                  <Link
                    href="/docs"
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent text-[#0c0c0a] text-[15px] font-semibold hover:bg-accent-hover shadow-[0_0_28px_-6px_rgba(57,237,53,0.4)]"
                  >
                    Read the docs
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-border bg-bg-card/60 text-text text-[15px] font-semibold hover:border-accent/30 hover:bg-bg-elevated/80 backdrop-blur-sm"
                  >
                    Open dashboard
                  </Link>
                </div>
              </div>
              <div className="lg:col-span-5 relative hidden lg:block">
                <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-accent/12 via-transparent to-indigo/10 blur-2xl" aria-hidden />
                <div className="relative rounded-2xl border border-border bg-bg-card p-5 shadow-[var(--shadow-elevated)] rotate-[1.5deg] hover:rotate-0 transition-transform duration-500">
                  <div className="flex items-center gap-2 text-[11px] font-mono text-text-dim mb-4">
                    <Terminal className="w-3.5 h-3.5 text-indigo" />
                    <span>analyze_page</span>
                    <span className="text-accent">●</span>
                    <span>live</span>
                  </div>
                  <p className="font-mono text-[11px] leading-relaxed text-text-muted">
                    <span className="text-indigo">url:</span> https://example.com<br />
                    <span className="text-indigo">elements:</span> <span className="text-accent">22</span><br /><br />
                    <span className="text-indigo">[#1 link &quot;Sign in&quot;]</span>{' '}
                    <span className="text-indigo">[#2 button &quot;Start&quot;]</span>
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>

        <section className="mb-16 sm:mb-20 px-4 sm:px-6">
          <div className="max-w-5xl mx-auto rounded-2xl border border-border overflow-hidden bg-bg-card shadow-[var(--shadow-card)] ring-1 ring-white/[0.04]">
            <div className="px-4 py-2 border-b border-border flex items-center justify-between bg-bg-elevated/40">
              <span className="text-[10px] font-mono uppercase tracking-widest text-text-dim">Product film</span>
              <span className="text-[10px] font-mono text-accent">REC</span>
            </div>
            <video autoPlay loop muted playsInline className="w-full block">
              <source src="/oya-browser.mp4" type="video/mp4" />
            </video>
          </div>
        </section>

        <div className="max-w-5xl mx-auto px-6 pb-6">

        {/* ─── THREE KEY FEATURES ─── */}
        <section className="py-14 sm:py-18">
          <SectionLabel>Why Oya Browser</SectionLabel>
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight mb-8 text-text">
            The three things no other browser agent has
          </h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {/* Cookie Sync */}
            <div className="relative group rounded-2xl border border-green-border bg-gradient-to-b from-green-surface to-transparent p-6 hover:border-accent/40 hover:shadow-[0_0_48px_-12px_rgba(57,237,53,0.3)] transition-all duration-300">
              <div className="w-10 h-10 rounded-xl bg-green-surface border border-green-border flex items-center justify-center mb-4">
                <Cookie className="w-5 h-5 text-accent" />
              </div>
              <h3 className="text-[16px] font-bold text-text mb-2">Cookie sync</h3>
              <p className="text-[13px] text-text-muted leading-relaxed">
                Login on your local browser once. Every remote browser in the fleet gets your authenticated sessions automatically. Gmail, Slack, Notion, internal tools — all just work. No re-login. No credential management.
              </p>
            </div>
            {/* Sandboxing */}
            <div className="relative group rounded-2xl border border-indigo/25 bg-gradient-to-b from-indigo/[0.06] to-transparent p-6 hover:border-indigo/40 hover:shadow-[0_0_48px_-12px_rgba(108,180,255,0.3)] transition-all duration-300">
              <div className="w-10 h-10 rounded-xl bg-indigo/15 border border-indigo/25 flex items-center justify-center mb-4">
                <Lock className="w-5 h-5 text-indigo" />
              </div>
              <h3 className="text-[16px] font-bold text-text mb-2">Sandboxed execution</h3>
              <p className="text-[13px] text-text-muted leading-relaxed">
                Each browser runs in its own isolated environment. Agents can&apos;t escape the sandbox, can&apos;t touch your filesystem, can&apos;t interfere with each other. Full browser power with zero risk to your machine.
              </p>
            </div>
            {/* Native Live View */}
            <div className="relative group rounded-2xl border border-yellow/25 bg-gradient-to-b from-yellow/[0.06] to-transparent p-6 hover:border-yellow/40 hover:shadow-[0_0_48px_-12px_rgba(245,166,35,0.3)] transition-all duration-300">
              <div className="w-10 h-10 rounded-xl bg-yellow/15 border border-yellow/25 flex items-center justify-center mb-4">
                <Eye className="w-5 h-5 text-yellow" />
              </div>
              <h3 className="text-[16px] font-bold text-text mb-2">Native live view</h3>
              <p className="text-[13px] text-text-muted leading-relaxed">
                Watch your agent work in real time through a native Chromium view — not a laggy VNC stream or a static screenshot. Smooth, instant, pixel-perfect. Intervene anytime with your own mouse and keyboard.
              </p>
            </div>
          </div>
        </section>

        <section className="py-12 sm:py-14 border-t border-border/80 relative">
          <div className="absolute left-0 top-8 bottom-8 w-px bg-gradient-to-b from-accent/50 via-border to-transparent hidden sm:block" aria-hidden />
          <div className="sm:pl-8">
          <SectionLabel>The problem</SectionLabel>
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight mb-4 text-text">
            AI agents can&apos;t use browsers. The tools are the bottleneck.
          </h2>
          <p className="text-text-muted mb-3 leading-relaxed text-[15px]">
            Playwright, Puppeteer, Selenium — they were built for human testers writing scripts, not for AI. When you connect an AI agent to these tools, it has to parse thousands of lines of raw HTML, guess CSS selectors like <code className="px-1.5 py-0.5 rounded-md bg-bg-elevated border border-border font-mono text-[13px] text-text-muted">div.main &gt; ul:nth-child(3) &gt; li &gt; a</code>, or stare at pixel screenshots trying to figure out where a button is.
          </p>
          <p className="text-text-muted mb-3 leading-relaxed text-[15px]">
            The agent spends more time fighting the browser than doing the actual task. Selectors break when sites update. Screenshots burn tokens and miss context. Every tool puts the hard work on the AI.
          </p>
          <p className="text-text-muted text-[15px]">
            That&apos;s backwards. <strong className="text-text">The browser should do the hard work — not the agent.</strong>
          </p>
          </div>
        </section>

        <section className="py-12 sm:py-14 border-t border-border/80">
          <SectionLabel>The solution</SectionLabel>
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight mb-4 text-text">
            Clean markdown instead of raw HTML
          </h2>
          <p className="text-text-muted mb-3 leading-relaxed text-[15px]">
            Oya Browser returns every page as structured markdown with numbered interactive elements. The AI reads <code className="px-1.5 py-0.5 rounded-md bg-bg-elevated border border-border font-mono text-[13px] text-text-muted">[#13 button &quot;Google Search&quot;]</code> and says <code className="px-1.5 py-0.5 rounded-md bg-bg-elevated border border-border font-mono text-[13px] text-text-muted">click(13)</code>. No vision model. No CSS selector. Just a number.
          </p>
          <p className="text-text-muted leading-relaxed text-[15px]">
            Elements are actual DOM attributes, not screenshot coordinates. Your real browser with cookies, logins, and extensions — sites see a real user, not a bot.
          </p>
        </section>

        <section className="py-12 sm:py-14 border-t border-border/80">
          <SectionLabel>What the AI sees</SectionLabel>
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight mb-5 text-text">
            Pages as markdown. Click by number.
          </h2>
          <CodeBlock title="analyze_page output">
            <span className="text-text-dim">{'# analyze_page response'}</span>{'\n\n'}
            <span className="text-indigo">url:</span> <span className="text-yellow">https://google.com</span>{'\n'}
            <span className="text-indigo">title:</span> <span className="text-text-muted">Google</span>{'\n'}
            <span className="text-indigo">elements:</span> <span className="text-indigo">22</span>{'\n\n'}
            <span className="text-text-dim">{'---'}</span>{'\n\n'}
            <span className="text-indigo">[#1 link &quot;About&quot;]</span> <span className="text-indigo">[#2 link &quot;Store&quot;]</span>{'\n'}
            <span className="text-indigo">[#3 link &quot;Gmail&quot;]</span> <span className="text-indigo">[#4 link &quot;Images&quot;]</span>{'\n\n'}
            <span className="text-text-dim">{'<!-- main content -->'}</span>{'\n'}
            <span className="text-text-muted">Google</span>{'\n\n'}
            <span className="text-indigo">[#9 textarea &quot;Search&quot;]</span>{'\n'}
            <span className="text-indigo">[#13 button &quot;Google Search&quot;]</span>{'\n'}
            <span className="text-indigo">[#14 button &quot;I&apos;m Feeling Lucky&quot;]</span>{'\n\n'}
            <span className="text-text-dim">{'---'}</span>{'\n\n'}
            <span className="text-accent">{'> '}</span><span className="text-text-muted">AI calls: </span><span className="text-yellow">type(9, &quot;best MCP tools&quot;)</span>{'\n'}
            <span className="text-accent">{'> '}</span><span className="text-text-muted">AI calls: </span><span className="text-yellow">click(13)</span>
          </CodeBlock>
        </section>

        <section className="py-12 sm:py-14 border-t border-border/80">
          <SectionLabel>MCP config</SectionLabel>
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight mb-4 text-text">
            Connect any MCP client
          </h2>
          <p className="text-text-muted mb-4 leading-relaxed text-[15px]">
            Get your endpoint from the <Link href="/dashboard" className="text-accent hover:text-accent-hover underline underline-offset-4 decoration-accent/40">dashboard</Link>. Paste the JSON config into Cursor, Claude Desktop, Windsurf, or any MCP-compatible client.
          </p>
          <CodeBlock copyText={mcpConfig} title="mcp.json">
            <span className="text-text-dim">{'// Per-browser MCP endpoint'}</span>{'\n'}
            <span className="text-text-muted">{'{'}</span>{'\n'}
            <span className="text-text-muted">{'  '}</span><span className="text-indigo">&quot;mcpServers&quot;</span><span className="text-text-muted">: {'{'}</span>{'\n'}
            <span className="text-text-muted">{'    '}</span><span className="text-indigo">&quot;oya-browser&quot;</span><span className="text-text-muted">: {'{'}</span>{'\n'}
            <span className="text-text-muted">{'      '}</span><span className="text-indigo">&quot;url&quot;</span><span className="text-text-muted">: </span><span className="text-yellow">&quot;https://browser.getoya.ai/mcp/YOUR_ID&quot;</span><span className="text-text-muted">,</span>{'\n'}
            <span className="text-text-muted">{'      '}</span><span className="text-indigo">&quot;transport&quot;</span><span className="text-text-muted">: </span><span className="text-yellow">&quot;streamable-http&quot;</span><span className="text-text-muted">,</span>{'\n'}
            <span className="text-text-muted">{'      '}</span><span className="text-indigo">&quot;headers&quot;</span><span className="text-text-muted">: {'{'}</span>{'\n'}
            <span className="text-text-muted">{'        '}</span><span className="text-indigo">&quot;Authorization&quot;</span><span className="text-text-muted">: </span><span className="text-yellow">&quot;Bearer YOUR_API_KEY&quot;</span>{'\n'}
            <span className="text-text-muted">{'      }'}</span>{'\n'}
            <span className="text-text-muted">{'    }'}</span>{'\n'}
            <span className="text-text-muted">{'  }'}</span>{'\n'}
            <span className="text-text-muted">{'}'}</span>
          </CodeBlock>
        </section>

        <section id="pool" className="py-12 sm:py-14 border-t border-border/80 scroll-mt-20">
          <SectionLabel>Pool mode</SectionLabel>
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight mb-4 text-text">
            Scale to 1,000 browsers as one endpoint
          </h2>
          <p className="text-text-muted mb-4 leading-relaxed text-[15px]">
            One fleet token. One MCP endpoint. The server round-robins commands across every connected browser. Cookies sync automatically. Scale horizontally with zero config.
          </p>
          <CodeBlock copyText={poolConfig} title="pool mcp.json">
            <span className="text-text-dim">{'// One endpoint for all browsers'}</span>{'\n'}
            <span className="text-text-muted">{'{'}</span>{'\n'}
            <span className="text-text-muted">{'  '}</span><span className="text-indigo">&quot;mcpServers&quot;</span><span className="text-text-muted">: {'{'}</span>{'\n'}
            <span className="text-text-muted">{'    '}</span><span className="text-indigo">&quot;oya-pool&quot;</span><span className="text-text-muted">: {'{'}</span>{'\n'}
            <span className="text-text-muted">{'      '}</span><span className="text-indigo">&quot;url&quot;</span><span className="text-text-muted">: </span><span className="text-yellow">&quot;https://browser.getoya.ai/mcp/pool&quot;</span><span className="text-text-muted">,</span>{'\n'}
            <span className="text-text-muted">{'      '}</span><span className="text-indigo">&quot;transport&quot;</span><span className="text-text-muted">: </span><span className="text-yellow">&quot;streamable-http&quot;</span><span className="text-text-muted">,</span>{'\n'}
            <span className="text-text-muted">{'      '}</span><span className="text-indigo">&quot;headers&quot;</span><span className="text-text-muted">: {'{'}</span>{'\n'}
            <span className="text-text-muted">{'        '}</span><span className="text-indigo">&quot;Authorization&quot;</span><span className="text-text-muted">: </span><span className="text-yellow">&quot;Bearer YOUR_FLEET_TOKEN&quot;</span>{'\n'}
            <span className="text-text-muted">{'      }'}</span>{'\n'}
            <span className="text-text-muted">{'    }'}</span>{'\n'}
            <span className="text-text-muted">{'  }'}</span>{'\n'}
            <span className="text-text-muted">{'}'}</span>
          </CodeBlock>
        </section>

        <section id="anonymity" className="py-12 sm:py-14 border-t border-border/80 scroll-mt-20">
          <SectionLabel>Anonymity</SectionLabel>
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight mb-4 text-text">
            One persona is one device
          </h2>
          <p className="text-text-muted mb-6 leading-relaxed text-[15px]">
            A persona is a fingerprint, a cookie jar and a proxy, bound together and stable for its
            life. That binding is the point: one account seen from many devices reads as a bot farm,
            and one device across many accounts reads as a device farm. Rotation means choosing a
            different persona — never giving one a new fingerprint.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {[
              { icon: Fingerprint, title: 'Stable fingerprints', desc: 'Derived from a stored seed, byte-identical across restarts — a returning session looks like a returning device' },
              { icon: Shield, title: 'Stealth, measured', desc: 'Scored against real detectors rather than asserted. Run oya stealth-test and read the number' },
              { icon: Globe, title: 'Proxy per persona', desc: 'Sticky HTTP exit per identity, with a timezone-versus-geo coherence check. Credentials sealed at rest' },
              { icon: X, title: 'Capped concurrency', desc: 'One laptop cannot be in a thousand places at once, so each persona has a visible ceiling' },
            ].map((f) => (
              <div
                key={f.title}
                className="group rounded-xl border border-border bg-bg-card/80 p-4 hover:border-accent/30 hover:bg-bg-elevated/60 hover:shadow-[0_0_32px_-12px_rgba(57,237,53,0.25)] transition-all duration-300"
              >
                <f.icon className="w-4 h-4 text-accent mb-2.5" />
                <p className="text-[13px] font-semibold text-text mb-1.5">{f.title}</p>
                <p className="text-[11px] text-text-muted leading-snug">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="tools" className="py-12 sm:py-14 border-t border-border/80 scroll-mt-20">
          <SectionLabel>MCP Tools</SectionLabel>
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight mb-6 text-text">
            15 tools. Full browser control.
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {tools.map((t) => (
              <div
                key={t.name}
                className="group rounded-xl border border-border bg-bg-card/80 p-3.5 hover:border-accent/30 hover:bg-bg-elevated/60 hover:shadow-[0_0_32px_-12px_rgba(57,237,53,0.25)] transition-all duration-300"
              >
                <p className="font-mono text-[11px] font-semibold text-accent mb-1.5 tracking-tight">{t.name}</p>
                <p className="text-[11px] text-text-muted leading-snug group-hover:text-text-muted/90">{t.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="download" className="py-12 sm:py-14 border-t border-border/80 scroll-mt-20">
          <SectionLabel>Download</SectionLabel>
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight mb-4 text-text">
            Get started in minutes
          </h2>
          <p className="text-text-muted mb-6 leading-relaxed text-[15px]">
            Download Oya Browser, connect your API key, and let AI control your real Chrome. Free to use.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <a
              href="/downloads/Oya.Browser-1.0.44-universal.dmg"
              className="flex flex-col rounded-xl border border-border bg-bg-card/80 p-6 hover:border-accent/25 transition-colors shadow-[var(--shadow-card)]"
            >
              <h3 className="text-[15px] font-semibold mb-1 text-text">macOS</h3>
              <p className="text-[12px] text-text-muted mb-4 flex-1">Universal — Intel + Apple Silicon</p>
              <span className="inline-block bg-accent text-[#0c0c0a] px-5 py-2.5 rounded-lg text-[13px] font-semibold text-center hover:bg-accent-hover">
                Download .dmg
              </span>
            </a>
            <a
              href="/downloads/Oya.Browser-1.0.44-arm64.AppImage"
              className="flex flex-col rounded-xl border border-border bg-bg-card/80 p-6 hover:border-accent/25 transition-colors shadow-[var(--shadow-card)]"
            >
              <h3 className="text-[15px] font-semibold mb-1 text-text">Linux</h3>
              <p className="text-[12px] text-text-muted mb-4 flex-1">ARM64 AppImage</p>
              <span className="inline-block bg-accent text-[#0c0c0a] px-5 py-2.5 rounded-lg text-[13px] font-semibold text-center hover:bg-accent-hover">
                Download .AppImage
              </span>
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
