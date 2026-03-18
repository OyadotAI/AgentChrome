# Oya Browser

A real Chrome browser that AI agents control via MCP. Unlike headless automation (Playwright/Puppeteer), this uses the user's real browser with their cookies, logins, and extensions.

## Architecture

```
Chrome Extension ←→ WebSocket ←→ Node.js Server ←→ MCP ←→ AI Client
```

- **Extension** (`extension/`): MV3 Chrome extension. Walks the DOM, numbers elements with `data-ac-id`, returns markdown. Executes click/type/scroll via content scripts.
- **Server** (`server/src/`): Express + WebSocket + MCP SDK. Bridges AI clients to browsers.
- **Pool mode**: All browsers sharing the same API key (or fleet token) form a pool. Server round-robins commands across them and syncs cookies.

## Key paths

| Area | Path |
|------|------|
| Server entry | `server/src/index.js` |
| REST API | `server/src/api.js` |
| WebSocket handler | `server/src/ws-handler.js` |
| MCP tools | `server/src/mcp-server.js` |
| Auth + fleet token | `server/src/auth.js` |
| Browser registry | `server/src/connection-registry.js` |
| Pool + round-robin | `server/src/pool.js` |
| Cookie sync | `server/src/cookie-store.js` |
| Extension service worker | `extension/background/service-worker.js` |
| DOM analyzer | `extension/content/analyzer.js` |
| Action executor | `extension/content/agent.js` |
| Landing page | `server/src/public/index.html` |
| Documentation | `server/src/public/docs.html` |
| AI-readable docs | `server/src/public/llms.txt` |
| Dashboard | `server/src/public/dashboard.html` |
| OpenAPI spec | `server/src/public/openapi.json` |

## Development

```bash
cd server && npm install && npm start    # Server on :3100
```

Load `extension/` as unpacked in Chrome. Tests: `node test-pool.js`.

## Conventions

- Server uses ES modules (`import`/`export`), no TypeScript
- Extension is vanilla JS with MV3 service worker (module type)
- All MCP tools are defined in `mcp-server.js` (per-browser) and also in the pool MCP server in the same file
- API keys: admin keys via `API_KEYS` env var, user keys in `server/data/keys.json`, fleet token via `FLEET_TOKEN` env var
- The pool MCP endpoint is `/mcp/pool`, per-browser is `/mcp/:browserId`
