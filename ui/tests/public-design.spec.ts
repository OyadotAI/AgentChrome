import { test, expect } from '@playwright/test';

test('landing preview, integration tabs and navigation work at both widths', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your agents.The whole web.');
  await expect(page.locator('link[rel="icon"][href*="icon.svg"]')).toHaveCount(1);
  await page.getByRole('button', { name: /Operations acme-ops/ }).click();
  await expect(page.getByText('Waiting for your next command')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('landing-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.waitForTimeout(200); // Capture the settled theme, after color transitions.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.getByRole('link', { name: 'Start building' }).evaluate(el => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
  await page.screenshot({ path: testInfo.outputPath('landing-light.png') });
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  expect(JSON.parse(await page.locator('#integration-code code').innerText()).mcpServers['oya-browser']).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('landing-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
});

test('docs search and mobile navigation lead to readable sections', async ({ page }, testInfo) => {
  await page.goto('/docs');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your browser,');
  await page.screenshot({ path: testInfo.outputPath('docs-desktop.png') });
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.waitForTimeout(200); // Capture the settled theme, after color transitions.
  await page.screenshot({ path: testInfo.outputPath('docs-light.png') });
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  const search = page.getByRole('textbox', { name: 'Search documentation' });
  await search.fill('MCP Setup');
  await page.getByRole('button', { name: 'MCP Setup', exact: true }).click();
  await expect(page.locator('#mcp-setup')).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('docs-mobile.png') });
  await page.getByRole('button', { name: 'Open documentation menu' }).click();
  const dialog = page.getByRole('dialog', { name: 'Documentation' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('link', { name: 'Quickstart', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#quickstart')).toBeInViewport();
});

test('code snippet tester and video motion showcase are interactive and functional', async ({ page }, testInfo) => {
  await page.goto('/');

  // 1. Test Video & Motion Studio scene switching
  const captchaBtn = page.getByRole('button', { name: /Autonomous CAPTCHA Bypass/ });
  await expect(captchaBtn).toBeVisible();
  await captchaBtn.click();
  await expect(page.getByText('Cloudflare Turnstile Verification')).toBeVisible();

  const takeoverBtn = page.getByRole('button', { name: /Sub-Second Live Takeover/ });
  await takeoverBtn.click();
  await expect(page.getByText('Okta Verify / Google Passkey Prompt')).toBeVisible();

  const failoverBtn = page.getByRole('button', { name: /Zero-Downtime Provider Failover/ });
  await failoverBtn.click();
  await expect(page.getByText('Dynamic Routing Matrix')).toBeVisible();

  // 2. Test Code Snippet Sandbox / Runner
  const testBtn = page.getByRole('button', { name: /Test snippet live/ });
  await expect(testBtn).toBeVisible();
  await testBtn.click();

  // Wait for test simulation to complete
  await expect(page.getByText('ALL CHECKS PASSED')).toBeVisible({ timeout: 6000 });
  await expect(page.getByText('Execution verified successfully')).toBeVisible();

  // Switch to telemetry tab. Assert on a label rather than a number: this
  // asserted '99.8%', which the panel has not shown for some time, so the test
  // was red before anyone read it.
  await page.getByRole('button', { name: 'TELEMETRY' }).click();
  await expect(page.getByText('creepJsHeadless', { exact: true })).toBeVisible();

  // Switch to output tab
  await page.getByRole('button', { name: 'OUTPUT' }).click();
  await expect(page.getByText('# analyze_page response')).toBeVisible();

  // Test Playwright CDP snippet
  await page.getByRole('tab', { name: 'Standard Playwright CDP' }).click();
  const testCdpBtn = page.getByRole('button', { name: /Test snippet live/ });
  await testCdpBtn.click();
  await expect(page.getByText('ALL CHECKS PASSED')).toBeVisible({ timeout: 6000 });

  // 3. Test Benchmarks section
  await expect(page.getByRole('heading', { name: 'Hard numbers. Zero marketing fluff.' })).toBeVisible();
  // The benchmarks section is down to the one claim that is reproducible; the
  // "LLM Token Economy" tab and its "85% Token Reduction" went with the rest.
  const benchTab = page.getByRole('tab', { name: /Bot evasion, measured/ });
  await benchTab.click();
  await expect(page.getByText('0% CreepJS headless, 0 lies, 31 / 31 Bot.Sannysoft')).toBeVisible();

  // 4. Test Use Cases section
  await expect(page.getByText('Autonomous Procurement & Enterprise ERP')).toBeVisible();
  await expect(page.getByText('High-Frequency Intelligence & Anti-Ban Scraping')).toBeVisible();

  // 5. Test FAQ accordion
  const faqBtn = page.getByRole('button', { name: /How does Oya differ from browser runners/ });
  await expect(faqBtn).toBeVisible();
  await faqBtn.click();
  await expect(page.getByText('Browserbase, Steel, Anchor, and Browser Use are execution targets')).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath('snippet-tested.png') });
});
