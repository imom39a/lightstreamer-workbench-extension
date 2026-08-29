import { expect, test, type Locator, type Page } from "@playwright/test";

import type { WorkbenchScenarioId } from "../support/workbench-scenarios";

type Theme = "dark" | "light";

async function prepareScenario(
  page: Page,
  scenario: WorkbenchScenarioId,
  theme: Theme = "light",
  viewport = { width: 900, height: 700 },
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(`/?scenario=${scenario}&theme=${theme}`);
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await expect(page.getByRole("button", { name: "Open Activity" })).toHaveCount(0);
  await expect(page.getByRole("main", { name: "Observed Activity" })).toHaveCount(0);
}

async function openSummary(page: Page): Promise<Locator> {
  const evidence = page.getByRole("region", { name: "Ordered Evidence" });
  await evidence.getByRole("button", {
    name: /^(Focus selected Context|Open selected Context|Open Scope Context)$/,
  }).click();
  const summary = page.locator('details[aria-label="Activity summary"]');
  await expect(summary).toBeVisible();
  await expect(summary.locator("summary")).toHaveText(/^Activity summary — /);
  await summary.locator("summary").click();
  await expect(summary).toHaveAttribute("open", "");
  return summary;
}

async function includeItemUpdates(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("button", { name: "Add structured criterion", exact: true }).click();
  await page.getByRole("option", { name: "Add Evidence kind criterion" }).click();
  await page.getByRole("button", { name: /^Include item-update/ }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
}

test("Activity offers scope Context with a collapsed summary when Evidence has no selection", async ({ page }) => {
  await prepareScenario(page, "active-no-selection");
  const evidence = page.getByRole("region", { name: "Ordered Evidence" });
  await evidence.getByRole("button", { name: "Open Scope Context" }).click();

  const summary = page.locator('details[aria-label="Activity summary"]');
  await expect(summary.locator("summary")).toHaveText(/^Activity summary — Inspected page$/);
  await expect(summary).not.toHaveAttribute("open", "");
});

test("Activity summary reports an empty matching Filter without falling back to unfiltered Evidence", async ({ page }) => {
  await prepareScenario(page, "activity-layers");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("textbox", { name: "Filter Evidence" }).fill("no-matching-activity-evidence");
  await page.getByRole("button", { name: "Apply", exact: true }).click();

  const summary = await openSummary(page);
  await expect(summary.getByRole("status")).toContainText("No matching accepted Evidence after Filter exclusion.");
  const counts = summary.getByRole("table", { name: "Activity counts" });
  await expect(counts.getByRole("row", { name: /SERVER/ })).toContainText("0");
  await expect(counts.getByRole("row", { name: /LOCAL/ })).toContainText("0");
});

test("Activity summary keeps Filter exclusions and selected Evidence independent", async ({ page }) => {
  await prepareScenario(page, "activity-layers", "dark");
  await includeItemUpdates(page);
  const summary = await openSummary(page);

  await expect(summary).toContainText("Current Scope and Filter");
  await expect(summary.getByRole("table", { name: "Activity counts" })).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toHaveText(/Filter:.*kind.*item-update/i);
  await expect(summary.getByRole("button", { name: "Reset Filter" })).toBeVisible();
});

test("Activity summary exposes aggregation failure without invented counts", async ({ page }) => {
  await prepareScenario(page, "activity-aggregation-failure");
  const summary = await openSummary(page);

  await expect(summary.getByRole("status")).toContainText("Synthetic Activity aggregation failure for browser verification.");
  await expect(summary.getByRole("table", { name: "Activity counts" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Workbench diagnostics" })).toContainText("Activity aggregation unavailable");
});

test("Activity keeps a clock discontinuity explicit instead of inventing elapsed time", async ({ page }) => {
  await prepareScenario(page, "activity-clock-discontinuity");
  const summary = await openSummary(page);

  await expect(summary.getByRole("table", { name: "Activity counts" })).toBeVisible();
  await expect(
    page.locator('[aria-label="Activity timeline"]').getByRole("status"),
  ).toContainText("Timeline unavailable across a clock change");
});

test("Activity summary remains useful after rolling retention", async ({ page }) => {
  await prepareScenario(page, "activity-rolling-retention", "dark");
  const summary = await openSummary(page);

  await expect(summary).toContainText("USEFUL observation Coverage");
  await expect(summary).toContainText("Committed read point");
  await expect(summary.getByRole("table", { name: "Activity counts" })).toBeVisible();
});

test("Clear starts a fresh empty History Interval without an Activity destination", async ({ page }) => {
  await prepareScenario(page, "activity-layers");
  await openSummary(page);
  await page.getByRole("button", { name: "More actions" }).click();
  const operations = page.getByRole("region", { name: "Session operations" });
  await operations.getByRole("button", { name: "Clear retained Evidence…" }).click();
  await operations.getByRole("button", { name: "Clear retained events" }).click();

  await expect(page.getByText("No Evidence in the current Scope.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Activity" })).toHaveCount(0);
});

test("Activity summary stays readable in shallow forced colors", async ({ page }) => {
  await prepareScenario(page, "activity-graphical", "dark", { width: 900, height: 320 });
  await page.emulateMedia({ colorScheme: "dark", forcedColors: "active" });
  const summary = await openSummary(page);

  await expect(summary).toContainText("SERVER");
  await expect(summary).toContainText("LOCAL");
  await expect(summary.getByRole("table", { name: "Activity counts" })).toBeVisible();
  const dimensions = await page.locator(".workbench-react").evaluate((shell) => ({
    clientWidth: shell.clientWidth,
    scrollWidth: shell.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
