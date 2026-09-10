/**
 * Daytona sandbox provisioning — launch cloud browsers on demand.
 *
 * A provisioned sandbox enrolls into the normal registry over the normal
 * WebSocket, using the same OYA_SERVER_URL / OYA_API_KEY / OYA_BROWSER_ID
 * contract browser/main.js already reads. Once connected it is an ordinary
 * browser: /browsers, /live/:id, /browsers/:id/command, /pool/* all work on it
 * with no special-casing anywhere.
 *
 * Sandboxes are named oya-browser-<browserId>, so the sandbox for a browser is
 * addressable without storing anything — a restart can still find and delete it.
 */

import { createHash, randomUUID } from 'crypto';

const PREFIX = 'oya-browser-';
const SESSION = 'oya-browser';

let sdkPromise;

/** Stable, non-reversible tag for the owning API key. Never label with the key itself. */
const ownerTag = (apiKey) => createHash('sha256').update(apiKey).digest('hex').slice(0, 32);

function settings(env = process.env) {
  if (!env.DAYTONA_API_KEY || !env.DAYTONA_SNAPSHOT || !env.OYA_PUBLIC_WS_URL) return null;
  return {
    apiKey: env.DAYTONA_API_KEY,
    snapshot: env.DAYTONA_SNAPSHOT,
    wsUrl: env.OYA_PUBLIC_WS_URL,
    apiUrl: env.DAYTONA_API_URL || null,
    target: env.DAYTONA_TARGET || 'us',
    // Abandoned sandboxes bill until something stops them. Tune per deployment.
    ttlMinutes: Math.max(5, Number(env.DAYTONA_SANDBOX_TTL_MINUTES) || 60),
  };
}

/** True when this deployment can provision cloud browsers. */
export function isConfigured(env = process.env) {
  return settings(env) !== null;
}

/**
 * Browser ids this process created sandboxes for. The browser's own claim
 * about its provider is a courtesy, not a source of truth: an older image
 * does not send one, and a client could say anything. Not persisted — after a
 * restart the Daytona lookup by name in removeSandbox is the authority.
 */
const provisioned = new Set();
export const isProvisioned = (browserId) => provisioned.has(browserId);

/** Name what is actually missing. Listing all three when two are set sends
 *  people to re-check settings that were never the problem. */
export function missingSettings(env = process.env) {
  return ['DAYTONA_API_KEY', 'DAYTONA_SNAPSHOT', 'OYA_PUBLIC_WS_URL'].filter((k) => !env[k]);
}

function unconfigured(env = process.env) {
  const missing = missingSettings(env);
  const hint = missing.includes('OYA_PUBLIC_WS_URL')
    // The sandbox dials back to this server, so localhost cannot work from a
    // cloud VM — this is the one people hit and cannot diagnose.
    ? ' OYA_PUBLIC_WS_URL must be reachable from the sandbox, so a localhost'
      + ' server needs a tunnel (ngrok, cloudflared) rather than ws://localhost.'
    : '';
  return Object.assign(
    new Error(`Cloud browsers need ${missing.join(', ')}, which ${missing.length > 1 ? 'are' : 'is'} not set.${hint}`),
    { status: 409 },
  );
}

async function client() {
  const config = settings();
  if (!config) throw unconfigured();
  // Lazy so the server runs without @daytona/sdk installed when provisioning
  // is not in use. Reset on failure so a later call can retry.
  sdkPromise ||= import('@daytona/sdk')
    .then(({ Daytona }) => new Daytona({
      apiKey: config.apiKey,
      ...(config.apiUrl ? { apiUrl: config.apiUrl } : {}),
      target: config.target,
    }))
    .catch((err) => {
      sdkPromise = undefined;
      throw Object.assign(
        new Error(`Daytona SDK unavailable: ${err.message}. Run \`npm i @daytona/sdk\` in server/.`),
        { status: 409 },
      );
    });
  return sdkPromise;
}

function isNotFound(err) {
  return err?.status === 404 || err?.statusCode === 404 || err?.response?.status === 404;
}

/**
 * Create one cloud browser. Resolves once the sandbox is starting — the browser
 * enrolls on its own and shows up in the registry within ~90s.
 */
export async function createSandbox({ apiKey, name, persona } = {}) {
  const config = settings();
  if (!config) throw unconfigured();
  if (!apiKey) throw Object.assign(new Error('An API key is required'), { status: 400 });

  const daytona = await client();
  const browserId = randomUUID();

  const sandbox = await daytona.create({
    name: PREFIX + browserId,
    snapshot: config.snapshot,
    labels: { 'oya-browser': 'true', 'oya-browser-id': browserId, 'oya-owner': ownerTag(apiKey),
      'oya-name': name || `Cloud browser ${browserId.slice(0, 8)}`, ...(persona ? { 'oya-persona': persona } : {}) },
    envVars: {
      OYA_SERVER_URL: config.wsUrl,
      OYA_API_KEY: apiKey,
      OYA_BROWSER_ID: browserId,
      OYA_BROWSER_NAME: name || `Cloud browser ${browserId.slice(0, 8)}`,
      OYA_AUTO_CONNECT: 'true',
      // Which identity it runs as: fingerprint, cookie jar and proxy together.
      ...(persona ? { OYA_PERSONA: persona } : {}),
      // So the control plane knows a Stop must destroy this sandbox.
      OYA_PROVIDER: 'oya-cloud',
    },
    autoStopInterval: config.ttlMinutes,
    autoDeleteInterval: 0,
  }, { timeout: 90 });

  // Hard cap behind the idle stop, so a wedged sandbox still stops billing.
  await sandbox.setTtl(config.ttlMinutes + 10);

  // Legacy snapshots sleep; current images run the browser as their entrypoint. Check it
  // exists first: fired async, a snapshot that is not the Oya browser image
  // fails invisibly and the caller waits out the full enrol window for a
  // browser that was never going to arrive.
  const probe = await sandbox.process.executeCommand('test -x /docker-entrypoint.sh && echo ok').catch(() => null);
  if (!/\bok\b/.test(probe?.result ?? probe?.output ?? '')) {
    await sandbox.delete().catch(() => {});
    throw Object.assign(new Error(
      `DAYTONA_SNAPSHOT "${config.snapshot}" has no /docker-entrypoint.sh, so it is not an Oya browser image. `
      + 'Build one from browser/Dockerfile, push it, and point DAYTONA_SNAPSHOT at that.'), { status: 409 });
  }

  const entrypoint = await sandbox.process.getEntrypointSession();
  const alreadyRunning = entrypoint.commands?.some(command =>
    command.command?.includes('/docker-entrypoint.sh') && command.exitCode == null);
  if (!alreadyRunning) {
    await sandbox.process.createSession(SESSION);
    await sandbox.process.executeSessionCommand(SESSION, {
      command: 'cd /app && /docker-entrypoint.sh', runAsync: true,
    });
  }

  inventory.delete(ownerTag(apiKey));
  provisioned.add(browserId);
  return { browserId, sandboxId: sandbox.id, sandboxName: PREFIX + browserId };
}

/**
 * Delete the sandbox backing a browser. Returns false if there wasn't one.
 *
 * Ownership is checked against the label, not against the live registry: a
 * sandbox outlives its websocket, and a browser id is not a secret, so a
 * disconnected sandbox must still only be deletable by the key that made it.
 */
export async function removeSandbox(browserId, apiKey) {
  if (!apiKey) throw Object.assign(new Error('An API key is required'), { status: 400 });
  const daytona = await client();
  try {
    const sandbox = await daytona.get(PREFIX + browserId);
    if (sandbox.labels?.['oya-browser-id'] !== browserId) {
      throw new Error('Sandbox ownership mismatch');
    }
    if (sandbox.labels?.['oya-owner'] !== ownerTag(apiKey)) {
      // Same shape as "no such sandbox" — don't confirm existence to a non-owner.
      return false;
    }
    await sandbox.delete(60, true);
    inventory.delete(ownerTag(apiKey));
    provisioned.delete(browserId);
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}


// Sandbox lifetime is independent of its WebSocket. Keep the inventory outside
// the command registry so disconnected clients remain visible but never routable.
const inventory = new Map();
export async function listSandboxBrowsers(apiKey, connected = []) {
  if (!isConfigured() || !apiKey) return connected;
  const owner = ownerTag(apiKey);
  let entry = inventory.get(owner);
  if (!entry) {
    if (inventory.size >= 500) inventory.delete(inventory.keys().next().value);
    entry = { rows: [], at: 0, pending: null };
    inventory.set(owner, entry);
  }
  if (Date.now() - entry.at > 5000 && !entry.pending) {
    entry.pending = (async () => {
      const daytona = await client();
      const rows = [];
      for await (const sandbox of daytona.list({ labels: { 'oya-browser': 'true', 'oya-owner': owner } })) {
        // Also verify locally: never trust an upstream filter for tenant isolation.
        const labels = sandbox.labels || {};
        const id = labels['oya-browser-id'];
        if (labels['oya-owner'] !== owner || labels['oya-browser'] !== 'true' || !id || ['deleted', 'destroyed'].includes(sandbox.state)) continue;
        rows.push({ id, name: labels['oya-name'] || `Cloud browser ${id.slice(0, 8)}`,
          clientType: 'oya', provider: 'oya-cloud', persona: labels['oya-persona'] || null,
          personaName: null, health: 'dead', currentUrl: '', connectedAt: null, lastSeen: null,
          commands: 0, errors: 0, pending: 0, lastCommandAt: null,
          lastError: `Browser disconnected · sandbox ${sandbox.state || 'available'}`,
          streaming: false, sandboxState: sandbox.state || 'unknown',
        });
      }
      entry.rows = rows;
    })().catch(err => {
      console.warn(`[sandbox] Inventory refresh failed: ${err.message}`);
    }).finally(() => { entry.at = Date.now(); entry.pending = null; });
  }
  if (entry.pending) {
    let timer;
    await Promise.race([entry.pending, new Promise(resolve => { timer = setTimeout(resolve, 3000); })]);
    clearTimeout(timer);
  }
  const rows = new Map(entry.rows.map(row => [row.id, row]));
  for (const row of connected) rows.set(row.id, rows.has(row.id) ? { ...row, provider: 'oya-cloud' } : row);
  return [...rows.values()];
}
