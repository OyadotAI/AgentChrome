# oya-browser-mcp

Turn your Chrome browser into an MCP server. AI agents (Cursor, Claude Code, Claude Desktop) see the page as numbered markdown and control it by element ID.

No puppeteer. No headless browser. No screenshots. Your real Chrome — your cookies, your logins, your extensions.

## How it works

```
AI Agent (Cursor / Claude Code) ──MCP──▶ oya-browser-mcp (localhost) ──WS──▶ Chrome Extension
```

1. The Chrome extension reads the page and tags every interactive element with a number
2. This bridge exposes those capabilities as MCP tools on a local port
3. Your AI tool connects to the bridge and can analyze, click, type, scroll, and navigate

The AI never sees HTML. It reads clean markdown and refers to elements by number: `click(element_id=5)`, `type(element_id=9, text="hello")`.

## Quick start

### 1. Install the Chrome extension

Get [Oya Browser](https://github.com/OyadotAI/AgentChrome) from the Chrome Web Store, or load unpacked from the `extension/` folder.

### 2. Start the bridge

```bash
npx oya-browser-mcp
```

Or install globally:

```bash
npm install -g oya-browser-mcp
oya-browser-mcp
```

You'll see:

```
  ● Oya Browser MCP Bridge

  MCP endpoint:  http://localhost:9333/mcp
  Extension WS:  ws://localhost:9333/ext

  Waiting for Chrome extension to connect...
```

### 3. Add to your AI tool

**Cursor** — Settings → MCP → Add:

```json
{
  "mcpServers": {
    "oya-browser": {
      "url": "http://localhost:9333/mcp"
    }
  }
}
```

**Claude Code** — Add to your MCP config:

```json
{
  "mcpServers": {
    "oya-browser": {
      "url": "http://localhost:9333/mcp",
      "transport": "streamable-http"
    }
  }
}
```

**Claude Desktop** — Settings → Developer → Edit Config:

```json
{
  "mcpServers": {
    "oya-browser": {
      "url": "http://localhost:9333/mcp",
      "transport": "streamable-http"
    }
  }
}
```

Done. Your AI can now control your browser.

## MCP Tools

| Tool | Description |
|------|-------------|
| `analyze_page` | Full page as structured markdown with every interactive element numbered `[#id type "label"]` |
| `navigate` | Navigate to a URL |
| `click` | Click element by number |
| `type` | Type text into input by number — clears first, types character-by-character |
| `press_key` | Press keyboard keys (Enter, Escape, Tab, arrows, etc.) |
| `screenshot` | Capture visible tab as PNG |
| `scroll` | Scroll up/down by pixel amount |
| `wait` | Wait for a CSS selector to appear |
| `click_coordinates` | Click at x,y pixel coordinates |
| `mouse_move` | Hover at x,y coordinates |
| `double_click` | Double-click element or coordinates |
| `keyboard_type` | Type into whatever is focused |
| `drag` | Drag from one point to another |
| `list_tabs` | List all open tabs |
| `open_tab` | Open a new tab |
| `switch_tab` | Switch to a tab by ID |
| `close_tab` | Close a tab |

## What `analyze_page` returns

```
---
url: https://github.com/settings/profile
title: Your Profile
viewport: 1440x900
scroll: 0% (0px / 2400px)
elements: 34 total, 18 visible
---

# Public profile

Name: [#1 input:text value="mk"]
Bio: [#2 textarea placeholder="Tell us about yourself"]

[#4 button "Update profile"]

## Element Index (34 total, 18 visible)

### Visible
  [#1] input: Name value="mk"
  [#2] textarea: Bio
  [#4] button: Update profile
```

`type(element_id=1, text="new name")` then `click(element_id=4)`. That's it.

## Options

```bash
# Custom port
oya-browser-mcp --port 8080

# Or via environment variable
PORT=8080 oya-browser-mcp
```

## Why not Puppeteer / Playwright / browser-use?

| | Oya Browser | Others |
|---|---|---|
| **Real browser** | Your Chrome, your cookies, your logins | Spawns a new browser — no sessions, no extensions |
| **Bot detection** | Invisible — it IS a real browser | Detected by Cloudflare, Akamai, etc. |
| **Element interaction** | `click(5)` — numbered on the live DOM | CSS selectors or coordinate guessing |
| **What AI reads** | Clean markdown with numbered elements | Raw HTML (thousands of lines) or screenshots |
| **Token cost** | Low — compact markdown | High — raw HTML or base64 images |
| **Setup** | Chrome extension + `npx` | Install Chromium binary (~400MB) |

## Support

mk@oya.ai

## License

MIT
