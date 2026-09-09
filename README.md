# Oya Browser

**The OpenRouter for browsers.** One API and one console in front of Oya
Cloud, Browserbase, Steel, Anchor, Browser Use and your own Chrome. Every
browser runs as a persona — a stable identity with its own logins and exit IP
— with CAPTCHA and MFA handled. The provider is a setting, not a rewrite.

```ts
import { Oya } from "@oya/browser";

const oya = new Oya();                                    // OYA_API_KEY
const browser = await oya.browser.start({ persona: "auto", captcha: "auto" });
await browser.goto("https://example.com");
```

That is the whole surface. Which provider actually runs the browser — our cloud,
your own machines, Browser Use, Browserbase, Steel, Anchor, or a CDP URL you
hand us — is a setting on your API key, not something your code has to know.

```bash
npm i @oya/browser
npx oya login && npx oya init
```

## What it is

A **control plane** for browser fleets. It sits between your agents and whoever
runs the browsers, and it owns the parts that are hard:

- **Identity.** A *persona* is one fingerprint, one cookie jar, one proxy, bound
  together and stable for its life. Rotation means picking a different persona,
  never giving one a new fingerprint.
- **Evasion, measured.** Stealth is scored against real detectors, not asserted.
  `oya stealth-test` prints the number.
- **Challenges.** CAPTCHA and MFA are two method calls, with provider-native
  solving used where it exists and a solver behind it where it does not.
- **Control.** A console built to hold a thousand browsers: health at a
  glance, every number a filter, and any row opened into a live, interactive
  view with its activity log and a Stop that actually stops it. Underneath:
  metrics, per-key usage, an append-only audit trail, rate limits and quotas.

Self-hostable, standalone. Everything is configured against an API key from the
dashboard or `oya init` — no environment variables to hunt down.

## Personas, and why they exist

Two ways to get caught, and they are mirror images:

| Shape | Signal |
|---|---|
| One account, many device fingerprints | Textbook bot farm |
| One device fingerprint, many accounts — or 1,000 concurrent sessions | Device farm |

Binding fingerprint to the API key avoids the first and walks into the second.
Binding it to the browser avoids the second and walks into the first. So the
binding sits at the level that actually corresponds to a device:

```
persona = fingerprint + cookie jar + proxy       # one identity, one device
API key = a group of personas                    # your fleet
```

A persona's fingerprint is derived from a stored seed, so it is byte-identical
across restarts — a returning session looks like a returning device. Concurrency
is capped per persona, because one laptop cannot be in a thousand places at
once, and `activeBrowsers` is visible in the dashboard and as a metric rather
than silently exceeded.

```ts
const p = await oya.personas.create({ name: "acme-ops" });
await oya.personas.setMfa(p.id, { type: "totp", secret: "JBSWY3DPEHPK3PXP" });
const browser = await oya.browser.start({ persona: p.id });
```

## Challenges

```ts
await browser.solveCaptcha();   // { solved, method: 'provider' | 'solver' | 'none' }
await browser.completeMfa();    // TOTP, email OTP, SMS OTP, or a human handoff
```

CAPTCHA solving delegates to the provider when the provider does it natively
(Anchor, Browserbase, Steel, Browser Use all do) rather than paying twice and
racing their attempt. Otherwise it goes to your configured solver. A failure
returns `{ solved: false }` — a silent no-op that leaves an agent stuck is
worse than a clear answer.

Automated solving conflicts with some sites' terms of service. Sessions that
used it are recorded in the audit trail so you can see which.

MFA covers TOTP (seed sealed at rest, never returned by the API), email and SMS
one-time codes via a relay endpoint, and a human handoff that hands back a live
view URL — the only workable answer for push-approval MFA.

## Sign in once, on your own machine

For browsers on our infrastructure, the desktop app is a one-time step: log into
the sites your agents need, and those cookies move to the remote browsers, which
run the same fingerprint as that identity. The agent arrives already signed in,
and the site sees one device returning rather than a fleet sharing an account.

The dashboard pairs the desktop app over an `oya://` link. That link carries a
**single-use pairing code**, never your API key — a protocol URL is reachable by
any page you visit, and it lands in OS logs on the way. The app exchanges the
code over HTTPS with the server the link names, and asks you first, naming the
destination host. Cancel is the default: a code proves the dashboard issued the
link, not that you meant to click it.

## Stealth, measured

"Zero detection" is not a number anyone can hold you to. This one is:

```bash
node server/test-stealth.js            # local probe suite
node server/test-stealth.js --live     # against live detectors
```

It scores a bare browser against a protected one across canvas, WebGL, audio,
client rects, plugins, `navigator.webdriver`, `userAgentData`, media devices and
`Function.prototype.toString` masking, and reports the delta. Improvements are
attributable to the change that made them.

`--live` adds real detectors — bot.sannysoft.com and CreepJS — and prints both
columns, because a live number on its own says nothing about whether any of it
is working. CreepJS's headless verdict is the honest one to watch; it is not at
zero, and the harness exists so that stays visible rather than assumed.

Our own stealth applies to Oya Cloud, self-hosted and plain CDP browsers. It is
deliberately **not** layered on top of Anchor, Browserbase, Steel or Browser Use
— they ship tuned stealth, and a second layer contradicts theirs, which is a
stronger signal than either alone. On those providers a persona still governs
the cookie jar, the proxy and the concurrency cap; only the device spoofing is
theirs to do.

Known gap, measured rather than assumed: a Worker is a separate global that the
injected script does not reach, so values the persona spoofs disagree between
page and worker and the real machine shows through. CreepJS compares exactly
that. The `worker.coherent` probe fails on purpose so it stays visible.

## The CLI

```
oya login                       Save an API key for this machine
oya init                        Model, browser provider, solver, desktop sign-in
oya start [--persona auto]      Start a browser
oya goto <url>                  Navigate
oya ask "<prompt>"              Drive it in plain language
oya ls / oya status             What is running, and what one of them has been doing
oya rm <id>… | --all            Stop — a cloud sandbox is destroyed, a CDP session released
oya personas new [name]         --platform mac|win|linux --tz <zone> --locale <l> --max <n> [--preview]
oya personas edit|clone|rm <id> Name, cap and proxy are editable; the device is cloned, never changed
oya open                        Watch a browser work
oya config [key=value ...]      This key's settings
oya usage                       What this key has spent
oya stealth-test [--live]       Score this deployment
```

## Bring your own tools

`browser.cdpUrl` is a gateway URL, not the vendor's — point Playwright,
Puppeteer, Stagehand or browser-use at it and you get routing, profile capture
and session recording without any of them knowing this exists.

```ts
const browser = await oya.browser.start();
const pw = await chromium.connectOverCDP(browser.cdpUrl);
```

The gateway also answers `/json/version` and `/json/list`, which is what lets
those clients treat it as an ordinary browser.

## Self-hosting

```bash
docker compose up            # server + UI on :3100
```

Then open the dashboard, create an API key, and walk through onboarding. The
API key is the identity for everything: browsers, personas, cookies, settings,
usage and audit history are all scoped to it, and one key can never see
another's.

Optional environment:

| Variable | Why |
|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Persist across restarts. Without it, state lives in `server/data/`. |
| `OYA_PROFILE_SECRET` | The KEK for credentials at rest. Generated into `server/data/.secret` if unset — back it up. |
| `OYA_OPERATOR_TOKEN` | Host-wide controls: metrics scrape, drain, deployment defaults. |
| `DAYTONA_API_KEY`, `DAYTONA_SNAPSHOT`, `OYA_PUBLIC_WS_URL` | Cloud browsers. See below. |

Migrations live in `server/migrations/`; apply them in order.

### Cloud browsers

`DAYTONA_SNAPSHOT` must name an image built from `browser/Dockerfile` — one that
carries `/docker-entrypoint.sh`. Point it at anything else and sandboxes start,
fail to launch a browser, and bill until their TTL; the server checks for that
entrypoint and refuses up front rather than letting you wait it out.

```bash
docker build --platform linux/amd64 --provenance=false --sbom=false \
  -t <registry>/oya-browser:<version> browser/
docker push <registry>/oya-browser:<version>
```

Then register it as a Daytona snapshot (Daytona rejects `:latest` — pin a real
tag) and set `DAYTONA_SNAPSHOT` to that name.

`OYA_PUBLIC_WS_URL` is where the sandbox dials back, so it has to be reachable
from a cloud VM. A server on localhost needs a tunnel; `ws://localhost` will
create sandboxes that never enrol.

## Layout

```
packages/sdk     @oya/browser — the TypeScript client
packages/cli     oya — the command line
server           control plane: API, gateway, personas, proxies, challenges
browser          the desktop/containerised Oya browser
ui               dashboard: Browsers · Personas · Control
```

## Tests

```bash
cd server && for t in test-security test-pool test-sandbox test-cdp \
  test-control-plane test-gateway test-anonymity test-challenges; do node $t.js; done
```

## License

MIT
