'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Check, Copy, Fingerprint, Globe2, Layers, Monitor, Terminal, Menu, X, ChevronRight, Command, Play, ShieldCheck } from 'lucide-react';
import { OyaWordmark, OyaLogo } from '@/components/oya-logo';
import ThemeToggle from '@/components/theme-toggle';
import SyntaxCode from '@/components/ui/syntax-code';

const examples = [
  { label: 'TypeScript', language: 'typescript' as const, file: 'browser.ts', code: `import { Oya } from "@oya/browser";

const oya = new Oya();
const browser = await oya.browser.start({
  persona: "acme-ops",
});

await browser.goto("https://example.com");
const page = await browser.analyze();
await browser.click(page.elements[0].id);` },
  { label: 'CLI', language: 'bash' as const, file: 'Terminal', code: `npm install -g oya
oya login
oya init

oya personas new acme-ops
oya start --persona acme-ops
oya goto https://example.com
oya ask "Find the pricing page"
oya ls` },
  { label: 'MCP', language: 'json' as const, file: 'mcp.json', code: `{
  "mcpServers": {
    "oya-browser": {
      "url": "https://browser.getoya.ai/mcp/pool",
      "headers": {
        "Authorization": "Bearer <your-api-key>"
      }
    }
  }
}` },
];
const demoBrowsers = [
  { name: 'Research workspace', provider: 'Oya Cloud', profile: 'research', page: 'example.com', action: 'Analyzing the page', health: 'Running' },
  { name: 'Operations', provider: 'Steel', profile: 'acme-ops', page: 'shop.example', action: 'Waiting for your next command', health: 'Ready' },
  { name: 'Personal browser', provider: 'Desktop', profile: 'personal', page: 'about:blank', action: 'Connected to your desktop', health: 'Ready' },
];

function ProductPreview() {
  const [selected, setSelected] = useState(0);
  const browser = demoBrowsers[selected];
  return <div className="product-preview" aria-label="Interactive browser console preview">
    <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
      <div className="flex items-center gap-2.5"><OyaLogo size={19} /><span className="text-[12px] font-medium">Workspace</span><ChevronRight size={13} className="text-text-dim" /><span className="text-[12px] text-text-muted">Browsers</span></div>
      <span className="eyebrow text-text-dim">Product preview</span>
    </div>
    <div className="grid min-w-0 md:grid-cols-[1.45fr_1fr]">
      <div className="min-w-0 md:border-r border-border">
        <div className="flex items-center justify-between px-5 py-5"><span className="text-[15px] font-semibold">Your browsers <span className="ml-2 text-text-dim">03</span></span><span className="flex items-center gap-1.5 text-[11px] text-text-muted"><span className="h-1.5 w-1.5 rounded-full bg-accent" />All connected</span></div>
        <div className="preview-columns border-y border-border bg-bg-sunken/60 py-2 text-[10px] uppercase tracking-widest text-text-dim"><span>Browser</span><span>Provider</span><span>Status</span></div>
        {demoBrowsers.map((row, index) => <button key={row.name} onClick={() => setSelected(index)} aria-pressed={index === selected} className={`preview-columns w-full border-b border-border/60 py-4 text-left ${index === selected ? 'bg-accent/[0.06]' : 'hover:bg-text/[0.03]'}`}>
          <span className="flex min-w-0 items-center gap-3"><Monitor size={15} className={index === selected ? 'text-accent shrink-0' : 'text-text-dim shrink-0'} /><span className="min-w-0"><span className="block truncate text-[12px] font-medium">{row.name}</span><span className="mt-1 block truncate font-mono text-[10px] text-text-dim">{row.profile}</span></span></span><span className="text-[11px] text-text-muted">{row.provider}</span><span className="text-[10px] text-accent">{row.health}</span>
        </button>)}
        <div className="flex items-center gap-2 px-5 py-4 text-[10px] text-text-dim"><Command size={11} />One workspace. Every provider.</div>
      </div>
      <div className="flex min-w-0 flex-col p-5">
        <div className="flex items-center justify-between gap-2"><span className="truncate text-[12px] font-medium">{browser.name}</span><span className="eyebrow text-accent">Connected</span></div>
        <div className="mt-4 flex items-center gap-2 rounded-md border border-border bg-bg-sunken px-3 py-2 font-mono text-[10px] text-text-muted"><ShieldCheck size={11} />{browser.page}</div>
        <div className="my-4 flex flex-1 items-center justify-center rounded-lg border border-border bg-bg-sunken p-6"><div className="text-center"><Globe2 size={26} strokeWidth={1} className="mx-auto mb-3 text-text-dim" /><p className="text-[13px] font-medium">A browser your agent can use.</p><p className="mt-2 text-[11px] text-text-dim">Observe. Act. Keep going.</p></div></div>
        <p aria-live="polite" className="flex items-center gap-2 text-[11px] text-text-muted"><span className="h-1.5 w-1.5 rounded-full bg-accent" />{browser.action}</p>
      </div>
    </div>
  </div>;
}

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [example, setExample] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const snippet = examples[example];
  async function copyCode() {
    try { await navigator.clipboard.writeText(snippet.code); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setCopyError('Select the code below to copy it.'); }
  }
  return <div className="marketing-page min-h-screen bg-bg text-text">
    <header className="sticky top-0 z-30 border-b border-border bg-bg/95 backdrop-blur-md">
      <div className="site-width flex h-[72px] items-center justify-between gap-5">
        <OyaWordmark />
        <nav aria-label="Main navigation" className="hidden items-center gap-8 text-[13px] text-text-muted md:flex"><a href="#product" className="hover:text-text">Product</a><a href="#developers" className="hover:text-text">Developers</a><Link href="/docs" className="hover:text-text">Documentation</Link></nav>
        <div className="flex items-center gap-3"><ThemeToggle /><Link href="/dashboard" className="btn-primary h-9 px-4 text-[12px]">Open console <ArrowUpRight size={13} /></Link><button className="btn-icon md:hidden" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={19} /> : <Menu size={19} />}</button></div>
      </div>
      {menuOpen && <nav aria-label="Mobile navigation" className="site-width flex flex-col gap-4 border-t border-border py-5 text-sm"><a href="#product" onClick={() => setMenuOpen(false)}>Product</a><a href="#developers" onClick={() => setMenuOpen(false)}>Developers</a><Link href="/docs">Documentation</Link></nav>}
    </header>
    <main>
      <section className="site-width pt-16 pb-12 sm:pt-24 sm:pb-20">
        <div className="grid items-end gap-8 lg:grid-cols-[1.3fr_1fr] lg:gap-16">
          <div><p className="eyebrow mb-6 flex items-center gap-2 text-text-muted"><span className="h-1.5 w-1.5 rounded-full bg-accent" />Browser infrastructure for agents</p><h1 className="marketing-title">Your agents.<br />The whole <span className="text-accent">web.</span></h1></div>
          <div className="pb-1 lg:max-w-[385px]"><p className="text-[17px] leading-[1.75] text-text-muted">Give your agents real browsers, persistent identities, and a workspace to run it all. Across the cloud, your desktop, and the providers you already use.</p><div className="mt-7 flex flex-wrap items-center gap-6"><Link href="/dashboard" className="btn-primary h-11 px-5">Start building <ArrowRight size={15} /></Link><Link href="/docs#quickstart" className="inline-flex items-center gap-2 text-[13px] font-medium hover:text-accent">Read the quickstart <ArrowUpRight size={14} /></Link></div></div>
        </div>
        <div id="product" className="mt-14 scroll-mt-24 sm:mt-16"><ProductPreview /></div>
        <div className="mt-7 flex flex-wrap items-center justify-between gap-x-7 gap-y-4 text-[12px] text-text-muted"><span className="eyebrow text-text-dim">One API. Your choice of provider.</span>{['Oya Cloud', 'Browserbase', 'Steel', 'Anchor', 'Browser Use', 'Your Chrome'].map(p => <span key={p}>{p}</span>)}</div>
      </section>
      <section className="site-width section-space border-t border-border">
        <div className="grid gap-6 lg:grid-cols-[1fr_1.35fr]"><div><p className="eyebrow mb-5 text-accent">Built around your workflow</p><h2 className="marketing-heading max-w-sm">A browser is just<br />the beginning.</h2></div><p className="max-w-xl text-[17px] leading-[1.75] text-text-muted lg:pt-9">Keep the identity. Change the provider. See every browser in one place, and step in whenever your agent needs a hand.</p></div>
        <div className="mt-12 grid gap-8 md:grid-cols-3 md:gap-12">{[
          { icon: Fingerprint, title: 'A session that remembers.', text: 'Profiles keep a stable device identity and saved logins. Sign in on desktop, then use that profile from your agent.' },
          { icon: Layers, title: 'One API. More possibilities.', text: 'Work with Oya Cloud, external providers, or your own Chrome through a shared SDK, CLI, and MCP interface.' },
          { icon: Monitor, title: 'Always within reach.', text: 'Watch browsers live, inspect their activity, and take control. Your entire fleet stays visible in one workspace.' },
        ].map((item, index) => <div key={item.title} className="border-t border-border pt-5"><div className="mb-7 flex items-center justify-between"><item.icon size={22} strokeWidth={1.4} className="text-text-muted" /><span className="font-mono text-[10px] text-text-dim">0{index+1}</span></div><h3 className="text-[18px] font-semibold tracking-tight">{item.title}</h3><p className="mt-3 text-[14px] leading-7 text-text-muted">{item.text}</p></div>)}</div>
      </section>
      <section id="developers" className="site-width section-space scroll-mt-16 border-t border-border">
        <div className="grid items-start gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20"><div><p className="eyebrow mb-5 text-accent">Developer first</p><h2 className="marketing-heading">From an idea<br />to a running browser.</h2><p className="mt-5 max-w-sm text-[15px] leading-7 text-text-muted">Use TypeScript, work from your terminal, or connect your preferred agent with MCP. The browser stays the same.</p><Link href="/docs" className="mt-7 inline-flex items-center gap-2 text-[13px] font-medium hover:text-accent">Explore the documentation <ArrowRight size={15} /></Link><div className="mt-10 flex items-center gap-3 border-t border-border pt-5 text-[12px] text-text-dim"><Terminal size={15} /><code>npm install @oya/browser</code></div></div>
          <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-bg-card"><div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2"><div role="tablist" aria-label="Integration language" className="flex gap-1">{examples.map((item,i)=><button key={item.label} role="tab" aria-selected={example===i} aria-controls="integration-code" onClick={()=>{setExample(i);setCopied(false);setCopyError('');}} className={`rounded-md px-3 py-2 text-[12px] ${example===i?'bg-text/5 text-text':'text-text-dim hover:text-text'}`}>{item.label}</button>)}</div><button aria-label="Copy example" onClick={copyCode} className="btn-icon">{copied?<Check size={14}/>:<Copy size={14}/>}</button></div><div id="integration-code" role="tabpanel" aria-label={snippet.label}><div className="px-5 pt-4 font-mono text-[10px] text-text-dim">{snippet.file}</div><pre className="min-h-[295px] overflow-x-auto p-5 font-mono text-[12px] leading-[1.9]"><SyntaxCode code={snippet.code} language={snippet.language}/></pre></div>{copyError&&<p role="status" className="px-5 pb-4 text-xs text-text-muted">{copyError}</p>}</div>
        </div>
      </section>
      <section className="site-width section-space border-t border-border"><div className="mb-8 flex flex-wrap items-end justify-between gap-5"><div><p className="eyebrow mb-4 text-accent">See it in action</p><h2 className="marketing-heading">A little less abstract.</h2></div><span className="flex items-center gap-2 text-[12px] text-text-dim"><Play size={12}/>Oya Browser walkthrough</span></div><video controls playsInline preload="none" poster="/oya-browser-poster.jpg" aria-label="Oya Browser product walkthrough" className="aspect-video w-full rounded-xl border border-border bg-bg-card"><source src="/oya-browser.mp4" type="video/mp4"/></video></section>
      <section className="site-width section-space grid gap-10 border-t border-border md:grid-cols-2 md:gap-20"><div id="download" className="scroll-mt-24"><Monitor size={23} strokeWidth={1.4} className="mb-6 text-text-muted"/><h2 className="text-[25px] font-semibold tracking-tight">Start on your desktop.</h2><p className="mt-3 max-w-md text-[14px] leading-7 text-text-muted">Sign in to your sites and save a profile for your agents. Your own browser, connected to your workspace.</p><a className="mt-6 inline-flex items-center gap-2 text-[13px] font-medium hover:text-accent" href="/downloads/Oya.Browser-1.0.46-universal.dmg">Download for macOS <ArrowUpRight size={14}/></a><p className="mt-2 text-[11px] text-text-dim">Apple Silicon & Intel</p></div><div id="self-host" className="scroll-mt-24"><Layers size={23} strokeWidth={1.4} className="mb-6 text-text-muted"/><h2 className="text-[25px] font-semibold tracking-tight">Run it on your terms.</h2><p className="mt-3 max-w-md text-[14px] leading-7 text-text-muted">Bring your own infrastructure, browser provider, or Chrome connection. Configure your workspace once and keep using the same interface.</p><Link href="/docs#settings" className="mt-6 inline-flex items-center gap-2 text-[13px] font-medium hover:text-accent">Explore configuration <ArrowUpRight size={14}/></Link></div></section>
      <section className="border-y border-border bg-bg-card/40"><div className="site-width flex flex-col items-start justify-between gap-8 py-14 sm:flex-row sm:items-center"><div><p className="eyebrow mb-4 text-text-dim">Your next move</p><h2 className="marketing-heading">Put your agents to work.</h2></div><Link href="/dashboard" className="btn-primary h-12 shrink-0 px-6">Open your workspace <ArrowRight size={16}/></Link></div></section>
    </main>
    <footer className="site-width flex flex-wrap items-center justify-between gap-6 py-9"><OyaWordmark/><div className="flex items-center gap-6 text-[12px] text-text-muted"><Link href="/docs">Documentation</Link><Link href="/dashboard">Console</Link><span className="text-text-dim">Built by Oya</span></div></footer>
  </div>;
}
