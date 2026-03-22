/**
 * Proxy configuration — SOCKS5/HTTP/HTTPS proxy support for Electron sessions.
 */

/**
 * Apply proxy settings to an Electron session.
 * @param {Electron.Session} ses
 * @param {{ type: string, host: string, port: number, username?: string, password?: string }} proxyConfig
 */
async function configureProxy(ses, proxyConfig) {
  if (!proxyConfig || !proxyConfig.host) return;

  const type = proxyConfig.type || 'http';
  let proxyUrl;

  if (type === 'socks5' || type === 'socks') {
    // SOCKS5 automatically routes DNS through the proxy
    proxyUrl = `socks5://${proxyConfig.host}:${proxyConfig.port}`;
  } else {
    proxyUrl = `http://${proxyConfig.host}:${proxyConfig.port}`;
  }

  await ses.setProxy({
    proxyRules: proxyUrl,
    proxyBypassRules: '<-loopback>',
  });

  // Handle proxy authentication
  if (proxyConfig.username) {
    ses.on('login', (event, webContents, details, authInfo, callback) => {
      if (authInfo.isProxy) {
        event.preventDefault();
        callback(proxyConfig.username, proxyConfig.password || '');
      }
    });
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

module.exports = { configureProxy, applyDNSLeakPrevention };
