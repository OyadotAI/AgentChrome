# Pool Setup Guide

You are helping the user set up an Oya Browser pool — multiple browsers sharing cookies and receiving commands via round-robin.

## What the user needs to decide

1. **How many browsers?** (default: ask)
2. **Where to run them?** Local machine, Docker, Daytona sandboxes, or cloud VMs
3. **Shared key or individual keys?** Fleet token (simplest) vs provisioned per-browser keys

## Option A: Fleet Token (simplest)

All browsers use one shared token. Zero per-browser config.

### Server setup

```bash
# .env
FLEET_TOKEN=<generate a random 32+ char string>
API_KEYS=<admin key for dashboard/provisioning>
PORT=3100
```

```bash
cd server && npm install && npm start
```

### Browser config

Every browser extension gets the same values:
- **Server URL**: `ws://<server-host>:3100/ws` (or `wss://` for production)
- **API Key**: the FLEET_TOKEN value

### AI client config

Point your MCP client at the **pool endpoint** (not individual browsers):

```json
{
  "mcpServers": {
    "oya-pool": {
      "url": "http://<server-host>:3100/mcp/pool",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer <FLEET_TOKEN>"
      }
    }
  }
}
```

The server round-robins across all connected browsers. Cookies sync automatically.

## Option B: Provisioned Keys (per-browser identity)

Each browser gets its own unique API key. Better for tracking which browser did what.

### Generate keys in bulk

```bash
curl -X POST "http://<server-host>:3100/fleet/provision?count=1000" \
  -H "Authorization: Bearer <ADMIN_KEY>" \
  -H "Content-Type: application/json"
```

Returns `{ "keys": ["key1", "key2", ...] }`. Assign one key per browser instance.

### NOTE: Per-browser keys don't form a pool by default

Browsers must share the SAME key to be in the same pool. With individual keys, each browser is its own pool. Use fleet token for pooling.

## Docker deployment

```dockerfile
# Each container runs Chrome + the extension
FROM chrome-base
COPY extension/ /opt/extension/
ENV OYA_SERVER_URL=ws://server:3100/ws
ENV OYA_API_KEY=<fleet-token>
# Use a startup script to set chrome.storage.local via Chrome DevTools Protocol
```

## Daytona sandboxes

Each sandbox runs a Chrome instance. Configure via the sandbox's startup script:
1. Launch Chrome with `--load-extension=/path/to/extension`
2. Use CDP to set `chrome.storage.local` with server URL + API key
3. The extension auto-connects on startup

## Verify the pool

```bash
# Check pool status
curl -H "Authorization: Bearer <KEY>" http://server:3100/pool

# Check cookie jar
curl -H "Authorization: Bearer <KEY>" http://server:3100/pool/cookies

# Run the integration test
cd server && node test-pool.js
```

## Pool MCP tools

Same tools as single-browser MCP, plus:
- `pool_status` — show pool size and connected browsers
- `navigate` / `analyze_page` — advance the round-robin to the next browser
- `click` / `type` / `screenshot` — stay pinned to the last-used browser (element IDs are valid)

## Troubleshooting

- **No browsers in pool**: Check that browsers are connected with the same API key / fleet token
- **Cookies not syncing**: Extension needs the `cookies` permission in manifest.json (already added)
- **Round-robin hitting same browser**: Browsers may have disconnected. Check `GET /pool`

## User Request

$ARGUMENTS
