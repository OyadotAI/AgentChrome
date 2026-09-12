import { sealText, openText } from './secrets.js';
/**
 * Where a CDP browser comes from.
 *
 * Two kinds:
 *   'cdp'  — you already have a CDP WebSocket URL (plain Chrome, your own
 *            infra, a tunnel). Always correct, no vendor knowledge needed.
 *   hosted — ask a vendor's REST API for a session, then drive the CDP URL it
 *            returns.
 *
 * Hosted providers are described by config rather than code, so a vendor
 * changing its API can be handled with OYA_BROWSER_PROVIDERS overrides.
 * deleteUrl also accepts a URL template containing {id}; deleteMethod and
 * deleteBody describe the vendor's release operation.
 */

const PRESETS = {
  anchor: {
    createUrl: 'https://api.anchorbrowser.io/v1/sessions',
    headers: (key) => ({ 'anchor-api-key': key, 'Content-Type': 'application/json' }),
    body: () => ({}),
    wsPath: ['data.cdp_url', 'data.websocket_url', 'cdp_url'],
    idPath: ['data.id', 'id'],
    deleteUrl: (id) => `https://api.anchorbrowser.io/v1/sessions/${id}`,
  },
  // https://docs.browserbase.com/reference/api/update-a-session
  browserbase: {
    createUrl: 'https://api.browserbase.com/v1/sessions',
    headers: (key) => ({ 'x-bb-api-key': key, 'Content-Type': 'application/json' }),
    body: (env) => (env.BROWSERBASE_PROJECT_ID ? { projectId: env.BROWSERBASE_PROJECT_ID } : {}),
    wsPath: ['connectUrl', 'data.connectUrl'],
    idPath: ['id', 'data.id'],
    deleteUrl: (id) => `https://api.browserbase.com/v1/sessions/${id}`,
    deleteMethod: 'POST',
    deleteBody: { status: 'REQUEST_RELEASE' },
  },
  // https://docs.browser-use.com/cloud/api-v2/browsers/create-browser-session
  browseruse: {
    createUrl: 'https://api.browser-use.com/api/v2/browsers',
    headers: (key) => ({ 'X-Browser-Use-API-Key': key, 'Content-Type': 'application/json' }),
    body: () => ({}),
    wsPath: ['cdpUrl', 'data.cdpUrl', 'cdp_url'],
    idPath: ['id', 'data.id'],
    deleteUrl: (id) => `https://api.browser-use.com/api/v2/browsers/${id}`,
    deleteMethod: 'PATCH',
    deleteBody: { action: 'stop' },
  },
  // https://docs.steel.dev/overview/authentication
  // https://github.com/steel-dev/steel-node/blob/main/src/resources/sessions/sessions.ts
  steel: {
    createUrl: 'https://api.steel.dev/v1/sessions',
    headers: (key) => ({ 'steel-api-key': key, 'Content-Type': 'application/json' }),
    body: () => ({}),
    wsPath: ['websocketUrl', 'data.websocketUrl', 'connectUrl'],
    idPath: ['id', 'data.id'],
    deleteUrl: (id) => `https://api.steel.dev/v1/sessions/${id}/release`,
    deleteMethod: 'POST',
    wsQueryKey: 'apiKey',
  },
};

function dig(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function firstPath(obj, paths) {
  for (const p of paths) {
    const v = dig(obj, p);
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

/** Presets merged with any OYA_BROWSER_PROVIDERS override. */
function catalog(env = process.env) {
  let overrides = {};
  if (env.OYA_BROWSER_PROVIDERS) {
    try { overrides = JSON.parse(env.OYA_BROWSER_PROVIDERS); }
    catch (e) { console.error('[providers] OYA_BROWSER_PROVIDERS is not valid JSON:', e.message); }
  }
  const merged = {};
  for (const name of new Set([...Object.keys(PRESETS), ...Object.keys(overrides)])) {
    merged[name] = { ...(PRESETS[name] || {}), ...(overrides[name] || {}) };
  }
  return merged;
}

const keyFor = (name, env) => env[`${name.toUpperCase()}_API_KEY`] || '';

/** Providers this deployment can actually use right now. */
export function available(env = process.env) {
  const out = [{ name: 'cdp', kind: 'direct', configured: true, note: 'Bring your own CDP WebSocket URL' }];
  for (const [name, cfg] of Object.entries(catalog(env))) {
    out.push({
      name,
      kind: 'hosted',
      configured: !!keyFor(name, env) && !!cfg.createUrl,
      envVar: `${name.toUpperCase()}_API_KEY`,
    });
  }
  return out;
}

/**
 * Acquire a CDP endpoint.
 * @returns {{ wsUrl: string, provider: string, sessionId: string|null, release: () => Promise<void> }}
 */
export async function acquire({ provider = 'cdp', wsUrl, env = process.env, onCreated } = {}) {
  const fail = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }); };

  if (provider === 'cdp') {
    if (!wsUrl) fail('wsUrl is required for the cdp provider');
    let parsed;
    try { parsed = new URL(wsUrl); } catch { fail('wsUrl is not a valid URL'); }
    if (!['ws:', 'wss:'].includes(parsed.protocol)) fail('wsUrl must be ws:// or wss://');
    return { wsUrl, provider, sessionId: null, release: async () => {} };
  }

  const cfg = catalog(env)[provider];
  if (!cfg?.createUrl) fail(`Unknown browser provider: ${provider}`, 400);
  const key = keyFor(provider, env);
  if (!key) fail(`${provider} is not configured — set ${provider.toUpperCase()}_API_KEY`, 409);

  let res;
  try {
    res = await fetch(cfg.createUrl, {
      method: 'POST',
      headers: typeof cfg.headers === 'function' ? cfg.headers(key) : cfg.headers,
      body: JSON.stringify(typeof cfg.body === 'function' ? cfg.body(env) : (cfg.body || {})),
      signal: AbortSignal.timeout(30000),
      redirect: 'error',
    });
  } catch { fail(`${provider} session create request failed. Check the provider configuration and connection.`, 502); }
  const text = await res.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = {}; }
  // Vendor responses can echo connection URLs or credentials. Keep them out
  // of public errors and audit records.
  if (!res.ok) fail(`${provider} session create failed (${res.status}). Check its API key, quota, and account status.`, 502);
  const sessionId = firstPath(payload, cfg.idPath || []);
  let releasePromise;
  const release = () => {
    if (!sessionId || !cfg.deleteUrl) return Promise.resolve();
    if (!releasePromise) {
      releasePromise = (async () => {
        const id = encodeURIComponent(sessionId);
        const endpoint = typeof cfg.deleteUrl === 'function' ? cfg.deleteUrl(id) : cfg.deleteUrl.replace('{id}', id);
        let released;
        try {
          released = await fetch(endpoint, {
            method: cfg.deleteMethod || 'DELETE',
            headers: typeof cfg.headers === 'function' ? cfg.headers(key) : cfg.headers,
            ...(cfg.deleteBody ? { body: JSON.stringify(cfg.deleteBody) } : {}),
            signal: AbortSignal.timeout(15000),
            redirect: 'error',
          });
        } catch { fail(`${provider} session ${sessionId} release request failed`, 502); }
        if (!released.ok && released.status !== 404 && released.status !== 410) {
          fail(`${provider} session ${sessionId} release failed (${released.status})`, 502);
        }
      })().catch((err) => { releasePromise = null; throw err; });
    }
    return releasePromise;
  };
  const cleanup = sessionId && cfg.deleteUrl ? { kind: 'vendor', sealed: sealText('provider-cleanup', {
      url: typeof cfg.deleteUrl === 'function' ? cfg.deleteUrl(encodeURIComponent(sessionId)) : cfg.deleteUrl.replace('{id}', encodeURIComponent(sessionId)),
      method: cfg.deleteMethod || 'DELETE', headers: typeof cfg.headers === 'function' ? cfg.headers(key) : cfg.headers,
      ...(cfg.deleteBody ? { body: JSON.stringify(cfg.deleteBody) } : {}),
    }) } : null;
  try {
    if (cleanup && onCreated) await onCreated(cleanup);
    const raw = firstPath(payload, cfg.wsPath || []);
    let url;
    try { url = new URL(raw); } catch { /* handled below */ }
    if (!url || !['ws:', 'wss:'].includes(url.protocol)) {
      fail(`${provider} responded without a valid CDP URL. Check the provider configuration.`, 502);
    }
    if (cfg.wsQueryKey) url.searchParams.set(cfg.wsQueryKey, key);
    return { wsUrl: url.href, provider, sessionId, release, cleanup };
  } catch (err) {
    try { await release(); }
    catch (cleanup) { err.message += ` Cleanup also failed: ${cleanup.message}`; }
    throw err;
  }
}

export async function releasePersisted(cleanup) {
  const { url, ...options } = openText('provider-cleanup', cleanup.sealed);
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok && ![404, 410].includes(response.status)) throw new Error(`Provider release failed (${response.status})`);
}
