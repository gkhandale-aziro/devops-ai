import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright visual regression config.
 *
 * All API calls are mocked via `page.route()` in the specs — no Flask
 * backend is required. The Vite dev server is started by Playwright itself
 * and reused across tests.
 */
export default defineConfig({
  testDir: "./e2e",
  snapshotDir: "./e2e/__snapshots__",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],

  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1280, height: 800 },
    // Match screenshots exactly; bump to a small threshold if OS font
    // rendering differs.
    launchOptions: { args: ["--font-render-hinting=none"] },
  },

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
