# Pool Operations

You have access to an Oya Browser **pool** — multiple browsers sharing cookies with round-robin command dispatch. Use the pool MCP endpoint instead of individual browser endpoints.

## Pool MCP Endpoint

```
POST /mcp/pool
Authorization: Bearer <API_KEY>
```

## Available Tools

| Tool | Behavior in pool mode |
|------|----------------------|
| `analyze_page` | Advances round-robin to next browser, analyzes its page |
| `navigate` | Advances round-robin to next browser, navigates it |
| `click` | Stays on the pinned browser (same one that last analyzed/navigated) |
| `type` | Stays on pinned browser |
| `screenshot` | Stays on pinned browser |
| `press_key` | Stays on pinned browser |
| `scroll` | Stays on pinned browser |
| `wait` | Stays on pinned browser |
| `pool_status` | Shows pool size and all connected browsers |

## Workflow

```
1. navigate or analyze_page → picks next browser in rotation
2. click / type / scroll → same browser (element IDs match)
3. navigate or analyze_page → rotates to next browser
```

Each tool response includes a browser tag like `[Browser-1 abc12345]` so you know which browser handled it.

## REST API shortcuts

```bash
# Pool status
GET /pool

# Round-robin command (picks next browser automatically)
POST /pool/command
Body: { "action": "navigate", "params": { "url": "..." } }

# View shared cookie jar
GET /pool/cookies

# Clear cookies
DELETE /pool/cookies
```

## Cookie sync

All browsers in the pool share cookies automatically:
- When one browser logs in, the session cookie propagates to all others
- New browsers joining the pool receive the full cookie jar immediately
- Changes are broadcast in real-time via WebSocket

## User Request

$ARGUMENTS
