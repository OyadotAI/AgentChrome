# Oya Browser

**The Browser Control Plane for AI Agents.**

Stop building on dumb browsers and single-vendor runners. Oya is the **control plane** that orchestrates Oya Cloud, Browserbase, Steel, Anchor, Browser Use, and your own Chrome fleet behind a single API and a high-density console.

Every browser runs as a **persona** — a stable, mathematically seeded device identity with its own logins, cookie jar, and pinned residential exit IP. CAPTCHA and MFA are solved automatically or handed off to human takeover via sub-second interactive streaming. The underlying execution provider is a setting on your API key, not a code rewrite.

```ts
import { Oya } from "@oya/browser";

const oya = new Oya();                                    // OYA_API_KEY
const browser = await oya.browser.start({ persona: "auto", captcha: "auto" });
await browser.goto("https://example.com");
```

That is the whole surface. Which provider actually runs the browser — Oya Cloud sandboxes, your own machines, Browser Use, Browserbase, Steel, Anchor, or a CDP URL you hand us — is a configuration setting on your key. Your agent code never branches on it.

```bash
npm i @oya/browser
npx oya login && npx oya init
```

---

## Architecture: The Browser Control Plane

Raw browser vendors run isolated headless Chrome instances. Oya sits *above* them as the operational control plane:

```
┌────────────────────────────────────────────────────────────────────────┐
│                      YOUR AGENTS & WORKFLOWS                           │
│   Claude Code · Cursor · Playwright · Puppeteer · Stagehand · LangChain│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ (CDP / MCP / TS SDK / CLI / REST)
┌───────────────────────────────────▼────────────────────────────────────┐
│                      OYA BROWSER CONTROL PLANE                         │
│  ┌─────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │  Unified Gateway Router │  │  Deterministic Personas (Identities)│  │
│  │  · Auto-failover        │  │  · Seeded hardware fingerprints     │  │
│  │  · Dynamic session pool │  │  · Persistent cookie jars & proxies │  │
│  │  · Zero-rewrite switch  │  │  · Per-persona concurrency caps     │  │
│  └─────────────────────────┘  └─────────────────────────────────────┘  │
│  ┌─────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │  Challenge Engine       │  │  Enterprise Fleet Observability     │  │
│  │  · Native + 3rd-party   │  │  · 1,000+ browser live console      │  │
│  │  · Automated TOTP / SMS │  │  · Sub-second interactive live view │  │
│  │  · Desktop Auth Pairing │  │  · Append-only audit & spend / key  │  │
│  └─────────────────────────┘  └─────────────────────────────────────┘  │
└──────┬──────────────┬──────────────┬──────────────┬─────────────┬──────┘
       │              │              │              │             │
┌──────▼──────┐┌──────▼──────┐┌──────▼──────┐┌──────▼──────┐┌─────▼──────┐
│  Oya Cloud  ││ Browserbase ││    Steel    ││   Anchor    ││Browser Use │
│ (Daytona/K8s││  (CDP API)  ││  (CDP API)  ││  (CDP API)  ││ & Private  │
│  Sandboxes) ││             ││             ││             ││   Chrome   │
└─────────────┘└─────────────┘└─────────────┘└─────────────┘└────────────┘
```

---

## Why a Control Plane? The 10x Difference

Point-solution runners (**Browserbase**, **Steel**, **Anchor**, **Browser Use**) run browsers. But when you deploy agents into production, raw runners hit the "Browser Wall": vendor lock-in, fragmented cookie jars, bans from inconsistent fingerprints, brittle scripted logins, and zero fleet governance.

Oya is **10x better** because it treats browsers as managed infrastructure:

| Capability | Raw Browser Runners<br>*(Browserbase, Steel, Anchor, Browser Use)* | Oya Browser Control Plane | Why it's 10x Better |
|---|---|---|---|
| **Architecture & Vendor Freedom** | Single-vendor point solutions. Hardcoded to their proprietary API, cloud, and billing. | **Unified Control Plane.** Sits above Oya Cloud, Browserbase, Steel, Anchor, Browser Use, or private Chrome. | **Zero lock-in & instant failover.** If a provider has an outage or rate limit, Oya fails over automatically without breaking running agents. |
| **Device Identity & Anti-Ban** | Ephemeral dumb sessions or randomized spoofing on each start. | **Deterministic Personas.** Seeded, byte-identical hardware profiles bound permanently to a cookie jar and proxy. | **Eliminates bot-farm and device-farm flags.** Returning weeks later looks like the exact same legitimate workstation. |
| **Authentication** | Fragile scripted login automation that breaks on Google SSO, Okta, passkeys, and Cloudflare. | **Sign-In-Once Desktop Pairing.** Log in once via real desktop Chrome/Electron; cookies sync cryptographically to remote personas. | **Instant authenticated sessions.** Agents arrive already logged into enterprise sites with passkeys and WebAuthn without writing login scripts. |
| **Challenge Resolution** | Fails or hangs on unexpected push notifications, 2FA, or novel CAPTCHAs. | **Two-Tier Engine + Live Takeover.** Native solver routing + TOTP/SMS relay + sub-second interactive Live View takeover. | **100% task completion.** If automation hits a wall, a human clicks or types directly in the stream, and the agent resumes. |
| **Fleet Observability** | Opaque session IDs, black-box execution, static post-mortem logs. | **Dense 1,000+ browser console.** Live health strip, command activity streams, Prometheus metrics, and hourly spend tracking. | **Real-time operations.** Every counter is a filter; bulk emergency stops (`POST /browsers/stop { all: true }`) prevent runaway loops. |
| **Protocol Freedom** | Proprietary SDK wrappers requiring bespoke code. | **Universal Gateway.** Native CDP (`/connect`), MCP streamable HTTP (`/mcp/:id`), TypeScript SDK, and CLI. | **Works with your entire stack.** Connect Playwright, Puppeteer, Stagehand, browser-use, Claude Code, or Cursor out of the box. |
| **Stealth Verification** | Unverifiable marketing claims ("100% undetectable"). | **Open Benchmark Suite.** Live testing against CreepJS and Bot.Sannysoft (`oya stealth-test --live`). | **Honest, measured evasion.** Every fingerprint delta is measured and attributed rather than asserted. |

---

## Personas, and why they exist

There are two ways anti-bot algorithms catch browser agents, and they are mirror images of each other:

| Shape | Signal |
|---|---|
| One account, many device fingerprints | Textbook bot farm |
| One device fingerprint, many accounts — or 1,000 concurrent sessions | Device farm |

Binding the fingerprint to your API key avoids the first and walks into the second. Binding it to each browser instance avoids the second and walks into the first. 

Oya solves this by binding at the level that actually corresponds to a physical device:

```
persona = fingerprint + cookie jar + proxy       # one identity, one device
API key = a group of personas                    # your fleet
```

A persona's fingerprint is derived from a stored cryptographic seed, making it **byte-identical across restarts** — a returning session looks like a returning device. Concurrency is capped per persona (e.g. 2 concurrent sessions for a laptop and a phone), preventing device-farm detection, while `activeBrowsers` is tracked in real-time in the dashboard and exported as a Prometheus metric.

```ts
const p = await oya.personas.create({ name: "acme-ops" });
await oya.personas.setMfa(p.id, { type: "totp", secret: "JBSWY3DPEHPK3PXP" });
const browser = await oya.browser.start({ persona: p.id });
```

---

## Sign in once, on your own machine

For browsers on our infrastructure, the desktop app eliminates the hardest part of browser automation: signing in.

1. Open the Oya desktop app on your workstation.
2. Log into the sites your agents need using real passkeys, Google SSO, Okta, or hardware 2FA.
3. Those authenticated cookies move securely to your remote cloud persona, which runs the exact same device fingerprint.
4. Your agent arrives already signed in, and the target site sees one legitimate device returning rather than a bot fleet sharing credentials.

The dashboard pairs the desktop app over an `oya://` link carrying a **single-use pairing code** (never your API key). The app exchanges the code over HTTPS with the server, prompts for confirmation, and encrypts the session state.

---

## Challenges: Automated Solving + Human Takeover

```ts
await browser.solveCaptcha();   // { solved, method: 'provider' | 'solver' | 'none' }
await browser.completeMfa();    // TOTP, email OTP, SMS OTP, or a human handoff
```

- **CAPTCHA Solving:** Automatically delegates to the underlying provider when it solves natively (Anchor, Browserbase, Steel, Browser Use) to avoid double billing and race conditions. For others, it dispatches to your configured solver (CapSolver or 2Captcha).
- **MFA:** Handles TOTP locally (seed sealed with AES-256-GCM at rest, never returned over the API), and email/SMS one-time codes via a secure relay endpoint.
- **Interactive Human Takeover:** When automation hits a phone push approval or novel challenge, Oya hands back an interactive Live View URL. A human completes the action directly in the real-time stream with sub-second latency, and the agent continues.

---

## Stealth, measured

"Zero detection" is a marketing myth. Real evasion is measurable:

```bash
node server/test-stealth.js            # local probe suite
node server/test-stealth.js --live     # against live detectors (CreepJS, Sannysoft)
```

Oya scores a bare browser against a protected one across canvas, WebGL, audio, client rects, plugins, `navigator.webdriver`, `userAgentData`, media devices, and `Function.prototype.toString` masking.

Our custom stealth applies to Oya Cloud, self-hosted, and plain CDP browsers. It is deliberately **not** double-layered over Anchor, Browserbase, Steel, or Browser Use — they ship tuned stealth, and double-masking creates contradictions that trigger bot heuristics. On those providers, Oya's control plane manages the persona identity, cookie jar, proxy, and concurrency limits.

---

## The CLI

```
oya login                       Save an API key for this machine
oya init                        Configure model, browser provider, solver, and sign-in
oya start [--persona auto]      Start a browser and print its ID
oya goto <url>                  Navigate the newest browser
oya ask "<prompt>"              Drive it with natural language
oya ls / oya status             List running browsers and activity history
oya rm <id>… | --all            Stop browsers (cloud sandboxes destroyed, CDP released)
oya personas new [name]         --platform mac|win|linux --tz <zone> --locale <l> --max <n>
oya personas edit|clone|rm <id> Edit name and cap; clone device fingerprints
oya open                        Watch a browser work in real-time
oya config [key=value ...]      Manage API key configuration
oya usage                       Audit hourly spend per key
oya stealth-test [--live]       Benchmark evasion against CreepJS and Sannysoft
```

---

## Bring your own tools

`browser.cdpUrl` is an Oya Gateway URL, not a vendor lock-in. Point standard tools directly at Oya:

```ts
import { chromium } from "playwright";
import { Oya } from "@oya/browser";

const oya = new Oya();
const browser = await oya.browser.start();

// Connect standard Playwright directly through Oya's gateway:
const pw = await chromium.connectOverCDP(browser.cdpUrl);
```

The gateway exposes standard `/json/version`, `/json/list`, and `/connect` endpoints, giving you unified routing, persona injection, and session recording across Playwright, Puppeteer, Stagehand, browser-use, Claude Code, and Cursor.

---

## Self-hosting

```bash
docker compose up            # server + UI on :3100
```

Open the dashboard at `http://localhost:3100`, create an API key, and complete onboarding. All state — browsers, personas, cookies, settings, usage, and audit trails — is strictly scoped to each API key.

### Environment Configuration

| Variable | Description |
|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Persistent storage across restarts. (Defaults to local `server/data/` if unset). |
| `OYA_PROFILE_SECRET` | KEK for encrypting credentials, cookies, and TOTP seeds at rest (AES-256-GCM). |
| `OYA_OPERATOR_TOKEN` | Host-wide control token for Prometheus metrics scrape (`/metrics`), draining, and defaults. |
| `DAYTONA_API_KEY`, `DAYTONA_SNAPSHOT`, `OYA_PUBLIC_WS_URL` | Cloud browser sandbox orchestration via Daytona. |

### Cloud Browser Sandboxes

`DAYTONA_SNAPSHOT` must name an image built from `browser/Dockerfile` containing `/docker-entrypoint.sh`:

```bash
docker build --platform linux/amd64 --provenance=false --sbom=false \
  -t <registry>/oya-browser:<version> browser/
docker push <registry>/oya-browser:<version>
```

Register the tagged image with Daytona and set `DAYTONA_SNAPSHOT`. `OYA_PUBLIC_WS_URL` must be reachable by cloud sandboxes (use ngrok or cloudflared when testing locally).

---

## Repository Layout

```
packages/sdk     @oya/browser — TypeScript client (ESM, CJS, Types)
packages/cli     oya — terminal CLI for fleet control and stealth testing
server           Browser Control Plane: API, gateway, personas, proxies, challenge routing
browser          Containerized & desktop Electron browser with stealth injection
ui               Control Plane Dashboard: Browsers · Personas · Control
```

---

## Verification & Tests

```bash
npm test
```

Runs full security verification, cookie tenant isolation, CDP gateway forwarding, provider failover contracts, persona persistence, challenge handling, and login state sync.

---

## License

MIT
