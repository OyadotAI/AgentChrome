# AgentChrome

Turn your real Chrome browser into an MCP server — AI sees the page as numbered markdown, not raw HTML or pixels, and controls it by element ID.

Built to power reliable AI Employees on [Oya.ai](https://oya.ai).

```
Chrome Extension ──WebSocket──▶ Node.js Server ◀──MCP (Streamable HTTP)── Claude / Cursor / any MCP client
```

## The fundamental problem with every other browser automation tool

Every existing tool — Playwright, Puppeteer, Selenium, Browser-use, all of them — works backwards. They give the AI a raw page and say "figure it out." The AI has to parse HTML, guess at selectors, and hope they work. That's the wrong direction entirely.

### Selector-based tools make the AI do the hard part

With Playwright or Puppeteer, the workflow looks like this:

1. The AI gets raw HTML — thousands of lines of `<div class="css-1a2b3c">` nested inside `<div data-reactroot>` nested inside more divs
2. The AI has to **understand the page structure** by reading HTML soup
3. The AI has to **invent a CSS selector** like `div.main-content > ul:nth-child(3) > li > a` and hope it's stable
4. The selector breaks the moment the site updates its CSS classes, restructures a component, or renders differently based on viewport
5. The AI has no idea what's actually visible on screen, what's behind a scroll, what's in a dropdown, or what's disabled

This is asking the AI to be a frontend developer just to click a button. It's fragile, slow, and burns tokens on HTML that the AI was never designed to parse.

Vision-based tools (screenshot → LLM) flip to the other extreme — now the AI is staring at pixels trying to figure out where to click by coordinates. Expensive, slow, and still no structured understanding of the page.

### AgentChrome inverts this

Instead of making the AI figure out what the page has, **we tell the AI what the page has.**

When you call `analyze_page`, AgentChrome walks the entire DOM, finds every interactive element — every link, button, input, dropdown, checkbox — highlights it with a colored outline, and tags it with a number:

![AgentChrome analyzing Google — every interactive element is highlighted and numbered](docs/analyze-google.png)

Every element on the page gets a number. The search box is `#9`. "Google Search" is `#13`. "I'm Feeling Lucky" is `#14`. The Gmail link is `#3`. The AI doesn't need to know any of this upfront — it gets it all back as structured markdown:

![Dashboard showing the analyze result — structured markdown with numbered element index](docs/dashboard-google.png)

The agent receives a clean element index:

```
[#9]  textarea: Search
[#13] button: Google Search
[#14] button: I'm Feeling Lucky
[#3]  link: Gmail → mail.google.com
[#15] link: Learn more about π with AI Mode
```

Want to search? `type(element_id=9, text="AgentChrome")` then `click(element_id=13)`. That's it. No CSS selectors. No XPath. No HTML parsing. No pixel coordinates. Just the number.

The numbers are assigned fresh on every `analyze_page` call, directly on the live DOM. The extension tags each element with `data-ac-id="9"` so when the AI says `click(9)`, it resolves instantly — no fragile selector lookup, no stale references.

**The agent never sees HTML. Never writes selectors. Never parses pixels.** It reads a structured description and refers to elements by number.

### The other problems

Beyond the selector mess, every other tool also shares these issues:

**Fake browsers**
- Playwright/Puppeteer/Selenium launch a **separate browser process** — no cookies, no sessions, no extensions
- Gets flagged by bot detection on every serious website (Cloudflare, reCAPTCHA, Akamai)
- Can't access anything behind auth without manually passing credentials
- Headless browsers behave differently from real ones — sites know
- Requires a full Chromium binary shipped with your app (hundreds of MB)

**Wrappers (Browser-use, LaVague, etc.)**
- Same fake browser underneath — just more abstraction on top
- Vision-based approaches burn tokens sending screenshots back and forth
- Slow: render → screenshot → send to LLM → parse response → repeat

**AgentChrome:**
- Runs inside your **actual Chrome** as a 15KB extension — your cookies, sessions, logins, extensions, all there
- Every website sees a real browser because it is one — no bot detection
- Supports **multiple browsers simultaneously** — each gets its own MCP endpoint
- Returns structured markdown, not HTML or pixels — faster, cheaper, more accurate
- Server is a single Node.js process. No Chromium binary to ship

## Quick Start

### 1. Start the server

```bash
cd server
cp .env.example .env    # edit API_KEYS
npm install
npm start               # listens on port 3100
```

Or with Docker:

```bash
docker compose up -d
```

### 2. Load the extension

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select the `extension/` folder
4. Click the extension icon, enter server URL (`ws://localhost:3100/ws`) and API key
5. Click Connect

### 3. Connect AI tools

Open the dashboard at `http://localhost:3100` to see connected browsers, send commands, and get MCP configuration snippets for Cursor / Claude Desktop.

Or manually — list connected browsers:

```bash
curl -H "Authorization: Bearer YOUR_KEY" http://localhost:3100/browsers
```

Then configure your MCP client with:

```json
{
  "mcpServers": {
    "agentchrome": {
      "url": "http://localhost:3100/mcp/BROWSER_ID",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer YOUR_KEY"
      }
    }
  }
}
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `analyze_page` | Full page as structured markdown — headings, text, links, forms — with every interactive element numbered `[#id type "label"]`. Includes viewport awareness, scroll position, and visibility flags |
| `navigate` | Navigate to a URL |
| `click` | Click element by ID number (from analyze) |
| `type` | Type text into an input by ID — clears existing content first, types character-by-character with realistic events |
| `screenshot` | Capture visible tab as base64 PNG |
| `scroll` | Scroll up/down by pixel amount |
| `wait` | Wait for a CSS selector to appear |
| `read_elements` | Lightweight element list without full page markdown |

## How analyze_page works

Unlike vision-based tools that send screenshots, `analyze_page` converts the live DOM into structured markdown:

```
---
url: https://github.com/settings/profile
title: Your Profile
viewport: 1440x900
scroll: 0% (0px / 2400px)
elements: 34 total, 18 visible
---

<!-- main -->
# Public profile

Name: [#1 input:text value="mk"]
Bio: [#2 textarea placeholder="Tell us about yourself"]
URL: [#3 input:url placeholder="https://example.com"]

[#4 button "Update profile"]

<!-- /main -->
```

The AI gets:
- Structured content it can reason about (not pixels to parse)
- Numbered elements it can reference by ID (`click(element_id=4)`)
- Visibility flags so it knows what's on screen vs needs scrolling
- Form state — checked checkboxes, selected options, disabled buttons, required fields
- Landmark regions (nav, main, footer) for page structure understanding

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌──────────────┐
│  Chrome Browser  │◄──WS──►│   Node.js Server  │◄──MCP──►│  Claude/AI   │
│  (extension)     │        │                    │         │  (MCP client)│
│                  │        │  /ws        - WS   │         │              │
│  analyzer.js     │        │  /mcp/:id   - MCP  │         │              │
│  agent.js        │        │  /browsers  - REST │         │              │
│  service-worker  │        │  /          - UI   │         │              │
└─────────────────┘         └──────────────────┘         └──────────────┘
```

- **Extension** (~15KB): MV3 service worker + content scripts. Reads DOM, clicks elements, types text, captures screenshots. Connects to server via WebSocket
- **Server**: Express + ws + MCP SDK. Manages browser connections, translates MCP tool calls into WebSocket commands, returns results. Each browser gets a dedicated MCP endpoint
- **Dashboard**: Built-in web UI at `/` for testing commands and getting MCP config snippets
