import { expect, test, type Page } from "@playwright/test";

import type { WorkbenchScenarioId } from "../support/workbench-scenarios";

type Theme = "dark" | "light";

declare global {
  interface Window {
    __appendDeferredWorkbenchEvents: () => number;
  }
}

async function openActivity(page: Page, scenario: WorkbenchScenarioId, theme: Theme = "light"): Promise<void> {
  await prepareScenario(page, scenario, theme);
  await page.getByRole("button", { name: "Open Activity" }).click();
  await expect(page.getByRole("main", { name: "Observed Activity" })).toBeVisible();
}

async function prepareScenario(page: Page, scenario: WorkbenchScenarioId, theme: Theme = "light"): Promise<void> {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(`/?scenario=${scenario}&theme=${theme}`);
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
}

async function includeItemUpdates(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("button", { name: "Add structured criterion", exact: true }).click();
  await page.getByRole("option", { name: "Add Evidence kind criterion" }).click();
  await page.getByRole("button", { name: /^Include item-update/ }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
}

test("Activity renders empty matching Evidence without an unfiltered fallback", async ({ page }) => {
  await prepareScenario(page, "activity-layers");
  const activity = page.getByRole("main", { name: "Observed Activity" });
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByLabel("Filter Evidence").fill("no-matching-activity-evidence");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.getByRole("button", { name: "Open Activity" }).click();
  await expect(activity).toBeVisible();

  await expect(activity).toContainText("0 Logical Updates");
  await expect(activity).toContainText("No matching accepted Evidence after Filter exclusion.");
  await expect(activity).toContainText("No matching accepted Server Logical Update Evidence.");
  await expect(page.getByRole("region", { name: "Activity Filter exclusions" })).toContainText("Connection transitions excluded by the active Filter");
});

test("Activity exposes active Filter exclusions for connection, loss, and error layers", async ({ page }) => {
  await prepareScenario(page, "activity-layers", "dark");
  await includeItemUpdates(page);
  await page.getByRole("button", { name: "Open Activity" }).click();
  const activity = page.getByRole("main", { name: "Observed Activity" });
  const exclusions = activity.getByRole("region", { name: "Activity Filter exclusions" });
  await expect(exclusions).toContainText("Connection transitions excluded by the active Filter");
  await expect(exclusions).toContainText("Lost updates excluded by the active Filter");
  await expect(exclusions).toContainText("Subscription errors excluded by the active Filter");
  await expect(activity).toContainText("Filter kind: item-update");
  await activity.getByRole("grid", { name: "Activity timeline buckets" }).locator("tbody tr").first().getByRole("button").click();
  await expect(activity.getByRole("region", { name: "Activity selection detail" })).toContainText("Filter kind: item-update");
});

test("Activity reports explicit aggregation failure at its diagnostic boundary", async ({ page }) => {
  await openActivity(page, "activity-aggregation-failure");
  const activity = page.getByRole("main", { name: "Observed Activity" });
  await expect(activity.getByRole("status")).toContainText("Synthetic Activity aggregation failure for browser verification.");
  await expect(activity).toContainText("0 Logical Updates");
  await expect(page.getByRole("region", { name: "Workbench diagnostics" })).toContainText("Activity aggregation unavailable");
});

test("Activity keeps a clock discontinuity as a selectable second segment", async ({ page }) => {
  await openActivity(page, "activity-clock-discontinuity");
  const activity = page.getByRole("main", { name: "Observed Activity" });
  const timeline = activity.getByRole("grid", { name: "Activity timeline buckets" });
  const starts = await timeline.locator("tbody tr button").evaluateAll((buttons) => buttons.map((button) => Number(button.textContent?.split("–", 1)[0])));
  expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(50_000);
  const segmentOneIndex = starts.indexOf(Math.min(...starts));
  expect(segmentOneIndex).toBeGreaterThan(0);
  await timeline.locator("tbody tr").nth(segmentOneIndex).getByRole("button").click();
  await expect(activity.getByRole("region", { name: "Activity selection detail" })).toContainText("segment 1");
});

test("Activity marks a live partial bucket and preserves selection across rebucketing", async ({ page }) => {
  await openActivity(page, "activity-graphical");
  let activity = page.getByRole("main", { name: "Observed Activity" });
  let timeline = activity.getByRole("grid", { name: "Activity timeline buckets" });
  await expect(timeline.locator("tbody tr").filter({ hasText: "LIVE · PARTIAL" })).toHaveCount(1);

  await openActivity(page, "activity-rebucket");
  activity = page.getByRole("main", { name: "Observed Activity" });
  timeline = activity.getByRole("grid", { name: "Activity timeline buckets" });
  await timeline.locator("tbody tr").first().getByRole("button").click();
  await page.evaluate(() => window.__appendDeferredWorkbenchEvents());
  await expect(activity.getByRole("region", { name: "Activity selection detail" })).toContainText("preserved absolute interval overlay after rebucketing");
});

test("Activity presents terminal history as a truthful limited boundary", async ({ page }) => {
  await openActivity(page, "activity-terminal", "dark");
  const activity = page.getByRole("main", { name: "Observed Activity" });
  await expect(activity).toContainText("Coverage LIMITED");
  await expect(activity.getByRole("status")).toContainText("complete through the terminal Committed Evidence Boundary");
  await expect(activity).toContainText("Committed Boundary 4");
});

test("Activity survives a successful Clear with a fresh empty History Interval", async ({ page }) => {
  await openActivity(page, "activity-layers");
  await page.getByRole("button", { name: "Back to Evidence" }).click();
  await page.getByRole("button", { name: "More actions" }).click();
  const operations = page.getByRole("region", { name: "Session operations" });
  await operations.getByRole("button", { name: "Clear retained Evidence…" }).click();
  await operations.getByRole("button", { name: "Clear retained events" }).click();
  await expect(page.getByText("No Evidence in the current Scope.", { exact: true })).toBeVisible();
});

test("Activity remains textually meaningful and scroll-reachable at shallow forced-colors geometry", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 320 });
  await page.emulateMedia({ colorScheme: "dark", forcedColors: "active" });
  await page.goto("/?scenario=activity-graphical&theme=dark");
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await page.getByRole("button", { name: "Open Activity" }).click();
  const activity = page.getByRole("main", { name: "Observed Activity" });
  await expect(activity).toBeVisible();
  await expect(activity).toContainText("SERVER");
  await expect(activity.getByRole("button", { name: "SERVER LOGICAL UPDATES", exact: true })).toBeVisible();
  await activity.getByRole("checkbox", { name: /Show separate LOCAL activity/ }).check();
  await expect(activity).toContainText("LOCAL");
  await expect(activity.getByRole("button", { name: "LOCAL LOGICAL UPDATES", exact: true })).toBeVisible();

  const documentScroll = activity.locator(".workbench-react__activity-scroll");
  await expect.poll(() => documentScroll.evaluate((element) => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }))).toMatchObject({ scrollHeight: expect.any(Number), clientHeight: expect.any(Number) });
  const scrollMetrics = await documentScroll.evaluate((element) => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
  await activity.getByRole("region", { name: "Activity selection detail" }).scrollIntoViewIfNeeded();
  await expect(activity.getByRole("region", { name: "Activity selection detail" })).toBeInViewport();
});

test("Activity keeps bounded connection lanes, contextual facts, and keyboard drilldown truthful", async ({ page }) => {
  await openActivity(page, "activity-connection-lanes", "dark");
  const activity = page.getByRole("main", { name: "Observed Activity" });
  const lanes = activity.getByRole("grid", { name: "Connection activity lanes" });

  await expect(lanes.getByRole("row")).toHaveCount(5);
  await expect(activity).toContainText("Other clients");

  const context = activity.getByRole("region", { name: "Activity contextual facts" });
  await expect(context).toContainText("Requested max bandwidth");
  await expect(context).toContainText("Real max bandwidth");
  await expect(context).toContainText("Requested max frequency");
  await expect(context).toContainText("Real max frequency");
  await expect(context.locator('[data-contextual-plot="REAL_MAX_BANDWIDTH"]')).toBeVisible();
  await expect(context.locator('[data-contextual-plot="REAL_MAX_FREQUENCY"]')).toBeVisible();
  await expect(context.locator('[data-contextual-plot="REQUESTED_MAX_BANDWIDTH"]')).toHaveCount(0);
  await expect(context.locator('[data-contextual-plot="REQUESTED_MAX_FREQUENCY"]')).toHaveCount(0);

  await lanes.focus();
  await expect(lanes).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(lanes.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(1);
  await expect(lanes.locator('button[data-focused="true"]')).toHaveCount(1);
  await page.keyboard.press("Enter");

  await expect(page.getByRole("region", { name: "Ordered Evidence" })).toBeVisible();
  await expect(page.getByText(/Filter: /).first()).toBeVisible();
});
