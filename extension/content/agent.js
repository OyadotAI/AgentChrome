/**
 * Core DOM agent — generic browser primitives.
 * Injected on all URLs. Listens for commands from the service worker,
 * dispatches to handlers, returns results.
 */

// ─── Helpers ───

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay(min = 200, max = 800) {
  return delay(min + Math.random() * (max - min));
}

/**
 * Shadow-piercing query: find element in light DOM or inside any open shadow root.
 */
function deepQuery(selector) {
  const el = document.querySelector(selector);
  if (el) return el;
  if (window.__acQueryShadow) return window.__acQueryShadow(selector);
  for (const host of document.querySelectorAll('*')) {
    if (host.shadowRoot) {
      const found = host.shadowRoot.querySelector(selector);
      if (found) return found;
    }
    if (host.tagName === 'IFRAME') {
      try {
        const iframeDoc = host.contentDocument;
        if (iframeDoc) {
          const found = iframeDoc.querySelector(selector);
          if (found) return found;
        }
      } catch {}
    }
  }
  return null;
}

/**
 * Find the main scroll container. SPAs like LinkedIn often use overflow on a div.
 * Returns the element to scroll, or null to use window.
 */
function getMainScroller() {
  const root = document.scrollingElement || document.documentElement;
  if (root.scrollHeight > root.clientHeight) return root;

  // LinkedIn: try known structure first (scaffold-layout__main, main#main)
  if (location.hostname.includes('linkedin.com')) {
    const main = document.querySelector('.scaffold-layout__main, main#main, main');
    if (main) {
      const scrollables = [];
      const scan = (el, d = 0) => {
        if (d > 15) return;
        if (el.scrollHeight > el.clientHeight && el.getBoundingClientRect().height > 200) {
          scrollables.push(el);
        }
        for (const c of el.children) scan(c, d + 1);
      };
      scan(main);
      if (scrollables.length > 0) {
        return scrollables.reduce((a, b) =>
          (a.scrollHeight - a.clientHeight) > (b.scrollHeight - b.clientHeight) ? a : b
        );
      }
    }
  }

  const candidates = [];
  const walk = (node, depth = 0) => {
    if (depth > 12) return;
    if (node.nodeType !== 1) return;
    const el = node;
    if (el.scrollHeight <= el.clientHeight) return;
    const rect = el.getBoundingClientRect();
    if (rect.height < 150) return;
    const style = window.getComputedStyle(el);
    if (style.overflow === 'clip') return;
    candidates.push({ el, inMain: !!el.closest('main, [role="main"]') });
    for (const child of el.children) walk(child, depth + 1);
  };
  walk(document.body);

  const inMain = candidates.filter((c) => c.inMain);
  const pool = inMain.length > 0 ? inMain : candidates;

  if (pool.length === 0) return null;
  const best = pool.reduce((a, b) =>
    (a.el.scrollHeight - a.el.clientHeight) > (b.el.scrollHeight - b.el.clientHeight) ? a : b
  );
  return best.el;
}


/**
 * Query an element (piercing shadow DOM), scrolling it into view if found.
 */
function queryAndScroll(selector) {
  const el = deepQuery(selector);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return el;
}

// ─── Action Handlers ───

const handlers = {
  async navigate({ url }) {
    window.location.href = url;
    await delay(500);
    return { ok: true, data: { url } };
  },

  async click({ selector }) {
    const el = queryAndScroll(selector);
    if (!el) return { ok: false, error: `Element not found: ${selector}` };

    await randomDelay();
    el.click();
    return { ok: true, data: { selector } };
  },

  async type({ selector, text }) {
    const el = queryAndScroll(selector);
    if (!el) return { ok: false, error: `Element not found: ${selector}` };

    await randomDelay(100, 300);
    el.focus();

    // Clear existing content
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (el.isContentEditable) {
      el.textContent = '';
    }

    // Type character by character
    for (const char of text) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.value += char;
      } else if (el.isContentEditable) {
        el.textContent += char;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
      await delay(30 + Math.random() * 70);
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, data: { selector, text } };
  },

  async read_page({ selector, limit }) {
    const root = selector ? document.querySelector(selector) : document.body;
    if (!root) return { ok: false, error: `Element not found: ${selector}` };

    const maxElements = limit || 50;
    const elements = [];
    const interactiveTags = new Set(['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT']);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let count = 0;
    let node;
    while ((node = walker.nextNode()) && count < maxElements) {
      const tag = node.tagName;
      const isInteractive = interactiveTags.has(tag) || node.getAttribute('role') === 'button' || node.onclick;
      const hasText = node.textContent?.trim().length > 0;

      if (!isInteractive && !hasText) continue;

      const cssSelector = buildSelector(node);

      const entry = {
        tag: tag.toLowerCase(),
        selector: cssSelector,
      };

      const text = getVisibleText(node);
      if (text) entry.text = text.slice(0, 200);

      if (node.id) entry.id = node.id;
      if (node.getAttribute('aria-label')) entry.aria_label = node.getAttribute('aria-label');
      if (node.getAttribute('placeholder')) entry.placeholder = node.getAttribute('placeholder');
      if (node.getAttribute('href')) entry.href = node.getAttribute('href');
      if (node.getAttribute('type')) entry.input_type = node.getAttribute('type');

      elements.push(entry);
      count++;
    }

    return {
      ok: true,
      data: {
        url: window.location.href,
        title: document.title,
        elements,
      },
    };
  },

  async screenshot() {
    return { ok: true, data: { needs_capture: true } };
  },

  async wait({ selector, timeout }) {
    const maxWait = timeout || 10000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      if (deepQuery(selector)) {
        return { ok: true, data: { selector, found: true } };
      }
      await delay(250);
    }
    return { ok: false, error: `Timeout: element not found after ${maxWait}ms: ${selector}` };
  },

  async scroll({ direction, amount }) {
    const px = amount || 500;
    const dy = direction === 'up' ? -px : px;

    // Remove analyze highlights before scroll — they can interfere with scroll
    // on SPAs like LinkedIn (overlays, modified DOM). User can re-analyze after.
    if (typeof window.__acCleanup === 'function') window.__acCleanup();

    // LinkedIn: scrollIntoView on feed posts — targets the actual scroll container
    if (location.hostname.includes('linkedin.com')) {
      const posts = document.querySelectorAll('[data-urn^="urn:li:activity"], .feed-shared-update-v2');
      if (posts.length > 0) {
        const target = dy > 0 ? posts[posts.length - 1] : posts[0];
        target.scrollIntoView({ block: dy > 0 ? 'end' : 'start', behavior: 'auto' });
        await delay(1800);
        return { ok: true, data: { direction, amount: px } };
      }
    }

    const scroller = getMainScroller();
    if (scroller) {
      scroller.scrollTop += dy;
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    } else {
      window.scrollBy({ top: dy, behavior: 'auto' });
    }

    await delay(1800);
    return { ok: true, data: { direction, amount: px } };
  },

  async press_key({ key }) {
    const target = document.activeElement || document.body;
    const opts = { key, bubbles: true, cancelable: true };
    // Handle special keys
    if (key === 'Enter') opts.keyCode = 13;
    else if (key === 'Escape') opts.keyCode = 27;
    else if (key === 'Tab') opts.keyCode = 9;
    else if (key === 'Backspace') opts.keyCode = 8;
    else if (key === 'ArrowDown') opts.keyCode = 40;
    else if (key === 'ArrowUp') opts.keyCode = 38;
    target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keypress', opts));
    target.dispatchEvent(new KeyboardEvent('keyup', opts));
    // For Enter on forms, also submit
    if (key === 'Enter' && target.form) {
      target.form.requestSubmit?.() || target.form.submit();
    }
    await delay(300);
    return { ok: true, data: { key } };
  },
};

// ─── Selector Builder ───

function buildSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    const tag = el.tagName.toLowerCase();
    return `${tag}[aria-label="${CSS.escape(ariaLabel)}"]`;
  }

  const testId = el.getAttribute('data-testid');
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`;

  const path = [];
  let current = el;
  while (current && current !== document.body) {
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) break;
    const siblings = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
    if (siblings.length > 1) {
      const idx = siblings.indexOf(current) + 1;
      path.unshift(`${tag}:nth-of-type(${idx})`);
    } else {
      path.unshift(tag);
    }
    current = parent;
  }
  return path.join(' > ');
}

// ─── Text Extraction ───

function getVisibleText(el) {
  const texts = [];
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = child.textContent?.trim();
      if (t) texts.push(t);
    }
  }
  if (texts.length > 0) return texts.join(' ');

  return el.innerText?.trim().slice(0, 200) || '';
}

// ─── Message Listener ───

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.source !== 'ac-service-worker') return false;

  // Ping — used by service worker to check if content script is alive
  if (msg.type === 'ping') {
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type !== 'exec') return false;

  const { action, params, cmdId } = msg;

  // Skip analyzer actions (handled by analyzer.js)
  if (action === 'analyze' || action === 'cleanup_highlights') {
    return false;
  }

  const handler = handlers[action];
  if (!handler) {
    chrome.runtime.sendMessage({
      source: 'ac-content',
      type: 'cmd_result',
      cmdId,
      ok: false,
      error: `Unknown action: ${action}`,
    });
    sendResponse({ _deferred: true, cmdId });
    return false;
  }

  handler(params || {})
    .then((result) => {
      chrome.runtime.sendMessage({
        source: 'ac-content',
        type: 'cmd_result',
        cmdId,
        ok: result?.ok ?? true,
        data: result?.data ?? null,
        error: result?.error ?? null,
      });
    })
    .catch((err) => {
      chrome.runtime.sendMessage({
        source: 'ac-content',
        type: 'cmd_result',
        cmdId,
        ok: false,
        error: err?.message || String(err),
      });
    });

  sendResponse({ _deferred: true, cmdId });
  return false;
});
