/** Shared localStorage transport for desktop and CDP browsers. No page globals. */
class LoginState {
  constructor(origins = {}, onChange = () => {}) {
    this.origins = origins;
    this.onChange = onChange;
    this.visited = new Set();
    this.pages = new Set();
  }

  async attach(send, on) {
    const page = { send, script: null, queue: Promise.resolve() };
    this.pages.add(page);
    const refresh = () => {
      page.queue = page.queue.then(async () => {
        if (page.script) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: page.script });
        const pending = Object.fromEntries(Object.entries(this.origins).filter(([origin]) => !this.visited.has(origin)));
        const source = `(() => { try { const entries = ${JSON.stringify(pending)}[location.origin]; if (entries) for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value); } catch {} })()`;
        const result = await send('Page.addScriptToEvaluateOnNewDocument', { source });
        page.script = result.identifier;
      }).catch(() => { this.pages.delete(page); });
      return page.queue;
    };
    page.refresh = refresh;
    on('Page.frameNavigated', ({ frame }) => {
      if (frame.parentId) return;
      let origin;
      try { origin = new URL(frame.url).origin; } catch { return; }
      if (!/^https?:/.test(origin)) return;
      this.visited.add(origin);
      for (const other of this.pages) other.refresh();
    });
    const capture = async ({ storageId }) => {
      if (!storageId?.isLocalStorage || !/^https?:/.test(storageId.securityOrigin || '')) return;
      try {
        const { entries } = await send('DOMStorage.getDOMStorageItems', { storageId });
        const values = Object.fromEntries(entries);
        this.origins[storageId.securityOrigin] = values;
        this.onChange({ [storageId.securityOrigin]: values });
      } catch { /* A closed tab or navigating document no longer has storage. */ }
    };
    for (const event of ['domStorageItemAdded', 'domStorageItemUpdated', 'domStorageItemRemoved', 'domStorageItemsCleared']) {
      on(`DOMStorage.${event}`, capture);
    }
    await send('Page.enable');
    await send('DOMStorage.enable');
    await refresh();
  }
}

/** Drop Chromium's read-only cookie fields and translate Electron's spelling. */
function cdpCookies(cookies) {
  return cookies.map((c) => ({
    name: c.name, value: c.value, path: c.path || '/', secure: !!c.secure, httpOnly: !!c.httpOnly,
    ...(c.hostOnly || !c.domain.startsWith('.')
      ? { url: `http${c.secure ? 's' : ''}://${c.domain.replace(/^\./, '')}${c.path || '/'}` }
      : { domain: c.domain }),
    ...(Number(c.expirationDate ?? c.expires) > 0 ? { expires: Number(c.expirationDate ?? c.expires) } : {}),
    ...({ strict: { sameSite: 'Strict' }, lax: { sameSite: 'Lax' }, no_restriction: { sameSite: 'None' }, Strict: { sameSite: 'Strict' }, Lax: { sameSite: 'Lax' }, None: { sameSite: 'None' } }[c.sameSite] || {}),
  }));
}
module.exports = { LoginState, cdpCookies };
