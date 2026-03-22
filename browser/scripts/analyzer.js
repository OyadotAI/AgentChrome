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
    'HEAD', 'OBJECT', 'EMBED', 'CANVAS', 'MAP', 'TEMPLATE',
    'PICTURE', // skip <picture>, the <img> inside will be caught
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
    // Site-specific
    '[data-testid]',                  // X/Twitter
    '[data-click-id]',                // Reddit
    '[data-tracking-control-name]',   // LinkedIn
  ].join(', ');

  let elementCounter = 0;
  let elementMap = [];
  const elementRefs = new Map(); // id → DOM node (survives React re-renders)

  window.analyzePage = function (options = {}) {
    // Bypass ClientRects noise from fingerprint spoofing during analysis
    window.__oyaInternalCall = true;
    try { return _analyzePageInner(options); } finally { window.__oyaInternalCall = false; }
  };

  function _analyzePageInner(options = {}) {
    cleanup();
    elementCounter = 0;
    elementMap = [];
    elementRefs.clear();

    // Attach listeners for programmatic input (type command, etc)
    attachInputListeners();

    // Resolve root — auto-detect open modal dialogs
    let root;
    let activeModal = null;

    if (options.selector) {
      root = document.querySelector(options.selector);
    } else {
      // Find visible modal dialogs — iterate backwards to find the topmost one.
      // Also catches LinkedIn overlays, Amazon popups, Reddit lightboxes.
      const modals = document.querySelectorAll(
        '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], dialog[open], ' +
        '[role="dialog"]:not([aria-modal="false"]), ' +  // Some sites omit aria-modal
        '.artdeco-modal__content, ' +                     // LinkedIn modals
        '[data-testid="sheetDialog"]'                     // X/Twitter sheets
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
        const off = getIframeOffset(dom);
        const top = rect.top + off.y, bottom = rect.bottom + off.y;
        const left = rect.left + off.x, right = rect.right + off.x;
        el.visible = bottom > 0 && top < vh && right > 0 && left < vw && rect.width > 0 && rect.height > 0;
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

  // ─── Site Detection ───

  function isHackerNews() {
    return location.hostname === 'news.ycombinator.com';
  }

  // ─── DOM → Markdown ───

  function nodeToMarkdown(node, depth) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.replace(/[ \t]+/g, ' ');
      return text.trim() ? text : (text.includes('\n') ? '\n' : ' ');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName;
    if (SKIP_TAGS.has(tag)) return '';
    if (isHardHidden(node)) return '';
    if (node.id === 'ac-labels' || node.id === 'ac-highlight-style') return '';
    // Only skip aria-hidden elements if they're also visually hidden (zero size or no opacity).
    // LinkedIn sets aria-hidden="true" on main content when messaging is open.
    // Reddit uses aria-hidden on expandable content.
    if (node.getAttribute('aria-hidden') === 'true') {
      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return '';
      try { if (window.getComputedStyle(node).opacity === '0') return ''; } catch {}
    }

    // ── Iframes: traverse into same-origin iframes ──
    if (tag === 'IFRAME') {
      try {
        const iframeDoc = node.contentDocument;
        if (iframeDoc && iframeDoc.body) {
          const src = node.src || '';
          let iframeLabel = 'iframe';
          try { iframeLabel = new URL(src, location.origin).pathname; } catch {}
          return `\n<!-- iframe: ${iframeLabel} -->\n${nodeToMarkdown(iframeDoc.body, depth)}\n<!-- /iframe -->\n`;
        }
      } catch {}
      const src = node.src || '';
      return src ? ` [iframe: ${src.slice(0, 80)}] ` : '';
    }

    const interType = getInteractiveType(node);
    if (interType) {
      // Dedup: skip wrappers that contain actual interactive children.
      const isLeaf = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      if (!isLeaf && hasInteractiveChild(node)) return childrenMarkdown(node, depth);
      return annotateInteractive(node, interType);
    }

    const children = childrenMarkdown(node, depth);

    // Forms get special context for LLM comprehension
    if (tag === 'FORM') {
      const c = children.trim();
      if (!c) return '';
      const action = node.getAttribute('action') || '';
      const name = node.getAttribute('aria-label') || node.getAttribute('name') || '';
      const label = name ? `form: ${name}` : 'form';
      return `\n<!-- ${label}${action ? ' → ' + action : ''} -->\n${c}\n<!-- /form -->\n`;
    }

    const landmark = LANDMARK_TAGS[tag] || landmarkFromRole(node);
    if (landmark && landmark !== 'form' && children.trim()) {
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
      case 'TABLE': {
        // HackerNews uses tables for layout — treat as container, not data table.
        // Also detect other layout tables: no <th> and mostly single-cell rows.
        if (isHackerNews() || isLayoutTable(node)) return '\n' + childrenMarkdown(node, depth) + '\n';
        return '\n' + tableMarkdown(node) + '\n';
      }
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
      case 'TIME': {
        const dt = node.getAttribute('datetime') || node.getAttribute('title') || node.textContent.trim();
        return dt;
      }
      case 'TR': {
        // HN post rows: render as a line with separator
        if (isHackerNews() && node.classList.contains('athing')) {
          return '\n' + childrenMarkdown(node, depth).trim() + ' ';
        }
        // HN subtext row (points, author, comments)
        if (isHackerNews() && node.querySelector('.subtext')) {
          return childrenMarkdown(node, depth).trim() + '\n';
        }
        // HN spacer rows
        if (isHackerNews() && node.classList.contains('spacer')) return '\n';
        return childrenMarkdown(node, depth);
      }
      case 'TD': {
        // Skip empty layout cells
        const text = node.textContent.trim();
        if (!text && !node.querySelector('a, button, input, select, textarea, [role="button"]')) return '';
        return childrenMarkdown(node, depth);
      }
      default: {
        // Reddit custom elements: traverse into shadow DOM
        if (tag.includes('-') && node.shadowRoot) {
          return childrenMarkdown(node, depth);
        }
        return children;
      }
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
      for (const td of tr.querySelectorAll('th, td')) cells.push(childrenMarkdown(td, 0).replace(/\s+/g, ' ').trim());
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
    if (node.hasAttribute('data-control-name')) return true;  // LinkedIn
    if (node.hasAttribute('data-click')) return true;
    // LinkedIn: ember-style actions, feed controls
    if (node.hasAttribute('data-urn')) return true;
    if (node.hasAttribute('data-tracking-control-name')) return true;
    // X / Twitter: React event delegation
    if (node.hasAttribute('data-testid')) {
      const tid = node.getAttribute('data-testid');
      if (/like|retweet|reply|bookmark|share|follow|tweet/i.test(tid)) return true;
    }
    // Reddit: custom interactive elements
    if (node.tagName === 'SHREDDIT-POST' || node.tagName === 'FACEPLATE-TRACKER') return true;
    if (node.hasAttribute('data-click-id')) return true;  // Reddit
    if (node.hasAttribute('data-faceplate-tracking-context')) return true;  // Reddit
    // Amazon: interactive product elements
    if (node.hasAttribute('data-action')) return true;
    if (node.hasAttribute('data-cel-widget')) return true;
    if (node.hasAttribute('data-asin')) return true;
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

    // ── Site-specific interactive element detection ──

    // LinkedIn: feed cards, connection actions, messaging items
    const cls = node.className || '';
    if (typeof cls === 'string') {
      // LinkedIn feed items and actions
      if (cls.includes('feed-shared-social-action') || cls.includes('artdeco-button') ||
          cls.includes('social-actions-button') || cls.includes('msg-conversation-card')) return 'button';
      // Reddit: vote buttons, expand/collapse
      if (cls.includes('voteButton') || cls.includes('_1rZYMD_4xY3gRcSS3p8ODO')) return 'button';
      // Amazon: add-to-cart, buy-now area elements
      if (cls.includes('a-button') || cls.includes('s-product-image-container')) return 'button';
    }

    // HackerNews: vote links (they use <a> without href but with onclick via id)
    if (tag === 'A' && !node.href && node.id?.startsWith('up_')) return 'button';

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
    // Rich metadata for SPA recovery
    if (node.name) entry.name = node.name;
    const ariaLabel = node.getAttribute('aria-label');
    if (ariaLabel) entry.ariaLabel = ariaLabel;
    const testId = node.getAttribute('data-testid');
    if (testId) entry.testId = testId;
    // Form context
    const form = node.closest('form');
    if (form) entry.formName = form.getAttribute('aria-label') || form.getAttribute('name') || form.getAttribute('action') || '';
    elementMap.push(entry);

    const label = text || node.tagName.toLowerCase();
    switch (type) {
      case 'link': {
        let h = '';
        try { const u = new URL(node.href || '', location.origin); h = u.hostname === location.hostname ? u.pathname : u.hostname + u.pathname; } catch {}
        // HN: enrich "reply" links with the comment author for context
        if (isHackerNews() && label === 'reply') {
          const commentRow = node.closest('.athing');
          const user = commentRow?.querySelector('.hnuser')?.textContent;
          if (user) return ` [#${id} link "reply to ${user}"] `;
        }
        // HN: enrich "N comments" links with post title
        if (isHackerNews() && /^\d+\s*comment/.test(label)) {
          const postRow = node.closest('tr')?.previousElementSibling;
          const title = postRow?.querySelector('.titleline a')?.textContent?.slice(0, 40);
          if (title) return ` [#${id} link "${label}" on "${title}"] `;
        }
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
    // aria-labelledby
    const labelledBy = node.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
      if (parts.length) return parts.join(' ').slice(0, 80);
    }
    if (node.id && ['input', 'checkbox', 'radio', 'select', 'textarea'].includes(type)) {
      const l = document.querySelector(`label[for="${CSS.escape(node.id)}"]`);
      if (l?.textContent?.trim()) return l.textContent.trim().slice(0, 80);
    }
    // Parent <label> wrapping this element
    const parentLabel = node.closest('label');
    if (parentLabel) {
      const labelText = parentLabel.textContent.replace(node.textContent || '', '').trim();
      if (labelText) return labelText.slice(0, 80);
    }
    // X/Twitter: data-testid often has a semantic name
    const testId = node.getAttribute('data-testid');
    if (testId && !node.textContent?.trim()) return testId.replace(/[-_]/g, ' ').slice(0, 80);
    // LinkedIn: data-control-name
    const controlName = node.getAttribute('data-control-name');
    if (controlName && !node.textContent?.trim()) return controlName.replace(/[_-]/g, ' ').slice(0, 80);
    const direct = [];
    for (const c of node.childNodes) if (c.nodeType === Node.TEXT_NODE && c.textContent.trim()) direct.push(c.textContent.trim());
    if (direct.length) return direct.join(' ').slice(0, 80);
    const t = node.innerText?.replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, 80);
    // Check title attribute (HN vote arrows use title="upvote")
    const title = node.getAttribute('title')?.trim();
    if (title) return title.slice(0, 80);
    // Check child element titles (HN: <a><div class="votearrow" title="upvote"></div></a>)
    const childTitle = node.querySelector('[title]');
    if (childTitle) return childTitle.getAttribute('title').trim().slice(0, 80);
    return node.placeholder?.slice(0, 80) || node.name || '';
  }

  /** Detect layout tables (no <th>, used for positioning not data). */
  function isLayoutTable(table) {
    if (table.querySelector('th')) return false;
    if (table.getAttribute('role') === 'presentation' || table.getAttribute('role') === 'none') return true;
    // If most rows have just 1-2 cells with mixed content, it's probably layout
    const rows = table.querySelectorAll(':scope > tbody > tr, :scope > tr');
    if (rows.length === 0) return false;
    let layoutScore = 0;
    for (const row of rows) {
      const cells = row.querySelectorAll(':scope > td');
      if (cells.length <= 2) layoutScore++;
      // Cells containing interactive elements = layout
      for (const cell of cells) {
        if (cell.querySelector('a, button, input, img')) layoutScore++;
      }
    }
    return layoutScore > rows.length;
  }

  function landmarkFromRole(node) {
    const r = node.getAttribute('role');
    return r ? ({ banner: 'header', navigation: 'nav', main: 'main', complementary: 'aside', contentinfo: 'footer', form: 'form', region: 'section', search: 'search' })[r] || null : null;
  }

  function isHardHidden(node) {
    try {
      const s = window.getComputedStyle(node);
      if (s.display === 'none' || s.visibility === 'hidden') return true;
      // Catch elements moved off-screen (common on LinkedIn, Amazon for screen readers)
      if (s.position === 'absolute' || s.position === 'fixed') {
        const r = node.getBoundingClientRect();
        if (r.right < -100 || r.bottom < -100 || r.left > window.innerWidth + 100) return true;
      }
      return false;
    } catch { return false; }
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

  function queryShadow(selector, root = document) {
    const el = root.querySelector(selector);
    if (el) return el;
    for (const h of root.querySelectorAll('*')) {
      if (h.shadowRoot) { const f = queryShadow(selector, h.shadowRoot); if (f) return f; }
      if (h.tagName === 'IFRAME') {
        try {
          const iframeDoc = h.contentDocument;
          if (iframeDoc) { const f = queryShadow(selector, iframeDoc); if (f) return f; }
        } catch {}
      }
    }
    return null;
  }

  window.__acQueryShadow = queryShadow;

  // Element lookup: ID-only. Never falls back to CSS selectors.
  window.__acFindElement = function (selector) {
    const match = selector.match(/data-ac-id="(\d+)"/);
    if (!match) return null;

    const id = parseInt(match[1], 10);

    // 1. Live reference from elementRefs map
    const ref = elementRefs.get(id);
    if (ref && ref.isConnected) return ref;

    // 2. DOM query by data-ac-id (may have been re-attached by observer)
    const byAttr = document.querySelector(`[data-ac-id="${id}"]`);
    if (byAttr) { elementRefs.set(id, byAttr); return byAttr; }

    // 3. Shadow DOM + iframe search by data-ac-id
    const byShadow = queryShadow(`[data-ac-id="${id}"]`);
    if (byShadow) { elementRefs.set(id, byShadow); return byShadow; }

    // 4. Recovery: find replacement element by stored metadata
    const replacement = findReplacementElement(id);
    if (replacement) {
      replacement.setAttribute('data-ac-id', String(id));
      elementRefs.set(id, replacement);
      return replacement;
    }

    // 5. Last resort: try by DOM id from metadata
    const entry = elementMap.find(e => e.id === id);
    if (entry?.domId) {
      const byDomId = document.getElementById(entry.domId);
      if (byDomId) {
        byDomId.setAttribute('data-ac-id', String(id));
        elementRefs.set(id, byDomId);
        return byDomId;
      }
    }

    return null;
  };

  // ─── Highlight Overlays ───

  const HIGHLIGHT_CSS = `[data-ac-id]{outline:2px solid var(--ac-hl-color,#3b82f6)!important;outline-offset:1px!important}`;
  const LABEL_CSS = `.ac-label{position:absolute;font-family:ui-monospace,monospace;font-size:11px;font-weight:700;line-height:16px;padding:0 5px;border-radius:4px;color:#fff;z-index:2147483646;pointer-events:none;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.5)}`;

  function addHighlights() {
    let style = document.getElementById('ac-highlight-style');
    if (!style) { style = document.createElement('style'); style.id = 'ac-highlight-style'; style.textContent = HIGHLIGHT_CSS + LABEL_CSS; document.head.appendChild(style); }
    // Inject highlight styles into same-origin iframes
    for (const iframe of document.querySelectorAll('iframe')) {
      try {
        const iframeDoc = iframe.contentDocument;
        if (iframeDoc && iframeDoc.head && !iframeDoc.getElementById('ac-highlight-style')) {
          const s = iframeDoc.createElement('style');
          s.id = 'ac-highlight-style';
          s.textContent = HIGHLIGHT_CSS;
          iframeDoc.head.appendChild(s);
        }
      } catch {}
    }
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
      const off = getIframeOffset(dom);
      const lbl = document.createElement('div');
      lbl.className = 'ac-label';
      lbl.style.background = color;
      lbl.style.left = `${rect.left + off.x + sx - 2}px`;
      lbl.style.top = `${rect.top + off.y + sy - 18}px`;
      lbl.textContent = `${el.id} ${el.type}`;
      c.appendChild(lbl);
    }
  }

  // ─── Cleanup ───

  function cleanup() {
    document.removeEventListener('input', onInputChange, true);
    document.removeEventListener('change', onInputChange, true);
    if (pollStateTimer) cancelAnimationFrame(pollStateTimer);
    if (stateCheckTimer) clearTimeout(stateCheckTimer);
    const c = document.getElementById('ac-labels'); if (c) c.remove();
    const s = document.getElementById('ac-highlight-style'); if (s) s.remove();
    document.querySelectorAll('[data-ac-id]').forEach(el => { el.removeAttribute('data-ac-id'); el.style.removeProperty('--ac-hl-color'); });
    // Clean up inside same-origin iframes
    document.querySelectorAll('iframe').forEach(iframe => {
      try {
        const iframeDoc = iframe.contentDocument;
        if (!iframeDoc) return;
        const iframeStyle = iframeDoc.getElementById('ac-highlight-style');
        if (iframeStyle) iframeStyle.remove();
        iframeDoc.querySelectorAll('[data-ac-id]').forEach(el => { el.removeAttribute('data-ac-id'); el.style.removeProperty('--ac-hl-color'); });
      } catch {}
    });
  }

  window.__acCleanup = cleanup;

  // ─── Force Poll State ───
  // Called by the type command to immediately check button states after typing

  window.__acForcePollState = function() {
    checkButtonStates();
  };

  // ─── Event Listener for Programmatic Input ───
  // Listens for input/change events which fire even when type is done programmatically

  let pollStateTimer = null;

  function onInputChange() {
    if (!stateCheckTimer) {
      stateCheckTimer = setTimeout(checkButtonStates, 50);
    }
  }

  function pollButtonStates() {
    checkButtonStates();
    pollStateTimer = requestAnimationFrame(pollButtonStates);
  }

  function attachInputListeners() {
    document.removeEventListener('input', onInputChange, true);
    document.removeEventListener('change', onInputChange, true);
    if (pollStateTimer) cancelAnimationFrame(pollStateTimer);
    document.addEventListener('input', onInputChange, true);
    document.addEventListener('change', onInputChange, true);
    // Poll button states continuously for programmatic changes
    pollStateTimer = requestAnimationFrame(pollButtonStates);
  }

  // ─── Live DOM Observer ───
  // Auto-tags new interactive elements as they're added (React re-renders,
  // infinite scroll, dropdowns, modals, etc.) without needing a full re-analyze.

  let observerTimer = null;
  const pendingNodes = new Set();
  let stateCheckTimer = null;

  function checkButtonStates() {
    stateCheckTimer = null;
    if (!elementMap.length) return;
    
    for (const entry of elementMap) {
      const dom = queryShadow(entry.selector);
      if (!dom) continue;
      
      // Update disabled state: check multiple indicators
      const wasDisabled = entry.disabled;
      const isDisabledAttr = dom.disabled || dom.getAttribute('aria-disabled') === 'true';
      const isDisabledClass = dom.className?.includes('disabled') || dom.className?.includes('is-disabled');
      const isDisabledOpacity = window.getComputedStyle(dom).opacity === '0.5' || window.getComputedStyle(dom).opacity < 0.6;
      
      // Most reliable: disabled attribute or aria-disabled
      entry.disabled = isDisabledAttr || isDisabledClass;
    }
  }

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
              const off = getIframeOffset(el);
              const top = rect.top + off.y, bottom = rect.bottom + off.y;
              const left = rect.left + off.x, right = rect.right + off.x;
              entry.visible = bottom > 0 && top < vh && right > 0 && left < vw && rect.width > 0 && rect.height > 0;
              elementMap.push(entry);

              // Add highlight label
              if (labelContainer) {
                const color = COLORS[type] || COLORS.button;
                el.style.setProperty('--ac-hl-color', color);
                if (rect.width > 0 && rect.height > 0) {
                  const lbl = document.createElement('div');
                  lbl.className = 'ac-label';
                  lbl.style.background = color;
                  lbl.style.left = `${left + sx - 2}px`;
                  lbl.style.top = `${top + sy - 18}px`;
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

  /** Find a replacement element in the DOM matching stored metadata. */
  function findReplacementElement(id) {
    const entry = elementMap.find(e => e.id === id);
    if (!entry) return null;

    // 1. By DOM id
    if (entry.domId) {
      const byId = document.getElementById(entry.domId);
      if (byId && !byId.hasAttribute('data-ac-id')) return byId;
    }
    // 2. By name attribute
    if (entry.name) {
      const byName = document.querySelector(`${entry.tag}[name="${CSS.escape(entry.name)}"]`);
      if (byName && !byName.hasAttribute('data-ac-id')) return byName;
    }
    // 3. By data-testid
    if (entry.testId) {
      const byTestId = document.querySelector(`[data-testid="${CSS.escape(entry.testId)}"]`);
      if (byTestId && !byTestId.hasAttribute('data-ac-id')) return byTestId;
    }
    // 4. By aria-label + tag
    if (entry.ariaLabel) {
      const byAria = document.querySelector(`${entry.tag}[aria-label="${CSS.escape(entry.ariaLabel)}"]`);
      if (byAria && !byAria.hasAttribute('data-ac-id')) return byAria;
    }
    // 5. By tag + text content match
    if (entry.text) {
      const candidates = document.querySelectorAll(entry.tag);
      for (const c of candidates) {
        if (c.hasAttribute('data-ac-id')) continue;
        const cText = getLabel(c, entry.type);
        if (cText === entry.text) return c;
      }
    }
    return null;
  }

  /** Re-attach data-ac-id to a re-rendered element. */
  function reattachElement(id) {
    const ref = elementRefs.get(id);
    if (ref && ref.isConnected) return; // still alive

    // Check if data-ac-id already exists in DOM (was re-rendered with it)
    const existing = document.querySelector(`[data-ac-id="${id}"]`);
    if (existing) { elementRefs.set(id, existing); return; }

    // Find replacement
    const replacement = findReplacementElement(id);
    if (replacement) {
      replacement.setAttribute('data-ac-id', String(id));
      elementRefs.set(id, replacement);
    }
  }

  const observer = new MutationObserver((mutations) => {
    let hasEditableChange = false;
    for (const m of mutations) {
      if (m.type === 'attributes') {
        const node = m.target;
        if (node.hasAttribute('data-ac-id')) {
          const id = parseInt(node.getAttribute('data-ac-id'), 10);
          const entry = elementMap.find(e => e.id === id);
          if (entry) {
            // Update dynamic properties
            if (node.disabled !== undefined) entry.disabled = node.disabled;
            if (node.checked !== undefined) entry.checked = node.checked;
            if (node.value !== undefined) entry.value = node.value;
            if (node.getAttribute('aria-disabled') !== null) entry.disabled = node.getAttribute('aria-disabled') === 'true';
            // Update visibility if needed
            const rect = node.getBoundingClientRect();
            const vw = window.innerWidth, vh = window.innerHeight;
            entry.visible = rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw && rect.width > 0 && rect.height > 0;
          }
        }
      } else if (m.type === 'characterData' && m.target.parentElement?.hasAttribute('data-ac-id')) {
        // Detect text change in contenteditable elements
        const el = m.target.parentElement;
        if (el.getAttribute('contenteditable') === 'true') {
          hasEditableChange = true;
        }
      } else if (m.type === 'childList' && m.target.hasAttribute('data-ac-id')) {
        const el = m.target;
        if (el.getAttribute('contenteditable') === 'true') {
          hasEditableChange = true;
        }
      } else {
        // Track removed elements for SPA re-render recovery
        for (const node of m.removedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const removed = node.querySelectorAll ? [node, ...node.querySelectorAll('[data-ac-id]')] : [node];
          for (const oldEl of removed) {
            const aid = oldEl.getAttribute?.('data-ac-id');
            if (!aid) continue;
            const id = parseInt(aid, 10);
            const ref = elementRefs.get(id);
            if (ref && !ref.isConnected) {
              // Element was removed — try to find replacement after addedNodes are processed
              setTimeout(() => reattachElement(id), 100);
            }
          }
        }
        for (const node of m.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) pendingNodes.add(node);
        }
      }
    }
    if (pendingNodes.size > 0 && !observerTimer) {
      observerTimer = setTimeout(processNewNodes, 200);
    }
    // When text changes in editable fields, re-check all button states after a short delay
    if (hasEditableChange && !stateCheckTimer) {
      stateCheckTimer = setTimeout(checkButtonStates, 150);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'checked', 'value', 'aria-disabled'], characterData: true });
})();
