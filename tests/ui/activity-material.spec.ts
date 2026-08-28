import axe from "axe-core";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

type Theme = "dark" | "light";
type ActivityScenario =
  | "activity-10k"
  | "activity-graphical"
  | "activity-ranking-pages"
  | "limited-capture"
  | "memory-fallback";

async function openActivitySummary(
  page: Page,
  scenario: ActivityScenario,
  viewport: { width: number; height: number },
  theme: Theme,
): Promise<Locator> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(`/?scenario=${scenario}&theme=${theme}`);
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await expect(page.getByRole("button", { name: "Open Activity" })).toHaveCount(0);
  await expect(page.getByRole("main", { name: "Observed Activity" })).toHaveCount(0);
  await page.getByRole("region", { name: "Ordered Evidence" }).getByRole("button", {
    name: /^(Focus selected Context|Open selected Context|Open Scope Context)$/,
  }).click();
  const summary = page.locator('details[aria-label="Activity summary"]');
  await expect(summary).toBeVisible();
  await expect(summary.locator("summary")).toHaveText(/^Activity summary — /);
  await summary.locator("summary").click();
  await expect(summary).toHaveAttribute("open", "");
  return summary;
}

async function expectNoSeriousAxeViolations(page: Page, testInfo: TestInfo): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, { resultTypes: ["violations"] });
    return result.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map(({ id, impact, help }) => ({ id, impact, help }));
  });
  await testInfo.attach("axe-violations.json", {
    body: JSON.stringify(violations, null, 2),
    contentType: "application/json",
  });
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function expectNoHorizontalShellOverflow(page: Page): Promise<void> {
  const dimensions = await page.locator(".workbench-react").evaluate((shell) => ({
    shellWidth: shell.clientWidth,
    shellScrollWidth: shell.scrollWidth,
    documentWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.shellScrollWidth).toBeLessThanOrEqual(dimensions.shellWidth);
  expect(dimensions.documentScrollWidth).toBeLessThanOrEqual(dimensions.documentWidth);
}

test("Activity summary exposes exact 10k SERVER and LOCAL counts in existing Context", async ({ page }, testInfo) => {
  const summary = await openActivitySummary(page, "activity-10k", { width: 900, height: 700 }, "light");
  const counts = summary.getByRole("table", { name: "Activity counts" });
  await expect(counts.getByRole("row", { name: /SERVER/ })).toContainText("9,999");
  await expect(counts.getByRole("row", { name: /LOCAL/ })).toContainText("0");
  await expect(summary).toContainText("SERVER Snapshot");
  await expect(summary).toContainText("Live");
  await expectNoHorizontalShellOverflow(page);
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Activity summary keeps one collapsed disclosure at compact and wide geometry", async ({ page }, testInfo) => {
  for (const scene of [
    { viewport: { width: 563, height: 700 }, theme: "dark" as const },
    { viewport: { width: 1440, height: 900 }, theme: "light" as const },
  ]) {
    const summary = await openActivitySummary(page, "activity-graphical", scene.viewport, scene.theme);
    await expect(summary).toHaveAttribute("open", "");
    await expect(summary.getByRole("table", { name: "Activity counts" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Activity" })).toHaveCount(0);
    await expectNoHorizontalShellOverflow(page);
  }
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Activity summary keeps bounded SERVER rankings with native paging", async ({ page }, testInfo) => {
  const summary = await openActivitySummary(page, "activity-ranking-pages", { width: 900, height: 700 }, "dark");
  const ranking = summary.getByRole("region", { name: "Busiest SERVER Subscriptions" });
  const table = ranking.getByRole("table");
  const pages = ranking.getByRole("group", { name: "Activity ranking pages" });

  await expect(table.locator("tbody tr")).toHaveCount(5);
  await expect(pages).toContainText("Rows 1–5 of 120");
  await expect(pages.getByRole("button", { name: "Previous Activity ranking page" })).toBeDisabled();
  await pages.getByRole("button", { name: "Next Activity ranking page" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(5);
  await expect(pages).toContainText("Rows 6–10 of 120");
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Activity ranking narrows existing Evidence through the canonical Filter", async ({ page }) => {
  const summary = await openActivitySummary(page, "activity-graphical", { width: 900, height: 700 }, "dark");
  const ranking = summary.getByRole("region", { name: "Busiest SERVER Subscriptions" });
  const filterRank = ranking.getByRole("button", { name: /^Filter Evidence to / }).first();
  const selected = page.locator('[data-evidence-id][aria-selected="true"]');
  const selectedId = await selected.getAttribute("data-evidence-id");

  await filterRank.click();
  await expect(summary.getByRole("button", { name: "Reset Filter" })).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toHaveText(/Filter:.*subscription/i);
  if (selectedId) {
    await expect(page.getByRole("heading", { name: new RegExp(selectedId) })).toBeVisible();
  }

  await page.getByRole("button", { name: "Back investigation" }).click();
  await expect(summary.getByRole("button", { name: "Reset Filter" })).toHaveCount(0);
  await expect(summary).toHaveAttribute("open", "");
});

test("Activity summary keeps captured bandwidth and frequency facts contextual", async ({ page }) => {
  const summary = await openActivitySummary(page, "activity-graphical", { width: 900, height: 700 }, "dark");
  const facts = summary.getByRole("region", { name: "Captured bandwidth and frequency" });

  await expect(facts).toContainText("Captured distinct values across matching owners; not current settings.");
  await expect(facts).toContainText("Requested max bandwidth");
  await expect(facts).toContainText("Real max bandwidth");
  await expect(facts).toContainText("Requested max frequency");
  await expect(facts).toContainText("Real max frequency");
  await expect(facts).not.toContainText("Session epochs");
});

test("Activity summary keeps limited and memory fallback boundaries textual", async ({ page }, testInfo) => {
  for (const scenario of ["limited-capture", "memory-fallback"] as const) {
    const summary = await openActivitySummary(page, scenario, { width: 900, height: 700 }, "light");
    await expect(summary).toContainText("observation Coverage");
    const counts = summary.getByRole("table", { name: "Activity counts" });
    const server = counts.getByRole("row", { name: /SERVER/ });
    await expect(server).toContainText("Unknown");
    await expect(server).toContainText("5");
    await expect(summary).toContainText("5 SERVER Update Deliveries lack logical update identity.");
    await expectNoHorizontalShellOverflow(page);
  }
  await expectNoSeriousAxeViolations(page, testInfo);
});
