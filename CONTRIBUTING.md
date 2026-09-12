# Contributing

Thanks for looking. Bug reports, fixes and new backends are all welcome.

## Before you start

- **Security problems** go through GitHub's private advisory form —
  [Report a vulnerability](https://github.com/OyadotAI/oya-browser/security/advisories/new) —
  never a public issue.
- **Large changes** — a new provider, a new storage backend, a change to the
  persona model — open an issue first so we can agree on the shape.
- **Licensing.** The SDK (`packages/sdk`) and CLI (`packages/cli`) are MIT.
  Everything else is under the [Sustainable Use License](LICENSE.md). By
  opening a pull request you agree your contribution is licensed the same way
  as the directory it lands in.

## Setup

Node 22+ and npm 10+.

```bash
git clone https://github.com/OyadotAI/oya-browser.git
cd oya-browser
npm run setup          # root, server, ui and browser dependencies
npm test               # server suite + CLI suite, no credentials needed
```

The test suite is hermetic: it runs with no database, no cloud keys and no
network. If a test of yours needs any of those, mock it — `server/test-providers.js`
and `server/test-sandbox.js` show the pattern.

Some tracked tests are deliberately *not* reachable from `npm test`, because
they need something CI does not have. Run them by hand when you touch that area:

| Test | Needs |
|:---|:---|
| `server/test-stealth.js` | a real Chrome, and the public detector sites |
| `server/test-control-postgres.js` | a Postgres at `DATABASE_URL` |
| `server/test-control-supabase.js` | a live Supabase project |
| `browser/test-cdp-front-door.mjs` | a running browser container and `playwright-core` |
| `ui/tests/*.spec.ts` | Playwright and a running stack (`npx playwright test`) |

`browser/test-regressions.js` needs neither Electron nor a display and does run
in CI (`npm test --prefix browser`).

Running the stack locally:

```bash
make dev               # API + Next.js console on http://localhost:3100
make wizard            # the guided self-host install, if you want the full stack
```

`server/.env` is loaded from the server's working directory. Copy
`server/.env.example` to start.

## House style

This codebase is deliberately small. A few things reviewers will push back on:

- **No new dependency** for something a few lines of standard library covers.
  The SDK has zero runtime dependencies and stays that way.
- **No abstraction with one implementation.** No factory for one product, no
  config knob for a value that never changes.
- **Comments explain why, not what.** The existing comments — especially in
  `server/src/net-guard.js`, `server/src/secrets.js` and `server/src/auth.js` —
  are the tone to match: they say what the security decision was and what
  breaks without it.
- **Every non-trivial change leaves one runnable check behind.** Add a case to
  the relevant `server/test-*.js`; they are plain `node` scripts with
  `assert`, no framework.
- **Deliberate corner-cuts get a `ponytail:` comment** naming the ceiling and
  the upgrade path, so the next reader knows it was a choice.

## Pull requests

1. Branch off `main`.
2. `npm test` and `npm run lint` both green.
3. One logical change per PR, with a description of what breaks without it.
4. If you touched anything under `server/src/control/`, say in the PR how you
   tested tenant isolation — that is the boundary most likely to regress.

## Project layout

| Path | What lives there |
|:---|:---|
| `server/` | Control plane: REST + MCP + WebSocket gateway, admission, personas, challenges |
| `server/src/control/` | Durable control plane: store, cluster, fleet drivers (docker, k8s) |
| `browser/` | Electron desktop app and the containerized browser runtime |
| `ui/` | Next.js console, live viewer and docs |
| `packages/sdk` | `@oya-ai/browser` — TypeScript SDK (MIT) |
| `packages/cli` | `@oya-ai/cli` — fleet CLI and the install wizard (MIT) |
| `examples/` | One runnable script per capability |
| `k8s/`, `docker-compose.yml` | Deployment manifests |
