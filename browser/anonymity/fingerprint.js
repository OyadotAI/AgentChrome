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

  return {
    id,
    createdAt: new Date().toISOString(),
    navigator: {
      platform,
      hardwareConcurrency: pick(HARDWARE_CONCURRENCY, rng),
      deviceMemory: pick(DEVICE_MEMORY, rng),
      maxTouchPoints: 0,
      languages: ['en-US', 'en'],
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
    canvas: { noiseSeed: rng() * 0.01 },
    webgl: gpu,
    audio: { noiseSeed: rng() * 0.01 },
    rects: { noiseSeed: rng() * 0.001 },
    fonts: { available: fonts },
    timezone: options.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: options.locale || 'en-US',
    proxy: options.proxy || null,
  };
}

// ── Build injection script string with profile baked in ──

function buildFingerprintInjectScript(profile) {
  const p = JSON.stringify(profile);

  return `(function() {
  'use strict';
  const __fp = ${p};

  // ── Seeded PRNG for deterministic noise ──
  function __fpRNG(seed) {
    let s = Math.floor(seed * 2147483647);
    return function() {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

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
  const canvasRNG = __fpRNG(__fp.canvas.noiseSeed * 100000);

  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
    const ctx = this.getContext('2d');
    if (ctx && this.width > 0 && this.height > 0) {
      try {
        const imageData = ctx.getImageData(0, 0, Math.min(this.width, 16), Math.min(this.height, 16));
        for (let i = 0; i < imageData.data.length; i += 4) {
          imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + (canvasRNG() < 0.5 ? -1 : 1)));
        }
        ctx.putImageData(imageData, 0, 0);
      } catch {}
    }
    return origToDataURL.call(this, type, quality);
  };

  const origToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function(cb, type, quality) {
    const ctx = this.getContext('2d');
    if (ctx && this.width > 0 && this.height > 0) {
      try {
        const imageData = ctx.getImageData(0, 0, Math.min(this.width, 16), Math.min(this.height, 16));
        for (let i = 0; i < imageData.data.length; i += 4) {
          imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + (canvasRNG() < 0.5 ? -1 : 1)));
        }
        ctx.putImageData(imageData, 0, 0);
      } catch {}
    }
    return origToBlob.call(this, cb, type, quality);
  };

  // ── WebGL overrides ──
  function patchWebGL(proto) {
    const origGetParam = proto.getParameter;
    proto.getParameter = function(pname) {
      if (pname === 0x1F00) return __fp.webgl.vendor;     // VENDOR
      if (pname === 0x1F01) return __fp.webgl.renderer;   // RENDERER
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

    // Override getParameter for unmasked values
    const origGetParam2 = proto.getParameter;
    proto.getParameter = function(pname) {
      if (pname === 0x9245) return __fp.webgl.unmaskedVendor;
      if (pname === 0x9246) return __fp.webgl.unmaskedRenderer;
      if (pname === 0x1F00) return __fp.webgl.vendor;
      if (pname === 0x1F01) return __fp.webgl.renderer;
      return origGetParam2.call(this, pname);
    };
  }

  try { patchWebGL(WebGLRenderingContext.prototype); } catch {}
  try { patchWebGL(WebGL2RenderingContext.prototype); } catch {}

  // ── AudioContext fingerprint noise ──
  const audioRNG = __fpRNG(__fp.audio.noiseSeed * 100000);

  if (typeof OfflineAudioContext !== 'undefined') {
    const origStartRendering = OfflineAudioContext.prototype.startRendering;
    OfflineAudioContext.prototype.startRendering = function() {
      return origStartRendering.call(this).then(function(buffer) {
        try {
          const data = buffer.getChannelData(0);
          for (let i = 0; i < Math.min(data.length, 100); i++) {
            data[i] += (audioRNG() - 0.5) * 0.0001;
          }
        } catch {}
        return buffer;
      });
    };
  }

  // ── ClientRects noise (with bypass for analyzer.js) ──
  const rectsRNG = __fpRNG(__fp.rects.noiseSeed * 1000000);

  function addRectsNoise(rect) {
    if (window.__oyaInternalCall) return rect;
    const noise = () => (rectsRNG() - 0.5) * 0.1;
    return new DOMRect(
      rect.x + noise(),
      rect.y + noise(),
      rect.width + noise(),
      rect.height + noise()
    );
  }

  const origGetBCR = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function() {
    const rect = origGetBCR.call(this);
    return addRectsNoise(rect);
  };

  const origGetCR = Element.prototype.getClientRects;
  Element.prototype.getClientRects = function() {
    const rects = origGetCR.call(this);
    if (window.__oyaInternalCall) return rects;
    const result = [];
    for (let i = 0; i < rects.length; i++) {
      result.push(addRectsNoise(rects[i]));
    }
    result.item = function(i) { return result[i] || null; };
    Object.defineProperty(result, 'length', { value: rects.length });
    return result;
  };

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

})();`;
}

module.exports = { generateProfile, buildFingerprintInjectScript };
