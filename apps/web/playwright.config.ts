import { defineConfig, devices } from '@playwright/test';

/**
 * Visual-regression harness for CSS refactors. Serves the production build (in
 * standalone/mock mode — no VITE_BACKEND, so the app boots a demo session with
 * deterministic mock data) and screenshots the components a CSS change touches.
 *
 * Workflow:
 *   npm run build --workspace apps/web
 *   npx playwright test --config apps/web/playwright.config.ts --update-snapshots   # baseline (before)
 *   <make CSS changes>
 *   npx playwright test --config apps/web/playwright.config.ts                       # compare (after)
 *
 * Baselines are environment-specific (chromium build), so they are git-ignored
 * and NOT run in CI — this is a local before/after verification tool.
 */
export default defineConfig({
  testDir: './e2e',
  snapshotDir: './e2e/__snapshots__',
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4318',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview --workspace apps/web -- --port 4318 --strictPort',
    url: 'http://localhost:4318',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
