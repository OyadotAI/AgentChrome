/**
 * Anti-detection stealth — builds a JS string injected before page code runs.
 * Removes Electron markers, fixes window.chrome, plugins, permissions.
 */

function buildStealthScript() {
  return `(function() {
  'use strict';

  // ── navigator.webdriver → undefined ──
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });

  // ── Remove Electron globals ──
  try { delete window.process; } catch {}
  try { delete window.require; } catch {}
  try { delete window.module; } catch {}
  try { delete window.exports; } catch {}
  try { delete window.__dirname; } catch {}
  try { delete window.__filename; } catch {}

  // ── Fix window.chrome to match real Chrome ──
  if (!window.chrome) window.chrome = {};
  window.chrome.app = {
    isInstalled: false,
    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    getDetails: function() { return null; },
    getIsInstalled: function() { return false; },
    installState: function(cb) { if (cb) cb('not_installed'); },
  };

  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
      RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
      connect: function() { return { onDisconnect: { addListener: function() {} }, onMessage: { addListener: function() {} }, postMessage: function() {} }; },
      sendMessage: function() {},
    };
  }

  window.chrome.csi = function() { return { onloadT: Date.now(), startE: Date.now(), pageT: Math.random() * 500 + 100 }; };
  window.chrome.loadTimes = function() {
    return {
      commitLoadTime: Date.now() / 1000,
      connectionInfo: 'h2',
      finishDocumentLoadTime: Date.now() / 1000,
      finishLoadTime: Date.now() / 1000,
      firstPaintAfterLoadTime: 0,
      firstPaintTime: Date.now() / 1000,
      navigationType: 'Other',
      npnNegotiatedProtocol: 'h2',
      requestTime: Date.now() / 1000 - Math.random() * 0.5,
      startLoadTime: Date.now() / 1000 - Math.random() * 0.5,
      wasAlternateProtocolAvailable: false,
      wasFetchedViaSpdy: true,
      wasNpnNegotiated: true,
    };
  };

  // ── Populate navigator.plugins (Electron has empty arrays) ──
  const pluginData = [
    { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', mimeType: 'application/pdf' },
    { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: '', mimeType: 'application/pdf' },
    { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: '', mimeType: 'application/pdf' },
    { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: '', mimeType: 'application/pdf' },
    { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: '', mimeType: 'application/pdf' },
  ];

  const fakePlugins = {
    length: pluginData.length,
    item: function(i) { return this[i] || null; },
    namedItem: function(name) { return pluginData.find(p => p.name === name) || null; },
    refresh: function() {},
  };
  pluginData.forEach((p, i) => { fakePlugins[i] = p; });

  Object.defineProperty(navigator, 'plugins', {
    get: () => fakePlugins,
    configurable: true,
  });

  const fakeMimeTypes = {
    length: 1,
    item: function(i) { return i === 0 ? { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: pluginData[0] } : null; },
    namedItem: function(name) { return name === 'application/pdf' ? this.item(0) : null; },
  };
  fakeMimeTypes[0] = fakeMimeTypes.item(0);

  Object.defineProperty(navigator, 'mimeTypes', {
    get: () => fakeMimeTypes,
    configurable: true,
  });

  // ── Fix navigator.permissions.query ──
  const origQuery = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = function(params) {
    if (params.name === 'notifications') {
      return Promise.resolve({ state: Notification.permission, onchange: null });
    }
    return origQuery(params);
  };

  // ── Ensure outerWidth/outerHeight have realistic chrome gap ──
  Object.defineProperty(window, 'outerWidth', {
    get: () => window.innerWidth + 16,
    configurable: true,
  });
  Object.defineProperty(window, 'outerHeight', {
    get: () => window.innerHeight + 88,
    configurable: true,
  });

  // ── Patch Error.stack to remove debugger frames ──
  const origPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = function(error, stack) {
    const filtered = stack.filter(frame => {
      const fn = frame.getFileName() || '';
      return !fn.includes('debugger') && !fn.includes('inspector');
    });
    if (origPrepareStackTrace) return origPrepareStackTrace(error, filtered);
    return error.toString() + '\\n' + filtered.map(f => '    at ' + f.toString()).join('\\n');
  };

})();`;
}

module.exports = { buildStealthScript };
