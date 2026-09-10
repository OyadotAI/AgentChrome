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
