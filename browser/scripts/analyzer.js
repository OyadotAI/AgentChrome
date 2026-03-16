/**
 * Oya Browser Page Analyzer for Electron — same logic as the extension version,
 * but callable directly as analyzePage() without chrome.runtime messaging.
 */

(function () {
  'use strict';

  if (window.__acAnalyzerLoaded) return;
  window.__acAnalyzerLoaded = true;

  const MAX_MARKDOWN_CHARS = 80000;

  const COLORS = {
    link: '#22c55e', button: '#3b82f6', input: '#a855f7',
    select: '#f59e0b', textarea: '#06b6d4', editable: '#ec4899',
  };

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'LINK', 'META',
    'HEAD', 'IFRAME', 'OBJECT', 'EMBED', 'CANVAS', 'MAP', 'TEMPLATE',
  ]);

  const LANDMARK_TAGS = { HEADER: 'header', FOOTER: 'footer', NAV: 'nav', MAIN: 'main', ASIDE: 'aside', FORM: 'form', SECTION: 'section', ARTICLE: 'article' };

  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'combobox', 'tab', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'option', 'checkbox', 'radio',
    'switch', 'slider', 'spinbutton', 'searchbox', 'gridcell', 'treeitem',
  ]);

  const INTERACTIVE_CHILD_SELECTOR = [
    'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
    'summary', '[role="button"]', '[role="link"]', '[role="textbox"]',
    '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="tab"]',
    '[role="menuitem"]', '[role="combobox"]', '[role="option"]', '[role="treeitem"]',
    '[onclick]', '[ng-click]', '[data-action]', '[jsaction]',
    '[data-control-name]', '[data-click]',
  ].join(', ');

  let elementCounter = 0;
  let elementMap = [];
  const elementRefs = new Map(); // id → DOM node (survives React re-renders)

  window.analyzePage = function (options = {}) {
    cleanup();
    elementCounter = 0;
    elementMap = [];
    elementRefs.clear();

    // Resolve root — auto-detect open modal dialogs
    let root;
    let activeModal = null;

    if (options.selector) {
      root = document.querySelector(options.selector);
    } else {
      // Find visible modal dialogs — iterate backwards to find the topmost one
      const modals = document.querySelectorAll(
        '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], dialog[open]'
      );
      for (let i = modals.length - 1; i >= 0; i--) {
        const m = modals[i];
        const rect = m.getBoundingClientRect();
        // Must be visible: has size and is not display:none/visibility:hidden
        if (rect.width > 0 && rect.height > 0 && !isHardHidden(m)) {
          activeModal = m;
          break;
        }
      }
      root = activeModal || document.body;
    }

    if (!root) return { ok: false, error: `Root not found: ${options.selector}` };

    const vw = window.innerWidth, vh = window.innerHeight;
    const scrollX = window.scrollX, scrollY = window.scrollY;
    const pageH = document.documentElement.scrollHeight;
    const scrollPct = pageH > vh ? Math.round((scrollY / (pageH - vh)) * 100) : 0;

    let focusedId = null;
    const focused = document.activeElement;
    if (focused && focused !== document.body) {
      const aid = focused.getAttribute('data-ac-id');
      if (aid) focusedId = parseInt(aid, 10);
    }

    let md = nodeToMarkdown(root, 0).trim().replace(/\n{3,}/g, '\n\n');

    for (const el of elementMap) {
      const dom = queryShadow(el.selector);
      if (dom) {
        const rect = dom.getBoundingClientRect();
        el.visible = rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw && rect.width > 0 && rect.height > 0;
      } else {
        el.visible = false;
      }
    }

    if (!focusedId && focused && focused !== document.body) {
      const aid = focused.getAttribute('data-ac-id');
      if (aid) focusedId = parseInt(aid, 10);
    }

    let truncated = false;
    if (md.length > MAX_MARKDOWN_CHARS) { md = md.slice(0, MAX_MARKDOWN_CHARS); truncated = true; }

    const visibleCount = elementMap.filter(e => e.visible).length;
    const header = [
      `url: ${location.href}`, `title: ${document.title}`,
      `viewport: ${vw}x${vh}`, `scroll: ${scrollPct}% (${scrollY}px / ${pageH}px)`,
      `elements: ${elementMap.length} total, ${visibleCount} visible`,
    ];
    if (activeModal) {
      const modalLabel = activeModal.getAttribute('aria-label') || activeModal.getAttribute('aria-labelledby') || 'unnamed';
      header.push(`modal: "${modalLabel}" (analysis scoped to this dialog)`);
    }
    if (focusedId) header.push(`focused: [#${focusedId}]`);
    if (truncated) header.push(`truncated: true`);

    if (options.highlight !== false) addHighlights();

    return {
      ok: true,
      data: {
        url: location.href, title: document.title,
        viewport: { width: vw, height: vh },
        scroll: { x: scrollX, y: scrollY, percent: scrollPct, pageHeight: pageH },
        focusedElement: focusedId,
        modal: activeModal ? (activeModal.getAttribute('aria-label') || true) : null,
        truncated,
        markdown: `---\n${header.join('\n')}\n---\n\n${md}`,
        elements: elementMap,
      },
    };
  };

  // ─── DOM → Markdown ───

  function nodeToMarkdown(node, depth) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\s+/g, ' ').trim();
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName;
    if (SKIP_TAGS.has(tag)) return '';
    if (isHardHidden(node)) return '';
    if (node.id === 'ac-labels' || node.id === 'ac-highlight-style') return '';
    // Only skip aria-hidden elements if they're also visually hidden (zero size).
    // LinkedIn sets aria-hidden="true" on main content when messaging is open.
    if (node.getAttribute('aria-hidden') === 'true') {
      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return '';
    }

    const interType = getInteractiveType(node);
    if (interType) {
      // Dedup: skip wrappers that contain actual interactive children.
      const isLeaf = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      if (!isLeaf && hasInteractiveChild(node)) return childrenMarkdown(node, depth);
      return annotateInteractive(node, interType);
    }

    const children = childrenMarkdown(node, depth);
    const landmark = LANDMARK_TAGS[tag] || landmarkFromRole(node);
    if (landmark && children.trim()) {
      const label = node.getAttribute('aria-label');
      return `\n<!-- ${label ? landmark + ': ' + label : landmark} -->\n${children}\n<!-- /${landmark} -->\n`;
    }

    switch (tag) {
      case 'H1': return `\n# ${children.trim()}\n`;
      case 'H2': return `\n## ${children.trim()}\n`;
      case 'H3': return `\n### ${children.trim()}\n`;
      case 'H4': return `\n#### ${children.trim()}\n`;
      case 'H5': return `\n##### ${children.trim()}\n`;
      case 'H6': return `\n###### ${children.trim()}\n`;
      case 'P': return `\n${children.trim()}\n`;
      case 'UL': case 'OL': return '\n' + listMarkdown(node, tag === 'OL', depth) + '\n';
      case 'LI': { const i = children.trim(); return i ? `- ${i}\n` : ''; }
      case 'TABLE': return '\n' + tableMarkdown(node) + '\n';
      case 'IMG': {
        const alt = node.getAttribute('alt'), src = node.getAttribute('src') || '';
        return alt ? `![${alt}](${src})` : '[image]';
      }
      case 'BLOCKQUOTE': { const i = children.trim(); return i ? `\n> ${i.replace(/\n/g, '\n> ')}\n` : ''; }
      case 'PRE': { const i = node.textContent.trim(); return i ? `\n\`\`\`\n${i}\n\`\`\`\n` : ''; }
      case 'CODE': return node.parentElement?.tagName === 'PRE' ? node.textContent : `\`${node.textContent.trim()}\``;
      case 'STRONG': case 'B': return `**${children.trim()}**`;
      case 'EM': case 'I': return `*${children.trim()}*`;
      case 'HR': return '\n---\n';
      case 'BR': return '\n';
      case 'LABEL': { const i = children.trim(); return i ? `${i}: ` : ''; }
      case 'DETAILS': {
        const summary = node.querySelector('summary');
        const isOpen = node.hasAttribute('open');
        let summaryAnnotation = '';
        if (summary) summaryAnnotation = annotateInteractive(summary, 'button');
        if (!isOpen) return `\n${summaryAnnotation} (collapsed)\n`;
        return `\n${summaryAnnotation}\n${children.trim()}\n`;
      }
      case 'SUMMARY': return ''; // handled by DETAILS
      case 'SLOT': {
        const assigned = node.assignedNodes ? node.assignedNodes({ flatten: true }) : [];
        return assigned.map(c => nodeToMarkdown(c, depth)).join('');
      }
      default: return children;
    }
  }

  function childrenMarkdown(node, depth) {
    let r = '';
    for (const c of (node.shadowRoot || node).childNodes) r += nodeToMarkdown(c, depth);
    return r;
  }

  function listMarkdown(el, ordered, depth) {
    const items = []; let idx = 1;
    for (const c of el.children) {
      if (c.tagName !== 'LI') continue;
      const i = childrenMarkdown(c, depth + 1).trim();
      if (i) { items.push(`${'  '.repeat(depth)}${ordered ? idx + '. ' : '- '}${i}`); idx++; }
    }
    return items.join('\n');
  }

  function tableMarkdown(el) {
    const rows = [];
    for (const tr of el.querySelectorAll('tr')) {
      const cells = [];
      for (const td of tr.querySelectorAll('th, td')) cells.push(td.textContent.replace(/\s+/g, ' ').trim());
      if (cells.length) rows.push(cells);
    }
    if (!rows.length) return '';
    const cols = Math.max(...rows.map(r => r.length));
    const lines = [];
    rows.forEach((row, i) => {
      const p = row.concat(Array(cols - row.length).fill(''));
      lines.push('| ' + p.join(' | ') + ' |');
      if (i === 0) lines.push('| ' + p.map(() => '---').join(' | ') + ' |');
    });
    return lines.join('\n');
  }

  // ─── Interactive Element Detection ───

  function hasClickHandler(node) {
    if (node.hasAttribute('onclick')) return true;
    if (node.hasAttribute('onmousedown')) return true;
    if (node.hasAttribute('ng-click')) return true;
    if (node.hasAttribute('data-action')) return true;
    if (node.hasAttribute('jsaction')) return true;
    if (node.hasAttribute('data-control-name')) return true;
    if (node.hasAttribute('data-click')) return true;
    return false;
  }

  function getInteractiveType(node) {
    const tag = node.tagName;

    // Native HTML interactive tags
    if (tag === 'A') return 'link';
    if (tag === 'BUTTON') return 'button';
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA') return 'textarea';

    if (tag === 'INPUT') {
      const t = (node.type || 'text').toLowerCase();
      if (t === 'hidden') return null;
      if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      return 'input';
    }

    // Contenteditable — check before ARIA roles so rich-text editors
    // (e.g. LinkedIn post editor: div[role="textbox"][contenteditable])
    // are typed as 'editable' instead of 'input'.
    // Only match the element with the attribute, NOT inherited children.
    if (node.getAttribute('contenteditable') === 'true') {
      return 'editable';
    }

    // ARIA roles
    const role = node.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) {
      if (role === 'link') return 'link';
      if (role === 'textbox' || role === 'searchbox') return 'input';
      if (role === 'combobox' || role === 'listbox') return 'select';
      if (role === 'checkbox' || role === 'switch') return 'checkbox';
      if (role === 'radio') return 'radio';
      return 'button';
    }

    // Explicit click handler attributes
    if (hasClickHandler(node)) return 'button';

    // Tabindex: only interactive if also has cursor:pointer
    const tabindex = node.getAttribute('tabindex');
    if (tabindex !== null && tabindex !== '-1') {
      try { if (window.getComputedStyle(node).cursor === 'pointer') return 'button'; } catch {}
    }

    // cursor:pointer fallback — tighter constraints
    try {
      if (window.getComputedStyle(node).cursor === 'pointer' && node.textContent?.trim()) {
        const r = node.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.width < 400 && r.height < 120) return 'button';
      }
    } catch {}

    return null;
  }

  function hasInteractiveChild(node) {
    for (const c of node.querySelectorAll(INTERACTIVE_CHILD_SELECTOR))
      if (!isHardHidden(c)) return true;
    return false;
  }

  // ─── Annotate interactive element ───

  function annotateInteractive(node, type) {
    elementCounter++;
    const id = elementCounter;
    node.setAttribute('data-ac-id', String(id));
    elementRefs.set(id, node); // keep live reference for click/type
    const text = getLabel(node, type);
    const entry = { id, type, tag: node.tagName.toLowerCase(), selector: `[data-ac-id="${id}"]`, text };
    if (node.href) entry.href = node.href;
    if (node.value !== undefined && node.value !== '') entry.value = node.value;
    if (node.placeholder) entry.placeholder = node.placeholder;
    if (node.disabled) entry.disabled = true;
    if (node.checked !== undefined) entry.checked = node.checked;
    if (node.id) entry.domId = node.id;
    elementMap.push(entry);

    const label = text || node.tagName.toLowerCase();
    switch (type) {
      case 'link': {
        let h = '';
        try { const u = new URL(node.href || '', location.origin); h = u.hostname === location.hostname ? u.pathname : u.hostname + u.pathname; } catch {}
        return ` [#${id} link "${label}"${h ? ' → ' + h.slice(0, 50) : ''}] `;
      }
      case 'button': return ` [#${id} button "${label}"${node.disabled ? ' disabled' : ''}] `;
      case 'checkbox': return ` [#${id} ${node.checked ? '☑' : '☐'} "${label}"] `;
      case 'radio': return ` [#${id} ${node.checked ? '◉' : '○'} "${label}"] `;
      case 'input': {
        const t = (node.type || 'text').toLowerCase();
        const d = node.value ? `value="${node.value}"` : node.placeholder ? `placeholder="${node.placeholder}"` : t;
        return ` [#${id} input:${t} ${d}] `;
      }
      case 'textarea': {
        const d = node.value ? `"${node.value.slice(0, 50)}"` : node.placeholder ? `placeholder="${node.placeholder}"` : '';
        return ` [#${id} textarea ${d}] `;
      }
      case 'select': {
        const s = node.options?.[node.selectedIndex];
        return ` [#${id} select "${s ? s.text : ''}" (${node.options?.length || 0} options)] `;
      }
      case 'editable': {
        const val = node.innerText?.replace(/\s+/g, ' ').trim() || '';
        const preview = val.length > 200 ? val.slice(0, 197) + '...' : val;
        return ` [#${id} editable "${preview}"] `;
      }
      default: return ` [#${id} ${type} "${label}"] `;
    }
  }

  function getLabel(node, type) {
    const aria = node.getAttribute('aria-label');
    if (aria) return aria.trim().slice(0, 80);
    if (node.id && ['input', 'checkbox', 'radio', 'select', 'textarea'].includes(type)) {
      const l = document.querySelector(`label[for="${CSS.escape(node.id)}"]`);
      if (l?.textContent?.trim()) return l.textContent.trim().slice(0, 80);
    }
    const direct = [];
    for (const c of node.childNodes) if (c.nodeType === Node.TEXT_NODE && c.textContent.trim()) direct.push(c.textContent.trim());
    if (direct.length) return direct.join(' ').slice(0, 80);
    const t = node.innerText?.replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, 80);
    return node.getAttribute('title')?.trim()?.slice(0, 80) || node.placeholder?.slice(0, 80) || node.name || '';
  }

  function landmarkFromRole(node) {
    const r = node.getAttribute('role');
    return r ? ({ banner: 'header', navigation: 'nav', main: 'main', complementary: 'aside', contentinfo: 'footer', form: 'form', region: 'section', search: 'search' })[r] || null : null;
  }

  function isHardHidden(node) {
    try { const s = window.getComputedStyle(node); return s.display === 'none' || s.visibility === 'hidden'; } catch { return false; }
  }

  function queryShadow(selector, root = document) {
    const el = root.querySelector(selector);
    if (el) return el;
    for (const h of root.querySelectorAll('*'))
      if (h.shadowRoot) { const f = queryShadow(selector, h.shadowRoot); if (f) return f; }
    return null;
  }

  window.__acQueryShadow = queryShadow;

  // Robust element lookup: stored ref → data-ac-id → shadow DOM query
  window.__acFindElement = function (selector) {
    // Try stored reference first (survives React re-renders)
    const match = selector.match(/data-ac-id="(\d+)"/);
    if (match) {
      const id = parseInt(match[1], 10);
      const ref = elementRefs.get(id);
      if (ref && ref.isConnected) return ref;
    }
    // Fall back to DOM query (pierces shadow DOM)
    return queryShadow(selector);
  };

  // ─── Highlight Overlays ───

  const HIGHLIGHT_CSS = `[data-ac-id]{outline:2px solid var(--ac-hl-color,#3b82f6)!important;outline-offset:1px!important}`;
  const LABEL_CSS = `.ac-label{position:absolute;font-family:ui-monospace,monospace;font-size:11px;font-weight:700;line-height:16px;padding:0 5px;border-radius:4px;color:#fff;z-index:2147483646;pointer-events:none;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.5)}`;

  function addHighlights() {
    let style = document.getElementById('ac-highlight-style');
    if (!style) { style = document.createElement('style'); style.id = 'ac-highlight-style'; style.textContent = HIGHLIGHT_CSS + LABEL_CSS; document.head.appendChild(style); }
    let c = document.getElementById('ac-labels');
    if (c) c.remove();
    c = document.createElement('div');
    c.id = 'ac-labels';
    c.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483646;pointer-events:none';
    document.body.appendChild(c);
    const sx = window.scrollX, sy = window.scrollY;
    for (const el of elementMap) {
      const dom = queryShadow(el.selector);
      if (!dom) continue;
      const color = COLORS[el.type] || COLORS.button;
      dom.style.setProperty('--ac-hl-color', color);
      const rect = dom.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      const lbl = document.createElement('div');
      lbl.className = 'ac-label';
      lbl.style.background = color;
      lbl.style.left = `${rect.left + sx - 2}px`;
      lbl.style.top = `${rect.top + sy - 18}px`;
      lbl.textContent = `${el.id} ${el.type}`;
      c.appendChild(lbl);
    }
  }

  // ─── Cleanup ───

  function cleanup() {
    const c = document.getElementById('ac-labels'); if (c) c.remove();
    const s = document.getElementById('ac-highlight-style'); if (s) s.remove();
    document.querySelectorAll('[data-ac-id]').forEach(el => { el.removeAttribute('data-ac-id'); el.style.removeProperty('--ac-hl-color'); });
  }

  window.__acCleanup = cleanup;

  // ─── Live DOM Observer ───
  // Auto-tags new interactive elements as they're added (React re-renders,
  // infinite scroll, dropdowns, modals, etc.) without needing a full re-analyze.

  let observerTimer = null;
  const pendingNodes = new Set();

  function processNewNodes() {
    observerTimer = null;
    if (!elementMap.length) return; // no analysis has run yet

    const labelContainer = document.getElementById('ac-labels');
    const sx = window.scrollX, sy = window.scrollY;
    const vw = window.innerWidth, vh = window.innerHeight;

    for (const node of pendingNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (!node.isConnected) continue;
      if (node.id === 'ac-labels' || node.id === 'ac-highlight-style') continue;

      // Walk the new subtree for interactive elements
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
      let el = node;
      while (el) {
        if (!el.hasAttribute('data-ac-id') && !SKIP_TAGS.has(el.tagName) && !isHardHidden(el)) {
          const type = getInteractiveType(el);
          if (type) {
            const isLeaf = el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA';
            if (isLeaf || !hasInteractiveChild(el)) {
              elementCounter++;
              const id = elementCounter;
              el.setAttribute('data-ac-id', String(id));
              elementRefs.set(id, el);
              const text = getLabel(el, type);
              const entry = { id, type, tag: el.tagName.toLowerCase(), selector: `[data-ac-id="${id}"]`, text };
              if (el.href) entry.href = el.href;
              if (el.disabled) entry.disabled = true;
              if (el.id) entry.domId = el.id;
              const rect = el.getBoundingClientRect();
              entry.visible = rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw && rect.width > 0 && rect.height > 0;
              elementMap.push(entry);

              // Add highlight label
              if (labelContainer) {
                const color = COLORS[type] || COLORS.button;
                el.style.setProperty('--ac-hl-color', color);
                if (rect.width > 0 && rect.height > 0) {
                  const lbl = document.createElement('div');
                  lbl.className = 'ac-label';
                  lbl.style.background = color;
                  lbl.style.left = `${rect.left + sx - 2}px`;
                  lbl.style.top = `${rect.top + sy - 18}px`;
                  lbl.textContent = `${id} ${type}`;
                  labelContainer.appendChild(lbl);
                }
              }
            }
          }
        }
        el = walker.nextNode();
      }
    }
    pendingNodes.clear();
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) pendingNodes.add(node);
      }
    }
    if (pendingNodes.size > 0 && !observerTimer) {
      observerTimer = setTimeout(processNewNodes, 200);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
