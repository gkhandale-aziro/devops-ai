/**
 * dashboard.spec.ts — visual regression for the Dashboard page.
 *
 * All API calls are mocked via `mockApi()`. We auto-select the first
 * target (the app does this in App.tsx) and then click into each tab
 * under test, taking a screenshot of the main content area.
 *
 * To refresh baselines after an intentional visual change:
 *   npx playwright test --update-snapshots
 */
import { test, expect } from "@playwright/test";
import { mockApi } from "./fixtures";

// Mask the "Refreshed Xm ago" chip — it's time-dependent and would
// otherwise flake across runs.
const DYNAMIC_MASKS = [/Refreshed /i];

async function openTab(page: import("@playwright/test").Page, label: string) {
  await page.getByRole("tab", { name: label }).click();
  // Give the tab a tick to render its fetch result. The network is mocked,
  // so this is immediate — we just wait for the skeleton to go away.
  await page.waitForTimeout(100);
}

test.describe("Dashboard — no target", () => {
  test("shows onboarding empty state", async ({ page }) => {
    await mockApi(page, null);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Connect your first target/i })).toBeVisible();
    await expect(page).toHaveScreenshot("empty-state.png");
  });
});

test.describe("Dashboard — kubernetes target", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, "kubernetes");
    await page.goto("/dashboard");
    // App auto-selects first target and defaults to first tab (workloads).
    await expect(page.getByText("prod-cluster").first()).toBeVisible();
  });

  test("workloads tab", async ({ page }) => {
    await openTab(page, "Workloads");
    await expect(page.getByText("Total Workloads")).toBeVisible();
    await expect(page).toHaveScreenshot("k8s-workloads.png", { mask: DYNAMIC_MASKS.map(r => page.getByText(r)) });
  });

  test("pods tab", async ({ page }) => {
    await openTab(page, "Pods");
    await expect(page.getByText("web-1").first()).toBeVisible();
    await expect(page).toHaveScreenshot("k8s-pods.png", { mask: DYNAMIC_MASKS.map(r => page.getByText(r)) });
  });

  test("events tab", async ({ page }) => {
    await openTab(page, "Events");
    await expect(page.getByText(/Events/).first()).toBeVisible();
    await expect(page).toHaveScreenshot("k8s-events.png", { mask: DYNAMIC_MASKS.map(r => page.getByText(r)) });
  });

  test("services tab", async ({ page }) => {
    await openTab(page, "Services");
    await expect(page.getByText("LoadBalancer").first()).toBeVisible();
    await expect(page).toHaveScreenshot("k8s-services.png", { mask: DYNAMIC_MASKS.map(r => page.getByText(r)) });
  });

  test("ingress tab", async ({ page }) => {
    await openTab(page, "Ingress");
    await expect(page.getByText("web-ing").first()).toBeVisible();
    await expect(page).toHaveScreenshot("k8s-ingress.png", { mask: DYNAMIC_MASKS.map(r => page.getByText(r)) });
  });

  test("storage tab", async ({ page }) => {
    await openTab(page, "Storage");
    await expect(page.getByText("Persistent Volume Claims").first()).toBeVisible();
    await expect(page).toHaveScreenshot("k8s-storage.png", { mask: DYNAMIC_MASKS.map(r => page.getByText(r)) });
  });

  test("network tab", async ({ page }) => {
    await openTab(page, "Network");
    await expect(page.getByText("Services").first()).toBeVisible();
    await expect(page).toHaveScreenshot("k8s-network.png", { mask: DYNAMIC_MASKS.map(r => page.getByText(r)) });
  });
});

test.describe("Dashboard — ssh target", () => {
  test("overview tab renders metric ring cards", async ({ page }) => {
    await mockApi(page, "ssh");
    await page.goto("/dashboard");
    await expect(page.getByText("web-01").first()).toBeVisible();
    await openTab(page, "Overview");
    await expect(page.getByText("CPU Usage")).toBeVisible();
    await expect(page).toHaveScreenshot("ssh-overview.png", { mask: DYNAMIC_MASKS.map(r => page.getByText(r)) });
  });
});

test.describe("Dashboard — docker target", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, "docker");
    await page.goto("/dashboard");
    await expect(page.getByText("local-docker").first()).toBeVisible();
  });

  test("containers tab", async ({ page }) => {
    await openTab(page, "Containers");
    await expect(page.getByText(/Containers/).first()).toBeVisible();
    await expect(page).toHaveScreenshot("docker-containers.png", { mask: DYNAMIC_MASKS.map(r => page.getByText(r)) });
  });

  test("volumes tab", async ({ page }) => {
    await openTab(page, "Volumes");
    await expect(page.getByText("data-vol").first()).toBeVisible();
    await expect(page).toHaveScreenshot("docker-volumes.png", { mask: DYNAMIC_MASKS.map(r => page.getByText(r)) });
  });

  test("images tab", async ({ page }) => {
    await openTab(page, "Images");
    await expect(page.getByText("nginx").first()).toBeVisible();
    await expect(page).toHaveScreenshot("docker-images.png", { mask: DYNAMIC_MASKS.map(r => page.getByText(r)) });
  });

  test("stats tab", async ({ page }) => {
    await openTab(page, "Stats");
    await expect(page.getByText("Container Stats").first()).toBeVisible();
    await expect(page).toHaveScreenshot("docker-stats.png", { mask: DYNAMIC_MASKS.map(r => page.getByText(r)) });
  });
});

// ── error state ──────────────────────────────────────────────────────────────

test.describe("Dashboard — error state", () => {
  test("shows error banner + retry when tab fetch fails", async ({ page }) => {
    // Install a base mock, then override /tab/ to 500.
    await mockApi(page, "kubernetes");
    await page.route("**/api/v1/tab/**", route =>
      route.fulfill({ status: 500, json: { error: "boom" } }),
    );
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: /Retry/i })).toBeVisible();
    await expect(page).toHaveScreenshot("error-state.png", { mask: DYNAMIC_MASKS.map(r => page.getByText(r)) });
  });
});
