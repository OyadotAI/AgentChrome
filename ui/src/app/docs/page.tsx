'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Search,
  X,
  ArrowLeft,
  ExternalLink,
  ChevronRight,
  BookOpen,
  Terminal,
  Code,
  Globe,
  Zap,
  Menu,
  Shield,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SearchIndexEntry {
  text: string;
  id: string;
  tag: string;
}

interface SearchHit {
  id: string;
  snippet: string;
  tag: string;
}

/* ------------------------------------------------------------------ */
/*  Docs Page                                                          */
/* ------------------------------------------------------------------ */

export default function DocsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---- Search index ---- */
  const searchIndex = useMemo<SearchIndexEntry[]>(() => {
    const items: [string, string, string][] = [
      ['Documentation', '', 'H1'],
      ['Everything you need to connect your browser to AI agents via Oya Browser.', '', 'P'],
      ['Quickstart', 'quickstart', 'H2'],
      ['Go to the dashboard and click Generate to create an API key', 'quickstart', 'LI'],
      ['Download Oya Browser for your OS', 'quickstart', 'LI'],
      ['Open the app, enter wss://browser.getoya.ai/ws as server URL and paste your API key', 'quickstart', 'LI'],
      ['Your browser appears in the dashboard — you can now send commands or connect AI tools', 'quickstart', 'LI'],
      ['Create API Key', 'create-key', 'H2'],
      ['Go to the dashboard. Click the green Generate button next to the API key field.', 'create-key', 'P'],
      ['Your key is scoped — you only see browsers connected with your key.', 'create-key', 'P'],
      ['Save your key somewhere safe. If you lose it, you\'ll need to generate a new one.', 'create-key', 'P'],
      ['Download Browser', 'download', 'H2'],
      ['macOS (Intel + Apple Silicon)', 'download', 'TD'],
      ['Linux (arm64)', 'download', 'TD'],
      ['Running multiple instances', 'download', 'H3'],
      ['Connect', 'connect', 'H2'],
      ['Open Oya Browser. The setup screen appears on first launch.', 'connect', 'P'],
      ['MCP Setup', 'mcp-setup', 'H2'],
      ['Oya Browser exposes each connected browser as an MCP server', 'mcp-setup', 'P'],
      ['Cursor', 'cursor', 'H3'],
      ['Claude Desktop', 'claude-desktop', 'H3'],
      ['Claude Code', 'claude-code', 'H3'],
      ['analyze_page', 'analyze_page', 'H2'],
      ['Analyzes the current page. Returns the full page as structured markdown with every interactive element numbered.', 'analyze_page', 'P'],
      ['navigate', 'navigate', 'H2'],
      ['Navigate the browser to a URL.', 'navigate', 'P'],
      ['click', 'click', 'H2'],
      ['Click an interactive element by its ID number from analyze_page.', 'click', 'P'],
      ['type', 'type', 'H2'],
      ['Type text into an input element.', 'type', 'P'],
      ['press_key', 'press_key', 'H2'],
      ['Press a keyboard key.', 'press_key', 'P'],
      ['screenshot', 'screenshot', 'H2'],
      ['Capture the visible tab as a base64 PNG image.', 'screenshot', 'P'],
      ['scroll', 'scroll', 'H2'],
      ['Scroll the page up or down.', 'scroll', 'P'],
      ['Tab Management', 'tabs', 'H2'],
      ['list_tabs', 'tabs', 'H3'],
      ['open_tab', 'tabs', 'H3'],
      ['switch_tab', 'tabs', 'H3'],
      ['close_tab', 'tabs', 'H3'],
      ['wait', 'wait', 'H2'],
      ['Wait for an element matching a CSS selector to appear on the page.', 'wait', 'P'],
      ['Anonymity', 'anonymity', 'H2'],
      ['Manage browser profiles with unique fingerprints, proxy routing, and isolated cookie stores', 'anonymity', 'P'],
      ['Fingerprint Spoofing', 'fingerprint', 'H3'],
      ['Canvas, WebGL, AudioContext, font, and ClientRects noise per profile', 'fingerprint', 'P'],
      ['Proxy Support', 'proxy-support', 'H3'],
      ['SOCKS5 and HTTP proxy per profile with DNS leak prevention', 'proxy-support', 'P'],
      ['Anti-Detection Stealth', 'stealth', 'H3'],
      ['Removes Electron markers, fixes window.chrome, navigator.webdriver, plugins', 'stealth', 'P'],
      ['list_profiles', 'list_profiles', 'H2'],
      ['List all available anonymity profiles with their platform, timezone, and proxy status', 'list_profiles', 'P'],
      ['create_profile', 'create_profile', 'H2'],
      ['Create a new anonymity profile with randomized fingerprint and optional proxy', 'create_profile', 'P'],
      ['set_profile', 'set_profile', 'H2'],
      ['Switch to a different profile — reloads all tabs with new fingerprint, proxy, and cookies', 'set_profile', 'P'],
      ['Dashboard', 'dashboard-overview', 'H2'],
      ['The dashboard at /dashboard is the control panel.', 'dashboard-overview', 'P'],
      ['Chat', 'chat', 'H3'],
      ['Natural language browser control with formatted responses and tool badges', 'chat', 'P'],
      ['Dev Panel', 'chat', 'H3'],
      ['Chat, Actions, Network, and Source tabs in the desktop app dev panel', 'chat', 'P'],
      ['Live View', 'live-view', 'H3'],
      ['Settings', 'settings', 'H3'],
      ['REST API', 'rest-api', 'H2'],
      ['All endpoints require Authorization: Bearer YOUR_API_KEY header', 'rest-api', 'P'],
      ['Command API Reference', 'command-api', 'H3'],
      ['Navigation Actions', 'command-api', 'H3'],
      ['Page Analysis Actions', 'command-api', 'H3'],
      ['Interaction Actions', 'command-api', 'H3'],
      ['WebSocket Protocol', 'websocket', 'H2'],
      ['Browsers connect via WebSocket at wss://browser.getoya.ai/ws.', 'websocket', 'P'],
    ];
    return items
      .filter(([text]) => text.length >= 3)
      .map(([text, id, tag]) => ({ text, id, tag }));
  }, []);

  /* ---- Search logic ---- */
  const doSearch = useCallback(
    (q: string) => {
      const query = q.trim().toLowerCase();
      if (!query || query.length < 2) {
        setSearchResults([]);
        setShowResults(false);
        return;
      }
      const hits: SearchHit[] = [];
      const seen = new Set<string>();
      for (const entry of searchIndex) {
        const lower = entry.text.toLowerCase();
        const pos = lower.indexOf(query);
        if (pos === -1) continue;
        const key = entry.id + '|' + entry.text.slice(0, 40);
        if (seen.has(key)) continue;
        seen.add(key);
        const start = Math.max(0, pos - 30);
        const end = Math.min(entry.text.length, pos + query.length + 30);
        const snippet =
          (start > 0 ? '...' : '') +
          entry.text.slice(start, end) +
          (end < entry.text.length ? '...' : '');
        hits.push({ id: entry.id, snippet, tag: entry.tag });
        if (hits.length >= 12) break;
      }
      setSearchResults(hits);
      setShowResults(true);
    },
    [searchIndex],
  );

  const handleSearchInput = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(value), 150);
    },
    [doSearch],
  );

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchQuery('');
        doSearch('');
        searchInputRef.current?.blur();
      }
    },
    [doSearch],
  );

  const handleResultClick = useCallback(
    (id: string) => {
      setSearchQuery('');
      setShowResults(false);
      setSearchResults([]);
      setMobileMenuOpen(false);
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [],
  );

  /* ---- "/" shortcut ---- */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && (document.activeElement as HTMLElement)?.tagName !== 'INPUT') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  /* ---- Lock body scroll when mobile menu open ---- */
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  /* ---- Sidebar nav click (close mobile menu + scroll) ---- */
  const navClick = useCallback((id: string) => {
    setMobileMenuOpen(false);
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Sidebar contents (shared between desktop + mobile)               */
  /* ---------------------------------------------------------------- */
  const sidebarContent = (
    <>
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2 text-text font-bold text-base mb-6 hover:opacity-80 transition-opacity">
        <div className="w-6 h-6 rounded-md bg-accent flex items-center justify-center">
          <Globe className="w-3.5 h-3.5 text-white" />
        </div>
        Oya Browser
      </Link>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-dim pointer-events-none" />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search docs..."
          className="w-full bg-bg-elevated border border-border rounded-lg py-2 pl-8 pr-8 text-text text-sm outline-none placeholder:text-text-dim focus:border-indigo transition-colors"
          value={searchQuery}
          onChange={(e) => handleSearchInput(e.target.value)}
          onKeyDown={handleSearchKeyDown}
        />
        {searchQuery && (
          <button
            onClick={() => { setSearchQuery(''); doSearch(''); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-dim hover:text-text transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Search results dropdown */}
      {showResults && (
        <div className="mb-4 bg-bg-card border border-border rounded-xl overflow-hidden shadow-lg shadow-black/30">
          {searchResults.length === 0 ? (
            <div className="text-xs text-text-dim px-3 py-2">No results</div>
          ) : (
            searchResults.map((hit, i) => (
              <button
                key={i}
                onClick={() => handleResultClick(hit.id)}
                className="w-full text-left block text-xs px-3 py-2 text-text-muted hover:bg-bg-elevated hover:text-text transition-colors cursor-pointer border-b border-border last:border-b-0"
              >
                <span className="text-text-dim text-[11px] leading-snug">{hit.snippet}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Nav sections */}
      <NavSection icon={<Zap className="w-3 h-3" />} label="Getting Started">
        <NavLink onClick={() => navClick('quickstart')}>Quickstart</NavLink>
        <NavLink onClick={() => navClick('create-key')}>Create API Key</NavLink>
        <NavLink onClick={() => navClick('download')}>Download Browser</NavLink>
        <NavLink onClick={() => navClick('connect')}>Connect</NavLink>
      </NavSection>

      <NavSection icon={<BookOpen className="w-3 h-3" />} label="AI Integration">
        <NavLink onClick={() => navClick('mcp-setup')}>MCP Setup</NavLink>
        <NavLink onClick={() => navClick('cursor')}>Cursor</NavLink>
        <NavLink onClick={() => navClick('claude-desktop')}>Claude Desktop</NavLink>
        <NavLink onClick={() => navClick('claude-code')}>Claude Code</NavLink>
      </NavSection>

      <NavSection icon={<Terminal className="w-3 h-3" />} label="MCP Tools">
        <NavLink onClick={() => navClick('analyze_page')}>analyze_page</NavLink>
        <NavLink onClick={() => navClick('navigate')}>navigate</NavLink>
        <NavLink onClick={() => navClick('click')}>click</NavLink>
        <NavLink onClick={() => navClick('type')}>type</NavLink>
        <NavLink onClick={() => navClick('press_key')}>press_key</NavLink>
        <NavLink onClick={() => navClick('screenshot')}>screenshot</NavLink>
        <NavLink onClick={() => navClick('scroll')}>scroll</NavLink>
        <NavLink onClick={() => navClick('tabs')}>Tab management</NavLink>
        <NavLink onClick={() => navClick('wait')}>wait</NavLink>
      </NavSection>

      <NavSection icon={<Shield className="w-3 h-3" />} label="Anonymity">
        <NavLink onClick={() => navClick('anonymity')}>Overview</NavLink>
        <NavLink onClick={() => navClick('fingerprint')}>Fingerprint Spoofing</NavLink>
        <NavLink onClick={() => navClick('proxy-support')}>Proxy Support</NavLink>
        <NavLink onClick={() => navClick('stealth')}>Anti-Detection</NavLink>
        <NavLink onClick={() => navClick('list_profiles')}>list_profiles</NavLink>
        <NavLink onClick={() => navClick('create_profile')}>create_profile</NavLink>
        <NavLink onClick={() => navClick('set_profile')}>set_profile</NavLink>
      </NavSection>

      <NavSection icon={<Globe className="w-3 h-3" />} label="Dashboard">
        <NavLink onClick={() => navClick('dashboard-overview')}>Overview</NavLink>
        <NavLink onClick={() => navClick('chat')}>Chat</NavLink>
        <NavLink onClick={() => navClick('live-view')}>Live View</NavLink>
        <NavLink onClick={() => navClick('settings')}>Settings</NavLink>
      </NavSection>

      <NavSection icon={<Code className="w-3 h-3" />} label="API">
        <NavLink onClick={() => navClick('rest-api')}>REST API</NavLink>
        <NavLink onClick={() => navClick('command-api')}>Command Reference</NavLink>
        <a
          href="/swagger"
          className="flex items-center gap-1 text-[13px] text-text-muted hover:text-text py-1 transition-colors"
        >
          Swagger UI <ExternalLink className="w-3 h-3" />
        </a>
        <NavLink onClick={() => navClick('websocket')}>WebSocket Protocol</NavLink>
      </NavSection>

      {/* Bottom links */}
      <div className="mt-auto pt-5 border-t border-border space-y-1.5">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-xs text-text-dim hover:text-text transition-colors"
        >
          <ArrowLeft className="w-3 h-3" /> Back to home
        </Link>
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 text-xs text-text-dim hover:text-text transition-colors"
        >
          <ChevronRight className="w-3 h-3" /> Open Dashboard
        </Link>
        <a
          href="/llms.txt"
          className="block text-[11px] text-text-dim/60 hover:text-text-dim transition-colors mt-2"
        >
          llms.txt (plain text for AI)
        </a>
        <div className="text-[10px] text-text-dim/40 mt-2">
          Press{' '}
          <kbd className="bg-bg-elevated border border-border rounded px-1 py-0.5 font-mono text-[10px]">
            /
          </kbd>{' '}
          to search
        </div>
      </div>
    </>
  );

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <div className="flex min-h-screen bg-bg">
      {/* ---- Mobile hamburger button ---- */}
      <button
        onClick={() => setMobileMenuOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 bg-bg-card border border-border rounded-lg p-2 text-text-muted hover:text-text hover:border-border-focus transition-colors"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* ---- Mobile overlay ---- */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* ---- Mobile sidebar (slide-in) ---- */}
      <aside
        className={`
          lg:hidden fixed inset-y-0 left-0 z-50 w-[280px] bg-bg border-r border-border
          flex flex-col p-5 overflow-y-auto
          transition-transform duration-300 ease-in-out
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <button
          onClick={() => setMobileMenuOpen(false)}
          className="absolute top-4 right-4 text-text-dim hover:text-text transition-colors"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
        {sidebarContent}
      </aside>

      {/* ---- Desktop sidebar (fixed) ---- */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-[260px] bg-bg border-r border-border flex-col p-5 overflow-y-auto">
        {sidebarContent}
      </aside>

      {/* ---- Main content ---- */}
      <main className="flex-1 lg:ml-[260px] px-6 pt-16 pb-20 lg:px-16 lg:pt-10">
        <div className="max-w-[860px] mx-auto">

          {/* Title */}
          <h1 className="font-display text-3xl font-bold tracking-tight text-text mb-2">Documentation</h1>
          <p className="text-text-muted mb-10 text-base leading-relaxed">
            Everything you need to connect your browser to AI agents via Oya Browser.
          </p>

          {/* ============ QUICKSTART ============ */}
          <SectionHeading id="quickstart" first>Quickstart</SectionHeading>
          <ol className="list-decimal list-inside space-y-1.5 mb-4 text-[15px] leading-relaxed">
            <li>Go to the <InlineLink href="/dashboard">dashboard</InlineLink> and click <strong>Generate</strong> to create an API key</li>
            <li><InlineAnchor onClick={() => navClick('download')}>Download</InlineAnchor> Oya Browser for your OS</li>
            <li>Open the app, enter <InlineCode>wss://browser.getoya.ai/ws</InlineCode> as server URL and paste your API key</li>
            <li>Your browser appears in the <InlineLink href="/dashboard">dashboard</InlineLink> — you can now send commands or connect AI tools</li>
          </ol>

          {/* ============ CREATE KEY ============ */}
          <SectionHeading id="create-key">Create API Key</SectionHeading>
          <p className="mb-3 text-[15px] leading-relaxed">
            Go to the <InlineLink href="/dashboard">dashboard</InlineLink>. Click the <strong>Generate</strong> button next to the API key field. This creates a random key and registers it with the server.
          </p>
          <p className="mb-3 text-[15px] leading-relaxed">
            Your key is scoped — you only see browsers connected with your key. Other users&apos; browsers are invisible to you.
          </p>
          <WarnBox>
            Save your key somewhere safe. If you lose it, you&apos;ll need to generate a new one. The old key still works for any browsers already connected with it.
          </WarnBox>

          {/* ============ DOWNLOAD ============ */}
          <SectionHeading id="download">Download Browser</SectionHeading>
          <Table
            headers={['Platform', 'Download']}
            rows={[
              [
                'macOS (Intel + Apple Silicon)',
                <a key="mac" href="/downloads/Oya.Browser-1.0.22-universal.dmg" className="text-accent hover:text-accent-hover transition-colors">Oya Browser.dmg</a>,
              ],
              [
                'Linux (arm64)',
                <a key="linux" href="/downloads/Oya.Browser-1.0.22-arm64.AppImage" className="text-accent hover:text-accent-hover transition-colors">Oya Browser.AppImage</a>,
              ],
            ]}
          />
          <p className="mb-3 text-[15px] leading-relaxed">
            <strong>macOS:</strong> Open the .dmg, drag to Applications. On first launch, macOS may block the app because it&apos;s not notarized. Fix:
          </p>
          <CodeBlock>{`xattr -cr /Applications/Oya\\ Browser.app`}</CodeBlock>
          <p className="mb-3 text-[15px] leading-relaxed">
            Or: right-click the app → Open → Open (bypasses Gatekeeper once).
          </p>
          <p className="mb-3 text-[15px] leading-relaxed">
            <strong>Linux:</strong> <InlineCode>chmod +x</InlineCode> the AppImage and run it.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2 text-text">Running multiple instances</h3>
          <p className="mb-3 text-[15px] leading-relaxed">
            To open multiple browser windows (e.g. different accounts or different API keys):
          </p>
          <CodeBlock>{`# macOS — open another instance
open -n "/Applications/Oya Browser.app"

# With separate sessions (own cookies, own config)
open -n "/Applications/Oya Browser.app" --args --user-data-dir=/tmp/oya-2
open -n "/Applications/Oya Browser.app" --args --user-data-dir=/tmp/oya-3

# Linux
./Oya-Browser.AppImage --user-data-dir=/tmp/oya-2`}</CodeBlock>
          <p className="mb-3 text-[15px] leading-relaxed">
            Each <InlineCode>--user-data-dir</InlineCode> gets its own cookies, logins, and config — fully isolated sessions.
          </p>

          {/* ============ CONNECT ============ */}
          <SectionHeading id="connect">Connect</SectionHeading>
          <p className="mb-3 text-[15px] leading-relaxed">Open Oya Browser. The setup screen appears on first launch.</p>
          <Table
            headers={['Field', 'Value']}
            rows={[
              ['Server URL', <InlineCode key="url">wss://browser.getoya.ai/ws</InlineCode>],
              ['API Key', 'The key you generated in the dashboard'],
              ['Browser Name', 'Optional — how it shows in the dashboard'],
            ]}
          />
          <p className="mb-3 text-[15px] leading-relaxed">
            Click <strong>Connect</strong>. The green dot in the toolbar confirms the connection. Your browser now appears in the <InlineLink href="/dashboard">dashboard</InlineLink>.
          </p>

          {/* ============ MCP SETUP ============ */}
          <SectionHeading id="mcp-setup">MCP Setup</SectionHeading>
          <p className="mb-3 text-[15px] leading-relaxed">
            Oya Browser exposes each connected browser as an MCP server at:
          </p>
          <CodeBlock>{'https://browser.getoya.ai/mcp/{BROWSER_ID}'}</CodeBlock>
          <p className="mb-3 text-[15px] leading-relaxed">
            Get your browser&apos;s ID from the <InlineLink href="/dashboard">dashboard</InlineLink> (shown under each browser name, or in the MCP Tools tab).
          </p>

          <h3 id="cursor" className="text-base font-semibold mt-6 mb-2 text-text">Cursor</h3>
          <p className="mb-3 text-[15px] leading-relaxed">
            Add to <InlineCode>.cursor/mcp.json</InlineCode> in your project:
          </p>
          <CodeBlock>{`{
  "mcpServers": {
    "oya-browser": {
      "url": "https://browser.getoya.ai/mcp/YOUR_BROWSER_ID",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`}</CodeBlock>

          <h3 id="claude-desktop" className="text-base font-semibold mt-6 mb-2 text-text">Claude Desktop</h3>
          <p className="mb-3 text-[15px] leading-relaxed">
            Add to Claude Desktop&apos;s MCP config (Settings → Developer → Edit Config):
          </p>
          <CodeBlock>{`{
  "mcpServers": {
    "oya-browser": {
      "url": "https://browser.getoya.ai/mcp/YOUR_BROWSER_ID",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`}</CodeBlock>

          <h3 id="claude-code" className="text-base font-semibold mt-6 mb-2 text-text">Claude Code</h3>
          <p className="mb-3 text-[15px] leading-relaxed">
            Same config — add to your project&apos;s <InlineCode>.claude/mcp.json</InlineCode> or use the <InlineCode>/browse</InlineCode> skill command included in the repo.
          </p>

          {/* ============ TOOLS ============ */}
          <SectionHeading id="analyze_page">analyze_page</SectionHeading>
          <p className="mb-3 text-[15px] leading-relaxed">
            Analyzes the current page. Returns the full page as structured markdown with every interactive element numbered.
          </p>
          <CodeBlock>{`// No parameters
analyze_page()`}</CodeBlock>
          <p className="mb-3 text-[15px] leading-relaxed">Returns:</p>
          <ul className="list-disc list-inside space-y-1 mb-4 text-[15px] leading-relaxed">
            <li>Page metadata — URL, title, viewport size, scroll position</li>
            <li>Full page content as markdown with inline element annotations like <InlineCode>{`[#5 button "Submit"]`}</InlineCode></li>
            <li>Element index — all elements listed with IDs, types, labels, visibility flags</li>
          </ul>
          <NoteBox>
            Always call <InlineCode>analyze_page</InlineCode> before using <InlineCode>click</InlineCode> or <InlineCode>type</InlineCode>. Element IDs only exist after analysis and reset on every call.
          </NoteBox>

          <SectionHeading id="navigate">navigate</SectionHeading>
          <p className="mb-3 text-[15px] leading-relaxed">Navigate the browser to a URL.</p>
          <CodeBlock>{'navigate({ url: "https://example.com" })'}</CodeBlock>
          <NoteBox>
            After navigating, call <InlineCode>analyze_page</InlineCode> again — old element IDs are invalid on the new page.
          </NoteBox>

          <SectionHeading id="click">click</SectionHeading>
          <p className="mb-3 text-[15px] leading-relaxed">
            Click an interactive element by its ID number from <InlineCode>analyze_page</InlineCode>.
          </p>
          <CodeBlock>{'click({ element_id: 13 })'}</CodeBlock>
          <p className="mb-3 text-[15px] leading-relaxed">
            The element was tagged with <InlineCode>data-ac-id=&quot;13&quot;</InlineCode> during analysis — the click resolves via a single <InlineCode>querySelector</InlineCode>.
          </p>

          <SectionHeading id="type">type</SectionHeading>
          <p className="mb-3 text-[15px] leading-relaxed">
            Type text into an input element. Clears existing content first, then types character by character with realistic key events.
          </p>
          <CodeBlock>{'type({ element_id: 9, text: "hello world" })'}</CodeBlock>

          <SectionHeading id="press_key">press_key</SectionHeading>
          <p className="mb-3 text-[15px] leading-relaxed">
            Press a keyboard key. Useful for submitting forms (Enter), dismissing dialogs (Escape), or navigating (Tab, arrows).
          </p>
          <CodeBlock>{'press_key({ key: "Enter" })'}</CodeBlock>
          <p className="mb-3 text-[15px] leading-relaxed">
            Supported keys: <InlineCode>Enter</InlineCode>, <InlineCode>Escape</InlineCode>, <InlineCode>Tab</InlineCode>, <InlineCode>Backspace</InlineCode>, <InlineCode>ArrowDown</InlineCode>, <InlineCode>ArrowUp</InlineCode>, or any character.
          </p>

          <SectionHeading id="screenshot">screenshot</SectionHeading>
          <p className="mb-3 text-[15px] leading-relaxed">Capture the visible tab as a base64 PNG image.</p>
          <CodeBlock>screenshot()</CodeBlock>

          <SectionHeading id="scroll">scroll</SectionHeading>
          <p className="mb-3 text-[15px] leading-relaxed">Scroll the page up or down.</p>
          <CodeBlock>{'scroll({ direction: "down", amount: 500 })'}</CodeBlock>
          <Table
            headers={['Param', 'Type', 'Description']}
            rows={[
              [
                <InlineCode key="dir">direction</InlineCode>,
                <><InlineCode>&quot;up&quot;</InlineCode> | <InlineCode>&quot;down&quot;</InlineCode></>,
                'Scroll direction',
              ],
              [
                <InlineCode key="amt">amount</InlineCode>,
                'number (optional)',
                'Pixels to scroll, default 500',
              ],
            ]}
          />

          <SectionHeading id="tabs">Tab Management</SectionHeading>

          <h3 className="text-base font-semibold mt-6 mb-2 text-text">list_tabs</h3>
          <p className="mb-3 text-[15px] leading-relaxed">List all open tabs with ID, title, URL, and which is active.</p>
          <CodeBlock>list_tabs()</CodeBlock>

          <h3 className="text-base font-semibold mt-6 mb-2 text-text">open_tab</h3>
          <p className="mb-3 text-[15px] leading-relaxed">Open a new tab, optionally at a URL.</p>
          <CodeBlock>{'open_tab({ url: "https://gmail.com" })'}</CodeBlock>

          <h3 className="text-base font-semibold mt-6 mb-2 text-text">switch_tab</h3>
          <p className="mb-3 text-[15px] leading-relaxed">Switch to a tab by ID (from <InlineCode>list_tabs</InlineCode>).</p>
          <CodeBlock>{'switch_tab({ tab_id: 2 })'}</CodeBlock>

          <h3 className="text-base font-semibold mt-6 mb-2 text-text">close_tab</h3>
          <p className="mb-3 text-[15px] leading-relaxed">Close a tab. Closes the active tab if no ID specified.</p>
          <CodeBlock>{'close_tab({ tab_id: 3 })'}</CodeBlock>

          <SectionHeading id="wait">wait</SectionHeading>
          <p className="mb-3 text-[15px] leading-relaxed">
            Wait for an element matching a CSS selector to appear on the page.
          </p>
          <CodeBlock>{'wait({ selector: ".results", timeout: 10000 })'}</CodeBlock>

          {/* ============ ANONYMITY ============ */}
          <SectionHeading id="anonymity">Anonymity</SectionHeading>
          <p className="mb-3 text-[15px] leading-relaxed">
            Create and manage browser profiles with unique fingerprints, proxy routing, and isolated cookie stores. Each profile is a complete identity — different canvas hash, WebGL renderer, navigator properties, and session storage. Switch identities with a single MCP call.
          </p>
          <NoteBox>
            Every browser runs as a persona: a fingerprint, cookie jar and proxy bound together and stable for its life. Rotation means choosing a different persona, never re-rolling one.
          </NoteBox>

          <h3 id="fingerprint" className="text-base font-semibold mt-6 mb-2 text-text">Fingerprint Spoofing</h3>
          <p className="mb-3 text-[15px] leading-relaxed">
            Each profile generates a coherent set of browser fingerprints that are internally consistent per platform. A Win32 profile gets Windows GPU strings, Windows fonts, and matching screen resolutions.
          </p>
          <ul className="list-disc list-inside space-y-1 mb-4 text-[15px] leading-relaxed">
            <li><strong>Canvas</strong> — deterministic pixel noise on <InlineCode>toDataURL</InlineCode> and <InlineCode>toBlob</InlineCode></li>
            <li><strong>WebGL</strong> — spoofed vendor/renderer strings from real GPU database</li>
            <li><strong>AudioContext</strong> — noise on <InlineCode>OfflineAudioContext.startRendering</InlineCode></li>
            <li><strong>ClientRects</strong> — sub-pixel noise on <InlineCode>getBoundingClientRect</InlineCode> (bypassed internally for click accuracy)</li>
            <li><strong>Navigator</strong> — platform, hardwareConcurrency, deviceMemory, languages, vendor</li>
            <li><strong>Screen</strong> — width, height, colorDepth, devicePixelRatio</li>
            <li><strong>WebRTC</strong> — ICE candidates stripped to prevent local IP leak</li>
            <li><strong>Fonts</strong> — platform-consistent font sets</li>
          </ul>

          <h3 id="proxy-support" className="text-base font-semibold mt-6 mb-2 text-text">Proxy Support</h3>
          <p className="mb-3 text-[15px] leading-relaxed">
            Each profile can include a SOCKS5 or HTTP/HTTPS proxy. The proxy is applied at the Electron session level — all traffic routes through it, including DNS (for SOCKS5). Timezone and locale auto-match the proxy&apos;s geographic location via CDP Emulation.
          </p>
          <CodeBlock>{'create_profile({\n  platform: "Win32",\n  timezone: "America/New_York",\n  proxy_type: "socks5",\n  proxy_host: "1.2.3.4",\n  proxy_port: 1080,\n  proxy_username: "user",\n  proxy_password: "pass"\n})'}</CodeBlock>

          <h3 id="stealth" className="text-base font-semibold mt-6 mb-2 text-text">Anti-Detection Stealth</h3>
          <p className="mb-3 text-[15px] leading-relaxed">
            Always active — no configuration needed. The stealth layer removes automation indicators that anti-bot systems check for:
          </p>
          <ul className="list-disc list-inside space-y-1 mb-4 text-[15px] leading-relaxed">
            <li><InlineCode>navigator.webdriver</InlineCode> removed</li>
            <li>Electron globals (<InlineCode>window.process</InlineCode>, <InlineCode>window.require</InlineCode>) deleted</li>
            <li><InlineCode>window.chrome</InlineCode> fixed to match real Chrome (app, runtime, csi, loadTimes)</li>
            <li><InlineCode>navigator.plugins</InlineCode> populated with PDF viewers</li>
            <li><InlineCode>navigator.permissions.query</InlineCode> patched</li>
            <li>Sec-CH-UA headers rewritten to hide Electron</li>
            <li>Google telemetry domains blocked at the network level</li>
          </ul>

          <SectionHeading id="list_profiles">list_profiles</SectionHeading>
          <p className="mb-3 text-[15px] leading-relaxed">
            List all available anonymity profiles on the connected browser. Shows which profile is active.
          </p>
          <CodeBlock>{'list_profiles()'}</CodeBlock>
          <p className="mb-3 text-[15px] leading-relaxed">Returns each profile&apos;s ID, platform, timezone, and whether it has a proxy configured.</p>

          <SectionHeading id="create_profile">create_profile</SectionHeading>
          <p className="mb-3 text-[15px] leading-relaxed">
            Create a new anonymity profile with a randomized browser fingerprint. All values are generated to be internally consistent for the chosen platform.
          </p>
          <CodeBlock>{'create_profile({\n  platform: "Win32",\n  timezone: "Europe/London",\n  locale: "en-GB"\n})'}</CodeBlock>
          <Table
            headers={['Param', 'Type', 'Description']}
            rows={[
              [<InlineCode key="p">platform</InlineCode>, 'string', 'Win32, MacIntel, or Linux x86_64'],
              [<InlineCode key="tz">timezone</InlineCode>, 'string', 'IANA timezone (e.g. America/New_York)'],
              [<InlineCode key="lo">locale</InlineCode>, 'string', 'Locale (e.g. en-US, en-GB)'],
              [<InlineCode key="pt">proxy_type</InlineCode>, 'string', 'http or socks5'],
              [<InlineCode key="ph">proxy_host</InlineCode>, 'string', 'Proxy server hostname or IP'],
              [<InlineCode key="pp">proxy_port</InlineCode>, 'number', 'Proxy server port'],
              [<InlineCode key="pu">proxy_username</InlineCode>, 'string', 'Proxy auth username'],
              [<InlineCode key="pw">proxy_password</InlineCode>, 'string', 'Proxy auth password'],
            ]}
          />

          <SectionHeading id="set_profile">set_profile</SectionHeading>
          <p className="mb-3 text-[15px] leading-relaxed">
            Switch to a different anonymity profile. This closes all open tabs and reopens the browser with the new profile&apos;s fingerprint, proxy, timezone, and isolated cookie store.
          </p>
          <CodeBlock>{'set_profile({ profile_id: "profile-a1b2c3" })'}</CodeBlock>
          <Table
            headers={['Param', 'Type', 'Description']}
            rows={[
              [<InlineCode key="pid">profile_id</InlineCode>, 'string (required)', 'ID of the profile to activate'],
            ]}
          />
          <WarnBox>
            Switching profiles closes all open tabs. The browser reopens on google.com with the new identity.
          </WarnBox>

          {/* ============ DASHBOARD ============ */}
          <SectionHeading id="dashboard-overview">Dashboard</SectionHeading>
          <p className="mb-3 text-[15px] leading-relaxed">
            The <InlineLink href="/dashboard">dashboard</InlineLink> at <InlineCode>/dashboard</InlineCode> is the control panel. It shows your connected browsers and lets you interact with them.
          </p>
          <ul className="list-disc list-inside space-y-1 mb-4 text-[15px] leading-relaxed">
            <li><strong>Generate key</strong> — click Generate in the API key bar to create a new key</li>
            <li><strong>Browser list</strong> — shows all browsers connected with your key</li>
            <li><strong>Commands tab</strong> — quick buttons for analyze, screenshot, scroll + input fields for navigate, click, type</li>
            <li><strong>MCP Tools tab</strong> — shows the MCP endpoint URL, copy-paste config for Cursor/Claude, and a tool runner</li>
          </ul>

          <h3 id="chat" className="text-base font-semibold mt-6 mb-2 text-text">Chat</h3>
          <p className="mb-3 text-[15px] leading-relaxed">
            Control the browser with natural language — available in both the web dashboard and the desktop app&apos;s dev panel. Type &quot;go to google and search for cats&quot; and the AI navigates, types, clicks, and reports back.
          </p>
          <ul className="list-disc list-inside space-y-1 mb-4 text-[15px] leading-relaxed">
            <li>Formatted markdown responses with <strong>bold</strong>, <InlineCode>code</InlineCode>, lists, and headings</li>
            <li>Tool call badges showing which MCP tools the AI used (analyze_page, click, type, etc.)</li>
            <li>Copy button on hover to copy any response</li>
            <li>Automatic context trimming when conversations get long</li>
            <li>Conversation history preserved across messages</li>
          </ul>
          <NoteBox>
            Chat requires an OpenAI API key. Set it in the Settings panel (gear icon in the API key bar) or <InlineCode>OPENAI_API_KEY</InlineCode> env var on the server. This is optional — you don&apos;t need it for MCP tools.
          </NoteBox>

          <h3 className="text-base font-semibold mt-6 mb-2 text-text">Dev Panel (Desktop App)</h3>
          <p className="mb-3 text-[15px] leading-relaxed">
            The desktop app&apos;s dev panel (<InlineCode>{'{}'}</InlineCode> button in the toolbar) has four tabs:
          </p>
          <ul className="list-disc list-inside space-y-1 mb-4 text-[15px] leading-relaxed">
            <li><strong>Chat</strong> — natural language browser control with formatted responses and tool badges</li>
            <li><strong>Actions</strong> — quick-fire buttons and input fields for every command: analyze, screenshot, navigate, click by element #, type, press keys, hover, scroll, wait, tab management</li>
            <li><strong>Network</strong> — live WebSocket traffic with IN/OUT badges, expandable payloads, filter by direction or type (All, In, Out, Commands, Results)</li>
            <li><strong>Source</strong> — view the page as AI sees it: toggle between Markdown (analyzePage output) and HTML source, refresh on demand</li>
          </ul>

          <h3 id="live-view" className="text-base font-semibold mt-6 mb-2 text-text">Live View</h3>
          <p className="mb-3 text-[15px] leading-relaxed">
            The Commands tab shows a live view of the browser below the command buttons. Frames are streamed as JPEG via SSE at ~2fps.
          </p>

          <h3 id="settings" className="text-base font-semibold mt-6 mb-2 text-text">Settings</h3>
          <p className="mb-3 text-[15px] leading-relaxed">
            Click the gear icon next to the API key bar. Configure:
          </p>
          <ul className="list-disc list-inside space-y-1 mb-4 text-[15px] leading-relaxed">
            <li><strong>OpenAI API Key</strong> — for the Chat feature</li>
            <li><strong>Chat Model</strong> — default <InlineCode>gpt-4o-mini</InlineCode></li>
            <li><strong>Base URL</strong> — override for compatible APIs (Azure OpenAI, local LLMs, etc.)</li>
          </ul>
          <p className="mb-3 text-[15px] leading-relaxed">Settings are saved on the server and persist across restarts.</p>

          {/* ============ REST API ============ */}
          <SectionHeading id="rest-api">REST API</SectionHeading>
          <p className="mb-3 text-[15px] leading-relaxed">
            All endpoints require <InlineCode>Authorization: Bearer YOUR_API_KEY</InlineCode> header (except health and register). Interactive API testing available at <a href="/swagger" className="text-accent hover:text-accent-hover transition-colors">/swagger</a>.
          </p>
          <Table
            headers={['Method', 'Endpoint', 'Description']}
            rows={[
              [<InlineCode key="m1">GET</InlineCode>, <InlineCode key="e1">/health</InlineCode>, 'Server status + browser count'],
              [<InlineCode key="m2">POST</InlineCode>, <InlineCode key="e2">/register-key</InlineCode>, <span key="d2">Register a new API key (<InlineCode>{`{ "key": "..." }`}</InlineCode>)</span>],
              [<InlineCode key="m3">GET</InlineCode>, <InlineCode key="e3">/browsers</InlineCode>, 'List your connected browsers'],
              [<InlineCode key="m4">POST</InlineCode>, <InlineCode key="e4">/browsers/:id/command</InlineCode>, <span key="d4">Send command (<InlineCode>{`{ "action": "...", "params": {} }`}</InlineCode>)</span>],
              [<InlineCode key="m5">POST</InlineCode>, <InlineCode key="e5">/browsers/:id/chat</InlineCode>, <span key="d5">Chat (<InlineCode>{`{ "messages": [...] }`}</InlineCode>)</span>],
              [<InlineCode key="m6">GET</InlineCode>, <InlineCode key="e6">/live/:id?key=...</InlineCode>, 'SSE live view frame stream'],
              [<InlineCode key="m7">GET/POST</InlineCode>, <InlineCode key="e7">/mcp/:id</InlineCode>, 'MCP Streamable HTTP endpoint'],
              [<InlineCode key="m8">GET</InlineCode>, <InlineCode key="e8">/config</InlineCode>, 'Get server settings'],
              [<InlineCode key="m9">POST</InlineCode>, <InlineCode key="e9">/config</InlineCode>, 'Update server settings'],
            ]}
          />

          <h3 id="command-api" className="text-base font-semibold mt-6 mb-2 text-text">Command API Reference</h3>
          <p className="mb-3 text-[15px] leading-relaxed">
            Send commands via <InlineCode>POST /browsers/:id/command</InlineCode>. Each action uses only specific params — the rest are ignored.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2 text-text">Navigation Actions</h3>
          <Table
            headers={['Action', 'Params', 'Description']}
            rows={[
              [<InlineCode key="a1">navigate</InlineCode>, <span key="p1"><InlineCode>url</InlineCode> (required)</span>, 'Navigate to a URL'],
              [<InlineCode key="a2">open_tab</InlineCode>, <span key="p2"><InlineCode>url</InlineCode> (optional)</span>, 'Open a new tab'],
              [<InlineCode key="a3">switch_tab</InlineCode>, <span key="p3"><InlineCode>tab_id</InlineCode> (required)</span>, 'Activate a tab by ID'],
              [<InlineCode key="a4">close_tab</InlineCode>, <span key="p4"><InlineCode>tab_id</InlineCode> (optional, defaults to active)</span>, 'Close a tab'],
              [<InlineCode key="a5">list_tabs</InlineCode>, <em>none</em>, 'List all open tabs'],
            ]}
          />

          <h3 className="text-base font-semibold mt-6 mb-2 text-text">Page Analysis Actions</h3>
          <Table
            headers={['Action', 'Params', 'Description']}
            rows={[
              [<InlineCode key="a1">analyze</InlineCode>, <em>none</em>, 'Full page as markdown + numbered elements'],
              [<InlineCode key="a2">read_page</InlineCode>, <span key="p2"><InlineCode>selector</InlineCode> (optional), <InlineCode>limit</InlineCode> (default 50)</span>, 'Lightweight element listing'],
              [<InlineCode key="a3">screenshot</InlineCode>, <em>none</em>, 'Capture page as PNG'],
            ]}
          />

          <h3 className="text-base font-semibold mt-6 mb-2 text-text">Interaction Actions</h3>
          <Table
            headers={['Action', 'Params', 'Description']}
            rows={[
              [<InlineCode key="a1">click</InlineCode>, <span key="p1"><InlineCode>selector</InlineCode> (e.g. <InlineCode>[data-ac-id=&quot;3&quot;]</InlineCode>)</span>, 'Click an element'],
              [<InlineCode key="a2">type</InlineCode>, <span key="p2"><InlineCode>selector</InlineCode> + <InlineCode>text</InlineCode></span>, 'Type into an input'],
              [<InlineCode key="a3">press_key</InlineCode>, <span key="p3"><InlineCode>key</InlineCode> (e.g. Enter, Tab, Escape)</span>, 'Press a keyboard key'],
              [<InlineCode key="a4">scroll</InlineCode>, <span key="p4"><InlineCode>direction</InlineCode> (up/down), <InlineCode>amount</InlineCode> (px, default 500)</span>, 'Scroll the page'],
              [<InlineCode key="a5">wait</InlineCode>, <span key="p5"><InlineCode>selector</InlineCode>, <InlineCode>timeout</InlineCode> (ms, default 10000)</span>, 'Wait for element to appear'],
            ]}
          />

          <h3 className="text-base font-semibold mt-6 mb-2 text-text">Examples</h3>
          <CodeBlock>{`// Navigate to a page
{ "action": "navigate", "params": { "url": "https://google.com" } }

// Analyze current page (no params needed)
{ "action": "analyze" }

// Click element #3 from analyze results
{ "action": "click", "params": { "selector": "[data-ac-id=\\"3\\"]" } }

// Type into element #9
{ "action": "type", "params": { "selector": "[data-ac-id=\\"9\\"]", "text": "hello world" } }

// Press Enter
{ "action": "press_key", "params": { "key": "Enter" } }

// Scroll down
{ "action": "scroll", "params": { "direction": "down", "amount": 500 } }

// Screenshot (no params needed)
{ "action": "screenshot" }

// List all tabs
{ "action": "list_tabs" }

// Open new tab
{ "action": "open_tab", "params": { "url": "https://gmail.com" } }

// Switch to tab
{ "action": "switch_tab", "params": { "tab_id": 2 } }

// Close tab (omit tab_id to close active tab)
{ "action": "close_tab", "params": { "tab_id": 3 } }

// Wait for element
{ "action": "wait", "params": { "selector": ".results", "timeout": 10000 } }

// Read page elements (lightweight)
{ "action": "read_page", "params": { "limit": 20 } }`}</CodeBlock>

          <h3 className="text-base font-semibold mt-6 mb-2 text-text">Typical Workflow</h3>
          <CodeBlock>{`1. navigate → go to the page
2. analyze  → understand the page, get element IDs
3. click / type / press_key / scroll → interact
4. analyze  → re-analyze after page changes (old IDs are invalid)
5. repeat until task is done`}</CodeBlock>

          {/* ============ WEBSOCKET ============ */}
          <SectionHeading id="websocket">WebSocket Protocol</SectionHeading>
          <p className="mb-3 text-[15px] leading-relaxed">
            Browsers connect via WebSocket at <InlineCode>wss://browser.getoya.ai/ws</InlineCode>.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2 text-text">Auth</h3>
          <p className="mb-3 text-[15px] leading-relaxed">First message from browser:</p>
          <CodeBlock>{`{ "type": "auth", "api_key": "...", "browser_id": "...", "browser_name": "..." }`}</CodeBlock>
          <p className="mb-3 text-[15px] leading-relaxed">Server responds:</p>
          <CodeBlock>{`{ "type": "auth_ok", "browser_id": "..." }`}</CodeBlock>

          <h3 className="text-base font-semibold mt-6 mb-2 text-text">Commands</h3>
          <p className="mb-3 text-[15px] leading-relaxed">Server → Browser:</p>
          <CodeBlock>{`{ "type": "cmd", "id": "uuid", "action": "analyze", "params": {} }`}</CodeBlock>
          <p className="mb-3 text-[15px] leading-relaxed">Browser → Server:</p>
          <CodeBlock>{`{ "type": "cmd_result", "id": "uuid", "ok": true, "data": { ... } }`}</CodeBlock>

          <h3 className="text-base font-semibold mt-6 mb-2 text-text">Ping/Pong</h3>
          <p className="mb-3 text-[15px] leading-relaxed">
            Both sides send <InlineCode>{`{ "type": "ping" }`}</InlineCode> and respond with <InlineCode>{`{ "type": "pong" }`}</InlineCode> every 15-20 seconds.
          </p>

          <h3 className="text-base font-semibold mt-6 mb-2 text-text">Live Stream</h3>
          <p className="mb-3 text-[15px] leading-relaxed">
            Server → Browser: <InlineCode>{`{ "type": "stream_start", "fps": 2 }`}</InlineCode>
          </p>
          <p className="mb-3 text-[15px] leading-relaxed">
            Browser → Server: <InlineCode>{`{ "type": "frame", "data": "data:image/jpeg;base64,..." }`}</InlineCode>
          </p>
          <p className="mb-3 text-[15px] leading-relaxed">
            Server → Browser: <InlineCode>{`{ "type": "stream_stop" }`}</InlineCode>
          </p>

        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helper Components                                                  */
/* ------------------------------------------------------------------ */

function NavSection({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-text-dim mb-2">
        {icon}
        {label}
      </div>
      <div className="flex flex-col gap-0.5 pl-[18px]">{children}</div>
    </div>
  );
}

function NavLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="text-left text-[13px] text-text-muted hover:text-text py-0.5 transition-colors cursor-pointer"
    >
      {children}
    </button>
  );
}

function SectionHeading({ id, children, first }: { id: string; children: React.ReactNode; first?: boolean }) {
  return (
    <h2
      id={id}
      className={`text-xl font-bold tracking-tight text-text mb-3 scroll-mt-20 ${
        first ? 'mt-0' : 'mt-12 pt-6 border-t border-border'
      }`}
    >
      {children}
    </h2>
  );
}

function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-bg-elevated px-1.5 py-0.5 rounded text-sm font-mono text-text-muted">
      {children}
    </code>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-bg-card border border-border rounded-xl p-4 text-sm font-mono overflow-x-auto mb-4 leading-relaxed text-text-muted">
      <code>{children}</code>
    </pre>
  );
}

function NoteBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-indigo/10 border border-indigo/20 rounded-xl p-4 text-sm text-indigo mb-4 leading-relaxed">
      {children}
    </div>
  );
}

function WarnBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-yellow/10 border border-yellow/20 rounded-xl p-4 text-sm text-yellow mb-4 leading-relaxed">
      {children}
    </div>
  );
}

function InlineLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-accent hover:text-accent-hover transition-colors">
      {children}
    </Link>
  );
}

function InlineAnchor({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="text-accent hover:text-accent-hover transition-colors cursor-pointer">
      {children}
    </button>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                className="text-left text-xs font-semibold uppercase tracking-wider text-text-dim py-2 px-3 border-b border-border"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-bg-card/50 transition-colors">
              {row.map((cell, ci) => (
                <td key={ci} className="py-2 px-3 border-b border-border text-[14px] text-text-muted">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
