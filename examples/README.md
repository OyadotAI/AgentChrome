# Examples

| File | Shows |
|---|---|
| [`01-quickstart.ts`](01-quickstart.ts) | Start a cloud browser and drive it in plain English |
| [`02-multi-vendor.ts`](02-multi-vendor.ts) | One script on Oya Cloud, Browserbase, Steel, Anchor and Browser Use |
| [`03-captcha.ts`](03-captcha.ts) | Detect and solve a CAPTCHA |
| [`04-mfa.ts`](04-mfa.ts) | TOTP stored on the persona, with a human fallback |
| [`05-personas.ts`](05-personas.ts) | Stable device identities: create, reuse, rotate, clone |
| [`06-playwright.ts`](06-playwright.ts) | Playwright through Oya's CDP gateway (needs a CDP vendor: Browserbase, Steel, Anchor or Browser Use) |

Needs Node 20.6+ and an API key from the dashboard at https://browser.getoya.ai.

```bash
git clone https://github.com/OyadotAI/AgentChrome.git
cd AgentChrome/examples
npm install                  # also builds the SDK from ../packages/sdk
cp .env.example .env         # paste your API key after OYA_API_KEY=
npx tsx --env-file=.env 01-quickstart.ts
```

If `OYA_API_KEY` is already exported in your shell, it wins over `.env`. Run `unset OYA_API_KEY` first.

Vendor keys (Browserbase, Steel, Anchor, Browser Use) and your CAPTCHA solver key are set once on your Oya key in the dashboard. They never appear in code.

## Live demo

`demo.ts` walks through everything above in one run, pausing for Enter between steps: vendors, a persona, a real Amazon page, CAPTCHA, a screenshot, plain-English control, a parallel fleet, and a two-factor login. Any step your key isn't set up for says what's missing and the demo carries on.

```bash
npx tsx --env-file=.env demo.ts              # --no-pause to run straight through
```

To light up every step, open **Settings** in the dashboard:

1. **AI model:** pick Claude or OpenAI and paste your API key. This enables "Drive it in plain English".
2. **Browsers:** pick a vendor under *Default provider*, enter its key and save. Repeat for each vendor you have. The fleet step spreads across all of them. The demo chooses providers itself, so the final default doesn't matter.
3. **Verification:** set *CAPTCHA solver* to CapSolver and paste its key. The CAPTCHA step then solves as well as detects.
4. **Two-factor:** uncomment the public test account in `.env` (from `.env.example`). The demo logs in to authenticationtest.com with a TOTP code generated from the secret stored on the persona.
