/**
 * Fingerprint profile generation and injection script builder.
 * Generates coherent per-profile fingerprints and builds a JS string
 * for injection via Page.addScriptToEvaluateOnNewDocument.
 */

const crypto = require('crypto');

// ── Realistic GPU databases by platform ──

const GPU_DB = {
  Win32: [
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', unmaskedVendor: 'NVIDIA Corporation', unmaskedRenderer: 'NVIDIA GeForce RTX 3060/PCIe/SSE2' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)', unmaskedVendor: 'NVIDIA Corporation', unmaskedRenderer: 'NVIDIA GeForce RTX 3070/PCIe/SSE2' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)', unmaskedVendor: 'NVIDIA Corporation', unmaskedRenderer: 'NVIDIA GeForce GTX 1660 SUPER/PCIe/SSE2' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', unmaskedVendor: 'ATI Technologies Inc.', unmaskedRenderer: 'AMD Radeon RX 6700 XT' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)', unmaskedVendor: 'Intel Inc.', unmaskedRenderer: 'Intel(R) UHD Graphics 630' },
  ],
  MacIntel: [
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M1, OpenGL 4.1)', unmaskedVendor: 'Apple', unmaskedRenderer: 'Apple M1' },
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)', unmaskedVendor: 'Apple', unmaskedRenderer: 'Apple M1 Pro' },
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)', unmaskedVendor: 'Apple', unmaskedRenderer: 'Apple M2' },
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M3, OpenGL 4.1)', unmaskedVendor: 'Apple', unmaskedRenderer: 'Apple M3' },
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M2 Pro, OpenGL 4.1)', unmaskedVendor: 'Apple', unmaskedRenderer: 'Apple M2 Pro' },
  ],
  'Linux x86_64': [
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080/PCIe/SSE2, OpenGL 4.5)', unmaskedVendor: 'NVIDIA Corporation', unmaskedRenderer: 'NVIDIA GeForce RTX 3080/PCIe/SSE2' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)', unmaskedVendor: 'Intel', unmaskedRenderer: 'Mesa Intel(R) UHD Graphics 630 (CFL GT2)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.6)', unmaskedVendor: 'ATI Technologies Inc.', unmaskedRenderer: 'AMD Radeon RX 580' },
  ],
};

const SCREEN_RESOLUTIONS = {
  Win32: [
    { width: 1920, height: 1080, dpr: 1 },
    { width: 2560, height: 1440, dpr: 1 },
    { width: 1366, height: 768, dpr: 1 },
    { width: 1680, height: 1050, dpr: 1 },
    { width: 3840, height: 2160, dpr: 1.5 },
  ],
  MacIntel: [
    { width: 1440, height: 900, dpr: 2 },
    { width: 1680, height: 1050, dpr: 2 },
    { width: 1920, height: 1080, dpr: 2 },
    { width: 2560, height: 1440, dpr: 2 },
    { width: 1280, height: 800, dpr: 2 },
  ],
  'Linux x86_64': [
    { width: 1920, height: 1080, dpr: 1 },
    { width: 2560, height: 1440, dpr: 1 },
    { width: 1366, height: 768, dpr: 1 },
  ],
};

const FONT_SETS = {
  Win32: ['Arial', 'Arial Black', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Impact', 'Lucida Console', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'],
  MacIntel: ['Arial', 'Arial Black', 'Courier New', 'Georgia', 'Helvetica', 'Helvetica Neue', 'Impact', 'Lucida Grande', 'Menlo', 'Monaco', 'SF Pro', 'Times New Roman', 'Trebuchet MS', 'Verdana'],
  'Linux x86_64': ['Arial', 'Courier New', 'DejaVu Sans', 'DejaVu Serif', 'FreeMono', 'FreeSans', 'FreeSerif', 'Liberation Mono', 'Liberation Sans', 'Liberation Serif', 'Noto Sans', 'Times New Roman', 'Ubuntu', 'Verdana'],
};

const HARDWARE_CONCURRENCY = [4, 6, 8, 12, 16];
const DEVICE_MEMORY = [4, 8, 16];

const TIMEZONES = {
  Win32: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Detroit', 'America/Indianapolis'],
  MacIntel: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'Pacific/Honolulu'],
  'Linux x86_64': ['America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'UTC'],
};

const LOCALES = {
  Win32: ['en-US', 'en-US', 'en-US', 'en-GB'],
  MacIntel: ['en-US', 'en-US', 'en-US', 'en-GB'],
  'Linux x86_64': ['en-US', 'en-US', 'en-GB', 'de-DE', 'ja-JP'],
};

// ── Simple seeded PRNG (LCG) ──

function createPRNG(seed) {
  let s = seed;
  return function() {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function seedFromString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

// ── Profile Generation ──

function generateProfile(options = {}) {
  const id = options.id || 'profile-' + crypto.randomBytes(6).toString('hex');
  // If a seed is provided (e.g. API key), use it for deterministic fingerprints
  // so all browsers with the same API key produce identical profiles.
  const seedStr = options.seed || id;
  const rng = createPRNG(seedFromString(seedStr));

  const platform = options.platform || pick(['Win32', 'MacIntel', 'Linux x86_64'], rng);
  const gpus = GPU_DB[platform] || GPU_DB.Win32;
  const gpu = pick(gpus, rng);
  const screens = SCREEN_RESOLUTIONS[platform] || SCREEN_RESOLUTIONS.Win32;
  const screen = pick(screens, rng);
  const fonts = FONT_SETS[platform] || FONT_SETS.Win32;
  const hardwareConcurrency = pick(HARDWARE_CONCURRENCY, rng);
  const deviceMemory = pick(DEVICE_MEMORY, rng);
  const canvasNoise = rng() * 0.01;
  const audioNoise = rng() * 0.01;
  const rectsNoise = rng() * 0.001;
  const timezone = options.timezone || pick(TIMEZONES[platform] || TIMEZONES.Win32, rng);
  const locale = options.locale || pick(LOCALES[platform] || LOCALES.Win32, rng);
  const lang = locale.split('-')[0];

  return {
    id,
    createdAt: new Date().toISOString(),
    navigator: {
      platform,
      hardwareConcurrency,
      deviceMemory,
      maxTouchPoints: 0,
      languages: [locale, lang],
      vendor: 'Google Inc.',
    },
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.width,
      availHeight: screen.height - 40,
      colorDepth: 24,
      pixelDepth: 24,
      devicePixelRatio: screen.dpr,
    },
    canvas: { noiseSeed: canvasNoise },
    webgl: gpu,
    audio: { noiseSeed: audioNoise },
    rects: { noiseSeed: rectsNoise },
    fonts: { available: fonts },
    timezone,
    locale,
    proxy: options.proxy || null,
  };
}

// ── Build injection script string with profile baked in ──

/** Fingerprint patches. Assumes the mask preamble (_mark, _noise, _patch) is in scope. */
function buildFingerprintBody(profile) {
  const p = JSON.stringify(profile);

  return `
  const __fp = ${p};

  // ── Navigator overrides ──
  const navProps = {
    platform: __fp.navigator.platform,
    hardwareConcurrency: __fp.navigator.hardwareConcurrency,
    deviceMemory: __fp.navigator.deviceMemory,
    maxTouchPoints: __fp.navigator.maxTouchPoints,
    languages: Object.freeze(__fp.navigator.languages),
    language: __fp.navigator.languages[0],
    vendor: __fp.navigator.vendor,
  };
  for (const [key, val] of Object.entries(navProps)) {
    try {
      Object.defineProperty(Navigator.prototype, key, {
        get: () => val,
        configurable: true,
        enumerable: true,
      });
    } catch {}
  }

  // ── Screen overrides ──
  const screenProps = __fp.screen;
  for (const [key, val] of Object.entries(screenProps)) {
    if (key === 'devicePixelRatio') continue;
    try {
      Object.defineProperty(Screen.prototype, key, {
        get: () => val,
        configurable: true,
        enumerable: true,
      });
    } catch {}
  }
  Object.defineProperty(window, 'devicePixelRatio', {
    get: () => screenProps.devicePixelRatio,
    configurable: true,
  });

  // ── Canvas fingerprint noise ──
  const __canvasSeed = Math.floor(__fp.canvas.noiseSeed * 100000);

  // Noise a COPY, never the source. The previous version wrote the noised
  // pixels back into the caller's canvas, so a second toDataURL() noised
  // already-noised data and returned something different — non-deterministic,
  // and it silently corrupted the page's own canvas.
  const _origGetImageData = CanvasRenderingContext2D.prototype.getImageData;

  const _noiseImageData = (img) => {
    for (let i = 0; i < img.data.length; i += 4) {
      const v = img.data[i];
      img.data[i] = Math.max(0, Math.min(255, v + (_noise(__canvasSeed, i, v) < 0 ? -1 : 1)));
    }
    return img;
  };

  const _noisyCopy = (source) => {
    const copy = document.createElement('canvas');
    copy.width = source.width;
    copy.height = source.height;
    const cctx = copy.getContext('2d');
    cctx.drawImage(source, 0, 0);
    const region = Math.min(source.width, 16);
    const img = _origGetImageData.call(cctx, 0, 0, region, Math.min(source.height, 16));
    cctx.putImageData(_noiseImageData(img), 0, 0);
    return copy;
  };

  _patch(HTMLCanvasElement.prototype, 'toDataURL', (orig) => function toDataURL(type, quality) {
    if (!this.width || !this.height) return orig.call(this, type, quality);
    try { return orig.call(_noisyCopy(this), type, quality); }
    catch { return orig.call(this, type, quality); }
  });

  _patch(HTMLCanvasElement.prototype, 'toBlob', (orig) => function toBlob(cb, type, quality) {
    if (!this.width || !this.height) return orig.call(this, cb, type, quality);
    try { return orig.call(_noisyCopy(this), cb, type, quality); }
    catch { return orig.call(this, cb, type, quality); }
  });

  // getImageData was left unpatched, so a detector could read the true pixels
  // and compare them against the noised toDataURL output.
  _patch(CanvasRenderingContext2D.prototype, 'getImageData', (orig) => function getImageData(x, y, w, h, settings) {
    return _noiseImageData(orig.call(this, x, y, w, h, settings));
  });

  // ── WebGL overrides ──
  function patchWebGL(proto) {
    const origGetParam = proto.getParameter;
    proto.getParameter = function(pname) {
      if (pname === 0x9245) return __fp.webgl.unmaskedVendor;   // UNMASKED_VENDOR_WEBGL
      if (pname === 0x9246) return __fp.webgl.unmaskedRenderer; // UNMASKED_RENDERER_WEBGL
      if (pname === 0x1F00) return __fp.webgl.vendor;           // VENDOR
      if (pname === 0x1F01) return __fp.webgl.renderer;         // RENDERER
      return origGetParam.call(this, pname);
    };

    const origGetExtension = proto.getExtension;
    proto.getExtension = function(name) {
      const ext = origGetExtension.call(this, name);
      if (name === 'WEBGL_debug_renderer_info' && ext) {
        return new Proxy(ext, {
          get(target, prop) {
            if (prop === 'UNMASKED_VENDOR_WEBGL') return 0x9245;
            if (prop === 'UNMASKED_RENDERER_WEBGL') return 0x9246;
            return target[prop];
          }
        });
      }
      return ext;
    };
  }

  try { patchWebGL(WebGLRenderingContext.prototype); } catch {}
  try { patchWebGL(WebGL2RenderingContext.prototype); } catch {}

  // ── AudioContext fingerprint noise ──
  const __audioSeed = Math.floor(__fp.audio.noiseSeed * 100000);

  if (typeof OfflineAudioContext !== 'undefined') {
    const origStartRendering = OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering = function() {
      return origStartRendering.call(this).then(function(buffer) {
        try {
          const data = buffer.getChannelData(0);
          for (let i = 0; i < Math.min(data.length, 100); i++) {
            data[i] += _noise(__audioSeed, i) * 0.0001;
          }
        } catch {}
        return buffer;
      });
    };
  }

  // ── ClientRects noise ──
  // Keyed by the rect's own geometry, so measuring the same element twice
  // gives the same answer — a real browser is deterministic here, and the
  // analyzer no longer needs a bypass because it runs in an isolated world.
  const __rectsSeed = Math.floor(__fp.rects.noiseSeed * 1000000);

  function addRectsNoise(rect) {
    const n = (k) => _noise(__rectsSeed, k, rect.x, rect.y, rect.width, rect.height) * 0.1;
    return new DOMRect(rect.x + n('x'), rect.y + n('y'), rect.width + n('w'), rect.height + n('h'));
  }

  _patch(Element.prototype, 'getBoundingClientRect', (orig) => function getBoundingClientRect() {
    return addRectsNoise(orig.call(this));
  });

  _patch(Element.prototype, 'getClientRects', (orig) => function getClientRects() {
    const rects = orig.call(this);
    const out = [];
    for (let i = 0; i < rects.length; i++) out.push(addRectsNoise(rects[i]));
    // A plain Array reports [object Array]; a real one reports [object DOMRectList].
    out.item = _mark(function item(i) { return out[i] || null; }, 'item');
    Object.defineProperty(out, 'length', { value: rects.length });
    if (typeof DOMRectList === 'function') {
      try { Object.setPrototypeOf(out, DOMRectList.prototype); } catch {}
    }
    return out;
  });

  // ── WebRTC leak prevention ──
  if (typeof RTCPeerConnection !== 'undefined') {
    const OrigRTC = RTCPeerConnection;
    window.RTCPeerConnection = function(config, constraints) {
      // Force empty ICE servers to prevent STUN-based IP leak
      if (config) {
        config.iceServers = [];
      } else {
        config = { iceServers: [] };
      }
      const pc = new OrigRTC(config, constraints);
      // Strip host/srflx candidates from SDP
      const origSetLocal = pc.setLocalDescription.bind(pc);
      pc.setLocalDescription = function(desc) {
        if (desc && desc.sdp) {
          desc.sdp = desc.sdp.replace(/a=candidate:.*typ (host|srflx).*\\r\\n/g, '');
        }
        return origSetLocal(desc);
      };
      return pc;
    };
    window.RTCPeerConnection.prototype = OrigRTC.prototype;
    Object.defineProperty(window, 'RTCPeerConnection', { writable: true, configurable: true });
    // Also patch webkitRTCPeerConnection if it exists
    if (typeof webkitRTCPeerConnection !== 'undefined') {
      window.webkitRTCPeerConnection = window.RTCPeerConnection;
    }
  }

  // ── Timezone override (JS-level backup, CDP Emulation is primary) ──
  try {
    const tz = __fp.timezone;
    const OrigDTF = Intl.DateTimeFormat;
    const origResolvedOptions = OrigDTF.prototype.resolvedOptions;
    OrigDTF.prototype.resolvedOptions = function() {
      const opts = origResolvedOptions.call(this);
      opts.timeZone = tz;
      return opts;
    };
  } catch {}
`;
}

/** Fingerprint alone, self-contained. */
function buildFingerprintInjectScript(profile) {
  const { buildMaskPreamble } = require('./stealth');
  return `(function() {\n'use strict';\n${buildMaskPreamble()}\n${buildFingerprintBody(profile)}\n})();`;
}

module.exports = { generateProfile, buildFingerprintInjectScript, buildFingerprintBody };
