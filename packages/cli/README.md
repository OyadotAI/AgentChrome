# @oya-ai/cli

The `oya` command: start, drive and watch browsers on the Oya control plane from your terminal.

```bash
npm i -g @oya-ai/cli
oya login     # paste an API key from browser.getoya.ai
oya init      # pick your model, browser provider and sign-ins
```

## A session

```bash
oya start --persona auto          # prints the browser id
oya goto https://example.com      # defaults to the newest browser
oya ask "Find the pricing page"   # drive it in plain language
oya open                          # watch it live
oya rm --all
```

## Commands

| Command | |
|---|---|
| `oya start [--persona auto] [--provider <p>]` | Start a browser and print its id |
| `oya goto <url>` · `oya ask "<prompt>"` | Navigate · drive it in plain language (`--id` picks a browser) |
| `oya ls` · `oya rm <id> \| --all` | List · stop browsers |
| `oya status` · `oya open` | Health and recent activity · open the live view |
| `oya personas [new \| edit \| clone \| rm]` | Identities: fingerprint + cookies + proxy |
| `oya config [key=value ...]` | Show or change this key's settings |
| `oya sessions` · `oya events` · `oya control` | Durable sessions, lifecycle events, project overview |
| `oya takeover <id>` · `oya release <id>` · `oya resume <id>` | Human control of a running browser |
| `oya members` · `oya credential` · `oya webhook` | Team, service credentials, signed webhooks |
| `oya usage` | What this key has spent |
| `oya stealth-test [--live]` | Score this deployment against bot detectors |

Run `oya help` for every flag.

## Configuration

`oya login` saves the key to `~/.oya/config.json` (or under `OYA_CONFIG_HOME`). `OYA_API_KEY` and `OYA_BASE_URL` override it, and so do `--key` and `--url`, so CI needs no login. Add `--json` for machine-readable output.

Building an agent in code? Use the SDK: [@oya-ai/browser](https://www.npmjs.com/package/@oya-ai/browser).
