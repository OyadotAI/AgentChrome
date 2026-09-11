import { test, expect, type Page } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

async function dashboard(page: Page, cloudReady = false) {
  let mode = 'agent';
  const commands: Array<{ action: string; params: Record<string, unknown> }> = [];
  const browser = {
    id: 'qa-browser', name: 'QA browser', clientType: 'oya', provider: 'oya-desktop',
    persona: null, personaName: null, health: 'ok', currentUrl: 'https://example.com',
    connectedAt: new Date().toISOString(), lastSeen: new Date().toISOString(),
    commands: 0, errors: 0, pending: 0, streaming: true, activity: [],
  };
  await page.context().addInitScript(() => {
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
  await page.context().route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    let body: unknown = {};
    if (path === '/control') body = { project: { id: 'prj-test', name: 'Test project', settings: { maxConcurrent: 3, budgetUsd: null, recordingDays: 7, auditDays: 90, rates: {}, policy: {} } }, sessions: [{ ...browser, state: 'ready', managed: false, costUsd: 0, control: { mode } }], events: [], credentials: [], webhooks: [], deliveries: [] };
    if (path === '/control/members') body = { owner: null, members: [{ userId: 'member-test', role: 'operator' }] };
    if (path === '/control/sessions/qa-browser') body = { ...browser, state: 'ready', control: { mode } };
    if (path.endsWith('/ticket')) body = { ticket: 'one-use-test', expiresIn: 60 };
    if (path.endsWith('/control') && route.request().method() === 'POST') { mode = ({ acquire: 'human', release: 'paused', resume: 'agent' } as Record<string, string>)[route.request().postDataJSON().action]; body = { mode }; }
    if (path === '/config') body = {
      onboarded: 'true', desktop_seen_at: 'now', browser_provider: 'oya-cloud',
      llm_provider: 'openai', chat_model: 'gpt-4o-mini', openai_api_key: '••••saved',
      effective: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' }, providers: [
        { id: 'oya-cloud', label: 'Oya Cloud', configured: cloudReady, needs: [] },
        { id: 'steel', label: 'Steel', configured: true, needs: ['steel_api_key'] },
      ],
    };
    if (path === '/providers') body = { providers: [{ name: 'cdp', configured: true }, { name: 'steel', configured: true }, { name: 'browseruse', configured: false }] };
    if (path === '/browsers') body = [browser];
    if (path === '/browsers/qa-browser') body = browser;
    if (path === '/personas') body = { personas: [{ id: 'profile-qa', name: 'Research workspace', isDefault: false, createdAt: '2026-09-01T12:00:00Z', lastUsedAt: null, activeBrowsers: 1, maxConcurrent: 3, proxy: null, exit: null, prefs: null, fingerprint: { platform: 'MacIntel', timezone: 'America/Indiana/Indianapolis', screen: '1920 × 1080' }, mfa: { configured: false }, login: { sites: ['example.com', 'shop.example'], cookies: 8, updatedAt: null } }] };
    if (path === '/fleet') body = { at: '2026-09-09T12:00:00Z', uptimeSeconds: 7200, sessions: { total: 0, attached: 0, recording: 0 }, routing: { strategy: 'priority', queueDepth: 0, capacity: 10, active: 1, healthy: 1, providers: [] }, usage: { hour: '2026-09-09T12:00:00Z', commands: 42, command_errors: 0, browser_seconds: 1800, browsers_started: 3 }, limits: { commandsPerMinute: { limit: 100, burst: 20, remaining: 20 } }, quotas: { chatTokensPerHour: 10000 }, browsers: { total: 1, commands: 0, errors: 0, pending: 0, byClient: {}, byProvider: {}, byHealth: { ok: 1 }, byPersona: {} } };
    if (path.endsWith('/command') || path.endsWith('/input')) {
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
  await page.getByRole('button', { name: 'Take control', exact: true }).click();
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
  await page.getByRole('button', { name: 'Take control', exact: true }).click();
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


test('settings discards cancelled drafts and saves a provider with its own credential', async ({ page }) => {
  await dashboard(page, true);
  const open = page.getByRole('button', { name: 'Settings', exact: true });
  await open.click();
  await page.getByLabel('Model', { exact: true }).selectOption('__custom');
  await page.getByLabel('Custom model ID').fill('custom-test');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await open.click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('gpt-4o-mini');
  await page.getByLabel('API key', { exact: true }).fill('fake-openai-draft');
  await page.getByRole('button', { name: /Claude/ }).click();
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('');
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled();
  await page.getByLabel('API key', { exact: true }).fill('fake-claude-test-key');
  await page.getByLabel('Model', { exact: true }).selectOption('claude-haiku-4-5');
  const posted = page.waitForRequest(req => req.url().endsWith('/api/config') && req.method() === 'POST');
  await save.click();
  expect((await posted).postDataJSON()).toMatchObject({ llm_provider: 'anthropic', chat_model: 'claude-haiku-4-5', openai_api_key: 'fake-claude-test-key' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('code snippets have visible syntax colors and safely render masked keys', async ({ page }, testInfo) => {
  await dashboard(page, true);
  await page.getByText('QA browser', { exact: true }).click({ button: 'right' });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Connect to QA browser' });
  await dialog.getByRole('tab', { name: 'TypeScript', exact: true }).click();
  const code = dialog.locator('code.syntax-code');
  await expect(code.locator('.token.keyword').first()).toHaveText('import');
  await expect(code).toContainText('<your-api-key>');
  expect(await code.locator('.token.keyword').first().evaluate(el => getComputedStyle(el).color)).not.toBe(await code.evaluate(el => getComputedStyle(el).color));
  await page.waitForTimeout(250); // Let dialog and theme transitions settle for visual inspection.
  await page.screenshot({ path: testInfo.outputPath('snippets-dark.png') });
  await dialog.getByRole('tab', { name: 'Agents (MCP)', exact: true }).click();
  await expect(code).toHaveAttribute('data-language', 'json');
  expect(JSON.parse(await code.innerText()).mcpServers['qa-browser'].headers.Authorization).toBe('Bearer <your-api-key>');
  await dialog.getByRole('tab', { name: 'curl', exact: true }).click();
  await expect(code).toHaveAttribute('data-language', 'bash');
  await expect(code.locator('.token.string').first()).toBeVisible();
  await page.evaluate(() => document.documentElement.dataset.theme = 'light');
  await page.waitForTimeout(250); // Let dialog and theme transitions settle for visual inspection.
  await page.screenshot({ path: testInfo.outputPath('snippets-light.png') });
});

test('settings fits desktop and mobile with aligned controls', async ({ page }, testInfo) => {
  await dashboard(page, true);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('gpt-4o-mini');
  await page.waitForTimeout(250); // Let dialog and theme transitions settle for visual inspection.
  await page.screenshot({ path: testInfo.outputPath('settings-desktop.png') });
  await page.setViewportSize({ width: 375, height: 812 });
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(dialog.getByRole('tab', { name: 'Verification' })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
  await page.waitForTimeout(250); // Let dialog and theme transitions settle for visual inspection.
  await page.screenshot({ path: testInfo.outputPath('settings-mobile.png') });
  await page.evaluate(() => document.documentElement.dataset.theme = 'light');
  await page.waitForTimeout(250); // Let dialog and theme transitions settle for visual inspection.
  await page.screenshot({ path: testInfo.outputPath('settings-light.png') });
});


test('browser list contains long content and keeps actions reachable', async ({ page }, testInfo) => {
  await dashboard(page, true);
  await page.route('**/api/browsers', route => route.fulfill({ json: [{ id: 'long-browser', name: 'Long workspace '.repeat(25), clientType: 'oya', provider: 'oya-cloud', persona: 'profile-qa', personaName: 'Operations '.repeat(25), health: 'ok', currentUrl: 'https://example.com/' + 'long-path/'.repeat(100), connectedAt: new Date().toISOString(), lastSeen: new Date().toISOString(), commands: 12345, errors: 0, pending: 0, streaming: false }] }));
  await expect(page.getByRole('table', { name: 'Browsers' }).getByRole('button', { name: /^Long workspace/ })).toBeVisible();
  const table = page.getByRole('table', { name: 'Browsers' });
  expect(await table.evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1440);
  const row = table.locator('tbody tr').first();
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(70);
  await page.screenshot({ path: testInfo.outputPath('browsers-desktop.png') });
  await page.getByLabel('Filter browsers').fill('nothing matches this');
  await expect(page.getByText('No browsers match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const scroll = page.locator('.data-scroll');
  await scroll.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await expect(row.getByRole('button', { name: /^Stop / })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('browsers-mobile.png') });
});

test('profiles and control have bounded layouts and explain CDP sessions', async ({ page }, testInfo) => {
  await dashboard(page, true);
  await page.getByRole('button', { name: 'Profiles', exact: true }).click();
  const profiles = page.getByRole('table', { name: 'Profiles' });
  await expect(profiles).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('profiles-desktop.png') });
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByText('Your browsers', { exact: true })).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: testInfo.outputPath('control-desktop.png') });
  await page.getByRole('tab', { name: 'CDP sessions', exact: true }).click();
  await expect(page.getByText(/Individual REST or curl commands do not create a session/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('control-mobile.png') });
  await page.getByRole('button', { name: 'Profiles', exact: true }).click();
  await expect(profiles).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('profiles-mobile.png') });
});

test('adding providers preserves priority zero and clears credentials when switching vendor', async ({ page }, testInfo) => {
  await dashboard(page);
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/gateway/providers', async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { name: submitted?.name } });
  });
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('tab', { name: 'Providers', exact: true }).click();
  await page.getByRole('button', { name: 'Add provider', exact: true }).click();
  const form = page.getByRole('form', { name: 'Add provider' });
  await form.getByLabel('Name', { exact: true }).fill('My browser');
  await form.getByLabel('Type', { exact: true }).selectOption('steel');
  await expect(form.getByLabel('Provider API key')).toHaveAttribute('placeholder', 'Use saved credential');
  await form.getByLabel('Provider API key').fill('steel-draft');
  await form.getByLabel('Type', { exact: true }).selectOption('browseruse');
  await expect(form.getByLabel('Provider API key')).toHaveValue('');
  await expect(form.getByLabel('Provider API key')).toHaveAttribute('required', '');
  await form.getByLabel('Provider API key').fill('browseruse-draft');
  await form.getByLabel('Priority (lower wins)').fill('0');
  await page.screenshot({ path: testInfo.outputPath('provider-form.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await form.getByRole('button', { name: 'Add provider', exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(submitted).toMatchObject({ name: 'My browser', type: 'browseruse', apiKey: 'browseruse-draft', priority: 0, maxConcurrent: 5 });
  await expect(page.getByRole('status')).toContainText('Provider saved');
});

test('provider errors remain visible across refresh and cancel clears the credential draft', async ({ page }) => {
  await dashboard(page);
  await page.route('**/api/gateway/providers', route => route.fulfill({ status: 409, json: { error: 'A provider with this name already exists.' } }));
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('tab', { name: 'Providers', exact: true }).click();
  const add = page.getByRole('button', { name: 'Add provider', exact: true }).first();
  await add.click();
  const form = page.getByRole('form', { name: 'Add provider' });
  await form.getByLabel('Name', { exact: true }).fill('Duplicate');
  await form.getByLabel('Type', { exact: true }).selectOption('steel');
  await form.getByLabel('Provider API key').fill('draft-only');
  await form.getByRole('button', { name: 'Add provider', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible();
  await page.waitForTimeout(4500);
  await expect(page.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible();
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await add.click();
  await expect(form.getByLabel('Provider API key')).toHaveValue('');
});

test('opening a stream in a tab renders live frames and accepts browser input', async ({ page }, testInfo) => {
  const commands = await dashboard(page);
  await page.getByText('QA browser', { exact: true }).click();
  const stream = page.getByRole('link', { name: 'Stream', exact: true });
  await expect(stream).toHaveAttribute('href', '/live/qa-browser');
  const popupPromise = page.waitForEvent('popup');
  await stream.click();
  const viewer = await popupPromise;
  await expect(viewer.getByRole('heading', { name: 'QA browser' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Take control', exact: true }).click();
  const live = viewer.getByLabel('Live view — click to control, Esc to release the keyboard');
  await expect.poll(() => live.locator('img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1000);
  await viewer.screenshot({ path: testInfo.outputPath('live-tab.png') });
  await live.locator('img').click();
  await viewer.keyboard.type('hello');
  await expect.poll(() => commands.some(c => c.action === 'keyboard_type')).toBe(true);
  expect(viewer.url()).not.toContain('key=');
  await viewer.close();
});


test('durable operations renders members, filters sessions, and fits a mobile viewport', async ({ page }, testInfo) => {
  await dashboard(page);
  await page.getByRole('button', { name: 'Control', exact: true }).click();
  await page.getByRole('tab', { name: 'Project operations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Test project' })).toBeVisible();
  await expect(page.getByText('member-test · operator')).toBeVisible();
  await page.getByLabel('Filter sessions by state').selectOption('queued');
  await expect(page.getByText('No sessions match this view.')).toBeVisible();
  await page.getByLabel('Filter sessions by state').selectOption('ready');
  await expect(page.getByRole('button', { name: 'Take control', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('operations-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('operations-mobile.png'), fullPage: true });
});
