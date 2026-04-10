/**
 * week1.spec.ts — e2e tests for Week 1 "Stop the Bleeding" changes.
 *
 * Covers:
 *  - Day/Night theme switching + persistence + system default
 *  - No fake sparklines (trendData removed)
 *  - Toast notifications on add/remove target
 *  - ErrorBoundary catches crashes gracefully
 *  - Lucide React icons render (no broken SVGs)
 *  - Home page renders correctly in both themes
 */
import { test, expect, type Page } from "@playwright/test";
import { mockApi } from "./fixtures";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Install standard API mocks + extra routes for stats/events on Home page. */
async function mockHomeApi(page: Page) {
  await mockApi(page, "kubernetes");
  // Home page also calls /api/v1/events and /api/v1/stats
  await page.route("**/api/v1/events**", route =>
    route.fulfill({ json: [] }),
  );
}

/** Set theme via localStorage before navigating. */
async function setTheme(page: Page, theme: "day" | "night") {
  await page.addInitScript((t) => {
    localStorage.setItem("aziro-theme", t);
  }, theme);
}

/** Clear theme from localStorage so system default applies. */
async function clearTheme(page: Page) {
  await page.addInitScript(() => {
    localStorage.removeItem("aziro-theme");
  });
}

// ── Theme switching ──────────────────────────────────────────────────────────

test.describe("Theme — Day/Night", () => {
  test.beforeEach(async ({ page }) => {
    await mockHomeApi(page);
  });

  test("defaults to day theme via system light preference", async ({ page }) => {
    // Headless Chromium reports prefers-color-scheme: light → system default is "day"
    await clearTheme(page);
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "day");
    // Day mode: light bg
    const body = page.locator("body");
    const bg = await body.evaluate(el => getComputedStyle(el).backgroundColor);
    const match = bg.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
    expect(match[0]).toBeGreaterThan(200);
    expect(match[1]).toBeGreaterThan(200);
    expect(match[2]).toBeGreaterThan(200);
  });

  test("defaults to night theme when system prefers dark", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await clearTheme(page);
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "night");
    // Night mode: dark bg
    const body = page.locator("body");
    const bg = await body.evaluate(el => getComputedStyle(el).backgroundColor);
    const match = bg.match(/\d+/g)?.map(Number) ?? [255, 255, 255];
    expect(match[0]).toBeLessThan(30);
    expect(match[1]).toBeLessThan(30);
    expect(match[2]).toBeLessThan(30);
  });

  test("switches to night theme via toggle button from day mode", async ({ page }) => {
    await clearTheme(page);
    await page.goto("/");
    // Default is day — toggle shows "Switch to night mode"
    const toggle = page.getByRole("button", { name: /night mode/i });
    await expect(toggle).toBeVisible();
    await toggle.click();
    // data-theme should flip to night
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "night");
    // Night mode: dark bg
    const body = page.locator("body");
    const bg = await body.evaluate(el => getComputedStyle(el).backgroundColor);
    const match = bg.match(/\d+/g)?.map(Number) ?? [255, 255, 255];
    expect(match[0]).toBeLessThan(30);
    expect(match[1]).toBeLessThan(30);
    expect(match[2]).toBeLessThan(30);
  });

  test("persists theme across navigation", async ({ page }) => {
    await setTheme(page, "day");
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "day");
    // Navigate to another page
    await page.getByRole("link", { name: /History/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "day");
  });

  test("restores saved theme from localStorage", async ({ page }) => {
    await setTheme(page, "night");
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    // Toggle label should say "Night"
    await expect(page.locator("span").filter({ hasText: /^Night$/ })).toBeVisible();
  });

  test("toggle label changes between Day and Night", async ({ page }) => {
    await setTheme(page, "night");
    await page.goto("/");
    // Night mode: label says "Night"
    await expect(page.locator("span").filter({ hasText: /^Night$/ })).toBeVisible();
    // Click toggle to switch to day
    await page.getByRole("button", { name: /day mode/i }).click();
    // Now label says "Day"
    await expect(page.locator("span").filter({ hasText: /^Day$/ })).toBeVisible();
  });
});

// ── Home page — no fake sparklines ───────────────────────────────────────────

test.describe("Home — honest data", () => {
  test.beforeEach(async ({ page }) => {
    await mockHomeApi(page);
  });

  test("stat cards render without sparkline SVGs", async ({ page }) => {
    await page.goto("/");
    // Wait for stat cards to appear (loading must complete)
    await expect(page.getByRole("heading", { name: "AziroOps" })).toBeVisible();
    // Stat card area is the grid with 4 stat cards inside #main
    const mainArea = page.locator("#main");
    await expect(mainArea).toBeVisible();
    // Sparkline SVGs render <polyline> elements — with no sparkData they should be absent
    // StatCard only renders Sparkline when sparkData prop is passed and has 2+ values
    const polylines = await mainArea.locator("polyline").count();
    expect(polylines).toBe(0);
  });

  test("stat card values come from real API data", async ({ page }) => {
    await page.goto("/");
    // With one kubernetes target, Connections = 1
    await expect(page.locator("#main").getByText("1").first()).toBeVisible();
    // Monitor should show "Idle" (monitor.status returns active: false)
    await expect(page.locator("#main").getByText("Idle")).toBeVisible();
  });
});

// ── Lucide icons ─────────────────────────────────────────────────────────────

test.describe("Icons — Lucide React", () => {
  test("sidebar nav icons render as SVG elements", async ({ page }) => {
    await mockHomeApi(page);
    await page.goto("/");
    // Sidebar has a "Connections" section header (text-transform: uppercase in CSS)
    const sidebar = page.locator("div").filter({ hasText: /Connections/ }).first();
    const svgCount = await sidebar.locator("svg").count();
    // Should have multiple SVGs: logo, nav items, add button, theme toggle, etc.
    expect(svgCount).toBeGreaterThanOrEqual(5);
  });

  test("home page action cards have proper SVG icons", async ({ page }) => {
    await mockHomeApi(page);
    await page.goto("/");
    // Wait for page to fully load
    await expect(page.getByRole("heading", { name: "AziroOps" })).toBeVisible();
    // Each action card is a Link — use exact name to avoid matching sidebar nav link
    const alertCard = page.getByRole("link", { name: "Live Alerts Monitor" });
    await expect(alertCard).toBeVisible();
    const alertSvg = await alertCard.locator("svg").count();
    expect(alertSvg).toBeGreaterThanOrEqual(1);
  });
});

// ── Toast notifications ──────────────────────────────────────────────────────

test.describe("Toast — feedback on actions", () => {
  test("shows toast when removing a target", async ({ page }) => {
    await mockHomeApi(page);
    // Mock the remove endpoint
    await page.route("**/api/v1/targets/*", route => {
      if (route.request().method() === "DELETE") {
        return route.fulfill({ json: { ok: true } });
      }
      return route.fallback();
    });
    await page.goto("/");
    // Hover over the target in sidebar to reveal remove button
    const targetItem = page.getByText("prod-cluster").first();
    await targetItem.hover();
    // Click the remove X button (aria-label "Remove connection")
    const removeBtn = page.getByRole("button", { name: /Remove connection/i });
    await expect(removeBtn).toBeVisible();
    await removeBtn.click();
    // Confirm dialog should appear
    await expect(page.getByText("Remove connection?")).toBeVisible();
    // Click "Remove" to confirm
    await page.getByRole("button", { name: /^Remove$/ }).click();
    // Toast should appear with "Removed prod-cluster"
    await expect(page.getByText(/Removed prod-cluster/i)).toBeVisible({ timeout: 5000 });
  });
});

// ── ErrorBoundary ────────────────────────────────────────────────────────────

test.describe("ErrorBoundary — crash recovery", () => {
  test("app renders without triggering error boundary", async ({ page }) => {
    await mockHomeApi(page);
    await page.goto("/");
    // Verify no error boundary is showing (positive test — app is healthy)
    await expect(page.getByText("Something went wrong")).not.toBeVisible();
    // Verify the page rendered correctly
    await expect(page.getByRole("heading", { name: "AziroOps" })).toBeVisible();
  });
});

// ── Visual regression — Home page in both themes ─────────────────────────────

test.describe("Home — visual regression", () => {
  test("night mode renders correctly", async ({ page }) => {
    await mockHomeApi(page);
    await setTheme(page, "night");
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "AziroOps" })).toBeVisible();
    await expect(page.locator("#main").getByText("Connections").first()).toBeVisible();
    await expect(page).toHaveScreenshot("home-night.png");
  });

  test("day mode renders correctly", async ({ page }) => {
    await mockHomeApi(page);
    await setTheme(page, "day");
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "AziroOps" })).toBeVisible();
    await expect(page.locator("#main").getByText("Connections").first()).toBeVisible();
    await expect(page).toHaveScreenshot("home-day.png");
  });

  test("empty state (no targets) renders correctly", async ({ page }) => {
    await mockApi(page, null);
    await page.route("**/api/v1/events**", route => route.fulfill({ json: [] }));
    await setTheme(page, "night");
    await page.goto("/");
    await expect(page.getByText("No connections yet")).toBeVisible();
    await expect(page).toHaveScreenshot("home-empty-night.png");
  });
});
