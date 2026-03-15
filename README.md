# AgentChrome

![AgentChrome analyzing Google — every interactive element is highlighted and numbered](docs/analyze-google.png)

Every element on the page gets a number. Want to click "Google Search"? `click(element_id=13)`. Want to type in the search box? `type(element_id=9, text="hello")`. No CSS selectors. No HTML parsing. No pixel coordinates. Just the number.

Turn your real Chrome browser into an MCP server — AI sees the page as numbered markdown, not raw HTML or pixels, and controls it by element ID.

Built to power reliable AI Employees on [Oya.ai](https://oya.ai). Works with Claude Desktop, Cursor, Windsurf, and any MCP client.

## How it works

```
Chrome Extension ──WebSocket──▶ Node.js Server ◀──MCP (Streamable HTTP)── Claude / Cursor / any MCP client
```

1. You browse the web normally in Chrome with the extension installed
2. An AI tool calls `analyze_page` via MCP
3. The extension walks the DOM, highlights every interactive element, assigns each a number
4. Returns structured markdown — the AI reads it like a human would read the page
5. The AI says `click(13)` or `type(9, "hello")` — the extension executes it on the real page

The AI never sees HTML. Never writes CSS selectors. Never parses screenshots. It reads a clean description and refers to elements by number.

![Dashboard showing the analyze result — structured markdown with numbered element index](docs/dashboard-google.png)

## Comparison

| | AgentChrome | Playwright / Puppeteer | Selenium | Browser-use | Vision agents |
|---|---|---|---|---|---|
| **Uses your real browser** | Yes — your Chrome, your cookies, your sessions | No — spawns a new browser | No — spawns a new browser | No — Playwright underneath | No — headless browser |
| **Bot detection** | Invisible — it's a real browser | Detected by Cloudflare, Akamai, etc. | Detected | Detected | Detected |
| **Existing logins** | All your sessions, cookies, extensions | None — starts fresh | None | None | None |
| **What AI sees** | Structured markdown with numbered elements | Raw HTML (thousands of lines) | Raw HTML | Screenshots (pixels) | Screenshots (pixels) |
| **How AI clicks** | `click(13)` — element number | `page.click('div.css-1a2b > button:nth-child(3)')` | Same fragile selectors | Click at pixel coordinates | Click at pixel coordinates |
| **Selectors needed** | None — elements are pre-numbered | Yes — AI must invent CSS/XPath | Yes | No (but vision is unreliable) | No (but vision is expensive) |
| **Output format** | Markdown with metadata | HTML DOM | HTML DOM | Screenshot image | Screenshot image |
| **Token cost** | Low — clean text | High — HTML soup | High — HTML soup | Very high — base64 images | Very high — base64 images |
| **Speed** | Fast — direct DOM access | Medium | Slow | Slow — render + screenshot + LLM | Slow |
| **Size** | 15KB extension + lightweight server | ~400MB Chromium binary | ~50MB driver + browser | Playwright + wrapper | Full browser + vision model |
| **Multiple browsers** | Yes — each gets its own MCP endpoint | One instance per script | One per session | One | One |

## The fundamental problem with every other tool

Every existing browser automation tool works backwards. They give the AI a raw page and say "figure it out."

**Selector-based tools (Playwright, Puppeteer, Selenium)** make the AI read thousands of lines of HTML like `<div class="css-1a2b3c">` nested inside `<div data-reactroot>`, then guess a CSS selector like `div.main-content > ul:nth-child(3) > li > a` and hope it doesn't break when the site updates. The AI has to be a frontend developer just to click a button.

**Vision-based tools (Browser-use, LaVague, screenshot agents)** flip to the other extreme — the AI stares at pixels trying to figure out where to click by coordinates. Burns tokens on base64 images. Slow, expensive, and still no structured understanding.

**AgentChrome inverts this.** Instead of making the AI figure out what the page has, we tell the AI what the page has. The extension analyzes the page, numbers every element, and returns a structured description:

```
[#9]  textarea: Search
[#13] button: Google Search
[#14] button: I'm Feeling Lucky
[#3]  link: Gmail → mail.google.com
```

The agent reads this and knows exactly what's on the page. To search: `type(element_id=9, text="AgentChrome")` then `click(element_id=13)`. Done. The numbers are tagged directly on the live DOM — no fragile selector lookup, no stale references, no guessing.

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

Open the dashboard at `http://localhost:3100` — it shows connected browsers, lets you send commands, and gives you copy-paste MCP config for Cursor and Claude Desktop.

Or configure manually:

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
| `analyze_page` | Full page as structured markdown with every interactive element numbered `[#id type "label"]`. Includes viewport size, scroll position, visibility flags, form state |
| `navigate` | Navigate to a URL |
| `click` | Click element by number (from analyze) |
| `type` | Type text into input by number — clears first, types character-by-character with realistic events |
| `screenshot` | Capture visible tab as PNG |
| `scroll` | Scroll up/down by pixel amount |
| `wait` | Wait for a CSS selector to appear |
| `read_elements` | Lightweight element list without full page markdown |

## What analyze_page returns

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

## Element Index (34 total, 18 visible)

### Visible
  [#1] input: Name value="mk"
  [#2] textarea: Bio
  [#3] input: URL
  [#4] button: Update profile

### Off-screen (scroll to reveal)
  [#18] link: Delete account → /settings/admin
  ...
```

The AI gets structured content it can reason about, numbered elements it can act on, visibility flags so it knows what needs scrolling, form state (checked, disabled, required), and landmark regions (nav, main, footer) for page structure.

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
- **Server**: Express + ws + MCP SDK. Manages browser connections, translates MCP tool calls into WebSocket commands. Each browser gets a dedicated MCP endpoint at `/mcp/:browserId`
- **Dashboard**: Built-in web UI at `/` for testing commands and copying MCP config snippets

## License

MIT
