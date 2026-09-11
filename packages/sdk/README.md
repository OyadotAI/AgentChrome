# @oya-ai/browser

Thousands of browsers behind one API: personas, proxies, stealth, CAPTCHA and MFA. The browser can run on Oya Cloud, Browserbase, Steel, Anchor, Browser Use, your own machines, or any CDP URL. Which one is a setting on your API key, so your code never changes.

```bash
npm i @oya-ai/browser
```

Get an API key at [browser.getoya.ai](https://browser.getoya.ai) and export it as `OYA_API_KEY`.

## Quickstart

```ts
import { Oya } from '@oya-ai/browser';

const oya = new Oya();                            // reads OYA_API_KEY
await using browser = await oya.browser.start(); // stopped when the block exits, even on error
await browser.goto('https://news.ycombinator.com');
console.log(await browser.ask('What are the top 3 stories?'));
```

`await using` needs Node 24+ or TypeScript 5.2+. Otherwise call `await browser.stop()` in a `finally` block.

## Personas

A persona is one device: fingerprint, cookie jar and exit IP, the same on every run.

```ts
const persona = await oya.personas.create({
  name: 'us-shopper',
  prefs: { platform: 'MacIntel', timezone: 'America/New_York', locale: 'en-US' }, // fixed for life
  proxy: { geo: 'US' },
});
await using browser = await oya.browser.start({ persona: persona.id }); // or 'auto' to rotate
```

## CAPTCHA and MFA

```ts
await using browser = await oya.browser.start({ captcha: 'auto' }); // solve on every goto()
await browser.solveCaptcha();                                        // or on demand

await oya.personas.setMfa(persona.id, { type: 'totp', secret: process.env.TOTP_SECRET! });
const mfa = await browser.completeMfa(); // totp, email, sms, or a human handoff
if (!mfa.completed) console.log('Finish it here:', mfa.liveViewUrl);
```

## Any vendor, any tool

```ts
import { chromium } from 'playwright-core';

await using browser = await oya.browser.start({ provider: 'browserbase' }); // one string per vendor
const pw = await chromium.connectOverCDP(browser.cdpUrl!);                  // Playwright, Puppeteer, Stagehand…
```

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
