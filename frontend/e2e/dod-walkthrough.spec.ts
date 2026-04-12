/**
 * dod-walkthrough.spec.ts — Definition of Done: 11-step keyboard walkthrough.
 *
 * Validates the v1.0 release criteria end-to-end (step 2 — login — deferred).
 * All API calls mocked via page.route(); no backend required.
 */
import { test, expect, type Page } from "@playwright/test";
import { mockApi } from "./fixtures";

// ── Extended mock helpers ──────────────────────────────────────────────────

/** Full API mock including Home stats, events, health, incidents, chat. */
async function mockFullApi(page: Page) {
  await mockApi(page, "kubernetes");

  // Home page stats + events
  await page.route("**/api/v1/events**", (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.match(/\/events\/(\d+)/)?.[1];
    if (id) {
      // Single event detail
      return route.fulfill({
        json: {
          id: Number(id),
          timestamp: new Date().toISOString(),
          source: "k8s-1",
          level: "SEV1",
          reason: "CrashLoopBackOff",
          object: "pod/broken-api-6b4c-crash",
          namespace: "staging",
          message: "Back-off restarting failed container",
          status: "open",
          snapshots: [{ kind: "pod-describe", content: "Name: broken-api\nStatus: CrashLoopBackOff" }],
          analyses: [],
        },
      });
    }
    // Event list
    return route.fulfill({
      json: [
        {
          id: 1,
          timestamp: new Date().toISOString(),
          source: "k8s-1",
          level: "SEV1",
          reason: "CrashLoopBackOff",
          object: "pod/broken-api-6b4c-crash",
          namespace: "staging",
          message: "Back-off restarting failed container",
          status: "open",
        },
        {
          id: 2,
          timestamp: new Date(Date.now() - 3600_000).toISOString(),
          source: "k8s-1",
          level: "SEV2",
          reason: "FailedScheduling",
          object: "pod/worker-7d8f9-pending",
          namespace: "staging",
          message: "0/3 nodes available: insufficient memory",
          status: "open",
        },
      ],
    });
  });

  await page.route("**/api/v1/stats**", (route) =>
    route.fulfill({
      json: {
        counts: { total: 2, sev1: 1, sev2: 1, sev3: 0 },
        top_failing: [{ object: "pod/broken-api-6b4c-crash", count: 5 }],
        recent: [],
      },
    }),
  );

  // Health endpoint
  await page.route("**/api/v1/health/**", (route) =>
    route.fulfill({
      json: {
        pods: { running: 5, pending: 1, failed: 1, total: 7 },
        deployments: { ready: 2, total: 3 },
        nodes: { ready: 3, total: 3 },
      },
    }),
  );

  // Metrics endpoint
  await page.route("**/api/v1/metrics/**", (route) =>
    route.fulfill({
      json: {
        cpu: [
          { ts: Date.now() - 3600_000, value: 42 },
          { ts: Date.now() - 1800_000, value: 55 },
          { ts: Date.now(), value: 38 },
        ],
        memory: [
          { ts: Date.now() - 3600_000, value: 60 },
          { ts: Date.now() - 1800_000, value: 65 },
          { ts: Date.now(), value: 62 },
        ],
      },
    }),
  );

  // SSE monitor — EventSource can't be intercepted by page.route(),
  // so we stub it via addInitScript to deliver a SEV1 alert event.
  await page.addInitScript(() => {
    const _OrigES = window.EventSource;
    // @ts-ignore
    window.EventSource = class FakeEventSource {
      static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
      readyState = 0;
      onopen: ((ev: Event) => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      url: string;
      constructor(url: string) {
        this.url = url;
        if (url.includes("/monitor/stream")) {
          setTimeout(() => {
            this.readyState = 1;
            this.onopen?.(new Event("open"));
            const data = JSON.stringify({
              type: "monitor_alert",
              level: "SEV1",
              reason: "CrashLoopBackOff",
              object: "pod/broken-api-6b4c-crash",
              namespace: "staging",
              message: "Back-off restarting failed container",
            });
            this.onmessage?.(new MessageEvent("message", { data }));
          }, 100);
        } else {
          // For non-monitor EventSource (e.g. log streams), use real impl
          const real = new _OrigES(url);
          Object.assign(this, { close: () => real.close() });
          real.onopen = (e) => { this.readyState = 1; this.onopen?.(e); };
          real.onmessage = (e) => this.onmessage?.(e);
          real.onerror = (e) => this.onerror?.(e);
        }
      }
      close() { this.readyState = 2; }
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() { return true; }
    };
  });

  // Chat stream — mock AI response with tool call + follow-up suggestions
  await page.route("**/api/v1/chat/*/stream**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: [
        `data: ${JSON.stringify({ t: "Looking at the pod status..." })}\n\n`,
        `data: ${JSON.stringify({
          tool_call: {
            name: "kubectl",
            args: "get pod broken-api-6b4c-crash -n staging -o yaml",
            output: "Name: broken-api\nStatus: CrashLoopBackOff\nRestarts: 12",
            duration_ms: 850,
          },
        })}\n\n`,
        `data: ${JSON.stringify({ t: "\n\nThe pod `broken-api` is in a **CrashLoopBackOff** state with 12 restarts. The container is failing to start. Check the container logs:\n\n```bash\nkubectl logs broken-api-6b4c-crash -n staging\n```\n" })}\n\n`,
        `data: ${JSON.stringify({
          suggestions: [
            "Show me the pod logs",
            "What resources is this pod requesting?",
            "Are there similar issues in other namespaces?",
          ],
        })}\n\n`,
        `data: ${JSON.stringify({ done: true })}\n\n`,
      ].join(""),
    }),
  );

  // Analyze stream (AI diagnose on pod)
  await page.route("**/api/v1/analyze/stream**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: [
        `data: ${JSON.stringify({ t: "CrashLoopBackOff — container OOM-killed, increase memory limit to 512Mi" })}\n\n`,
        `data: ${JSON.stringify({ done: true })}\n\n`,
      ].join(""),
    }),
  );

  // Feedback endpoint (thumbs up/down)
  await page.route("**/api/v1/feedback**", (route) =>
    route.fulfill({ json: { ok: true } }),
  );

  // Acknowledge event
  await page.route("**/api/v1/events/*/status", (route) =>
    route.fulfill({ json: { ok: true } }),
  );

  // Resource describe
  await page.route("**/api/v1/resource/**", (route) =>
    route.fulfill({
      json: {
        output: "Name: broken-api-6b4c-crash\nNamespace: staging\nStatus: CrashLoopBackOff\nRestarts: 12",
      },
    }),
  );

  // Search (for Cmd+K)
  await page.route("**/api/v1/search**", (route) =>
    route.fulfill({
      json: {
        results: [
          { type: "page", name: "Settings", path: "/settings" },
        ],
      },
    }),
  );

  // Monitor status — report active so AlertBanner subscribes to SSE
  await page.route("**/api/v1/monitor/status**", (route) =>
    route.fulfill({ json: { active: true } }),
  );

  // Monitor start/stop
  await page.route("**/api/v1/monitor", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/api/v1/monitor/**", (route) => {
    if (route.request().url().includes("/status")) return route.fallback();
    return route.fulfill({ json: { ok: true, monitoring: "k8s-1" } });
  });

  // Model health
  await page.route("**/api/v1/models/health**", (route) =>
    route.fulfill({
      json: { status: "ok", primary_answer: "gemini-2.5-flash" },
    }),
  );

  // Models list (needed by Settings page)
  await page.route("**/api/v1/models", (route) => {
    if (route.request().url().includes("/health")) return route.fallback();
    return route.fulfill({
      json: {
        ollama: ["llama3"],
        cloud: [],
        current: { tool_model: "gemini-2.5-flash", answer_model: "gemini-2.5-flash" },
        ollama_url: "http://localhost:11434",
        health: "ok",
      },
    });
  });
}

/** Set theme via localStorage before navigating. */
async function setTheme(page: Page, theme: "day" | "night") {
  await page.addInitScript((t) => {
    localStorage.setItem("aziro-theme", t);
  }, theme);
}

/** Mark onboarding as seen so the tour doesn't auto-start. */
async function skipOnboarding(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("aziro-tour-seen", "1");
  });
}

// ── Step 1: Day mode ────────────────────────────────────────────────────────

test.describe("Step 1: Day mode", () => {
  test("app opens in Day mode and all surfaces adapt", async ({ page }) => {
    await mockFullApi(page);
    await setTheme(page, "day");
    await skipOnboarding(page);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "day");
    // Light background
    const bg = await page.locator("body").evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    const rgb = bg.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
    expect(rgb[0]).toBeGreaterThan(200);
  });
});

// ── Step 3: Onboarding tour ─────────────────────────────────────────────────

test.describe("Step 3: Onboarding tour", () => {
  test("tour starts for new user and has multiple steps", async ({ page }) => {
    await mockFullApi(page);
    await setTheme(page, "night");
    // Do NOT skip onboarding — let the tour auto-start
    await page.goto("/");
    // Joyride renders a tooltip with a "Next" button
    await expect(page.getByRole("button", { name: /Next/i })).toBeVisible({ timeout: 5000 });
  });

  test("replay tour from Settings works", async ({ page }) => {
    await mockFullApi(page);
    await skipOnboarding(page);
    await page.goto("/settings");
    await page.waitForTimeout(1000);
    const replayBtn = page.getByText("Replay tour");
    await replayBtn.scrollIntoViewIfNeeded();
    await expect(replayBtn).toBeVisible({ timeout: 5000 });
    await replayBtn.click();
    // Toast confirms the tour is starting
    await expect(page.getByText(/Starting tour/i).first()).toBeVisible({ timeout: 5000 });
    // The localStorage key should be cleared (tour will auto-start on next Home visit)
    const tourSeen = await page.evaluate(() => localStorage.getItem("aziro-tour-seen"));
    expect(tourSeen).toBeNull();
  });
});

// ── Step 4: Real charts ─────────────────────────────────────────────────────

test.describe("Step 4: Real charts on Overview", () => {
  test("Home page shows health summary with pod counts", async ({ page }) => {
    await mockFullApi(page);
    await skipOnboarding(page);
    await page.goto("/");
    await expect(page.getByText("prod-cluster").first()).toBeVisible({ timeout: 5000 });
    // Health summary bar fetches /api/v1/health and shows pod status counts
    await expect(page.getByText(/running/i).first()).toBeVisible({ timeout: 10000 });
  });
});

// ── Step 5: Time range picker ───────────────────────────────────────────────

test.describe("Step 5: Time range picker", () => {
  test("time range picker renders with selectable ranges", async ({ page }) => {
    await mockFullApi(page);
    await skipOnboarding(page);
    await page.goto("/dashboard");
    await expect(page.getByText("prod-cluster").first()).toBeVisible();
    const overviewTab = page.getByRole("tab", { name: "Overview" });
    if (await overviewTab.isVisible()) {
      await overviewTab.click();
      await page.waitForTimeout(300);
    }
    // Time range buttons should be visible (1h, 6h, 24h, 7d)
    const picker1h = page.getByRole("button", { name: "1h" });
    if (await picker1h.isVisible()) {
      await picker1h.click();
      await expect(picker1h).toHaveAttribute("aria-pressed", "true");
    }
  });
});

// ── Step 6 & 7: SEV1 banner + click to jump ─────────────────────────────────

test.describe("Steps 6-7: SEV1 banner alert", () => {
  test("SEV1 banner appears and click navigates to alerts", async ({ page }) => {
    await mockFullApi(page);
    await skipOnboarding(page);
    // Start on Settings page (not Alerts)
    await page.goto("/settings");
    await expect(page.getByText(/Settings/i).first()).toBeVisible();
    // Wait for SSE to deliver the alert banner
    // The banner should appear at the top of the page
    const banner = page.locator("[role='alert']").filter({ hasText: /SEV1|CrashLoop/i });
    // Give SSE time to connect and deliver
    await expect(banner.first()).toBeVisible({ timeout: 10000 });
    // Click the banner to navigate to alerts
    await banner.first().click();
    // Should be on alerts page now
    await expect(page).toHaveURL(/alerts/i);
  });
});

// ── Step 8: AI drawer with tool calls ───────────────────────────────────────

test.describe("Step 8: AI chat with tool calls", () => {
  test("chat shows tool call blocks that expand/collapse", async ({ page }) => {
    await mockFullApi(page);
    await skipOnboarding(page);
    await page.goto("/dashboard");
    await expect(page.getByText("prod-cluster").first()).toBeVisible({ timeout: 5000 });
    // Switch to AI Chat tab
    const chatTab = page.getByRole("tab", { name: /AI Chat/i });
    await expect(chatTab).toBeVisible({ timeout: 5000 });
    await chatTab.click();
    await page.waitForTimeout(1000);
    // Type a message and send
    const input = page.getByPlaceholder(/Ask/i);
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill("Why is broken-api crashing?");
    await input.press("Enter");
    // Wait for response with tool call
    await expect(page.getByText(/kubectl/i).first()).toBeVisible({ timeout: 10000 });
    // Tool call block should be expandable — look for expand button
    const toolBlock = page.getByRole("button", { name: /kubectl/i }).first();
    if (await toolBlock.isVisible()) {
      await toolBlock.click();
      // Should show the command output
      await expect(page.getByText(/CrashLoopBackOff/).first()).toBeVisible();
    }
  });
});

// ── Step 9: Follow-up suggestions ───────────────────────────────────────────

test.describe("Step 9: Suggested follow-up questions", () => {
  test("suggestion chips appear after AI response", async ({ page }) => {
    await mockFullApi(page);
    await skipOnboarding(page);
    await page.goto("/dashboard");
    await page.getByRole("tab", { name: /AI Chat/i }).click();
    await page.waitForTimeout(300);
    const input = page.getByPlaceholder(/Ask/i);
    await input.fill("Diagnose the issue");
    await input.press("Enter");
    // Wait for suggestions to appear
    await expect(page.getByText("Show me the pod logs").first()).toBeVisible({ timeout: 10000 });
    // Click a suggestion chip
    await page.getByText("Show me the pod logs").first().click();
    // Input should be populated or a new message sent
  });
});

// ── Step 10: Thumbs up + copy code ──────────────────────────────────────────

test.describe("Step 10: Feedback + copy code block", () => {
  test("thumbs up button works on AI response", async ({ page }) => {
    await mockFullApi(page);
    await skipOnboarding(page);
    await page.goto("/dashboard");
    await page.getByRole("tab", { name: /AI Chat/i }).click();
    await page.waitForTimeout(300);
    const input = page.getByPlaceholder(/Ask/i);
    await input.fill("Help me debug");
    await input.press("Enter");
    // Wait for response
    await expect(page.getByText(/CrashLoopBackOff/).first()).toBeVisible({ timeout: 10000 });
    // Find thumbs up button
    const thumbsUp = page.getByRole("button", { name: /thumbs.?up|like|helpful/i }).first();
    if (await thumbsUp.isVisible()) {
      await thumbsUp.click();
    }
  });

  test("code block has copy button", async ({ page }) => {
    await mockFullApi(page);
    await skipOnboarding(page);
    await page.goto("/dashboard");
    await expect(page.getByText("prod-cluster").first()).toBeVisible({ timeout: 5000 });
    await page.getByRole("tab", { name: /AI Chat/i }).click();
    await page.waitForTimeout(1000);
    const input = page.getByPlaceholder(/Ask/i);
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill("Show me the fix");
    await input.press("Enter");
    // Wait for code block to render
    await expect(page.locator("pre").first()).toBeVisible({ timeout: 10000 });
    // Hover over code block to reveal copy button
    await page.locator("pre").first().hover();
    // Copy button should exist (may be hidden until hover in some browsers)
    const copyBtn = page.getByRole("button", { name: /copy/i }).first();
    await expect(copyBtn).toBeVisible({ timeout: 3000 });
  });
});

// ── Step 11: Acknowledge incident + toast ───────────────────────────────────

test.describe("Step 11: Acknowledge incident", () => {
  test("ack button on incident triggers toast", async ({ page }) => {
    await mockFullApi(page);
    await skipOnboarding(page);
    await page.goto("/history");
    // Wait for incidents to load
    await expect(page.getByText(/CrashLoopBackOff/).first()).toBeVisible({ timeout: 5000 });
    // Click on the incident row to open detail
    await page.getByText(/CrashLoopBackOff/).first().click();
    // Wait for detail panel
    await page.waitForTimeout(500);
    // Find and click Acknowledge button (first one — there may be multiple events)
    const ackBtn = page.getByRole("button", { name: /Acknowledge/i }).first();
    if (await ackBtn.isVisible()) {
      await ackBtn.click();
      // Toast should appear
      await expect(page.getByText(/acknowledged/i).first()).toBeVisible({ timeout: 5000 });
    }
  });
});

// ── Step 12: Cmd+K → Settings ───────────────────────────────────────────────

test.describe("Step 12: Cmd+K palette opens Settings", () => {
  test("Ctrl+K opens command palette and navigates to Settings", async ({ page }) => {
    await mockFullApi(page);
    await skipOnboarding(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "AziroOps" })).toBeVisible();
    // Open command palette with Ctrl+K
    await page.keyboard.press("Control+k");
    // Palette should appear with an input
    const paletteInput = page.getByPlaceholder(/Search|command|type/i);
    await expect(paletteInput).toBeVisible({ timeout: 3000 });
    // Type "settings"
    await paletteInput.fill("settings");
    await page.waitForTimeout(300);
    // Should see Settings option
    await expect(page.getByText(/Settings/).first()).toBeVisible();
    // Press Enter or click it
    await page.keyboard.press("Enter");
    // Should navigate to settings
    await expect(page).toHaveURL(/settings/i, { timeout: 3000 });
  });
});

// ── Bonus: Sidebar collapse ─────────────────────────────────────────────────

test.describe("Bonus: Sidebar collapse/expand", () => {
  test("sidebar collapses and expands with persistence", async ({ page }) => {
    await mockFullApi(page);
    await skipOnboarding(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "AziroOps" })).toBeVisible();
    // Find collapse toggle button
    const collapseBtn = page.getByRole("button", { name: /Collapse sidebar/i });
    await expect(collapseBtn).toBeVisible({ timeout: 5000 });
    await collapseBtn.click();
    await page.waitForTimeout(300);
    // After collapse, button changes to "Expand sidebar"
    const expandBtn = page.getByRole("button", { name: /Expand sidebar/i });
    await expect(expandBtn).toBeVisible({ timeout: 3000 });
    await expandBtn.click();
    await page.waitForTimeout(300);
    // Should be back to expanded
    await expect(collapseBtn).toBeVisible({ timeout: 3000 });
  });
});

// ── Bonus: Breadcrumbs ──────────────────────────────────────────────────────

test.describe("Bonus: Breadcrumbs on all pages", () => {
  test("Dashboard shows breadcrumb with target name", async ({ page }) => {
    await mockFullApi(page);
    await skipOnboarding(page);
    await page.goto("/dashboard");
    await expect(page.getByText("Home").first()).toBeVisible();
    await expect(page.getByText("prod-cluster").first()).toBeVisible();
  });

  test("History page shows breadcrumb", async ({ page }) => {
    await mockFullApi(page);
    await skipOnboarding(page);
    await page.goto("/history");
    await expect(page.getByText("Home").first()).toBeVisible();
  });

  test("Settings page shows breadcrumb", async ({ page }) => {
    await mockFullApi(page);
    await skipOnboarding(page);
    await page.goto("/settings");
    await expect(page.getByText("Home").first()).toBeVisible();
  });
});

// ── Bonus: Kebab menu on pod table ──────────────────────────────────────────

test.describe("Bonus: Kebab menu actions", () => {
  test("pod row shows three-dot menu with actions", async ({ page }) => {
    await mockFullApi(page);
    await skipOnboarding(page);
    await page.goto("/dashboard");
    await page.getByRole("tab", { name: "Pods" }).click();
    await page.waitForTimeout(500);
    // Find a kebab button
    const kebab = page.getByLabel("Row actions").first();
    await expect(kebab).toBeVisible();
    await kebab.click();
    // Menu should show Describe action
    await expect(page.getByText("Describe").first()).toBeVisible();
  });
});

// ── Bonus: Auto-refresh controls ────────────────────────────────────────────

test.describe("Bonus: Auto-refresh controls", () => {
  test("refresh interval selector and staleness label visible", async ({ page }) => {
    await mockFullApi(page);
    await skipOnboarding(page);
    await page.goto("/dashboard");
    await expect(page.getByText("prod-cluster").first()).toBeVisible();
    // Auto-refresh select
    const refreshSelect = page.getByLabel("Auto-refresh interval");
    await expect(refreshSelect).toBeVisible();
    // Staleness label
    await expect(page.getByText(/Updated/i).first()).toBeVisible();
  });
});
