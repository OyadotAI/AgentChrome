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

function unconfigured() {
  return Object.assign(
    new Error('Daytona is not configured. Set DAYTONA_API_KEY, DAYTONA_SNAPSHOT and OYA_PUBLIC_WS_URL.'),
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
export async function createSandbox({ apiKey, name } = {}) {
  const config = settings();
  if (!config) throw unconfigured();
  if (!apiKey) throw Object.assign(new Error('An API key is required'), { status: 400 });

  const daytona = await client();
  const browserId = randomUUID();

  const sandbox = await daytona.create({
    name: PREFIX + browserId,
    snapshot: config.snapshot,
    labels: { 'oya-browser': 'true', 'oya-browser-id': browserId, 'oya-owner': ownerTag(apiKey) },
    envVars: {
      OYA_SERVER_URL: config.wsUrl,
      OYA_API_KEY: apiKey,
      OYA_BROWSER_ID: browserId,
      OYA_BROWSER_NAME: name || `Cloud browser ${browserId.slice(0, 8)}`,
      OYA_AUTO_CONNECT: 'true',
    },
    autoStopInterval: config.ttlMinutes,
    autoDeleteInterval: 0,
  }, { timeout: 90 });

  // Hard cap behind the idle stop, so a wedged sandbox still stops billing.
  await sandbox.setTtl(config.ttlMinutes + 10);

  // The snapshot's entrypoint just sleeps; this starts the browser.
  await sandbox.process.createSession(SESSION);
  await sandbox.process.executeSessionCommand(SESSION, {
    command: 'cd /app && /docker-entrypoint.sh',
    runAsync: true,
  });

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
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}
