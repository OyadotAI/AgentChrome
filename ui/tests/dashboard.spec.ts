import { test, expect, type Page } from '@playwright/test';

async function dashboard(page: Page, cloudReady = false) {
  const commands: Array<{ action: string; params: Record<string, unknown> }> = [];
  const browser = {
    id: 'qa-browser', name: 'QA browser', clientType: 'oya', provider: 'oya-desktop',
    persona: null, personaName: null, health: 'ok', currentUrl: 'https://example.com',
    connectedAt: new Date().toISOString(), lastSeen: new Date().toISOString(),
    commands: 0, errors: 0, pending: 0, streaming: true, activity: [],
  };
  await page.addInitScript(() => {
    localStorage.setItem('oya_api_key', 'isolated-ui-test');
    // A deterministic frame; no real browser session or credentials are used.
    const frame = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600"><rect width="1000" height="600" fill="#eee"/><text x="40" y="60">Test browser</text></svg>');
    class Frames {
      onmessage: ((e: { data: string }) => void) | null = null;
      timer = setInterval(() => this.onmessage?.({ data: frame }), 100);
      close() { clearInterval(this.timer); }
    }
    Object.defineProperty(window, 'EventSource', { value: Frames });
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    let body: unknown = {};
    if (path === '/config') body = {
      onboarded: 'true', desktop_seen_at: 'now', browser_provider: 'oya-cloud',
      effective: {}, providers: [
        { id: 'oya-cloud', label: 'Oya Cloud', configured: cloudReady, needs: [] },
        { id: 'steel', label: 'Steel', configured: true, needs: ['steel_api_key'] },
      ],
    };
    if (path === '/browsers') body = [browser];
    if (path === '/browsers/qa-browser') body = browser;
    if (path === '/personas') body = { personas: [] };
    if (path === '/fleet') body = { browsers: { total: 1, commands: 0, errors: 0, pending: 0, byClient: {}, byProvider: {}, byHealth: { ok: 1 }, byPersona: {} } };
    if (path.endsWith('/command')) {
      commands.push(route.request().postDataJSON());
      await new Promise(resolve => setTimeout(resolve, 250));
      body = { ok: true };
    }
    await route.fulfill({ json: body });
  });
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: /^Start browser/ }).first()).toBeVisible();
  return commands;
}

test('dialog preserves text focus through fleet refreshes and restores its opener', async ({ page }) => {
  await dashboard(page, true);
  const opener = page.getByRole('button', { name: /^Start browser/ }).first();
  await opener.click();
  const name = page.getByLabel('Name (optional)');
  await name.fill('checkout');
  await page.waitForTimeout(3600); // Cross the actual 3-second fleet refresh.
  await expect(name).toBeFocused();
  await page.keyboard.type('-worker');
  await expect(name).toHaveValue('checkout-worker');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('unavailable cloud default is explained before launching and a ready alternative can be selected', async ({ page }) => {
  await dashboard(page);
  await page.getByRole('button', { name: /^Start browser/ }).first().click();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Cloud browsers');
  await page.getByLabel(/Provider/).selectOption('steel');
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
});

test('live view consumes wheel events and preserves small trackpad deltas', async ({ page }) => {
  const commands = await dashboard(page);
  await page.getByText('QA browser', { exact: true }).click();
  const live = page.getByLabel('Live view — click to control, Esc to release the keyboard');
  await expect(live.locator('img')).toBeVisible();
  await expect.poll(() => live.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1000);
  const prevented = await live.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const event = new WheelEvent('wheel', { deltaY: 12, clientX: rect.x + 40, clientY: rect.y + 40, bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect.poll(() => commands.filter(c => c.action === 'scroll').length).toBe(1);
  expect(commands.find(c => c.action === 'scroll')?.params.amount).toBe(12);
});

test('live input completes each command before sending the next', async ({ page }) => {
  const commands = await dashboard(page);
  await page.getByText('QA browser', { exact: true }).click();
  const live = page.getByLabel('Live view — click to control, Esc to release the keyboard');
  await expect.poll(() => live.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1000);
  await live.click({ position: { x: 40, y: 40 } });
  await page.keyboard.type('abc');
  await page.keyboard.press('Enter');
  expect(commands.length).toBeLessThanOrEqual(1);
  await expect.poll(() => commands.length).toBe(3);
  expect(commands.map(c => c.action)).toEqual(['click_coordinates', 'keyboard_type', 'press_key']);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: 'Browser detail' })).toBeVisible();
});

test('dialog controls stay reachable on a short viewport and shortcuts stay inside the dialog', async ({ page }) => {
  await dashboard(page, true);
  await page.setViewportSize({ width: 800, height: 420 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeInViewport();
  const scrolling = dialog.locator('.overflow-y-auto');
  expect(await scrolling.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await scrolling.hover();
  await page.mouse.wheel(0, 250);
  await expect.poll(() => scrolling.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await expect(save).toBeInViewport();
  await dialog.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('n');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
});

test('context-menu keyboard selection survives fleet refresh', async ({ page }) => {
  await dashboard(page, true);
  await page.getByText('QA browser', { exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(3600);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Connect to QA browser' })).toBeVisible();
});
