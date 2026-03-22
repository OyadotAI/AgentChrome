/**
 * Telemetry removal — disable Google/Chromium phone-home behavior.
 * Must be called BEFORE app.whenReady().
 */

const BLOCKED_DOMAINS = [
  'clients1.google.com',
  'clients2.google.com',
  'clients3.google.com',
  'clients4.google.com',
  'clients5.google.com',
  'clients6.google.com',
  'sb-ssl.google.com',
  'safebrowsing.googleapis.com',
  'safebrowsing-cache.google.com',
  'update.googleapis.com',
  'optimizationguide-pa.googleapis.com',
  'content-autofill.googleapis.com',
  'chrome-devtools-frontend.appspot.com',
  'redirector.gvt1.com',
  'accounts.google.com/ListAccounts',
];

/**
 * Add Chromium command-line flags to disable telemetry.
 * Call before app.whenReady().
 */
function applyTelemetryFlags(app) {
  app.commandLine.appendSwitch('disable-features', [
    'MediaRouter',
    'SafeBrowsing',
    'AutofillServerCommunication',
    'NetworkTimeServiceQuerying',
    'SpareRendererForSitePerProcess',
    'OptimizationHints',
    'Translate',
  ].join(','));
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-client-side-phishing-detection');
  app.commandLine.appendSwitch('disable-default-apps');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-domain-reliability');
  app.commandLine.appendSwitch('disable-sync');
  app.commandLine.appendSwitch('metrics-recording-only');
  app.commandLine.appendSwitch('no-pings');
  app.commandLine.appendSwitch('disable-breakpad');
  app.commandLine.appendSwitch('disable-component-extensions-with-background-pages');
  app.commandLine.appendSwitch('disable-hang-monitor');
}

/**
 * Block known telemetry domains via webRequest.
 * Call after session is created.
 */
function applyDomainBlocking(ses) {
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    try {
      const url = new URL(details.url);
      const blocked = BLOCKED_DOMAINS.some(d =>
        url.hostname === d || url.hostname.endsWith('.' + d) || url.href.includes(d)
      );
      if (blocked) {
        callback({ cancel: true });
        return;
      }
    } catch {}
    callback({});
  });
}

module.exports = { applyTelemetryFlags, applyDomainBlocking };
