import axe from "axe-core";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

type Theme = "dark" | "light";

async function openActivity(page: Page, scenario: "activity-10k" | "activity-graphical" | "activity-ranking-pages" | "limited-capture" | "memory-fallback", viewport: { width: number; height: number }, theme: Theme): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(`/?scenario=${scenario}&theme=${theme}`);
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await page.getByRole("button", { name: "Open Activity" }).click();
  await expect(page.getByRole("main", { name: "Observed Activity" })).toBeVisible();
}

async function expectNoSeriousAxeViolations(page: Page, testInfo: TestInfo): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, { resultTypes: ["violations"] });
    return result.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => ({ id: violation.id, impact: violation.impact, help: violation.help, nodes: violation.nodes.map((node) => node.html) }));
  });
  await testInfo.attach("axe-violations.json", {
    body: JSON.stringify(violations, null, 2),
    contentType: "application/json"
  });
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function expectNoHorizontalShellOverflow(page: Page): Promise<void> {
  const dimensions = await page.locator(".workbench-react").evaluate((shell) => ({
    shellWidth: shell.clientWidth,
    shellScrollWidth: shell.scrollWidth,
    documentWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth
  }));
  expect(dimensions.shellScrollWidth).toBeLessThanOrEqual(dimensions.shellWidth);
  expect(dimensions.documentScrollWidth).toBeLessThanOrEqual(dimensions.documentWidth);
}

async function attachActivityScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(`${name}.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png"
  });
}

test("Activity 10k remains exact and keyboard-focusable at normal geometry", async ({ page }, testInfo) => {
  await openActivity(page, "activity-10k", { width: 900, height: 700 }, "light");
  const activity = page.getByRole("main", { name: "Observed Activity" });
  await expect(activity).toContainText("9,999 Logical Updates");
  await expect(activity).toContainText("9,999 Update Deliveries");
  const grid = activity.getByRole("grid", { name: "Activity timeline buckets" });
  await expect(grid).toBeVisible();
  await grid.focus();
  await expect(grid).toBeFocused();
  await page.keyboard.press("End");
  await expect(activity.locator("tr[aria-selected='true']")).toHaveCount(1);
  await expectNoHorizontalShellOverflow(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachActivityScreenshot(page, testInfo, "activity-10k-normal-light");
});

test("Activity retains its bounded timeline in narrow and wide themes", async ({ page }, testInfo) => {
  await openActivity(page, "activity-graphical", { width: 563, height: 700 }, "dark");
  const narrowActivity = page.getByRole("main", { name: "Observed Activity" });
  await expect(narrowActivity.getByRole("grid", { name: "Activity timeline buckets" })).toBeVisible();
  await expectNoHorizontalShellOverflow(page);
  await attachActivityScreenshot(page, testInfo, "activity-narrow-dark");

  await openActivity(page, "activity-graphical", { width: 1440, height: 900 }, "light");
  const wideActivity = page.getByRole("main", { name: "Observed Activity" });
  await expect(wideActivity.getByRole("group", { name: "Activity small multiples" })).toBeVisible();
  await expect(wideActivity.getByRole("grid", { name: "Activity timeline buckets" })).toBeVisible();
  await expectNoHorizontalShellOverflow(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachActivityScreenshot(page, testInfo, "activity-wide-light");
});

test("Activity ranking is one keyboard composite with synchronized selection and Evidence drill-down", async ({ page }, testInfo) => {
  await openActivity(page, "activity-graphical", { width: 900, height: 700 }, "dark");
  const activity = page.getByRole("main", { name: "Observed Activity" });
  const ranking = activity.getByRole("region", { name: "Activity ranking" });
  const graph = ranking.getByRole("grid", { name: "Busiest ranking graph" });
  const table = ranking.getByRole("table", { name: /Complete synchronized Server ranking/ });

  await expect(graph).toBeVisible();
  await expect(graph.locator('[role="gridcell"]')).toHaveCount(11);
  await graph.focus();
  await expect(graph).toBeFocused();
  await page.keyboard.press("ArrowRight");

  const selectedBar = graph.locator('[role="gridcell"][aria-selected="true"]');
  await expect(selectedBar).toHaveCount(1);
  const identity = await selectedBar.getAttribute("data-ranking-identity");
  expect(identity).toBeTruthy();
  await expect(table.locator(`tr[data-ranking-identity="${identity}"]`)).toHaveAttribute("aria-selected", "true");
  await expect(activity.getByRole("region", { name: "Activity selection detail" })).toContainText("Filter None");
  await expect(activity.getByRole("region", { name: "Activity selection detail" })).toContainText("interval");

  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Ordered Evidence" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset Filter" })).toBeVisible();
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Activity exposes the Local series in chart, table, selection, and drill-down", async ({ page }, testInfo) => {
  await openActivity(page, "activity-graphical", { width: 900, height: 700 }, "dark");
  const activity = page.getByRole("main", { name: "Observed Activity" });
  await activity.getByRole("checkbox", { name: /Show separate LOCAL activity/ }).check();
  await activity.getByRole("button", { name: "LOCAL LOGICAL UPDATES", exact: true }).click();
  await expect(activity.getByRole("img", { name: /Local Logical Updates/ })).toBeVisible();
  const timeline = activity.getByRole("grid", { name: "Activity timeline buckets" });
  await expect(timeline).toContainText("LOCAL LOGICAL UPDATES");
  await timeline.locator("tbody tr").first().getByRole("button").click();
  await expect(activity.getByRole("region", { name: "Activity selection detail" })).toContainText("LOCAL LOGICAL UPDATES");
  await timeline.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Ordered Evidence" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset Filter" })).toBeVisible();
  await expect(page.getByText(/Filter:.*provenance.*LOCAL/i).first()).toBeVisible();
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Activity snapshot and live series keep phase-specific chart and selection counts", async ({ page }) => {
  await openActivity(page, "activity-graphical", { width: 900, height: 700 }, "light");
  const activity = page.getByRole("main", { name: "Observed Activity" });
  const timeline = activity.getByRole("grid", { name: "Activity timeline buckets" });

  await activity.getByRole("button", { name: "SERVER SNAPSHOT", exact: true }).click();
  await expect(activity.getByRole("img", { name: /Server Snapshot Logical Updates/ })).toBeVisible();
  const firstRow = timeline.locator("tbody tr").first();
  const snapshotCount = await firstRow.locator("td").nth(0).innerText();
  await firstRow.getByRole("button").click();
  const selection = activity.getByRole("region", { name: "Activity selection detail" });
  await expect(selection).toContainText(`${snapshotCount} SERVER SNAPSHOT`);
  await selection.getByRole("button", { name: "Show supporting Evidence" }).click();
  await expect(page.getByText(/Filter:.*phase.*SNAPSHOT/i).first()).toBeVisible();
});

test("Activity keeps connection lanes composite, epochs textual, and contextual facts truthful", async ({ page }) => {
  await openActivity(page, "activity-graphical", { width: 900, height: 700 }, "dark");
  const activity = page.getByRole("main", { name: "Observed Activity" });
  const lanes = activity.getByRole("grid", { name: "Connection activity lanes" });
  await expect(lanes).toHaveAttribute("tabindex", "0");
  await expect(lanes.getByRole("button").first()).toHaveAttribute("tabindex", "-1");

  const context = activity.getByRole("region", { name: "Activity contextual facts" });
  await expect(context).toContainText("Requested max bandwidth");
  await expect(context).toContainText("Real max bandwidth");
  await expect(context).toContainText("Requested max frequency");
  await expect(context).toContainText("Real max frequency");
  await expect(context.locator('[data-contextual-plot="REAL_MAX_BANDWIDTH"]')).toBeVisible();
  await expect(context.locator('[data-contextual-plot="REQUESTED_MAX_BANDWIDTH"]')).toHaveCount(0);

  const epoch = lanes.getByRole("button").first();
  await epoch.click();
  const selection = activity.getByRole("region", { name: "Activity selection detail" });
  await expect(selection).toContainText("client");
  await expect(selection).toContainText("session");
  await expect(selection).toContainText("status");
  await expect(selection).toContainText("timestamps");
  await expect(selection).toContainText("Committed Boundary");
  await expect(selection).toContainText("Observation Coverage");
  await expect(selection).toContainText("no duration");
  await expect(selection.getByRole("button", { name: "Show supporting Evidence" })).toBeVisible();
  await selection.getByRole("button", { name: "Show supporting Evidence" }).click();
  await expect(page.getByRole("region", { name: "Ordered Evidence" })).toBeVisible();
});

test("Activity connection composite Enter drills the focused epoch", async ({ page }) => {
  await openActivity(page, "activity-graphical", { width: 900, height: 700 }, "light");
  const activity = page.getByRole("main", { name: "Observed Activity" });
  const lanes = activity.getByRole("grid", { name: "Connection activity lanes" });
  await lanes.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Ordered Evidence" })).toBeVisible();
});

test("Activity Back restores its composite, selection, and scroll while explicit close restores its trigger", async ({ page }) => {
  await openActivity(page, "activity-graphical", { width: 563, height: 700 }, "dark");
  let activity = page.getByRole("main", { name: "Observed Activity" });
  const ranking = activity.getByRole("grid", { name: "Busiest ranking graph" });
  await ranking.scrollIntoViewIfNeeded();
  await ranking.focus();
  await page.keyboard.press("ArrowRight");
  const selectedIdentity = await ranking.locator('[role="gridcell"][aria-selected="true"]').getAttribute("data-ranking-identity");
  expect(selectedIdentity).toBeTruthy();
  const documentScroll = activity.locator(".workbench-react__activity-scroll");
  const plotScroll = activity.locator(".workbench-react__activity-plot");
  await documentScroll.evaluate((element) => { element.scrollTop = Math.min(120, element.scrollHeight - element.clientHeight); element.dispatchEvent(new Event("scroll")); });
  await plotScroll.evaluate((element) => { element.scrollLeft = Math.min(80, element.scrollWidth - element.clientWidth); element.dispatchEvent(new Event("scroll")); });
  const before = {
    documentTop: await documentScroll.evaluate((element) => element.scrollTop),
    plotLeft: await plotScroll.evaluate((element) => element.scrollLeft)
  };

  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Ordered Evidence" })).toBeVisible();
  const back = page.getByRole("button", { name: "Back investigation" });
  await expect(back).toBeEnabled();
  await back.click();

  activity = page.getByRole("main", { name: "Observed Activity" });
  await expect(activity).toBeVisible();
  const restoredRanking = activity.getByRole("grid", { name: "Busiest ranking graph" });
  await expect(restoredRanking).toBeFocused();
  await expect(restoredRanking.locator(`[data-ranking-identity="${selectedIdentity}"]`)).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => activity.locator(".workbench-react__activity-scroll").evaluate((element) => element.scrollTop)).toBe(before.documentTop);
  await expect.poll(() => activity.locator(".workbench-react__activity-plot").evaluate((element) => element.scrollLeft)).toBe(before.plotLeft);

  await activity.getByRole("button", { name: "Back to Evidence" }).click();
  await expect(page.getByRole("button", { name: "Open Activity" })).toBeFocused();
});

test("Activity keeps compact ranking columns and diagnostics clear of the document", async ({ page }, testInfo) => {
  await openActivity(page, "activity-graphical", { width: 563, height: 700 }, "dark");
  const activity = page.getByRole("main", { name: "Observed Activity" });
  const ranking = activity.getByRole("region", { name: "Activity ranking" });
  const rankingTable = ranking.getByRole("table", { name: /Complete synchronized Server ranking/ });
  const tableViewport = ranking.locator(".workbench-react__activity-ranking-table-scroll");
  const deliveryHeader = rankingTable.getByRole("columnheader", { name: "Update Deliveries" });

  await expect(tableViewport).toBeVisible();
  await expect(tableViewport).toHaveJSProperty("scrollWidth", await tableViewport.evaluate((element) => element.clientWidth));
  await expect(deliveryHeader).toBeVisible();
  const deliveryHeaderBox = await deliveryHeader.boundingBox();
  const tableViewportBox = await tableViewport.boundingBox();
  expect(deliveryHeaderBox).not.toBeNull();
  expect(tableViewportBox).not.toBeNull();
  expect(deliveryHeaderBox!.x + deliveryHeaderBox!.width).toBeLessThanOrEqual(tableViewportBox!.x + tableViewportBox!.width + 1);

  const selection = activity.getByRole("region", { name: "Activity selection detail" });
  await rankingTable.locator("tbody tr").first().getByRole("button").click();
  await selection.scrollIntoViewIfNeeded();
  const selectionBox = await selection.boundingBox();
  const footerBox = await page.getByRole("region", { name: "Workbench diagnostics" }).boundingBox();
  expect(selectionBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(selectionBox!.y + selectionBox!.height).toBeLessThanOrEqual(footerBox!.y + 1);
  await attachActivityScreenshot(page, testInfo, "activity-compact-selection-dark");

  await openActivity(page, "limited-capture", { width: 900, height: 700 }, "dark");
  const limitedActivity = page.getByRole("main", { name: "Observed Activity" });
  const limitedStatus = page.getByRole("region", { name: "Workbench diagnostics" });
  const limitedSelection = limitedActivity.getByRole("region", { name: "Activity selection detail" });
  await limitedSelection.scrollIntoViewIfNeeded();
  const limitedStatusBox = await limitedStatus.boundingBox();
  const limitedSelectionBox = await limitedSelection.boundingBox();
  expect(limitedSelectionBox!.y + limitedSelectionBox!.height).toBeLessThanOrEqual(limitedStatusBox!.y + 1);
  await attachActivityScreenshot(page, testInfo, "activity-limited-selection-dark");

  await openActivity(page, "memory-fallback", { width: 563, height: 700 }, "light");
  const memoryActivity = page.getByRole("main", { name: "Observed Activity" });
  const memoryStatus = page.getByRole("region", { name: "Workbench diagnostics" });
  const memorySelection = memoryActivity.getByRole("region", { name: "Activity selection detail" });
  await memorySelection.scrollIntoViewIfNeeded();
  const memoryStatusBox = await memoryStatus.boundingBox();
  const memorySelectionBox = await memorySelection.boundingBox();
  expect(memorySelectionBox!.y + memorySelectionBox!.height).toBeLessThanOrEqual(memoryStatusBox!.y + 1);
  await attachActivityScreenshot(page, testInfo, "activity-memory-selection-light");
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Activity bounds complete ranking rows with accessible pagination", async ({ page }, testInfo) => {
  await openActivity(page, "activity-ranking-pages", { width: 900, height: 700 }, "dark");
  const activity = page.getByRole("main", { name: "Observed Activity" });
  const ranking = activity.getByRole("region", { name: "Activity ranking" });
  const table = ranking.getByRole("table", { name: /Complete synchronized Server ranking/ });
  const pagination = ranking.getByRole("group", { name: "Ranking table pagination" });

  await expect(table.locator("tbody tr")).toHaveCount(50);
  await expect(table).toContainText(/rows 1–50 of 120/);
  await expect(pagination.getByRole("button", { name: "Previous ranking rows" })).toBeDisabled();
  await expect(pagination.getByRole("button", { name: "Next ranking rows" })).toBeEnabled();
  await pagination.getByRole("button", { name: "Next ranking rows" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(50);
  await expect(table).toContainText(/rows 51–100 of 120/);
  await table.locator("tbody tr").first().getByRole("button").click();
  await expect(activity.getByRole("region", { name: "Activity selection detail" })).toContainText("Subscription activity-ranking-page-subscription-");
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Activity labels limited and memory-fallback states without changing exact boundaries", async ({ page }, testInfo) => {
  await openActivity(page, "limited-capture", { width: 900, height: 700 }, "dark");
  const limited = page.getByRole("main", { name: "Observed Activity" });
  await expect(limited).toContainText("Coverage LIMITED");
  await expect(limited).toContainText("Observation Coverage is limited");
  await expectNoHorizontalShellOverflow(page);
  await attachActivityScreenshot(page, testInfo, "activity-limited-normal-dark");

  await openActivity(page, "memory-fallback", { width: 563, height: 700 }, "light");
  const memory = page.getByRole("main", { name: "Observed Activity" });
  await expect(memory).toContainText("Coverage USEFUL");
  await expect(memory).toContainText("History Interval");
  await expectNoHorizontalShellOverflow(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachActivityScreenshot(page, testInfo, "activity-memory-fallback-narrow-light");
});

test("Activity keeps textual meaning in forced-colors mode", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.emulateMedia({ colorScheme: "dark", forcedColors: "active" });
  await page.goto("/?scenario=activity-graphical&theme=dark");
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await page.getByRole("button", { name: "Open Activity" }).click();
  const activity = page.getByRole("main", { name: "Observed Activity" });
  await expect(activity).toContainText("Observed Server activity");
  await expect(activity).toContainText("Server Logical Updates");
  await expect(activity).toContainText("Update Deliveries");
  await expectNoHorizontalShellOverflow(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachActivityScreenshot(page, testInfo, "activity-forced-colors-dark");
});
