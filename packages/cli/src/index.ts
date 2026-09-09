/**
 * oya — the command line for the Oya browser control plane.
 *
 *   oya login                  save an API key
 *   oya init                   onboarding: model, provider, sign-in
 *   oya start                  start a browser
 *   oya goto <url>             navigate the newest browser
 *   oya ls                     what is running
 *   oya rm <id|--all>          stop browsers
 *   oya personas               identities and their concurrency
 *   oya open                   watch a browser work
 *   oya stealth-test           score this deployment against bot detectors
 */

import { spawn } from 'node:child_process';
import { Oya, OyaError } from '@oya/browser';
import { load, save, resolved, configPath } from './config.js';
import { ask, askSecret, choose } from './prompt.js';

const HELP = `oya — thousands of browsers, one API

  oya login                       Save an API key for this machine
  oya init                        Set your model, browser provider and sign-ins
  oya start [--persona auto]      Start a browser and print its id
  oya goto <url> [--id <id>]      Navigate (defaults to the newest browser)
  oya ask "<prompt>" [--id <id>]  Drive it in plain language
  oya ls                          List running browsers
  oya rm <id> | --all             Stop browsers
  oya personas [new|rm <id>]      Identities: fingerprint + cookies + proxy
  oya open [--id <id>]            Open the live view in your browser
  oya config [key=value ...]      Show or change this key's settings
  oya usage                       What this key has spent
  oya stealth-test [--live]       Score this deployment against bot detectors

Options: --url <control plane>   --key <api key>   --json
Config:  ${configPath}
`;

type Flags = Record<string, string | boolean>;

function parse(argv: string[]): { command: string; args: string[]; flags: Flags } {
  const [command = 'help', ...rest] = argv;
  const args: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) { args.push(token); continue; }
    const name = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) flags[name] = true;
    else { flags[name] = next; i++; }
  }
  return { command, args, flags };
}

const flagStr = (flags: Flags, name: string): string | undefined =>
  typeof flags[name] === 'string' ? (flags[name] as string) : undefined;

function client(flags: Flags): Oya {
  const saved = resolved();
  const apiKey = flagStr(flags, 'key') || saved.apiKey;
  const baseUrl = flagStr(flags, 'url') || saved.baseUrl;
  if (!apiKey) {
    console.error('No API key. Run `oya login`, or pass --key / set OYA_API_KEY.');
    process.exit(1);
  }
  return new Oya({ apiKey, baseUrl });
}

const out = (flags: Flags, value: unknown, human: () => void): void => {
  if (flags.json) console.log(JSON.stringify(value, null, 2));
  else human();
};

/** The browser a command acts on when none is named: the most recent one. */
async function targetBrowser(oya: Oya, flags: Flags) {
  const id = flagStr(flags, 'id');
  if (id) return oya.browser.get(id);
  const all = await oya.browser.list();
  if (!all.length) {
    console.error('No browsers running. Start one with `oya start`.');
    process.exit(1);
  }
  return oya.browser.get(all[all.length - 1].id);
}

// ── Commands ────────────────────────────────────────────────────────────────

async function cmdLogin(flags: Flags): Promise<void> {
  const current = resolved();
  // `oya login --key ... --url ...` must not prompt: that is the CI path.
  let apiKey = flagStr(flags, 'key') || '';
  const baseUrl = (flagStr(flags, 'url')
    || (apiKey ? current.baseUrl : await ask('Control plane URL:', current.baseUrl))).replace(/\/+$/, '');

  const how = apiKey ? 'paste' : await choose('How do you want to authenticate?', [
    { id: 'paste', label: 'Paste an API key', note: 'from the dashboard, or a self-hosted key' },
    { id: 'password', label: 'Sign in with email and password', note: 'mints a new key for this machine' },
  ]);

  if (!apiKey && how === 'paste') apiKey = await askSecret('API key:');

  if (!apiKey && how === 'password') {
    const email = await ask('Email:');
    const password = await askSecret('Password:');
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const session = await res.json() as { access_token?: string; error?: string };
    if (!res.ok || !session.access_token) throw new Error(session.error || 'Sign-in failed');

    const minted = await fetch(`${baseUrl}/api/auth/keys`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'CLI' }),
    });
    const created = await minted.json() as { key?: string; error?: string };
    if (!minted.ok || !created.key) throw new Error(created.error || 'Could not create an API key');
    apiKey = created.key;
    console.log('  Created a new API key labelled "CLI".');
  }

  if (!apiKey) throw new Error('No API key given');

  // Prove it works before writing it — a saved-but-wrong key is a bad first run.
  const check = await fetch(`${baseUrl}/api/config`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!check.ok) throw new Error(`That key was rejected by ${baseUrl} (${check.status})`);

  save({ apiKey, baseUrl });
  console.log(`\n✅ Signed in to ${baseUrl}. Saved to ${configPath}`);
  console.log('   Next: `oya init` to pick your model and browser provider.');
}

async function cmdInit(flags: Flags): Promise<void> {
  const oya = client(flags);
  const current = await oya.config.get<{
    providers: Array<{ id: string; label: string; configured: boolean; needs: string[] }>;
    has_openai_key: boolean;
    chat_model: string;
  }>();

  console.log('\n── 1. Your model ──');
  const llm = await choose('Which LLM should agents use?', [
    { id: 'anthropic', label: 'Claude (Anthropic)' },
    { id: 'openai', label: 'OpenAI' },
    { id: 'skip', label: 'Skip', note: current.has_openai_key ? 'keep what is configured' : 'no agent control' },
  ]);

  const updates: Record<string, unknown> = {};
  if (llm !== 'skip') {
    updates.llm_provider = llm;
    const key = await askSecret(`${llm === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key:`);
    if (key) updates.openai_api_key = key;
    const model = await ask('Default model:', llm === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o-mini');
    if (model) updates.chat_model = model;
  }

  console.log('\n── 2. Where your browsers run ──');
  const provider = await choose('Browser provider:', current.providers.map((p) => ({
    id: p.id,
    label: p.label,
    note: p.needs.length ? (p.configured ? 'configured' : 'needs an API key') : undefined,
  })));
  updates.browser_provider = provider;

  const needs = current.providers.find((p) => p.id === provider)?.needs || [];
  for (const field of needs) {
    const value = await askSecret(`${field.replace(/_/g, ' ')}:`);
    if (value) updates[field] = value;
  }

  console.log('\n── 3. CAPTCHAs ──');
  const solver = await choose('Solve CAPTCHAs automatically?', [
    { id: '', label: 'No', note: 'providers that solve natively still will' },
    { id: 'capsolver', label: 'Yes, via CapSolver' },
    { id: '2captcha', label: 'Yes, via 2Captcha' },
  ]);
  updates.captcha_solver = solver;
  if (solver) {
    const key = await askSecret('Solver API key:');
    if (key) updates.captcha_api_key = key;
  }

  updates.onboarded = 'true';
  await oya.config.set(updates);
  console.log('\n✅ Saved against your API key.');

  if (provider === 'oya-cloud' || provider === 'oya-selfhosted') {
    console.log('\n── 4. Sign in once, on your own machine ──');
    console.log('   Your remote browsers reuse the cookies from a desktop sign-in, so agents');
    console.log('   arrive already logged in — as the same identity, from the same fingerprint.');
    console.log(`   Download the desktop browser: ${resolved().baseUrl}/downloads`);
  }

  console.log('\n   Then:  oya start && oya goto https://example.com');
}

async function cmdStart(flags: Flags): Promise<void> {
  const oya = client(flags);
  const browser = await oya.browser.start({
    persona: flagStr(flags, 'persona') || 'default',
    captcha: flags.captcha === false ? 'off' : 'auto',
    provider: flagStr(flags, 'provider') as never,
    wsUrl: flagStr(flags, 'ws-url'),
    name: flagStr(flags, 'name'),
  });
  out(flags, { id: browser.id, provider: browser.provider, persona: browser.persona, cdpUrl: browser.cdpUrl }, () => {
    console.log(`✅ ${browser.id}`);
    console.log(`   provider: ${browser.provider}   persona: ${browser.persona}`);
    if (browser.cdpUrl) console.log(`   cdp:      ${browser.cdpUrl}`);
  });
}

async function cmdGoto(args: string[], flags: Flags): Promise<void> {
  const url = args[0];
  if (!url) throw new Error('Usage: oya goto <url>');
  const oya = client(flags);
  const browser = await targetBrowser(oya, flags);
  await browser.goto(url);
  console.log(`✅ ${browser.id} → ${url}`);
}

async function cmdAsk(args: string[], flags: Flags): Promise<void> {
  const prompt = args.join(' ');
  if (!prompt) throw new Error('Usage: oya ask "find the pricing page"');
  const oya = client(flags);
  const browser = await targetBrowser(oya, flags);
  console.log(await browser.ask(prompt));
}

async function cmdLs(flags: Flags): Promise<void> {
  const all = await client(flags).browser.list();
  out(flags, all, () => {
    if (!all.length) return console.log('No browsers running.');
    for (const b of all) {
      console.log(`${b.id}  ${(b.provider || 'oya').padEnd(14)} ${(b.persona || 'default').padEnd(12)} ${b.name}`);
    }
    console.log(`\n${all.length} running.`);
  });
}

async function cmdRm(args: string[], flags: Flags): Promise<void> {
  const oya = client(flags);
  if (flags.all) {
    console.log(`✅ stopped ${await oya.browser.stopAll()}`);
    return;
  }
  if (!args.length) throw new Error('Usage: oya rm <id> | oya rm --all');
  for (const id of args) {
    await (await oya.browser.get(id)).close();
    console.log(`✅ stopped ${id}`);
  }
}

async function cmdPersonas(args: string[], flags: Flags): Promise<void> {
  const oya = client(flags);
  const [sub, ...rest] = args;

  if (sub === 'new' || sub === 'create') {
    const created = await oya.personas.create({
      name: flagStr(flags, 'name') || rest[0],
      proxy: flagStr(flags, 'proxy'),
      maxConcurrent: flagStr(flags, 'max') ? Number(flagStr(flags, 'max')) : undefined,
    });
    return out(flags, created, () => console.log(`✅ ${created.id}  ${created.name}`));
  }

  if (sub === 'rm' || sub === 'delete') {
    if (!rest[0]) throw new Error('Usage: oya personas rm <id>');
    await oya.personas.remove(rest[0]);
    return console.log(`✅ removed ${rest[0]}`);
  }

  const all = await oya.personas.list();
  out(flags, all, () => {
    if (!all.length) return console.log('No personas yet — `oya personas new`.');
    for (const p of all) {
      const cap = p.maxConcurrent === null ? '∞' : String(p.maxConcurrent);
      console.log(`${p.id}  ${p.name.padEnd(20)} ${p.activeBrowsers}/${cap} running`
        + `${p.proxy?.geo ? `  via ${p.proxy.geo}` : ''}${p.isDefault ? '  (default)' : ''}`);
    }
  });
}

async function cmdOpen(flags: Flags): Promise<void> {
  const browser = await targetBrowser(client(flags), flags);
  const url = browser.liveViewUrl();
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref();
  console.log(`Opening ${browser.id}`);
}

async function cmdConfig(args: string[], flags: Flags): Promise<void> {
  const oya = client(flags);
  if (!args.length) {
    const current = await oya.config.get();
    return out(flags, current, () => console.log(JSON.stringify(current, null, 2)));
  }
  const updates: Record<string, string> = {};
  for (const pair of args) {
    const index = pair.indexOf('=');
    if (index < 1) throw new Error(`Expected key=value, got "${pair}"`);
    updates[pair.slice(0, index)] = pair.slice(index + 1);
  }
  await oya.config.set(updates);
  console.log(`✅ updated ${Object.keys(updates).join(', ')}`);
}

async function cmdUsage(flags: Flags): Promise<void> {
  const usage = await client(flags).usage();
  console.log(JSON.stringify(usage, null, 2));
}

/**
 * The stealth harness lives with the server, because it needs a browser to
 * measure. This just runs it where it is.
 */
function cmdStealthTest(flags: Flags): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['test-stealth.js', ...(flags.live ? ['--live'] : [])], {
      cwd: process.env.OYA_SERVER_DIR || 'server',
      stdio: 'inherit',
    });
    child.on('error', () => reject(new Error(
      'Could not find the stealth harness. Run it from a checkout, or set OYA_SERVER_DIR.')));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`stealth test exited ${code}`))));
  });
}

// ── Entry ───────────────────────────────────────────────────────────────────

const { command, args, flags } = parse(process.argv.slice(2));

try {
  switch (command) {
    case 'login':        await cmdLogin(flags); break;
    case 'init':         await cmdInit(flags); break;
    case 'start':        await cmdStart(flags); break;
    case 'goto':         await cmdGoto(args, flags); break;
    case 'ask':          await cmdAsk(args, flags); break;
    case 'ls': case 'list': await cmdLs(flags); break;
    case 'rm': case 'stop': await cmdRm(args, flags); break;
    case 'personas':     await cmdPersonas(args, flags); break;
    case 'open':         await cmdOpen(flags); break;
    case 'config':       await cmdConfig(args, flags); break;
    case 'usage':        await cmdUsage(flags); break;
    case 'stealth-test': await cmdStealthTest(flags); break;
    case 'whoami':       console.log(JSON.stringify({ ...resolved(), apiKey: load().apiKey ? 'saved' : 'none' }, null, 2)); break;
    case 'help': case '--help': case '-h': console.log(HELP); break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exit(1);
  }
} catch (err) {
  const error = err as OyaError;
  console.error(`\n✗ ${error.message}`);
  if (error.status === 401) console.error('  The API key was rejected. Run `oya login`.');
  if (error.status === 429) console.error('  A quota or a persona concurrency cap. `oya personas` shows what is running.');
  process.exit(1);
}
