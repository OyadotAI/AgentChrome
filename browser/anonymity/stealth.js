/**
 * Anti-detection stealth — builds a JS string injected before page code runs.
 *
 * The load-bearing piece is the Function.prototype.toString mask. Without it
 * every override below reports its own source ("() => val") where a real
 * browser reports "[native code]", which is the first thing any commercial
 * detector checks — so the mask has to be installed before anything else and
 * every patched function has to be registered with it.
 */

/**
 * The mask, and the helpers every patch must use. Emitted once at the top of
 * the combined injection so the fingerprint patches are covered too — they run
 * before stealth and were previously left unmasked.
 */
function buildMaskPreamble() {
  return `
  // ── Native toString mask ──
  // Registered functions report as native. The proxy registers itself, so
  // Function.prototype.toString.toString() is native too.
  const _origToString = Function.prototype.toString;
  const _native = new WeakMap();
  const _mark = (fn, name) => { try { _native.set(fn, name || fn.name || ''); } catch {} return fn; };

  const _toStringProxy = new Proxy(_origToString, {
    apply(target, thisArg, args) {
      if (_native.has(thisArg)) {
        return 'function ' + _native.get(thisArg) + '() { [native code] }';
      }
      return Reflect.apply(target, thisArg, args);
    },
  });
  _mark(_toStringProxy, 'toString');
  try { Function.prototype.toString = _toStringProxy; } catch {}

  /** defineProperty with a getter that reports as a native accessor. */
  const _defineGetter = (target, prop, value) => {
    const get = () => value;
    _mark(get, 'get ' + prop);
    try {
      Object.defineProperty(target, prop, { get, configurable: true, enumerable: true });
    } catch {}
  };

  /** Replace a method, keeping the original and reporting native. */
  const _patch = (target, name, make) => {
    try {
      const orig = target[name];
      if (typeof orig !== 'function') return null;
      const fn = make(orig);
      _mark(fn, name);
      target[name] = fn;
      return orig;
    } catch { return null; }
  };

  /**
   * Deterministic noise: a pure function of the seed and the inputs, so the
   * same query returns the same answer. An advancing RNG made
   * getBoundingClientRect() and toDataURL() differ between consecutive calls,
   * which no real browser does and which CreepJS tests directly.
   */
  const _noise = (seed, ...parts) => {
    let h = (seed >>> 0) || 1;
    for (const part of parts) {
      const str = String(part);
      for (let i = 0; i < str.length; i++) {
        h = (Math.imul(h, 31) + str.charCodeAt(i)) >>> 0;
      }
      h = (h ^ (h >>> 13)) >>> 0;
    }
    return ((h >>> 8) / 0x1000000) - 0.5;   // [-0.5, 0.5)
  };
`;
}

/** The stealth patches themselves. Assumes the mask preamble is in scope. */
function buildStealthBody() {
  return `
  // ── navigator.webdriver ──
  // On the PROTOTYPE, not the instance: an own property named 'webdriver' on
  // navigator never exists in real Chrome. And the value is false, not
  // undefined — undefined is itself the tell.
  _defineGetter(Navigator.prototype, 'webdriver', false);

  // ── Remove Electron globals ──
  // Tabs run with contextIsolation and sandbox, so these should already be
  // absent; harmless belt-and-braces for any surface that is not.
  try { delete window.process; } catch {}
  try { delete window.require; } catch {}
  try { delete window.module; } catch {}
  try { delete window.exports; } catch {}
  try { delete window.__dirname; } catch {}
  try { delete window.__filename; } catch {}

  // ── window.chrome ──
  // app/csi/loadTimes exist on a normal page in real Chrome. chrome.runtime
  // does NOT — it is only present on extension pages, so defining it is
  // positive evidence of automation rather than cover. Deliberately absent.
  if (!window.chrome) window.chrome = {};
  window.chrome.app = {
    isInstalled: false,
    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    getDetails: _mark(function getDetails() { return null; }, 'getDetails'),
    getIsInstalled: _mark(function getIsInstalled() { return false; }, 'getIsInstalled'),
    installState: _mark(function installState(cb) { if (cb) cb('not_installed'); }, 'installState'),
  };

  window.chrome.csi = _mark(function csi() {
    return { onloadT: Date.now(), startE: Date.now(), pageT: performance.now() };
  }, 'csi');

  window.chrome.loadTimes = _mark(function loadTimes() {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const origin = performance.timeOrigin / 1000;
    return {
      commitLoadTime: origin + (nav.responseStart || 0) / 1000,
      connectionInfo: 'h2',
      finishDocumentLoadTime: origin + (nav.domContentLoadedEventEnd || 0) / 1000,
      finishLoadTime: origin + (nav.loadEventEnd || 0) / 1000,
      firstPaintAfterLoadTime: 0,
      firstPaintTime: origin + (nav.responseEnd || 0) / 1000,
      navigationType: 'Other',
      npnNegotiatedProtocol: 'h2',
      requestTime: origin + (nav.startTime || 0) / 1000,
      startLoadTime: origin + (nav.startTime || 0) / 1000,
      wasAlternateProtocolAvailable: false,
      wasFetchedViaSpdy: true,
      wasNpnNegotiated: true,
    };
  }, 'loadTimes');

  // ── navigator.plugins / mimeTypes ──
  // Electron ships empty arrays. The values below match modern Chrome; the
  // types matter as much as the data — a plain object reports
  // "[object Object]" where a real one reports "[object PluginArray]".
  const _pluginSpecs = [
    { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
  ];

  const _mimeSpecs = [
    { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
    { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
  ];

  /**
   * Borrow the real interface prototype so instanceof and Symbol.toStringTag
   * are correct. If the interface is missing we leave the surface alone
   * rather than install something that reads as a lie.
   */
  const _asInterface = (obj, Ctor) => {
    if (typeof Ctor !== 'function' || !Ctor.prototype) return null;
    try { Object.setPrototypeOf(obj, Ctor.prototype); return obj; } catch { return null; }
  };

  const _buildArrayLike = (items, Ctor, namedKey) => {
    const arr = Object.create(null);
    const list = items.slice();
    list.forEach((item, i) => { arr[i] = item; });
    Object.defineProperty(arr, 'length', { value: list.length, enumerable: false });
    arr.item = _mark(function item(i) { return list[i] || null; }, 'item');
    arr.namedItem = _mark(function namedItem(n) {
      return list.find((x) => x[namedKey] === n) || null;
    }, 'namedItem');
    if (Ctor === window.PluginArray) {
      arr.refresh = _mark(function refresh() {}, 'refresh');
    }
    list.forEach((item) => { arr[item[namedKey]] = item; });
    return _asInterface(arr, Ctor) || arr;
  };

  if (typeof window.Plugin === 'function' && typeof window.PluginArray === 'function'
      && typeof window.MimeType === 'function' && typeof window.MimeTypeArray === 'function') {
    const mimes = _mimeSpecs.map((m) => _asInterface(Object.assign(Object.create(null), m), window.MimeType)
      || Object.assign({}, m));
    const plugins = _pluginSpecs.map((p) => {
      const plugin = Object.assign(Object.create(null), p, {
        length: mimes.length,
        item: _mark(function item(i) { return mimes[i] || null; }, 'item'),
        namedItem: _mark(function namedItem(t) { return mimes.find((m) => m.type === t) || null; }, 'namedItem'),
      });
      mimes.forEach((m, i) => { plugin[i] = m; });
      return _asInterface(plugin, window.Plugin) || plugin;
    });
    mimes.forEach((m) => { try { m.enabledPlugin = plugins[0]; } catch {} });

    _defineGetter(Navigator.prototype, 'plugins', _buildArrayLike(plugins, window.PluginArray, 'name'));
    _defineGetter(Navigator.prototype, 'mimeTypes', _buildArrayLike(mimes, window.MimeTypeArray, 'type'));
  }

  // ── navigator.permissions.query ──
  const _origQuery = navigator.permissions.query;
  const query = function query(params) {
    if (params && params.name === 'notifications') {
      return Promise.resolve({ state: Notification.permission, onchange: null });
    }
    return Reflect.apply(_origQuery, navigator.permissions, arguments);
  };
  _mark(query, 'query');
  try { navigator.permissions.query = query; } catch {}

  // ── outerWidth / outerHeight ──
  // A headless window can report 0, which no real window does.
  if (!window.outerWidth || !window.outerHeight) {
    _defineGetter(window, 'outerWidth', window.innerWidth);
    _defineGetter(window, 'outerHeight', window.innerHeight + 88);
  }

  // Error.prepareStackTrace is deliberately NOT patched. It is undefined on a
  // real page, so defining it is a stronger signal than the debugger frames it
  // was hiding.
`;
}

/** Stealth alone, for callers that do not need the fingerprint layer. */
function buildStealthScript() {
  return `(function() {\n'use strict';\n${buildMaskPreamble()}\n${buildStealthBody()}\n})();`;
}

module.exports = { buildStealthScript, buildMaskPreamble, buildStealthBody };
