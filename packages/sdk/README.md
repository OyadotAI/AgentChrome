# @oya-ai/browser

Thousands of browsers behind one API: personas, proxies, stealth, CAPTCHA and MFA. The browser can run on Oya Cloud, Browserbase, Steel, Anchor, Browser Use, your own machines, or any CDP URL. Which one is a setting on your API key, so your code never changes.

```bash
npm i @oya-ai/browser
```

Get an API key at [browser.getoya.ai](https://browser.getoya.ai) and export it as `OYA_API_KEY`. Every snippet below runs as-is.

## Quickstart

```ts
import { Oya } from '@oya-ai/browser';

const oya = new Oya();                            // reads OYA_API_KEY
await using browser = await oya.browser.start(); // stopped when the block exits, even on error
await browser.goto('https://news.ycombinator.com');
console.log(await browser.ask('What are the top 3 stories?'));
```

`await using` needs Node 24+ or TypeScript 5.2+. Otherwise call `await browser.stop()` in a `finally` block. `ask()` uses the AI model set on your key in the dashboard.

## Personas

A persona is one device: fingerprint, cookie jar and exit IP, the same on every run.

```ts
import { Oya } from '@oya-ai/browser';

const oya = new Oya();
const persona = await oya.personas.create({
  name: 'us-shopper',
  prefs: { platform: 'MacIntel', timezone: 'America/New_York', locale: 'en-US' }, // fixed for life
  proxy: { geo: 'US' },
});
await using browser = await oya.browser.start({ persona: persona.id }); // or persona: 'auto' to rotate
await browser.goto('https://example.com');
console.log(persona.fingerprint.platform, persona.fingerprint.timezone); // the same on every run
```

## CAPTCHA

The vendor's own solver when it has one, otherwise your CapSolver or 2Captcha key.

```ts
import { Oya } from '@oya-ai/browser';

const oya = new Oya();
await using browser = await oya.browser.start(); // or start({ captcha: 'auto' }) to clear them on every goto()
await browser.goto('https://www.google.com/recaptcha/api2/demo');
console.log(await browser.solveCaptcha()); // { present, solved, method: 'provider' | 'solver' | 'none' }
```

## MFA

The TOTP seed is sealed on the persona, and `completeMfa()` enters the code.

```ts
import { Oya } from '@oya-ai/browser';

const oya = new Oya();
const persona = await oya.personas.create({ name: 'billing-admin' });
await oya.personas.setMfa(persona.id, { type: 'totp', secret: process.env.TOTP_SECRET! }); // sealed, never read back

await using browser = await oya.browser.start({ persona: persona.id });
await browser.goto(process.env.MFA_URL!); // after your login step: the page asking for the code
const mfa = await browser.completeMfa();   // method: 'totp' | 'email' | 'sms' | 'handoff'
if (!mfa.completed) console.log('A person can finish it here:', mfa.liveViewUrl);
```

## Playwright, Puppeteer, Stagehand

`browser.cdpUrl` is a standard CDP endpoint on any CDP vendor.

```ts
import { chromium } from 'playwright-core';
import { Oya } from '@oya-ai/browser';

const oya = new Oya();
await using browser = await oya.browser.start({ provider: 'browserbase' }); // or steel, anchor, browseruse
const context = (await chromium.connectOverCDP(browser.cdpUrl!)).contexts()[0];
const page = context.pages()[0] ?? await context.newPage();
await page.goto('https://example.com');
console.log(await page.title());
```

Vendor keys are set once on your Oya key in the dashboard. They never appear in code.

## API

| | |
|---|---|
| `new Oya({ apiKey?, baseUrl?, timeoutMs? })` | Defaults to `OYA_API_KEY` and `OYA_BASE_URL` |
| `oya.browser` | `start(options)`, `get(id)`, `list()`, `stop(ids \| 'all')`, `stopAll()` |
| `browser` | `goto`, `ask`, `analyze`, `elements`, `click`, `type`, `pressKey`, `scroll`, `waitFor`, `screenshot`, `url`, `tabs`, `openTab`, `switchTab`, `closeTab`, `solveCaptcha`, `completeMfa`, `liveViewUrl`, `status`, `stop`, `cdpUrl` |
| `oya.personas` | `list`, `get`, `create`, `update`, `clone`, `preview`, `options`, `pinProxy`, `remove`, `setMfa`, `clearMfa` |
| `oya.config` | `get()`, `set(values)`: model, provider and solver keys for this API key |
| `oya.control` | Sessions, human takeover, events, members, credentials and webhooks |
| `oya.usage()` | What this key has spent |

Errors are thrown as `OyaError` with `status` and `body`. ESM and CommonJS, fully typed, no runtime dependencies, Node 18+.

More: [examples](https://github.com/OyadotAI/AgentChrome/tree/main/examples) · [docs](https://browser.getoya.ai/docs) · [CLI](https://www.npmjs.com/package/@oya-ai/cli)
