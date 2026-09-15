# @oya-ai/browser

<p align="center">
  <strong>Thousands of browsers behind one API: personas, residential proxies, measured stealth, CAPTCHA, and MFA.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@oya-ai/browser"><img src="https://img.shields.io/npm/v/@oya-ai/browser?color=39ed35&label=@oya-ai/browser&logo=npm" alt="NPM Version"></a>
  <a href="https://github.com/OyadotAI/oya-browser/blob/main/packages/sdk/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?color=39ed35" alt="License: MIT"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-Ready-3178C6.svg?logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg" alt="Node Version"></a>
  <a href="https://bundlephobia.com/package/@oya-ai/browser"><img src="https://img.shields.io/bundlephobia/minzip/@oya-ai/browser?color=39ed35" alt="Bundle Size"></a>
</p>

---

Orchestrate browser instances running on **Oya Cloud sandboxes**, **Browserbase**, **Steel**, **Anchor**, **Browser Use**, or your own **private Chrome fleet**.

Oya does for browser vendors what OpenRouter does for LLM providers. The vendor behind a browser is a setting on your API key, or one `provider` parameter, so switching vendors never means rewriting your agent.

```bash
npm install @oya-ai/browser
```

Get an API key at [browser.getoya.ai](https://browser.getoya.ai) or self-host your control plane, and set `OYA_API_KEY`.

---

## ⚡ Quickstart

### Natural Language Driving

```ts
import { Oya } from "@oya-ai/browser";

const oya = new Oya(); // Reads process.env.OYA_API_KEY

// Explicit resource management (Node 24+ / TS 5.2+)
// Stops the browser automatically when the scope exits, even on error
await using browser = await oya.browser.start({ persona: "auto", captcha: "auto" });

await browser.goto("https://news.ycombinator.com");
const answer = await browser.ask("What are the top 3 stories and their points?");
console.log(answer);
```

### Data pass-through: the model never sees your values

```ts
await browser.ask("Search for order {{orderNumber}} and download its invoice", {
  data: { orderNumber: "1042" }, // typed into the page; the LLM only reads {{orderNumber}}
});
```

### Playbooks: ask once, replay without the LLM

```ts
const pb = await browser.toPlaybook("download-invoice");
console.log(pb.variables); // ["orderNumber"]
console.log(pb.code);      // the same flow as Playwright

// Later, on any browser. If the site changed, the agent finishes the task
// and saves its fix as a draft ("download-invoice:draft").
const result = await browser.play("download-invoice", { orderNumber: "2077" });
if (result.healed) await oya.playbooks.promote("download-invoice"); // after reviewing it
// autoHeal: false throws at the broken step instead.
```

### Submit and get called back

```ts
const run = await browser.submit({ playbook: "download-invoice" }, {
  data: { orderNumber: "2077" },
  onSuccess: (result) => console.log("done", result),
  onFailure: (error) => console.error("failed", error.message),
  // CAPTCHA or MFA it could not clear, the agent asking a question, or a replay it could not heal.
  onHumanAttention: async (req) => {
    console.log(req.reason, req.message, req.liveViewUrl);
    await req.respond("done"); // or your answer, when req.reason === "agent"
  },
  onHealed: (result) => console.log("fix saved as", result.draft),
});
await run.done;
```

> **Universal Lifecycle:** If you are not using `await using`, manage lifecycle with `try / finally`:
> ```ts
> const browser = await oya.browser.start();
> try {
>   await browser.goto("https://example.com");
> } finally {
>   await browser.stop();
> }
> ```

---

## 🛡️ Deterministic Personas (Anti-Ban Identity)

A persona is a permanent, mathematically seeded device identity: **fingerprint + cookie jar + residential proxy**, identical on every run to eliminate bot-farm and device-farm flags.

```ts
import { Oya } from "@oya-ai/browser";

const oya = new Oya();

// Create a persistent persona
const persona = await oya.personas.create({
  name: "us-shopper",
  prefs: { platform: "MacIntel", timezone: "America/New_York", locale: "en-US" },
  proxy: { geo: "US" },
  maxConcurrent: 2, // Concurrency cap prevents device-farm detection
});

// Launch a browser with this persona (or persona: 'auto' for least-recently-used)
await using browser = await oya.browser.start({ persona: persona.id });
await browser.goto("https://www.amazon.com");

// Hardware attributes remain byte-identical on subsequent sessions
console.log(persona.fingerprint.platform, persona.fingerprint.timezone);

// Need another device of the same class? Clone it with an empty cookie jar:
// const altDevice = await oya.personas.clone(persona.id, { name: "us-shopper-02" });
```

---

## 🧠 Structured Agent Analysis & Interaction

Skip messy DOM traversal. Get clean markdown and numbered interactive elements:

```ts
import { Oya } from "@oya-ai/browser";

const oya = new Oya();
await using browser = await oya.browser.start();
await browser.goto("https://github.com/trending");

// Analyze page: returns markdown and visible numbered elements
const { markdown, elements } = await browser.analyze();
console.log(markdown.slice(0, 300));

// Interact using numbered element IDs:
const firstRepo = elements.find((el) => el.tag === "a" && el.href?.includes("/stargazers"));
if (firstRepo) {
  await browser.click(firstRepo.id); // clicks [data-ac-id="firstRepo.id"]
}
```

---

## 🧩 Challenge Handling: Automated CAPTCHA & Sealed MFA

```ts
import { Oya } from "@oya-ai/browser";

const oya = new Oya();

// 1. Seal a TOTP secret on a persona (encrypted with AES-256-GCM at rest, never exposed over API)
const persona = await oya.personas.create({ name: "finance-admin" });
await oya.personas.setMfa(persona.id, {
  type: "totp",
  secret: process.env.TOTP_SECRET!,
});

await using browser = await oya.browser.start({ persona: persona.id });

// 2. Clear CAPTCHAs automatically (uses vendor solver or CapSolver/2Captcha fallback)
await browser.goto("https://www.google.com/recaptcha/api2/demo");
const captcha = await browser.solveCaptcha();
console.log("CAPTCHA Solved:", captcha.solved, "via", captcha.method);

// 3. Complete Two-Factor Authentication
await browser.goto(process.env.MFA_LOGIN_URL!);
const mfa = await browser.completeMfa();

if (!mfa.completed && mfa.liveViewUrl) {
  // Hand off to human operator if interactive push notification or WebAuthn is needed
  console.log("Interactive handoff required at:", mfa.liveViewUrl);
}
```

---

## 🔌 Universal CDP Gateway (Playwright & Puppeteer)

Every browser exposes an authenticated `browser.cdpUrl` routed through Oya's gateway. Connect standard Playwright, Puppeteer, or Stagehand:

```ts
import { chromium } from "playwright-core";
import { Oya } from "@oya-ai/browser";

const oya = new Oya();

// Run on any underlying provider: browserbase, steel, anchor, browseruse, or oya-cloud
await using browser = await oya.browser.start({ provider: "browserbase" });

// Connect Playwright directly over Oya's gateway
const context = (await chromium.connectOverCDP(browser.cdpUrl!)).contexts()[0];
const page = context.pages()[0] ?? (await context.newPage());

await page.goto("https://news.ycombinator.com");
console.log("Page Title:", await page.title());
```

---

## 📚 Complete API Reference

### Initialization

```ts
import { Oya } from "@oya-ai/browser";

const oya = new Oya({
  apiKey: "oya_...",                    // default: process.env.OYA_API_KEY
  baseUrl: "https://browser.getoya.ai", // default: OYA_BASE_URL, then the hosted service
  timeoutMs: 60_000,                    // per request
  // fetch: customFetch,                // any fetch-compatible implementation
});
```

### Browser Operations (`oya.browser`)

| Method | Signature | Description |
|:---|:---|:---|
| `start(options)` | `(options?: StartOptions) => Promise<Browser>` | Start a browser and wait until it is ready for commands |
| `get(id)` | `(id: string) => Promise<Browser>` | Reattach to an existing running browser |
| `list()` | `() => Promise<BrowserInfo[]>` | List all active running browser sessions |
| `stop(ids \| 'all')` | `(ids: string[] \| 'all') => Promise<{ stopped: number; results: StopResult[] }>` | Stop target browsers or all browsers |
| `stopAll()` | `() => Promise<number>` | Terminate all active browser sessions |

#### `StartOptions`

- `persona?: 'default' | 'auto' | string` — Assign persistent identity
- `provider?: 'oya-cloud' | 'oya-selfhosted' | 'browserbase' | 'steel' | 'anchor' | 'browseruse' | 'cdp'`
- `wsUrl?: string`: required only for the `'cdp'` provider
- `name?: string`: display name in the console and `oya ls`
- `captcha?: 'auto' | 'off'` — Automatically solve CAPTCHAs on navigation
- `queueMs?: number` — Wait duration for fleet capacity (ms)
- `budgetUsd?: number` — Enforce budget limit for session
- `idempotencyKey?: string` — Safe retry token
- `governed?: boolean` — Enforce strict isolation policies

### Browser Instance Methods (`browser.*`)

| Method | Returns | Description |
|:---|:---|:---|
| `goto(url)` | `Promise<void>` | Navigate to URL (with optional auto-CAPTCHA) |
| `ask(prompt)` | `Promise<string>` | Natural-language AI driving using key's configured model |
| `analyze()` | `Promise<Analysis>` | Returns markdown representation and numbered elements |
| `elements()` | `Promise<Element[]>` | Returns only visible interactable elements |
| `click(elementId)` | `Promise<void>` | Click element by numeric ID from `analyze()` |
| `type(elementId, text)` | `Promise<{ suggestions_visible?: boolean }>` | Type text into specified element |
| `pressKey(key)` | `Promise<void>` | Dispatch keyboard key event (e.g. `'Enter'`) |
| `scroll(dir, amount?, at?)` | `Promise<void>` | Scroll `'up' \| 'down' \| 'top' \| 'bottom'` |
| `waitFor(selector, timeout?)`| `Promise<void>` | Wait for DOM selector |
| `screenshot()` | `Promise<string>` | Capture page as base64 image data URL |
| `url()` | `Promise<string>` | Current active tab URL |
| `tabs()` | `Promise<Tab[]>` | List open tabs |
| `openTab(url?)` | `Promise<string>` | Open a new tab |
| `switchTab(tabId)` | `Promise<void>` | Switch active tab |
| `closeTab(tabId)` | `Promise<void>` | Close target tab |
| `solveCaptcha()` | `Promise<CaptchaResult>` | Detect and solve on-screen CAPTCHA |
| `completeMfa()` | `Promise<MfaResult>` | Resolve TOTP/SMS MFA or return `liveViewUrl` |
| `liveViewUrl()` | `string` | SSE JPEG stream URL for sub-second human takeover |
| `status()` | `Promise<BrowserDetail>` | Instance metrics, health, and recent activity log |
| `stop()` | `Promise<StopResult>` | Tear down sandbox and release CDP session |

### Persona Management (`oya.personas`)

| Method | Description |
|:---|:---|
| `create({ name?, prefs?, proxy?, maxConcurrent? })` | Create new deterministic device identity |
| `list()` | List all saved personas and active concurrency |
| `get(id)` | Get persona profile details |
| `update(id, changes)` | Update name, concurrency limit, or proxy geo |
| `clone(id, options)` | Create fresh persona with same device traits but empty cookie jar |
| `preview(prefs)` | Preview generated hardware fingerprint before creating |
| `options()` | Available platforms, timezones, and valid locales |
| `pinProxy(id, proxyId)` | Bind persona permanently to a residential proxy exit node |
| `remove(id)` | Delete persona and associated cookie jar |
| `setMfa(id, config)` | Store TOTP secret (sealed at rest with AES-256-GCM) |
| `clearMfa(id)` | Remove MFA secret from persona |

### Proxies (`oya.proxies`)

| Method | Description |
|:---|:---|
| `create({ url, label?, geo?, kind?, maxPersonas? })` | Add a proxy from your vendor. Credentials are encrypted and never returned |
| `list()` | Your proxies and shared ones, with exit IP, health and how many personas use each |
| `check()` | Dial every proxy and record its real exit IP |
| `remove(id)` | Delete a proxy and unpin the personas on it |

```ts
const proxy = await oya.proxies.create({
  url: "http://user:pass_session-shopper1@gate.vendor.com:7000", // one sticky session per persona
  label: "us-shopper-1", geo: "US", kind: "residential", maxPersonas: 1,
});
await oya.personas.pinProxy(persona.id, proxy.id);
```

### Durable Governance & Control (`oya.control`)

| Method | Description |
|:---|:---|
| `overview()` | Fleet overview, spend, sessions, and active rate cards |
| `sessions()` | List all durable sessions (including cleanup-pending) |
| `session(id)` | Get detailed session execution state |
| `takeover(id, 'acquire' \| 'release' \| 'resume')` | Manage human control leases |
| `ticket(id)` | Generate single-use connection ticket for secure handoff |
| `events(after?)` | Stream append-only audit event log |
| `createCredential(options)` | Mint scoped service credential (`viewer` / `operator` / `administrator`) |
| `createWebhook(url, types)` | Register HMAC-signed webhook for fleet lifecycle events |

---

## 🚨 Error Handling

All failed API and command operations throw an `OyaError`:

```ts
import { Oya, OyaError } from "@oya-ai/browser";

try {
  const oya = new Oya();
  await oya.browser.start({ persona: "invalid-id" });
} catch (err) {
  if (err instanceof OyaError) {
    console.error(`Oya API Error (${err.status}):`, err.message);
    console.error("Payload:", err.body);
  }
}
```

---

## 📄 License

MIT © [Oya](https://getoya.ai)
