'use client';

import { useState } from 'react';
import { Copy, Check, Eye, EyeOff } from 'lucide-react';
import Dialog from '@/components/ui/dialog';
import type { BrowserRow } from './types';

/** Where this dashboard is served from is where the API is. */
export function origins() {
  if (typeof window === 'undefined') return { http: '', ws: '' };
  const { protocol, host } = window.location;
  return { http: `${protocol}//${host}`, ws: `${protocol === 'https:' ? 'wss' : 'ws'}://${host}` };
}

interface Snippet { id: string; label: string; file: string; code: (key: string) => string; note?: string }

const MASK = '<your-api-key>';

/** Snippets for one running browser. */
export function browserSnippets(b: BrowserRow): Snippet[] {
  const { http, ws } = origins();
  const cdp = b.clientType === 'cdp';
  const out: Snippet[] = [
    {
      id: 'sdk', label: 'TypeScript', file: 'drive.ts',
      code: (k) => `import { Oya } from "@oya/browser";

const oya = new Oya({ apiKey: "${k}", baseUrl: "${http}" });
const browser = await oya.browser.get("${b.id}");   // ${b.name}

await browser.goto("https://example.com");
const page = await browser.analyze();
await browser.click(page.elements[0].id);
console.log(await browser.status());               // health, counters, activity`,
    },
    {
      id: 'cli', label: 'CLI', file: 'terminal',
      code: (k) => `export OYA_API_KEY=${k} OYA_BASE_URL=${http}

oya goto https://example.com --id ${b.id}
oya ask "find the pricing page" --id ${b.id}
oya status --id ${b.id}
oya rm ${b.id}`,
    },
    {
      id: 'mcp', label: 'Agents (MCP)', file: 'mcp.json',
      code: (k) => `{
  "mcpServers": {
    "${b.name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase() || 'oya-browser'}": {
      "url": "${http}/mcp/${b.id}",
      "headers": { "Authorization": "Bearer ${k}" }
    }
  }
}`,
      note: 'Claude Desktop, Cursor, Windsurf and Claude Code all take this shape. The pool endpoint /mcp/pool spreads calls across every browser on the key instead.',
    },
    {
      id: 'curl', label: 'curl', file: 'terminal',
      code: (k) => `curl -X POST ${http}/api/browsers/${b.id}/command \\
  -H "Authorization: Bearer ${k}" -H "Content-Type: application/json" \\
  -d '{"action":"navigate","params":{"url":"https://example.com"}}'

curl -X POST ${http}/api/browsers/${b.id}/command \\
  -H "Authorization: Bearer ${k}" -H "Content-Type: application/json" \\
  -d '{"action":"analyze"}'

curl -X POST ${http}/api/browsers/${b.id}/stop -H "Authorization: Bearer ${k}"`,
    },
  ];
  if (cdp) {
    out.splice(1, 0, {
      id: 'playwright', label: 'Playwright', file: 'attach.ts',
      code: (k) => `import { chromium } from "playwright";

// Attaches to this exact browser through the gateway. Closing your client
// leaves the browser running in the fleet.
const browser = await chromium.connectOverCDP(
  "${ws}/connect?token=${k}&browser=${b.id}",
);
const page = browser.contexts()[0]?.pages()[0] ?? await browser.newPage();
await page.goto("https://example.com");
console.log(await page.title());`,
      note: 'Puppeteer: puppeteer.connect({ browserWSEndpoint: <the same URL> }). browser-use and Stagehand take a CDP URL too.',
    });
  } else {
    out.push({
      id: 'playwright', label: 'Playwright', file: 'attach.ts',
      code: () => `// This browser is an Oya client (${b.provider || 'desktop'}): it is driven over its
// own socket and has no CDP endpoint to attach to. Use the SDK, CLI or MCP above,
// or start a CDP-backed browser (Browserbase, Steel, Anchor, your own Chrome) and
// attach to that with:
//
//   chromium.connectOverCDP("${ws}/connect?token=<key>&browser=<id>")`,
    });
  }
  return out;
}

/** Snippets for the fleet: how to make browsers appear here. */
export function fleetSnippets(): Snippet[] {
  const { http, ws } = origins();
  return [
    {
      id: 'sdk', label: 'TypeScript', file: 'start.ts',
      code: (k) => `import { Oya } from "@oya/browser";

const oya = new Oya({ apiKey: "${k}", baseUrl: "${http}" });

// The provider comes from this key's settings. persona: "auto" rotates
// across your personas; captcha: "auto" clears them as they appear.
const browser = await oya.browser.start({ persona: "auto", captcha: "auto" });
await browser.goto("https://example.com");
await browser.stop();`,
    },
    {
      id: 'cli', label: 'CLI', file: 'terminal',
      code: (k) => `npm i -g oya
oya login --url ${http} --key ${k}

oya start --persona auto --name checkout-worker
oya goto https://example.com
oya ls
oya rm --all`,
    },
    {
      id: 'playwright', label: 'Playwright', file: 'new-session.ts',
      code: (k) => `import { chromium } from "playwright";

// A fresh browser from whichever provider the gateway routes to.
// Add &profile=<name> to keep cookies, &record=1 to record the session.
const browser = await chromium.connectOverCDP("${ws}/connect?token=${k}");
const page = await browser.newPage();
await page.goto("https://example.com");
await browser.close();`,
    },
    {
      id: 'mcp', label: 'Agents (MCP)', file: 'mcp.json',
      code: (k) => `{
  "mcpServers": {
    "oya-browser-pool": {
      "url": "${http}/mcp/pool",
      "headers": { "Authorization": "Bearer ${k}" }
    }
  }
}`,
      note: 'The pool hands each call to the next healthy browser on this key. One browser: /mcp/<id>.',
    },
    {
      id: 'curl', label: 'curl', file: 'terminal',
      code: (k) => `curl -X POST ${http}/api/browsers/start \\
  -H "Authorization: Bearer ${k}" -H "Content-Type: application/json" \\
  -d '{"persona":"auto","name":"worker"}'

curl ${http}/api/browsers -H "Authorization: Bearer ${k}"
curl ${http}/api/fleet    -H "Authorization: Bearer ${k}"`,
    },
  ];
}

interface Props {
  open: boolean;
  onClose: () => void;
  apiKey: string;
  title: string;
  description?: string;
  snippets: Snippet[];
}

/**
 * Code that works when pasted. The key is masked until asked for, and copying
 * always copies the real thing — nobody wants to paste a placeholder.
 */
export default function SnippetsDialog({ open, onClose, apiKey, title, description, snippets }: Props) {
  const [active, setActive] = useState(snippets[0]?.id);
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState(false);
  const s = snippets.find((x) => x.id === active) || snippets[0];
  if (!s) return null;
  const shown = s.code(reveal ? apiKey : MASK);

  const copy = () => {
    navigator.clipboard.writeText(s.code(apiKey)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };

  return (
    <Dialog open={open} onClose={onClose} title={title} description={description} size="lg">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-bg p-1" role="tablist">
          {snippets.map((x) => (
            <button key={x.id} role="tab" aria-selected={active === x.id} onClick={() => setActive(x.id)}
              className={`rounded-md px-3 py-1 text-[12.5px] font-medium transition-colors ${active === x.id ? 'bg-accent/15 text-text' : 'text-text-muted hover:text-text'}`}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className="btn-ghost h-7" onClick={() => setReveal(!reveal)} title={reveal ? 'Hide the key' : 'Show the key'}>
            {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {reveal ? 'Hide key' : 'Show key'}
          </button>
          <button className="btn-primary h-7" onClick={copy}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : 'Copy with key'}
          </button>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-bg">
        <div className="flex items-center justify-between border-b border-border bg-bg-elevated/40 px-3 py-1.5">
          <span className="font-mono text-[11px] text-text-dim">{s.file}</span>
        </div>
        <pre className="overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-[1.75] text-text-secondary">{shown}</pre>
      </div>
      {s.note && <p className="mt-3 text-[12.5px] text-text-muted">{s.note}</p>}
    </Dialog>
  );
}
