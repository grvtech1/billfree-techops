import { test, expect, type Page } from '@playwright/test';

// Freeze transitions/animations so screenshots are stable.
const FREEZE = '*,*::before,*::after{transition:none!important;animation:none!important}';

async function ready(page: Page) {
  await page.goto('/');
  await page.locator('.app-shell').waitFor({ state: 'visible' });
  await page.locator('.sidebar').waitFor({ state: 'visible' });
  await page.addStyleTag({ content: FREEZE });
}

test('sidebar (covers .sidebar / .nav-item / theme toggle .btn)', async ({ page }) => {
  await ready(page);
  await expect(page.locator('.sidebar')).toHaveScreenshot('sidebar.png', { maxDiffPixels: 60 });
});

test('header (covers .header / .btn create+refresh)', async ({ page }) => {
  await ready(page);
  await expect(page.locator('.header')).toHaveScreenshot('header.png', { maxDiffPixels: 60 });
});

test('kpi grid (covers .kpi-card x5)', async ({ page }) => {
  await ready(page);
  const grid = page.locator('.kpi-grid').first();
  await grid.waitFor({ state: 'visible' });
  await expect(grid).toHaveScreenshot('kpi-grid.png', { maxDiffPixels: 80 });
});

test('agent cards on dashboard (covers .agent-card x4)', async ({ page }) => {
  await ready(page);
  const grid = page.locator('.agent-grid').first();
  await grid.scrollIntoViewIfNeeded();
  await grid.waitFor({ state: 'visible' });
  await expect(grid).toHaveScreenshot('agent-grid.png', { maxDiffPixels: 120 });
});

test('dark-mode sidebar (covers dark token + .sidebar)', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: /dark mode|light mode/i }).click();
  await page.waitForTimeout(200);
  await page.addStyleTag({ content: FREEZE });
  await expect(page.locator('.sidebar')).toHaveScreenshot('sidebar-dark.png', { maxDiffPixels: 80 });
});
