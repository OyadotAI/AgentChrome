/**
 * Oya Browser Extension — Content Script
 * Page analyzer + command execution via DOM APIs.
 * Injected into every page to analyze DOM and handle agent commands.
 */

(function () {
  'use strict';

  if (window.__oyaContentLoaded) return;
  window.__oyaContentLoaded = true;

  const MAX_MARKDOWN_CHARS = 80000;

  const COLORS = {
    link: '#22c55e', button: '#3b82f6', input: '#a855f7',
    select: '#f59e0b', textarea: '#06b6d4', editable: '#ec4899',
  };

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'LINK', 'META',
    'HEAD', 'OBJECT', 'EMBED', 'CANVAS', 'MAP', 'TEMPLATE',
    'PICTURE',
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
    '[data-testid]', '[data-click-id]', '[data-tracking-control-name]',
  ].join(', ');

  let elementCounter = 0;
  let elementMap = [];
  const elementRefs = new Map();

  // ─── Page Analyzer ───

  function analyzePage(options = {}) {
    cleanup();
    elementCounter = 0;
    elementMap = [];
    elementRefs.clear();

    let root;
    let activeModal = null;

    if (options.selector) {
      root = document.querySelector(options.selector);
    } else {
      const modals = document.querySelectorAll(
        '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], dialog[open], ' +
        '[role="dialog"]:not([aria-modal="false"]), ' +
        '.artdeco-modal__content, ' +
        '[data-testid="sheetDialog"]'
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
  }

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
    if (node.getAttribute('aria-hidden') === 'true') {
      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return '';
      try { if (window.getComputedStyle(node).opacity === '0') return ''; } catch {}
    }

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
      const isLeaf = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      if (!isLeaf && hasInteractiveChild(node)) return childrenMarkdown(node, depth);
      return annotateInteractive(node, interType);
    }

    const children = childrenMarkdown(node, depth);

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
      case 'SUMMARY': return '';
      case 'SLOT': {
        const assigned = node.assignedNodes ? node.assignedNodes({ flatten: true }) : [];
        return assigned.map(c => nodeToMarkdown(c, depth)).join('');
      }
      case 'TIME': {
        return node.getAttribute('datetime') || node.getAttribute('title') || node.textContent.trim();
      }
      case 'TR': {
        if (isHackerNews() && node.classList.contains('athing')) return '\n' + childrenMarkdown(node, depth).trim() + ' ';
        if (isHackerNews() && node.querySelector('.subtext')) return childrenMarkdown(node, depth).trim() + '\n';
        if (isHackerNews() && node.classList.contains('spacer')) return '\n';
        return childrenMarkdown(node, depth);
      }
      case 'TD': {
        const text = node.textContent.trim();
        if (!text && !node.querySelector('a, button, input, select, textarea, [role="button"]')) return '';
        return childrenMarkdown(node, depth);
      }
      default: {
        if (tag.includes('-') && node.shadowRoot) return childrenMarkdown(node, depth);
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
    if (node.hasAttribute('data-control-name')) return true;
    if (node.hasAttribute('data-click')) return true;
    if (node.hasAttribute('data-urn')) return true;
    if (node.hasAttribute('data-tracking-control-name')) return true;
    if (node.hasAttribute('data-testid')) {
      const tid = node.getAttribute('data-testid');
      if (/like|retweet|reply|bookmark|share|follow|tweet/i.test(tid)) return true;
    }
    if (node.tagName === 'SHREDDIT-POST' || node.tagName === 'FACEPLATE-TRACKER') return true;
    if (node.hasAttribute('data-click-id')) return true;
    if (node.hasAttribute('data-faceplate-tracking-context')) return true;
    if (node.hasAttribute('data-cel-widget')) return true;
    if (node.hasAttribute('data-asin')) return true;
    return false;
  }

  function getInteractiveType(node) {
    const tag = node.tagName;

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

    if (node.getAttribute('contenteditable') === 'true') return 'editable';

    const role = node.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) {
      if (role === 'link') return 'link';
      if (role === 'textbox' || role === 'searchbox') return 'input';
      if (role === 'combobox' || role === 'listbox') return 'select';
      if (role === 'checkbox' || role === 'switch') return 'checkbox';
      if (role === 'radio') return 'radio';
      return 'button';
    }

    if (hasClickHandler(node)) return 'button';

    const tabindex = node.getAttribute('tabindex');
    if (tabindex !== null && tabindex !== '-1') {
      try { if (window.getComputedStyle(node).cursor === 'pointer') return 'button'; } catch {}
    }

    try {
      if (window.getComputedStyle(node).cursor === 'pointer' && node.textContent?.trim()) {
        const r = node.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.width < 400 && r.height < 120) return 'button';
      }
    } catch {}

    const cls = node.className || '';
    if (typeof cls === 'string') {
      if (cls.includes('feed-shared-social-action') || cls.includes('artdeco-button') ||
          cls.includes('social-actions-button') || cls.includes('msg-conversation-card')) return 'button';
      if (cls.includes('voteButton') || cls.includes('_1rZYMD_4xY3gRcSS3p8ODO')) return 'button';
      if (cls.includes('a-button') || cls.includes('s-product-image-container')) return 'button';
    }

    if (tag === 'A' && !node.href && node.id?.startsWith('up_')) return 'button';

    return null;
  }

  function hasInteractiveChild(node) {
    for (const c of node.querySelectorAll(INTERACTIVE_CHILD_SELECTOR))
      if (!isHardHidden(c)) return true;
    return false;
  }

  // ─── Annotate Interactive Element ───

  function annotateInteractive(node, type) {
    elementCounter++;
    const id = elementCounter;
    node.setAttribute('data-ac-id', String(id));
    elementRefs.set(id, node);
    const text = getLabel(node, type);
    const entry = { id, type, tag: node.tagName.toLowerCase(), selector: `[data-ac-id="${id}"]`, text };
    if (node.href) entry.href = node.href;
    if (node.value !== undefined && node.value !== '') entry.value = node.value;
    if (node.placeholder) entry.placeholder = node.placeholder;
    if (node.disabled) entry.disabled = true;
    if (node.checked !== undefined) entry.checked = node.checked;
    if (node.id) entry.domId = node.id;
    if (node.name) entry.name = node.name;
    const ariaLabel = node.getAttribute('aria-label');
    if (ariaLabel) entry.ariaLabel = ariaLabel;
    const testId = node.getAttribute('data-testid');
    if (testId) entry.testId = testId;
    const form = node.closest('form');
    if (form) entry.formName = form.getAttribute('aria-label') || form.getAttribute('name') || form.getAttribute('action') || '';
    elementMap.push(entry);

    const label = text || node.tagName.toLowerCase();
    switch (type) {
      case 'link': {
        let h = '';
        try { const u = new URL(node.href || '', location.origin); h = u.hostname === location.hostname ? u.pathname : u.hostname + u.pathname; } catch {}
        if (isHackerNews() && label === 'reply') {
          const commentRow = node.closest('.athing');
          const user = commentRow?.querySelector('.hnuser')?.textContent;
          if (user) return ` [#${id} link "reply to ${user}"] `;
        }
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
    const labelledBy = node.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean);
      if (parts.length) return parts.join(' ').slice(0, 80);
    }
    if (node.id && ['input', 'checkbox', 'radio', 'select', 'textarea'].includes(type)) {
      const l = document.querySelector(`label[for="${CSS.escape(node.id)}"]`);
      if (l?.textContent?.trim()) return l.textContent.trim().slice(0, 80);
    }
    const parentLabel = node.closest('label');
    if (parentLabel) {
      const labelText = parentLabel.textContent.replace(node.textContent || '', '').trim();
      if (labelText) return labelText.slice(0, 80);
    }
    const testId = node.getAttribute('data-testid');
    if (testId && !node.textContent?.trim()) return testId.replace(/[-_]/g, ' ').slice(0, 80);
    const controlName = node.getAttribute('data-control-name');
    if (controlName && !node.textContent?.trim()) return controlName.replace(/[_-]/g, ' ').slice(0, 80);
    const direct = [];
    for (const c of node.childNodes) if (c.nodeType === Node.TEXT_NODE && c.textContent.trim()) direct.push(c.textContent.trim());
    if (direct.length) return direct.join(' ').slice(0, 80);
    const t = node.innerText?.replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, 80);
    const title = node.getAttribute('title')?.trim();
    if (title) return title.slice(0, 80);
    const childTitle = node.querySelector('[title]');
    if (childTitle) return childTitle.getAttribute('title').trim().slice(0, 80);
    return node.placeholder?.slice(0, 80) || node.name || '';
  }

  function isLayoutTable(table) {
    if (table.querySelector('th')) return false;
    if (table.getAttribute('role') === 'presentation' || table.getAttribute('role') === 'none') return true;
    const rows = table.querySelectorAll(':scope > tbody > tr, :scope > tr');
    if (rows.length === 0) return false;
    let layoutScore = 0;
    for (const row of rows) {
      const cells = row.querySelectorAll(':scope > td');
      if (cells.length <= 2) layoutScore++;
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
      if (s.position === 'absolute' || s.position === 'fixed') {
        const r = node.getBoundingClientRect();
        if (r.right < -100 || r.bottom < -100 || r.left > window.innerWidth + 100) return true;
      }
      return false;
    } catch { return false; }
  }

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

  // ─── Element Lookup ───

  function findElement(selector) {
    const match = selector.match(/data-ac-id="(\d+)"/);
    if (!match) return null;

    const id = parseInt(match[1], 10);

    const ref = elementRefs.get(id);
    if (ref && ref.isConnected) return ref;

    const byAttr = document.querySelector(`[data-ac-id="${id}"]`);
    if (byAttr) { elementRefs.set(id, byAttr); return byAttr; }

    const byShadow = queryShadow(`[data-ac-id="${id}"]`);
    if (byShadow) { elementRefs.set(id, byShadow); return byShadow; }

    const replacement = findReplacementElement(id);
    if (replacement) {
      replacement.setAttribute('data-ac-id', String(id));
      elementRefs.set(id, replacement);
      return replacement;
    }

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
  }

  function findReplacementElement(id) {
    const entry = elementMap.find(e => e.id === id);
    if (!entry) return null;

    if (entry.domId) {
      const byId = document.getElementById(entry.domId);
      if (byId && !byId.hasAttribute('data-ac-id')) return byId;
    }
    if (entry.name) {
      const byName = document.querySelector(`${entry.tag}[name="${CSS.escape(entry.name)}"]`);
      if (byName && !byName.hasAttribute('data-ac-id')) return byName;
    }
    if (entry.testId) {
      const byTestId = document.querySelector(`[data-testid="${CSS.escape(entry.testId)}"]`);
      if (byTestId && !byTestId.hasAttribute('data-ac-id')) return byTestId;
    }
    if (entry.ariaLabel) {
      const byAria = document.querySelector(`${entry.tag}[aria-label="${CSS.escape(entry.ariaLabel)}"]`);
      if (byAria && !byAria.hasAttribute('data-ac-id')) return byAria;
    }
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

  // ─── Highlight Overlays ───

  const HIGHLIGHT_CSS = `[data-ac-id]{outline:2px solid var(--ac-hl-color,#3b82f6)!important;outline-offset:1px!important}`;
  const LABEL_CSS = `.ac-label{position:absolute;font-family:ui-monospace,monospace;font-size:11px;font-weight:700;line-height:16px;padding:0 5px;border-radius:4px;color:#fff;z-index:2147483646;pointer-events:none;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.5)}`;

  function addHighlights() {
    let style = document.getElementById('ac-highlight-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'ac-highlight-style';
      style.textContent = HIGHLIGHT_CSS + LABEL_CSS;
      document.head.appendChild(style);
    }
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
    const c = document.getElementById('ac-labels'); if (c) c.remove();
    const s = document.getElementById('ac-highlight-style'); if (s) s.remove();
    document.querySelectorAll('[data-ac-id]').forEach(el => {
      el.removeAttribute('data-ac-id');
      el.style.removeProperty('--ac-hl-color');
    });
    document.querySelectorAll('iframe').forEach(iframe => {
      try {
        const iframeDoc = iframe.contentDocument;
        if (!iframeDoc) return;
        const iframeStyle = iframeDoc.getElementById('ac-highlight-style');
        if (iframeStyle) iframeStyle.remove();
        iframeDoc.querySelectorAll('[data-ac-id]').forEach(el => {
          el.removeAttribute('data-ac-id');
          el.style.removeProperty('--ac-hl-color');
        });
      } catch {}
    });
  }

  // ─── DOM Observer (auto-tag new interactive elements) ───

  let observerTimer = null;
  const pendingNodes = new Set();

  function processNewNodes() {
    observerTimer = null;
    if (!elementMap.length) return;

    const labelContainer = document.getElementById('ac-labels');
    const sx = window.scrollX, sy = window.scrollY;
    const vw = window.innerWidth, vh = window.innerHeight;

    for (const node of pendingNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (!node.isConnected) continue;
      if (node.id === 'ac-labels' || node.id === 'ac-highlight-style') continue;

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

  function reattachElement(id) {
    const ref = elementRefs.get(id);
    if (ref && ref.isConnected) return;
    const existing = document.querySelector(`[data-ac-id="${id}"]`);
    if (existing) { elementRefs.set(id, existing); return; }
    const replacement = findReplacementElement(id);
    if (replacement) {
      replacement.setAttribute('data-ac-id', String(id));
      elementRefs.set(id, replacement);
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') {
        const node = m.target;
        if (node.hasAttribute('data-ac-id')) {
          const id = parseInt(node.getAttribute('data-ac-id'), 10);
          const entry = elementMap.find(e => e.id === id);
          if (entry) {
            if (node.disabled !== undefined) entry.disabled = node.disabled;
            if (node.checked !== undefined) entry.checked = node.checked;
            if (node.value !== undefined) entry.value = node.value;
            if (node.getAttribute('aria-disabled') !== null) entry.disabled = node.getAttribute('aria-disabled') === 'true';
          }
        }
      } else {
        for (const node of m.removedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const removed = node.querySelectorAll ? [node, ...node.querySelectorAll('[data-ac-id]')] : [node];
          for (const oldEl of removed) {
            const aid = oldEl.getAttribute?.('data-ac-id');
            if (!aid) continue;
            const id = parseInt(aid, 10);
            const ref = elementRefs.get(id);
            if (ref && !ref.isConnected) setTimeout(() => reattachElement(id), 100);
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
  });

  if (document.body) {
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['disabled', 'checked', 'value', 'aria-disabled'],
    });
  }

  // ─── Command Execution (DOM-based, no CDP) ───

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function findElementById(elementId) {
    const selector = `[data-ac-id="${elementId}"]`;
    return findElement(selector) || document.querySelector(selector);
  }

  function scrollIntoViewSafe(el) {
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    let rect = el.getBoundingClientRect();
    if (rect.top < 80) {
      window.scrollBy(0, rect.top - 100);
      rect = el.getBoundingClientRect();
    }
    return rect;
  }

  function dispatchMouseEvents(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y };
    el.dispatchEvent(new PointerEvent('pointerover', { ...opts, pointerId: 1, pointerType: 'mouse' }));
    el.dispatchEvent(new PointerEvent('pointerenter', { ...opts, pointerId: 1, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new MouseEvent('mouseenter', opts));
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...opts, button: 0, buttons: 1 }));
    el.focus();
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...opts, button: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...opts, button: 0 }));
  }

  async function typeText(el, text) {
    // Focus and clear
    el.focus();
    if (el.select) el.select();
    else if (el.isContentEditable) {
      const sel = window.getSelection();
      sel.selectAllChildren(el);
    }
    document.execCommand('delete', false);
    await sleep(20);

    // Type character by character with realistic events
    for (const ch of text) {
      const keyCode = ch.charCodeAt(0);
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, code: `Key${ch.toUpperCase()}`, keyCode, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, code: `Key${ch.toUpperCase()}`, keyCode, charCode: keyCode, bubbles: true }));

      if (el.isContentEditable) {
        document.execCommand('insertText', false, ch);
      } else {
        // Use InputEvent for proper React/Vue integration
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
        )?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(el, el.value + ch);
        } else {
          el.value += ch;
        }
        el.dispatchEvent(new InputEvent('input', { data: ch, inputType: 'insertText', bubbles: true }));
      }

      el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, code: `Key${ch.toUpperCase()}`, keyCode, bubbles: true }));
      await sleep(8 + Math.random() * 18);
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function pressKey(key) {
    const el = document.activeElement || document.body;
    const keyCode = {
      'Enter': 13, 'Tab': 9, 'Backspace': 8, 'Delete': 46, 'Escape': 27,
      'ArrowUp': 38, 'ArrowDown': 40, 'ArrowLeft': 37, 'ArrowRight': 39,
      'Home': 36, 'End': 35, 'PageUp': 33, 'PageDown': 34, 'Space': 32,
    }[key] || key.charCodeAt(0);

    el.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, keyCode, bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keypress', { key, code: key, keyCode, charCode: keyCode, bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, keyCode, bubbles: true }));
  }

  // ─── Command Router ───

  async function handleCommand(action, params) {
    switch (action) {
      case 'analyze':
      case 'analyze_page': {
        return analyzePage(params || {});
      }

      case 'navigate': {
        if (!params?.url) return { ok: false, error: 'URL required' };
        window.location.href = params.url;
        return { ok: true, data: { url: params.url } };
      }

      case 'click': {
        if (!params?.element_id) return { ok: false, error: 'element_id required' };
        const el = findElementById(params.element_id);
        if (!el) return { ok: false, error: `Element #${params.element_id} not found` };
        scrollIntoViewSafe(el);
        await sleep(50);
        dispatchMouseEvents(el);
        // For links, also do native click
        if (el.tagName === 'A' && el.href) el.click();
        await sleep(300);
        return { ok: true, data: { clicked: true, url: location.href } };
      }

      case 'double_click': {
        if (!params?.element_id) return { ok: false, error: 'element_id required' };
        const el = findElementById(params.element_id);
        if (!el) return { ok: false, error: `Element #${params.element_id} not found` };
        scrollIntoViewSafe(el);
        await sleep(50);
        dispatchMouseEvents(el);
        const rect = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('dblclick', {
          bubbles: true, cancelable: true, view: window,
          clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2,
          button: 0,
        }));
        await sleep(300);
        return { ok: true, data: { clicked: true, url: location.href } };
      }

      case 'type': {
        if (!params?.element_id || !params?.text) return { ok: false, error: 'element_id and text required' };
        const el = findElementById(params.element_id);
        if (!el) return { ok: false, error: `Element #${params.element_id} not found` };
        scrollIntoViewSafe(el);
        await sleep(50);
        dispatchMouseEvents(el);
        await sleep(20);
        await typeText(el, params.text);
        return { ok: true, data: { typed: true } };
      }

      case 'keyboard_type': {
        if (!params?.text) return { ok: false, error: 'text required' };
        const el = document.activeElement || document.body;
        await typeText(el, params.text);
        return { ok: true, data: { typed: true } };
      }

      case 'press_key':
      case 'press-key': {
        if (!params?.key) return { ok: false, error: 'key required' };
        pressKey(params.key);
        return { ok: true, data: { key: params.key } };
      }

      case 'scroll':
      case 'scroll-down': {
        const amount = params?.amount || params?.pixels || 400;
        const direction = params?.direction || 'down';
        const delta = direction === 'up' ? -Math.abs(amount) : Math.abs(amount);
        window.scrollBy({ top: delta, behavior: 'instant' });
        return { ok: true };
      }

      case 'scroll-up': {
        window.scrollBy({ top: -(params?.amount || 400), behavior: 'instant' });
        return { ok: true };
      }

      case 'mouse_move':
      case 'hover': {
        if (!params?.element_id) return { ok: false, error: 'element_id required' };
        const el = findElementById(params.element_id);
        if (!el) return { ok: false, error: `Element #${params.element_id} not found` };
        scrollIntoViewSafe(el);
        const rect = el.getBoundingClientRect();
        const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
        const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
        el.dispatchEvent(new PointerEvent('pointerover', { ...opts, pointerId: 1, pointerType: 'mouse' }));
        el.dispatchEvent(new PointerEvent('pointerenter', { ...opts, pointerId: 1, pointerType: 'mouse' }));
        el.dispatchEvent(new MouseEvent('mouseover', opts));
        el.dispatchEvent(new MouseEvent('mouseenter', opts));
        return { ok: true, data: { hovered: true } };
      }

      case 'click_coordinates':
      case 'click-coords': {
        if (params?.x == null || params?.y == null) return { ok: false, error: 'x and y required' };
        const el = document.elementFromPoint(params.x, params.y);
        if (el) {
          const opts = { bubbles: true, cancelable: true, view: window, clientX: params.x, clientY: params.y };
          el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse' }));
          el.dispatchEvent(new MouseEvent('mousedown', { ...opts, button: 0, buttons: 1 }));
          el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, pointerType: 'mouse' }));
          el.dispatchEvent(new MouseEvent('mouseup', { ...opts, button: 0 }));
          el.dispatchEvent(new MouseEvent('click', { ...opts, button: 0 }));
        }
        return { ok: true, data: { clicked: true, x: params.x, y: params.y } };
      }

      case 'drag': {
        if (!params?.element_id || params?.target_x == null || params?.target_y == null) {
          return { ok: false, error: 'element_id, target_x, and target_y required' };
        }
        const el = findElementById(params.element_id);
        if (!el) return { ok: false, error: `Element #${params.element_id} not found` };
        scrollIntoViewSafe(el);
        const rect = el.getBoundingClientRect();
        const startX = rect.x + rect.width / 2, startY = rect.y + rect.height / 2;
        const opts = { bubbles: true, cancelable: true, view: window };
        el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: startX, clientY: startY, pointerId: 1, pointerType: 'mouse' }));
        el.dispatchEvent(new MouseEvent('mousedown', { ...opts, clientX: startX, clientY: startY, button: 0, buttons: 1 }));
        // Move steps
        const steps = 10;
        for (let i = 1; i <= steps; i++) {
          const x = startX + (params.target_x - startX) * (i / steps);
          const y = startY + (params.target_y - startY) * (i / steps);
          el.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' }));
          el.dispatchEvent(new MouseEvent('mousemove', { ...opts, clientX: x, clientY: y, buttons: 1 }));
          await sleep(16);
        }
        el.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: params.target_x, clientY: params.target_y, pointerId: 1, pointerType: 'mouse' }));
        el.dispatchEvent(new MouseEvent('mouseup', { ...opts, clientX: params.target_x, clientY: params.target_y, button: 0 }));
        return { ok: true, data: { dragged: true } };
      }

      case 'wait': {
        if (!params?.selector) return { ok: false, error: 'selector required' };
        const maxWait = params?.timeout || 10000;
        const start = Date.now();
        while (Date.now() - start < maxWait) {
          if (document.querySelector(params.selector)) return { ok: true, data: { found: true } };
          await sleep(250);
        }
        return { ok: false, error: 'Timeout' };
      }

      case 'select': {
        if (!params?.element_id || !params?.value) return { ok: false, error: 'element_id and value required' };
        const el = findElementById(params.element_id);
        if (!el || el.tagName !== 'SELECT') return { ok: false, error: 'Select element not found' };
        el.value = params.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, data: { selected: el.value } };
      }

      case 'reload': {
        location.reload();
        return { ok: true };
      }

      default:
        return { ok: false, error: 'Unknown action: ' + action };
    }
  }

  // ─── Message Listener (from service worker) ───

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== 'cmd') return false;

    handleCommand(msg.action, msg.params).then(result => {
      sendResponse(result);
    }).catch(err => {
      sendResponse({ ok: false, error: err.message });
    });

    return true; // async response
  });

})();
