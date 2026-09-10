# Oya Browser Control Plane UI

The high-density web console and public portal for **Oya Browser** — the browser control plane for AI agents that orchestrates Oya Cloud, Browserbase, Steel, Anchor, Browser Use, and private Chrome fleets.

Built with Next.js 16 (App Router), Tailwind CSS v4, and Lucide React. Designed to handle 1,000+ concurrent browsers with sub-second live streaming, command-by-command audit streams, and real-time human takeover.

---

## Surfaces

### 1. The Fleet Console (`/dashboard`)

The operational control plane is split into three primary workspaces accessible via tabs or keyboard shortcuts (`⌘1`, `⌘2`, `⌘3`):

- **Browsers (`⌘1`)**:
  - **Health Strip:** Metric counters (Total, Healthy, Degraded, Errors, Stale) where every number is an instant filter.
  - **Fleet Table:** High-density data grid displaying running browser instances, bound personas, provider routes, active URLs, command counts, error rates, and uptime.
  - **Inspection Panel:** Opens on row selection with URL bar controls, screenshot capture, interactive element tree, and a real-time activity log.
  - **Sub-Second Interactive Live View:** Real-time JPEG stream over SSE with pixel-accurate click, drag, scroll, and batched keyboard typing for immediate human takeover during MFA or complex challenges.
  - **Emergency Stop:** Single-click or bulk termination (`POST /browsers/stop { all: true }`) that tears down cloud sandboxes and releases vendor CDP sessions immediately.

- **Personas (`⌘2`)**:
  - **Deterministic Device Identities:** Seeded, byte-identical hardware profiles (canvas, WebGL GPU renderer, audio noise, client rects, fonts, navigator properties) bound to a dedicated cookie jar and proxy.
  - **Live Fingerprint Preview:** Visualizes device characteristics before creation.
  - **Concurrency & MFA:** Manage per-persona concurrency caps (e.g. 2 sessions per persona to prevent device-farm flags) and store TOTP seeds (sealed with AES-256-GCM) or email/SMS relay endpoints.

- **Control (`⌘3`)**:
  - **Provider Routing:** Add, prioritize, and capacity-cap routes across Oya Cloud, Browserbase, Steel, Anchor, Browser Use, or custom CDP endpoints. Configures automatic zero-rewrite failover.
  - **CDP Sessions:** Monitor active gateway client connections (`/connect`), view attached browser instances, and manage session recordings.
  - **Usage Accounting:** Hourly breakdown of commands, LLM model tokens, and spend attributed per API key.
  - **Append-Only Audit Trail:** Chronological, tenant-isolated log of security events, cookie modifications, and administrative operations.

### 2. Public Landing Page (`/`)

- **High-Conviction Positioning:** Explains why Oya is the Browser Control Plane for AI agents and why it is 10x better than single-vendor browser runners (Browserbase, Steel, Anchor, Browser Use).
- **Interactive Architecture Diagram:** Visualizes the 3-layer architecture (Agents → Oya Control Plane → Execution Targets).
- **10x Comparison Matrix:** Side-by-side comparison across Architecture, Identity, Auth, Challenges, Observability, Protocols, and Stealth.
- **Product Preview:** Interactive simulator demonstrating multi-provider browser orchestration.
- **Code Integrations:** Quickstarts for TypeScript SDK, Playwright over CDP, Terminal CLI, and Model Context Protocol (MCP).

### 3. Documentation (`/docs`)

- Full architecture specification and comparison guides.
- Multi-provider routing and automatic failover configuration.
- Measured evasion and stealth testing (`oya stealth-test --live`).
- Complete REST API, Command API, and WebSocket protocol references.
- Interactive search with keyboard navigation (`/`).

### 4. Standalone Live Viewer (`/live/[browserId]`)

- Dedicated, full-screen interactive streaming viewer for remote monitoring and human-in-the-loop takeover.

---

## Key Shortcuts

| Key | Action |
|---|---|
| `⌘/Ctrl 1 · 2 · 3` | Switch between Browsers, Personas, and Control workspaces |
| `n` | Start a new browser instance |
| `/` | Focus search / fleet filter |
| `↑ ↓` or `j k` | Navigate the browser fleet table |
| `x` | Stop selected browser(s) |
| `l · r · s` | URL bar · Reload · Screenshot |
| `Esc` | Close inspector panel or release keyboard from live stream |
| `?` | Show shortcut cheat sheet |

---

## Development

```bash
# Install dependencies
npm install

# Run local development server
npm run dev

# Run TypeScript type check and production build
npm run build

# Start production server
npm run start

# Run Playwright UI integration tests
npm run test:ui
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_OYA_API_URL` | Base URL for the Oya server API (defaults to relative `/api`) |
| `NEXT_PUBLIC_OYA_WS_URL` | WebSocket gateway URL (defaults to `ws://localhost:3100/ws`) |

---

## License

MIT
