/**
 * Page Analyzer — converts the visible page to structured, AI-friendly markdown.
 *
 * Improvements over v1:
 *   - Viewport awareness: marks which elements are visible without scrolling
 *   - Page context header: viewport size, scroll position, focused element
 *   - Landmark regions: groups content by page regions (header/nav/main/aside/footer/form)
 *   - Better element dedup: nested interactive elements → only the innermost counts
 *   - Cleaner annotations: `[#id type "label"]` format instead of mixed bold markers
 *   - Form state: includes checked/disabled/required/selected state
 *   - Truncation: caps output at ~80KB to avoid choking MCP transport
 */

(function () {
  'use strict';

  // ─── Config ───

  const MAX_MARKDOWN_CHARS = 80000;

  const COLORS = {
    link:     '#22c55e',
    button:   '#3b82f6',
    input:    '#a855f7',
    select:   '#f59e0b',
    textarea: '#06b6d4',
    editable: '#ec4899',
  };

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'LINK', 'META',
    'HEAD', 'OBJECT', 'EMBED', 'CANVAS', 'MAP', 'TEMPLATE',
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

  // ─── Main entry ───

  function analyzePage(options = {}) {
    cleanup();
    elementCounter = 0;
    elementMap = [];

    const rootSel = options.selector;
    let root;
    let activeModal = null;

    if (rootSel) {
      root = document.querySelector(rootSel);
    } else {
      // Auto-detect open modal dialogs and focus analysis on the topmost visible one.
      const modals = document.querySelectorAll(
        '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], dialog[open]'
      );
      for (let i = modals.length - 1; i >= 0; i--) {
        const m = modals[i];
        const rect = m.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && !isHardHidden(m)) {
          activeModal = m;
          break;
        }
      }
      root = activeModal || document.body;
    }

    if (!root) {
      return { ok: false, error: `Root element not found: ${rootSel}` };
    }

    // Gather viewport info
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const pageH = document.documentElement.scrollHeight;
    const pageW = document.documentElement.scrollWidth;
    const scrollPct = pageH > vh ? Math.round((scrollY / (pageH - vh)) * 100) : 0;

    // Detect focused element
    let focusedId = null;
    const focused = document.activeElement;
    if (focused && focused !== document.body && focused.tagName !== 'BODY') {
      const existing = focused.getAttribute('data-ac-id');
      if (existing) focusedId = parseInt(existing, 10);
    }

    // Walk DOM
    let md = nodeToMarkdown(root, 0).trim();
    md = md.replace(/\n{3,}/g, '\n\n');

    // Mark viewport visibility on each element
    for (const el of elementMap) {
      const dom = queryShadow(el.selector);
      if (dom) {
        const rect = dom.getBoundingClientRect();
        const off = getIframeOffset(dom);
        const top = rect.top + off.y, bottom = rect.bottom + off.y;
        const left = rect.left + off.x, right = rect.right + off.x;
        el.visible = bottom > 0 && top < vh && right > 0 && left < vw && rect.width > 0 && rect.height > 0;
        el.x = Math.round(left);
        el.y = Math.round(top);
      } else {
        el.visible = false;
      }
    }

    // If focused element wasn't already numbered, find it now
    if (!focusedId && focused && focused !== document.body) {
      const aid = focused.getAttribute('data-ac-id');
      if (aid) focusedId = parseInt(aid, 10);
    }

    // Truncate if too large
    let truncated = false;
    if (md.length > MAX_MARKDOWN_CHARS) {
      md = md.slice(0, MAX_MARKDOWN_CHARS);
      truncated = true;
    }

    // Build context header
    const visibleCount = elementMap.filter((e) => e.visible).length;
    const header = [
      `url: ${location.href}`,
      `title: ${document.title}`,
      `viewport: ${vw}x${vh}`,
      `scroll: ${scrollPct}% (${scrollY}px / ${pageH}px)`,
      `elements: ${elementMap.length} total, ${visibleCount} visible`,
    ];
    if (activeModal) {
      const modalLabel = activeModal.getAttribute('aria-label')
        || activeModal.getAttribute('aria-labelledby')
        || 'unnamed';
      header.push(`modal: "${modalLabel}" (analysis scoped to this dialog)`);
    }
    if (focusedId) header.push(`focused: [#${focusedId}]`);
    if (truncated) header.push(`truncated: true (page too large)`);

    // Highlights
    if (options.highlight !== false) {
      addHighlights();
    }

    const modalLabel = activeModal
      ? (activeModal.getAttribute('aria-label') || activeModal.getAttribute('aria-labelledby') || true)
      : null;

    return {
      ok: true,
      data: {
        url: location.href,
        title: document.title,
        viewport: { width: vw, height: vh },
        scroll: { x: scrollX, y: scrollY, percent: scrollPct, pageHeight: pageH },
        focusedElement: focusedId,
        modal: modalLabel,
        truncated,
        markdown: `---\n${header.join('\n')}\n---\n\n${md}`,
        elements: elementMap,
      },
    };
  }

  // ─── DOM → Markdown ───

  function nodeToMarkdown(node, depth) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent.replace(/\s+/g, ' ').trim();
      return t || '';
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName;
    if (SKIP_TAGS.has(tag)) return '';
    if (isHardHidden(node)) return '';
    if (node.id === 'ac-labels' || node.id === 'ac-highlight-style') return '';
    if (node.getAttribute('aria-hidden') === 'true') {
      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return '';
    }

    // ── Iframes: traverse into same-origin iframes ──
    if (tag === 'IFRAME') {
      try {
        const iframeDoc = node.contentDocument;
        if (iframeDoc && iframeDoc.body) {
          const src = node.src || '';
          let iframeLabel = 'iframe';
          try {
            iframeLabel = new URL(src, location.origin).pathname;
          } catch {}
          return `\n<!-- iframe: ${iframeLabel} -->\n${nodeToMarkdown(iframeDoc.body, depth)}\n<!-- /iframe -->\n`;
        }
      } catch {
        // Cross-origin — can't access contentDocument
      }
      // Cross-origin or empty iframe — note it but skip content
      const src = node.src || '';
      return src ? ` [iframe: ${src.slice(0, 80)}] ` : '';
    }

    // ── Interactive elements ──
    const interType = getInteractiveType(node);
    if (interType) {
      // Dedup: skip wrappers that contain actual interactive children.
      // Leaf elements (input/select/textarea) can't have meaningful interactive children.
      const isLeaf = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      if (!isLeaf && hasInteractiveChild(node)) {
        return childrenMarkdown(node, depth);
      }
      return annotateInteractive(node, interType);
    }

    // ── Structural / semantic tags ──
    const children = childrenMarkdown(node, depth);

    // Landmark wrapper
    const landmark = LANDMARK_TAGS[tag] || landmarkFromRole(node);
    if (landmark && children.trim()) {
      const labelAttr = node.getAttribute('aria-label') || node.getAttribute('aria-labelledby');
      const landmarkLabel = labelAttr ? `${landmark}: ${labelAttr}` : landmark;
      return `\n<!-- ${landmarkLabel} -->\n${children}\n<!-- /${landmark} -->\n`;
    }

    switch (tag) {
      case 'H1': return `\n# ${children.trim()}\n`;
      case 'H2': return `\n## ${children.trim()}\n`;
      case 'H3': return `\n### ${children.trim()}\n`;
      case 'H4': return `\n#### ${children.trim()}\n`;
      case 'H5': return `\n##### ${children.trim()}\n`;
      case 'H6': return `\n###### ${children.trim()}\n`;

      case 'P':  return `\n${children.trim()}\n`;

      case 'UL':
      case 'OL':
        return '\n' + listMarkdown(node, tag === 'OL', depth) + '\n';

      case 'LI': {
        const inner = children.trim();
        return inner ? `- ${inner}\n` : '';
      }

      case 'TABLE': return '\n' + tableMarkdown(node) + '\n';

      case 'IMG': {
        const alt = node.getAttribute('alt');
        const src = node.getAttribute('src') || '';
        if (alt) return `![${alt}](${src})`;
        // Still note images without alt text
        const w = node.getAttribute('width') || '';
        const h = node.getAttribute('height') || '';
        const dims = (w || h) ? ` ${w}x${h}` : '';
        return `[image${dims}]`;
      }

      case 'BLOCKQUOTE': {
        const inner = children.trim();
        return inner ? `\n> ${inner.replace(/\n/g, '\n> ')}\n` : '';
      }

      case 'PRE': {
        const inner = node.textContent.trim();
        if (!inner) return '';
        // Detect language from class (e.g. class="language-js")
        const codeEl = node.querySelector('code');
        const langClass = (codeEl || node).className.match(/language-(\w+)/);
        const lang = langClass ? langClass[1] : '';
        return `\n\`\`\`${lang}\n${inner}\n\`\`\`\n`;
      }

      case 'CODE': {
        // Inline code (not inside <pre>)
        if (node.parentElement?.tagName === 'PRE') return node.textContent;
        const inner = node.textContent.trim();
        return inner ? `\`${inner}\`` : '';
      }

      case 'STRONG':
      case 'B':
        return `**${children.trim()}**`;

      case 'EM':
      case 'I':
        return `*${children.trim()}*`;

      case 'DEL':
      case 'S':
        return `~~${children.trim()}~~`;

      case 'MARK':
        return `==${children.trim()}==`;

      case 'HR': return '\n---\n';
      case 'BR': return '\n';

      case 'LABEL': {
        // Include the label text and associate with its input
        const forAttr = node.getAttribute('for');
        const inner = children.trim();
        if (forAttr && inner) return `${inner}: `;
        return inner ? `${inner} ` : '';
      }

      case 'DETAILS': {
        const summary = node.querySelector('summary');
        const isOpen = node.hasAttribute('open');
        // Annotate summary as a clickable button so the AI can toggle it
        let summaryAnnotation = '';
        if (summary) {
          summaryAnnotation = annotateInteractive(summary, 'button');
        }
        if (!isOpen) {
          return `\n${summaryAnnotation} (collapsed)\n`;
        }
        const inner = children.trim();
        return `\n${summaryAnnotation}\n${inner}\n`;
      }

      case 'SUMMARY':
        return ''; // handled by DETAILS

      case 'SLOT': {
        const assigned = node.assignedNodes ? node.assignedNodes({ flatten: true }) : [];
        let slotResult = '';
        for (const child of assigned) {
          slotResult += nodeToMarkdown(child, depth);
        }
        return slotResult;
      }

      case 'DIALOG': {
        if (!node.hasAttribute('open')) return '';
        return `\n--- Dialog ---\n${children}\n--- /Dialog ---\n`;
      }

      case 'TIME': {
        const dt = node.getAttribute('datetime');
        const inner = children.trim();
        return dt && dt !== inner ? `${inner} (${dt})` : inner;
      }

      default:
        return children;
    }
  }

  function childrenMarkdown(node, depth) {
    let result = '';
    const root = node.shadowRoot || node;
    for (const child of root.childNodes) {
      result += nodeToMarkdown(child, depth);
    }
    return result;
  }

  function listMarkdown(listEl, ordered, depth) {
    const items = [];
    let idx = 1;
    for (const child of listEl.children) {
      if (child.tagName !== 'LI') continue;
      const inner = childrenMarkdown(child, depth + 1).trim();
      if (!inner) continue;
      const prefix = ordered ? `${idx}. ` : '- ';
      items.push(`${'  '.repeat(depth)}${prefix}${inner}`);
      idx++;
    }
    return items.join('\n');
  }

  function tableMarkdown(tableEl) {
    const rows = [];
    for (const tr of tableEl.querySelectorAll('tr')) {
      const cells = [];
      for (const td of tr.querySelectorAll('th, td')) {
        cells.push(td.textContent.replace(/\s+/g, ' ').trim());
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length === 0) return '';
    const colCount = Math.max(...rows.map((r) => r.length));
    const lines = [];
    rows.forEach((row, i) => {
      const padded = row.concat(Array(colCount - row.length).fill(''));
      lines.push('| ' + padded.join(' | ') + ' |');
      if (i === 0) {
        lines.push('| ' + padded.map(() => '---').join(' | ') + ' |');
      }
    });
    return lines.join('\n');
  }

  // ─── Interactive Element Detection ───

  function hasClickHandler(node) {
    if (node.hasAttribute('onclick')) return true;
    if (node.hasAttribute('onmousedown')) return true;
    // Common framework binding attributes that appear in the DOM at runtime
    if (node.hasAttribute('ng-click')) return true;       // AngularJS
    if (node.hasAttribute('data-action')) return true;    // Stimulus / Rails
    if (node.hasAttribute('jsaction')) return true;       // Google jsaction
    if (node.hasAttribute('data-control-name')) return true; // LinkedIn
    if (node.hasAttribute('data-click')) return true;     // generic data-click pattern
    return false;
  }

  function getInteractiveType(node) {
    const tag = node.tagName;

    // ── Native HTML interactive tags ──
    // Note: SUMMARY is handled by the DETAILS case in nodeToMarkdown, not here.
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

    // ── Contenteditable — check before ARIA roles so rich-text editors
    //    (e.g. LinkedIn post editor: div[role="textbox"][contenteditable])
    //    are typed as 'editable' instead of 'input'. ──
    if (node.getAttribute('contenteditable') === 'true') {
      return 'editable';
    }

    // ── ARIA roles ──
    const role = node.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) {
      if (role === 'link') return 'link';
      if (role === 'textbox' || role === 'searchbox' || role === 'spinbutton') return 'input';
      if (role === 'combobox' || role === 'listbox') return 'select';
      if (role === 'checkbox') return 'checkbox';
      if (role === 'radio') return 'radio';
      if (role === 'switch') return 'checkbox';
      return 'button';
    }

    // ── Explicit click handler attributes (onclick, ng-click, etc.) ──
    if (hasClickHandler(node)) {
      return 'button';
    }

    // ── Tabindex: only interactive if also has cursor:pointer ──
    const tabindex = node.getAttribute('tabindex');
    if (tabindex !== null && tabindex !== '-1') {
      try {
        const style = window.getComputedStyle(node);
        if (style.cursor === 'pointer') return 'button';
      } catch {}
    }

    // ── cursor:pointer fallback — tighter constraints ──
    try {
      const style = window.getComputedStyle(node);
      if (style.cursor === 'pointer' && node.textContent?.trim()) {
        const rect = node.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.width < 400 && rect.height < 120) {
          return 'button';
        }
      }
    } catch {}

    return null;
  }

  /**
   * Check if node has an interactive descendant (for dedup).
   */
  function hasInteractiveChild(node) {
    for (const child of node.querySelectorAll(INTERACTIVE_CHILD_SELECTOR)) {
      if (!isHardHidden(child)) return true;
    }
    return false;
  }

  // ─── Annotate interactive element ───

  function annotateInteractive(node, type) {
    elementCounter++;
    const id = elementCounter;
    const tag = node.tagName;

    node.setAttribute('data-ac-id', String(id));

    const text = getLabel(node, type);
    const selector = `[data-ac-id="${id}"]`;

    const entry = { id, type, tag: tag.toLowerCase(), selector, text };

    // Enrich with element-specific metadata
    if (node.href) entry.href = node.href;
    if (node.value !== undefined && node.value !== '') entry.value = node.value;
    if (node.placeholder) entry.placeholder = node.placeholder;
    if (node.type) entry.inputType = node.type;
    if (node.disabled) entry.disabled = true;
    if (node.required) entry.required = true;
    if (node.readOnly) entry.readOnly = true;
    if (node.checked !== undefined) entry.checked = node.checked;

    elementMap.push(entry);

    // Build inline annotation
    return formatAnnotation(id, type, node, text);
  }

  function formatAnnotation(id, type, node, text) {
    const label = text || node.tagName.toLowerCase();

    switch (type) {
      case 'link': {
        const href = node.href || '';
        // Show shortened href for context
        let hrefShort = '';
        try {
          const u = new URL(href, location.origin);
          hrefShort = u.hostname === location.hostname ? u.pathname : u.hostname + u.pathname;
          if (hrefShort.length > 50) hrefShort = hrefShort.slice(0, 47) + '...';
        } catch {
          hrefShort = href.slice(0, 50);
        }
        return ` [#${id} link "${label}"${hrefShort ? ' → ' + hrefShort : ''}] `;
      }

      case 'button': {
        const disabled = node.disabled ? ' disabled' : '';
        return ` [#${id} button "${label}"${disabled}] `;
      }

      case 'checkbox': {
        const checked = node.checked ? '☑' : '☐';
        return ` [#${id} ${checked} "${label}"] `;
      }

      case 'radio': {
        const checked = node.checked ? '◉' : '○';
        return ` [#${id} ${checked} "${label}"] `;
      }

      case 'input': {
        const inputType = (node.type || 'text').toLowerCase();
        const val = node.value || '';
        const ph = node.placeholder || '';
        const desc = val ? `value="${val}"` : ph ? `placeholder="${ph}"` : inputType;
        const required = node.required ? ' required' : '';
        const disabled = node.disabled ? ' disabled' : '';
        return ` [#${id} input:${inputType} ${desc}${required}${disabled}] `;
      }

      case 'textarea': {
        const val = node.value || '';
        const ph = node.placeholder || '';
        const desc = val ? `"${val.slice(0, 50)}${val.length > 50 ? '...' : ''}"` : ph ? `placeholder="${ph}"` : '';
        const required = node.required ? ' required' : '';
        return ` [#${id} textarea ${desc}${required}] `;
      }

      case 'select': {
        const sel = node.options?.[node.selectedIndex];
        const val = sel ? sel.text : '';
        const optCount = node.options?.length || 0;
        return ` [#${id} select "${val}" (${optCount} options)] `;
      }

      case 'editable': {
        const val = node.innerText?.replace(/\s+/g, ' ').trim() || '';
        const preview = val.length > 200 ? val.slice(0, 197) + '...' : val;
        return ` [#${id} editable "${preview}"] `;
      }

      default:
        return ` [#${id} ${type} "${label}"] `;
    }
  }

  function getLabel(node, type) {
    // aria-label is highest priority
    const aria = node.getAttribute('aria-label');
    if (aria) return aria.trim().slice(0, 80);

    // aria-labelledby
    const labelledBy = node.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) {
        const t = labelEl.textContent?.trim();
        if (t) return t.slice(0, 80);
      }
    }

    // Associated <label> for inputs
    if (node.id && (type === 'input' || type === 'checkbox' || type === 'radio' || type === 'select' || type === 'textarea')) {
      const labelEl = document.querySelector(`label[for="${CSS.escape(node.id)}"]`);
      if (labelEl) {
        const t = labelEl.textContent?.trim();
        if (t) return t.slice(0, 80);
      }
    }

    // Direct text children
    const directText = [];
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.textContent.trim();
        if (t) directText.push(t);
      }
    }
    if (directText.length > 0) {
      const joined = directText.join(' ').slice(0, 80);
      if (joined) return joined;
    }

    // innerText fallback
    const text = node.innerText?.replace(/\s+/g, ' ').trim();
    if (text && text.length <= 80) return text;
    if (text) return text.slice(0, 77) + '...';

    const title = node.getAttribute('title');
    if (title) return title.trim().slice(0, 80);

    if (node.placeholder) return node.placeholder.slice(0, 80);
    if (node.name) return node.name;

    return '';
  }

  // ─── Landmark detection from ARIA role ───

  function landmarkFromRole(node) {
    const role = node.getAttribute('role');
    if (!role) return null;
    const landmarks = { banner: 'header', navigation: 'nav', main: 'main', complementary: 'aside', contentinfo: 'footer', form: 'form', region: 'section', dialog: 'dialog', search: 'search' };
    return landmarks[role] || null;
  }

  // ─── Visibility ───

  function isHardHidden(node) {
    try {
      const style = window.getComputedStyle(node);
      if (style.display === 'none') return true;
      if (style.visibility === 'hidden') return true;
    } catch {}
    return false;
  }

  /** Return {x, y} offset if element lives inside a same-origin iframe. */
  function getIframeOffset(el) {
    const ownerDoc = el.ownerDocument;
    if (ownerDoc === document) return { x: 0, y: 0 };
    for (const iframe of document.querySelectorAll('iframe')) {
      try {
        if (iframe.contentDocument === ownerDoc) {
          const r = iframe.getBoundingClientRect();
          return { x: r.left, y: r.top };
        }
      } catch {}
    }
    return { x: 0, y: 0 };
  }

  // ─── Shadow DOM query ───

  function queryShadow(selector, root = document) {
    const el = root.querySelector(selector);
    if (el) return el;
    const hosts = root.querySelectorAll('*');
    for (const host of hosts) {
      if (host.shadowRoot) {
        const found = queryShadow(selector, host.shadowRoot);
        if (found) return found;
      }
      // Search inside same-origin iframes
      if (host.tagName === 'IFRAME') {
        try {
          const iframeDoc = host.contentDocument;
          if (iframeDoc) {
            const found = queryShadow(selector, iframeDoc);
            if (found) return found;
          }
        } catch {}
      }
    }
    return null;
  }

  window.__acQueryShadow = queryShadow;

  // ─── Highlight Overlays ───

  const HIGHLIGHT_CSS = `
    [data-ac-id] {
      outline: 2px solid var(--ac-hl-color, #3b82f6) !important;
      outline-offset: 1px !important;
    }
  `;

  const LABEL_CSS = `
    .ac-label {
      position: absolute;
      font-family: ui-monospace, 'SF Mono', 'Fira Code', monospace;
      font-size: 11px;
      font-weight: 700;
      line-height: 16px;
      padding: 0 5px;
      border-radius: 4px;
      color: #fff;
      z-index: 2147483646;
      pointer-events: none;
      white-space: nowrap;
      box-shadow: 0 1px 4px rgba(0,0,0,.5);
      letter-spacing: 0.5px;
    }
  `;

  function addHighlights() {
    const styleId = 'ac-highlight-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = HIGHLIGHT_CSS + LABEL_CSS;
      document.head.appendChild(style);
    }

    for (const host of document.querySelectorAll('*')) {
      if (host.shadowRoot && !host.shadowRoot.getElementById('ac-hl-shadow')) {
        const s = document.createElement('style');
        s.id = 'ac-hl-shadow';
        s.textContent = HIGHLIGHT_CSS;
        host.shadowRoot.appendChild(s);
      }
      // Inject highlight styles into same-origin iframes
      if (host.tagName === 'IFRAME') {
        try {
          const iframeDoc = host.contentDocument;
          if (iframeDoc && iframeDoc.head && !iframeDoc.getElementById('ac-highlight-style')) {
            const s = iframeDoc.createElement('style');
            s.id = 'ac-highlight-style';
            s.textContent = HIGHLIGHT_CSS;
            iframeDoc.head.appendChild(s);
          }
        } catch {}
      }
    }

    const oldContainer = document.getElementById('ac-labels');
    if (oldContainer) oldContainer.remove();

    const container = document.createElement('div');
    container.id = 'ac-labels';
    container.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483646;pointer-events:none;';
    document.body.appendChild(container);

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    for (const el of elementMap) {
      const dom = queryShadow(el.selector);
      if (!dom) continue;

      const color = COLORS[el.type] || COLORS.button;
      dom.style.setProperty('--ac-hl-color', color);

      const rect = dom.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const off = getIframeOffset(dom);

      const label = document.createElement('div');
      label.className = 'ac-label';
      label.style.background = color;
      label.style.left = `${rect.left + off.x + scrollX - 2}px`;
      label.style.top = `${rect.top + off.y + scrollY - 18}px`;
      const parts = [el.id, el.type];
      if (el.text) parts.push(`"${el.text.slice(0, 25)}"`);
      if (dom.id) parts.push(`#${dom.id}`);
      label.textContent = parts.join(' · ');
      container.appendChild(label);
    }
  }

  // ─── Cleanup ───

  function cleanup() {
    const container = document.getElementById('ac-labels');
    if (container) container.remove();

    const style = document.getElementById('ac-highlight-style');
    if (style) style.remove();

    document.querySelectorAll('[data-ac-id]').forEach((el) => {
      el.removeAttribute('data-ac-id');
      el.style.removeProperty('--ac-hl-color');
    });

    // Clean up inside same-origin iframes
    document.querySelectorAll('iframe').forEach((iframe) => {
      try {
        const iframeDoc = iframe.contentDocument;
        if (!iframeDoc) return;
        const iframeStyle = iframeDoc.getElementById('ac-highlight-style');
        if (iframeStyle) iframeStyle.remove();
        iframeDoc.querySelectorAll('[data-ac-id]').forEach((el) => {
          el.removeAttribute('data-ac-id');
          el.style.removeProperty('--ac-hl-color');
        });
      } catch {}
    });
  }

  window.__acCleanup = cleanup;

  // ─── Message listener ───

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.source !== 'ac-service-worker') return false;
    if (msg.type !== 'exec') return false;

    const { action, params, cmdId } = msg;

    if (action === 'analyze') {
      try {
        const result = analyzePage(params || {});
        chrome.runtime.sendMessage({
          source: 'ac-content',
          type: 'cmd_result',
          cmdId,
          ok: result.ok !== false,
          data: result.data || null,
          error: result.error || null,
        });
      } catch (err) {
        chrome.runtime.sendMessage({
          source: 'ac-content',
          type: 'cmd_result',
          cmdId,
          ok: false,
          error: err.message || String(err),
        });
      }
      sendResponse({ _deferred: true, cmdId });
      return false;
    }

    if (action === 'cleanup_highlights') {
      cleanup();
      chrome.runtime.sendMessage({
        source: 'ac-content',
        type: 'cmd_result',
        cmdId,
        ok: true,
        data: null,
      });
      sendResponse({ _deferred: true, cmdId });
      return false;
    }

    return false;
  });
})();
