/**
 * Proxy configuration — SOCKS5/HTTP/HTTPS proxy support for Electron sessions.
 */

/**
 * Apply proxy settings to an Electron session.
 * @param {Electron.Session} ses
 * @param {{ type: string, host: string, port: number, username?: string, password?: string }} proxyConfig
 */
const authHandlers = new WeakMap();
/**
 * The server sends a proxy as { url, username, password }; older profiles and
 * governance send { host, port, type }. One shape from here on.
 */
function normalizeProxy(proxyConfig) {
  if (!proxyConfig?.url || proxyConfig.host) return proxyConfig;
  const u = new URL(proxyConfig.url);
  const type = u.protocol.replace(':', '');
  return { ...proxyConfig, type, host: u.hostname, port: Number(u.port) || (type === 'https' ? 443 : 80) };
}

/**
 * Bytes through the operator's residential proxy, which is billed per GB.
 * Chromium talks to a local pass-through that pipes to the vendor gateway, so
 * every byte either way is counted, TLS and headers included — the same thing
 * the vendor bills. Proxy auth passes through untouched.
 */
const net = require('net');
let meteredBytes = 0;
const meters = new Map();

function meter(host, port) {
  const key = `${host}:${port}`;
  if (!meters.has(key)) {
    meters.set(key, new Promise((resolve, reject) => {
      const server = net.createServer((client) => {
        const upstream = net.connect({ host, port });
        client.on('data', (d) => { meteredBytes += d.length; });
        upstream.on('data', (d) => { meteredBytes += d.length; });
        client.pipe(upstream).pipe(client);
        const end = () => { client.destroy(); upstream.destroy(); };
        client.on('error', end); upstream.on('error', end); client.on('close', end); upstream.on('close', end);
      });
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    }));
  }
  return meters.get(key);
}

/** Bytes counted since the last call. */
function takeProxyBytes() { const n = meteredBytes; meteredBytes = 0; return n; }

async function configureProxy(ses, proxyConfig) {
  proxyConfig = normalizeProxy(proxyConfig);
  if (proxyConfig?.metered && proxyConfig.host) {
    proxyConfig = { ...proxyConfig, type: 'http', host: '127.0.0.1', port: await meter(proxyConfig.host, proxyConfig.port) };
  }
  const { app } = require('electron');
  const previous = authHandlers.get(ses);
  if (previous) { app.removeListener('login', previous); authHandlers.delete(ses); }
  if (!proxyConfig || !proxyConfig.host) { await ses.setProxy({ mode: 'direct' }); return; }

  const type = proxyConfig.type || 'http';
  let proxyUrl;

  if (type === 'socks5' || type === 'socks') {
    // SOCKS5 automatically routes DNS through the proxy
    proxyUrl = `socks5://${proxyConfig.host}:${proxyConfig.port}`;
  } else {
    proxyUrl = `${type === 'https' ? 'https' : 'http'}://${proxyConfig.host}:${proxyConfig.port}`;
  }

  await ses.setProxy({
    proxyRules: proxyUrl,
    proxyBypassRules: '<-loopback>',
  });

  // Handle proxy authentication
  if (proxyConfig.username) {
    const handler = (event, webContents, details, authInfo, callback) => {
      if (webContents?.session === ses && authInfo.isProxy && authInfo.host === proxyConfig.host && Number(authInfo.port) === Number(proxyConfig.port)) {
        event.preventDefault();
        callback(proxyConfig.username, proxyConfig.password || '');
      }
    };
    authHandlers.set(ses, handler);
    app.on('login', handler);
  }
}

/**
 * Apply DNS leak prevention flags.
 * Must be called before app.whenReady().
 * @param {Electron.App} app
 */
function applyDNSLeakPrevention(app) {
  // Disable DoH to prevent DNS bypass
  app.commandLine.appendSwitch('disable-features', 'DnsOverHttps');
  // Disable async DNS resolver that might bypass proxy
  app.commandLine.appendSwitch('disable-async-dns');
}

module.exports = { configureProxy, normalizeProxy, meter, takeProxyBytes, applyDNSLeakPrevention };
