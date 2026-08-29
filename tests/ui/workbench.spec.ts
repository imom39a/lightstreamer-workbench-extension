import axe from "axe-core";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { highVolumeEventId, type WorkbenchScenarioId } from "../support/workbench-scenarios";

const browserDiagnostics = new WeakMap<Page, string[]>();

declare global {
  interface Window {
    axe: typeof axe;
    __setWorkbenchStorageMode: (mode: "indexeddb" | "memory") => void;
    __makeWorkbenchFilterStale: () => void;
  }
}

test.beforeEach(async ({ page }) => {
  const diagnostics: string[] = [];
  browserDiagnostics.set(page, diagnostics);
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      diagnostics.push(`[console:${message.type()}] ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`[pageerror] ${error.message}`));
});
test.afterEach(async ({ page }, testInfo) => {
  const diagnostics = browserDiagnostics.get(page) ?? [];
  await testInfo.attach("browser-diagnostics.log", {
    body: diagnostics.join("\n"),
    contentType: "text/plain"
  });
  expect(diagnostics, diagnostics.join("\n")).toEqual([]);
});

async function openScenario(
  page: Page,
  scenario: WorkbenchScenarioId,
  viewport: { width: number; height: number },
  theme: "dark" | "light" | "auto"
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme === "auto" ? "light" : theme });
  await page.goto(`/?scenario=${scenario}&theme=${theme}`);
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await expect(page.locator(".workbench-react")).toBeVisible();
}

async function clearSelectedEvidence(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByLabel("Filter Evidence").fill("no-evidence-matches-this-query");
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByRole("button", { name: "Clear selection" }).click();
  await page.getByRole("button", { name: "Reset Filter" }).click();
}

async function expectShellFits(page: Page): Promise<void> {
  const dimensions = await page.locator(".workbench-react").evaluate((shell) => ({
    shellClientWidth: shell.clientWidth,
    shellScrollWidth: shell.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth
  }));
  expect(dimensions.shellScrollWidth).toBeLessThanOrEqual(dimensions.shellClientWidth);
  expect(dimensions.documentScrollWidth).toBeLessThanOrEqual(dimensions.documentClientWidth);
}

async function expectOperatingStatusFullyVisible(page: Page, statuses: readonly string[]): Promise<void> {
  const operating = page.locator(".workbench-react__operating");
  for (const status of statuses) {
    const item = operating.getByText(status, { exact: true });
    await expect(item).toBeVisible();
    const dimensions = await item.evaluate((element) => {
      const itemRect = element.getBoundingClientRect();
      const operatingRect = element.parentElement!.getBoundingClientRect();
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        left: itemRect.left,
        right: itemRect.right,
        operatingLeft: operatingRect.left,
        operatingRight: operatingRect.right
      };
    });
    expect(dimensions.scrollWidth, `${status} is horizontally clipped`).toBeLessThanOrEqual(dimensions.clientWidth);
    expect(dimensions.left, `${status} starts outside the operating strip`).toBeGreaterThanOrEqual(dimensions.operatingLeft);
    expect(dimensions.right, `${status} ends outside the operating strip`).toBeLessThanOrEqual(dimensions.operatingRight);
  }
  const intersections = await operating.locator(":scope > strong, :scope > span, :scope > .workbench-react__operating-actions")
    .evaluateAll((items) => items.flatMap((item, index) => {
      const first = item.getBoundingClientRect();
      return items.slice(index + 1).flatMap((other) => {
        const second = other.getBoundingClientRect();
        const overlaps = Math.min(first.right, second.right) - Math.max(first.left, second.left) > 0.5
          && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 0.5;
        return overlaps ? [`${item.textContent?.trim()} overlaps ${other.textContent?.trim()}`] : [];
      });
    }));
  expect(intersections).toEqual([]);
}

async function expectShellFitsExactly(page: Page): Promise<void> {
  const dimensions = await page.locator(".workbench-react").evaluate((shell) => {
    const rect = shell.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  });
  expect(dimensions.left).toBe(0);
  expect(dimensions.top).toBe(0);
  expect(dimensions.width).toBe(dimensions.viewportWidth);
  expect(dimensions.height).toBe(dimensions.viewportHeight);
}

async function expectWorkspaceFitsExactly(page: Page): Promise<void> {
  const dimensions = await page.locator(".workbench-react__workspace").evaluate((workspace) => ({
    clientWidth: workspace.clientWidth,
    scrollWidth: workspace.scrollWidth,
    clientHeight: workspace.clientHeight,
    scrollHeight: workspace.scrollHeight
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
  expect(dimensions.scrollHeight).toBe(dimensions.clientHeight);
}

async function attachScenarioScreenshot(page: Page, testInfo: TestInfo): Promise<void> {
  const name = testInfo.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  await testInfo.attach(`current-${name}.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png"
  });
}

async function attachNamedScenarioScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(`${name}.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png"
  });
}

async function expectNoSeriousAxeViolations(page: Page, testInfo: TestInfo): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, { resultTypes: ["violations"] });
    return result.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.map((node) => node.html)
      }));
  });
  await testInfo.attach("axe-violations.json", {
    body: JSON.stringify(violations, null, 2),
    contentType: "application/json"
  });
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

test("Workbench keeps selected Evidence focused without COMMAND projection UI", async ({
  page
}, testInfo) => {
  await openScenario(page, "live-selected", { width: 900, height: 700 }, "dark");

  await expect(page.getByText("Capture RUNNING", { exact: true })).toBeVisible();
  await expect(page.getByText("Coverage USEFUL", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scope", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "COMMAND projection summary" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /COMMAND projections/ })).toHaveCount(0);

  const initialRow = page.locator('[data-evidence-id="scenario-event-3"]');
  const normalRowHeight = await initialRow.evaluate((row) => row.getBoundingClientRect().height);
  expect(normalRowHeight).toBe(52);
  const eventOrder = initialRow.locator('[role="gridcell"]').first();
  await expect(eventOrder.locator("small").first()).toHaveText("Event");
  await expect(eventOrder.locator("strong")).toHaveText("3");
  await expect(eventOrder.locator("strong")).toHaveAttribute("title", "scenario-event-3");
  expect(await eventOrder.locator("strong").evaluate((identity) => identity.scrollWidth <= identity.clientWidth)).toBe(true);
  await expect(initialRow).toHaveAttribute("aria-selected", "true");
  await initialRow.focus();
  await page.keyboard.press("ArrowDown");

  const nextRow = page.locator('[data-evidence-id="scenario-event-4"]');
  await expect(nextRow).toHaveAttribute("aria-selected", "true");
  await expect(nextRow).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "scenario-event-4 · Item Update" })).toBeFocused();
  await expect(page.getByText("scenario-event-4 · Item Update")).toBeVisible();

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench keeps Capture, Coverage, and View explicit across docked geometries", async ({ page }, testInfo) => {
  await openScenario(page, "activity-10k", { width: 563, height: 700 }, "dark");
  await page.evaluate(() => window.__setWorkbenchStorageMode("indexeddb"));
  const shell = page.locator(".workbench-react");
  const operating = page.locator(".workbench-react__operating");
  const historyStatus = operating.locator("[data-history-status]");

  for (const viewport of [
    { width: 563, height: 700, geometry: "compact" },
    { width: 900, height: 320, geometry: "shallow" },
    { width: 900, height: 700, geometry: "normal" },
    { width: 1440, height: 900, geometry: "wide" }
  ] as const) {
    await page.setViewportSize(viewport);
    await expect(shell).toHaveAttribute("data-geometry", viewport.geometry);
    await expectOperatingStatusFullyVisible(page, [
      "Capture RUNNING",
      "Coverage USEFUL",
      "10,000/10,000 Evidence · IndexedDB",
      "View FOLLOW LIVE"
    ]);
    await expect(historyStatus).toHaveAttribute("aria-label", "10,000 retained Evidence of 10,000 accepted");

    for (const name of ["Find", "Filter", "More actions"] as const) {
      const action = operating.getByRole("button", { name, exact: true });
      await action.focus();
      await expect(action).toBeFocused();
      await expect(action).toBeInViewport();
    }
    await expectShellFits(page);
    await attachNamedScenarioScreenshot(page, testInfo, `operating-status-${viewport.geometry}`);
  }
});

test("Workbench promotes distinct COMMAND projections and restores the investigation", async ({ page }, testInfo) => {
  await openScenario(page, "command-projection-matching", { width: 900, height: 700 }, "dark");
  const contextSummary = page.getByRole("region", { name: "COMMAND projection summary" });
  await expect(contextSummary.getByLabel("Observed Server COMMAND State")).toContainText(
    "Captured Server Updates only"
  );
  await expect(contextSummary.getByLabel("Local Effective COMMAND State")).toContainText(
    "Server Updates plus successfully delivered Local Injected Updates"
  );
  await expect(contextSummary).toContainText("Matching projections");
  await expect(contextSummary).toContainText("Neither projection is Authoritative COMMAND State.");
  const compare = page.getByRole("button", { name: "Compare COMMAND projections" });
  await compare.focus();
  await page.keyboard.press("Enter");
  const comparison = page.getByRole("region", { name: "COMMAND projection comparison" });
  await expect(comparison).toBeVisible();
  await expect(comparison.getByRole("heading", { name: "Observed Server COMMAND State" })).toBeVisible();
  await expect(comparison.getByText("Captured Server Updates only", { exact: true })).toBeVisible();
  await expect(comparison.getByRole("heading", { name: "Local Effective COMMAND State" })).toBeVisible();
  await expect(comparison.getByText("Server Updates plus successfully delivered Local Injected Updates", { exact: true })).toBeVisible();
  await expect(comparison.getByText("Why matching?", { exact: true })).toBeVisible();
  const normalColumns = await comparison.locator(".workbench-react__projection-column").evaluateAll((columns) =>
    columns.map((column) => ({ top: column.getBoundingClientRect().top, width: column.getBoundingClientRect().width }))
  );
  expect(normalColumns).toHaveLength(2);
  expect(normalColumns[0]?.top).toBe(normalColumns[1]?.top);
  expect(normalColumns.every(({ width }) => width > 300)).toBe(true);
  await attachNamedScenarioScreenshot(page, testInfo, "command-projection-normal-dark");
  await comparison.getByRole("button", { name: "Back to Evidence" }).click();
  await expect(compare).toBeFocused();
  await expect(contextSummary).toBeVisible();
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench keeps COMMAND projection UI out of selected high-volume Evidence", async ({ page }, testInfo) => {
  await openScenario(page, "frozen-high-volume", { width: 900, height: 700 }, "dark");
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByLabel("Filter Evidence").fill("retained-evidence-event");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator(".workbench-react__active-filter")).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toHaveText("Filter: retained-evidence-event");

  const grid = page.getByRole("grid", { name: "Ordered Lightstreamer Evidence" });
  const focused = page.locator(`[data-evidence-id="${highVolumeEventId(3_970)}"]`);
  await focused.focus();
  await expect(focused).toBeFocused();
  await grid.hover();
  await page.mouse.wheel(0, -240);
  const beforeScrollTop = await grid.evaluate((ledger) => ledger.scrollTop);
  expect(beforeScrollTop).toBeGreaterThan(0);

  await expect.poll(() => grid.evaluate((ledger) => ledger.scrollTop)).toBe(beforeScrollTop);
  await expect(page.locator(".workbench-react__active-filter")).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toHaveText("Filter: retained-evidence-event");
  await expect(focused).toHaveAttribute("aria-selected", "true");
  await expect(focused).toBeFocused();
  await expect(page.getByRole("region", { name: "COMMAND projection summary" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /COMMAND projections/ })).toHaveCount(0);

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Activity summary preserves exact 10,000-record orientation in Context", async ({ page }, testInfo) => {
  await openScenario(page, "activity-10k", { width: 900, height: 700 }, "light");
  await expect(page.getByRole("button", { name: "Open Activity" })).toHaveCount(0);
  await expect(page.getByRole("main", { name: "Observed Activity" })).toHaveCount(0);
  await page.getByRole("region", { name: "Ordered Evidence" }).getByRole("button", {
    name: /^(Focus selected Context|Open selected Context|Open Scope Context)$/,
  }).click();
  const summary = page.locator('details[aria-label="Activity summary"]');
  await expect(summary.locator("summary")).toHaveText(/^Activity summary — /);
  await expect(summary).not.toHaveAttribute("open", "");
  await summary.locator("summary").click();
  const counts = summary.getByRole("table", { name: "Activity counts" });
  await expect(counts.getByRole("row", { name: /SERVER/ })).toContainText("9,999");
  await expect(counts.getByRole("row", { name: /LOCAL/ })).toContainText("0");
  await attachNamedScenarioScreenshot(page, testInfo, "activity-10k-normal-light");
});

test("Activity summary ranking uses native buttons to apply a visible canonical Filter", async ({ page }, testInfo) => {
  await openScenario(page, "activity-graphical", { width: 900, height: 700 }, "dark");
  await page.getByRole("region", { name: "Ordered Evidence" }).getByRole("button", {
    name: /^(Focus selected Context|Open selected Context|Open Scope Context)$/,
  }).click();
  const summary = page.locator('details[aria-label="Activity summary"]');
  await summary.locator("summary").click();
  const ranking = summary.getByRole("region", { name: "Busiest SERVER Subscriptions" });
  const firstRank = ranking.getByRole("button", { name: /^Filter Evidence to / }).first();
  await firstRank.focus();
  await expect(firstRank).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(summary.getByRole("button", { name: "Reset Filter" })).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toHaveText(/Filter:.*subscription/i);
  await expectNoSeriousAxeViolations(page, testInfo);
  await page.setViewportSize({ width: 563, height: 700 });
  await expect(summary).toHaveAttribute("open", "");
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Workbench explains Local-only COMMAND projection differences without changing the observed projection", async ({ page }, testInfo) => {
  await openScenario(page, "command-projection-local-difference", { width: 1440, height: 900 }, "dark");
  const draft = page.getByRole("region", { name: "Local Injection Draft" });
  await expect(draft.getByRole("heading", { name: "DELIVERED LOCALLY" })).toBeVisible();
  await draft.getByRole("button", { name: "Finish Local Injection" }).click();
  const originatingEvidence = page.locator('[data-evidence-id="event-5"]');
  await expect(originatingEvidence).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".workbench-react__evidence-row").filter({ hasText: "LOCAL" })).not.toHaveCount(0);
  await expect(page.getByRole("region", { name: "COMMAND projection summary" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /COMMAND projections/ })).toHaveCount(0);
  await clearSelectedEvidence(page);
  const divergentSummary = page.getByRole("region", { name: "COMMAND projection summary" });
  await expect(divergentSummary).toContainText("Projections differ");
  await expect(divergentSummary).toContainText("successful Local Injected Update");
  await divergentSummary.getByRole("button", { name: "Compare COMMAND projections" }).click();

  const comparison = page.getByRole("region", { name: "COMMAND projection comparison" });
  await expect(comparison.getByText("Why different?", { exact: true })).toBeVisible();
  await expect(comparison).toContainText("Successful Local Injected Updates advance Local Effective COMMAND State only");
  const observed = comparison.getByLabel("Observed Server COMMAND State");
  const localEffective = comparison.getByLabel("Local Effective COMMAND State");
  await expect(observed).not.toContainText("value=9");
  await expect(localEffective).toContainText("command=UPDATE, key=small-alpha, value=9");
  await expect(comparison).toContainText("Neither projection is Authoritative COMMAND State.");
  await attachNamedScenarioScreenshot(page, testInfo, "command-projection-wide-dark-local-difference");
  const supportingLocalEvidence = page.locator(".workbench-react__evidence-row", { hasText: "LOCAL" }).last();
  await comparison.getByRole("button", { name: "Back to Evidence" }).click();
  await expect(originatingEvidence).toHaveAttribute("aria-selected", "false");
  await expect(supportingLocalEvidence).toHaveAttribute("aria-selected", "false");

  await page.getByRole("button", { name: "Compare COMMAND projections" }).click();
  const reopenedComparison = page.getByRole("region", { name: "COMMAND projection comparison" });
  await reopenedComparison.getByRole("button", { name: "Reveal Evidence" }).focus();
  await page.keyboard.press("Enter");
  await expect(supportingLocalEvidence).toHaveAttribute("aria-selected", "true");
  await expect(supportingLocalEvidence).toBeFocused();

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench omits false supporting Evidence routes when Local Evidence retention fails", async ({ page }, testInfo) => {
  await openScenario(page, "command-projection-retention-failure", { width: 1440, height: 900 }, "dark");
  const draft = page.getByRole("region", { name: "Local Injection Draft" });
  await expect(draft.getByRole("heading", { name: "DELIVERED LOCALLY" })).toBeVisible();
  await draft.getByRole("button", { name: "Finish Local Injection" }).click();

  const unrelatedPriorLocal = page.locator(".workbench-react__evidence-row", { hasText: "LOCAL" }).first();
  await expect(unrelatedPriorLocal).toBeVisible();
  await expect(page.getByRole("region", { name: "COMMAND projection summary" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /COMMAND projections/ })).toHaveCount(0);
  await clearSelectedEvidence(page);
  const summary = page.getByRole("region", { name: "COMMAND projection summary" });
  await expect(summary).toContainText("Projections differ");
  await expect(summary.getByRole("button", { name: "Reveal supporting Evidence" })).toHaveCount(0);
  await summary.getByRole("button", { name: "Compare COMMAND projections" }).click();
  const comparison = page.getByRole("region", { name: "COMMAND projection comparison" });
  await expect(comparison.getByText("Why different?", { exact: true })).toBeVisible();
  await expect(comparison.getByRole("button", { name: "Reveal Evidence" })).toHaveCount(0);
  await comparison.getByRole("button", { name: "Back to Evidence" }).click();
  await expect(unrelatedPriorLocal).toHaveAttribute("aria-selected", "false");

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Workbench presents unavailable COMMAND projections truthfully", async ({ page }, testInfo) => {
  await openScenario(page, "command-projection-unavailable", { width: 900, height: 700 }, "light");
  await page.getByRole("button", { name: "Compare COMMAND projections" }).click();
  const comparison = page.getByRole("region", { name: "COMMAND projection comparison" });
  await expect(comparison).toContainText("Capture Coverage UNAVAILABLE");
  await expect(comparison).toContainText("No captured Server Updates are available for this Scope.");
  await expect(comparison.getByText("No reconstructed rows are available for the current Scope.")).toHaveCount(2);
  await expect(comparison).toContainText("Neither projection is Authoritative COMMAND State.");

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench exposes structural Scope as a roving tree at wide geometry", async ({ page }, testInfo) => {
  await openScenario(page, "live-selected", { width: 1440, height: 900 }, "light");

  const scopeDisclosure = page.getByRole("button", { name: "Scope", exact: true });
  await expect(scopeDisclosure).toHaveAttribute("aria-expanded", "true");
  await expect(scopeDisclosure).toHaveAttribute("aria-controls", "workbench-runtime-scope");
  await scopeDisclosure.click();
  await expect(page.locator(":focus")).toHaveRole("treeitem");
  const scopeItems = page.getByRole("treeitem");
  expect(await scopeItems.count()).toBeGreaterThan(1);
  await expect(page.getByLabel("Structural runtime scope")).not.toContainText("0 clients · 0 subscriptions");
  const evidenceRows = page.locator('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]');
  expect(await evidenceRows.count()).toBeGreaterThan(0);
  await expect(scopeItems.first()).toContainText("Active");
  const priorityBlock = await scopeItems.first().evaluate((row) => {
    const type = row.querySelector<HTMLElement>(".workbench-react__scope-type")!;
    const identity = row.querySelector<HTMLElement>(".workbench-react__scope-identity")!;
    const state = row.querySelector<HTMLElement>(".workbench-react__scope-state")!;
    const facts = row.querySelector<HTMLElement>(".workbench-react__scope-facts")!;
    return {
      height: row.getBoundingClientRect().height,
      typeTop: type.getBoundingClientRect().top,
      identityTop: identity.getBoundingClientRect().top,
      stateTop: state.getBoundingClientRect().top,
      factsTop: facts.getBoundingClientRect().top,
      identityTitle: identity.title,
      factsTitle: facts.title
    };
  });
  expect(priorityBlock.height).toBe(58);
  expect(Math.abs(priorityBlock.typeTop - priorityBlock.stateTop)).toBeLessThan(2);
  expect(priorityBlock.identityTop).toBeGreaterThan(priorityBlock.typeTop);
  expect(priorityBlock.factsTop).toBeGreaterThan(priorityBlock.identityTop);
  expect(priorityBlock.identityTitle).toBe("Inspected page");
  expect(priorityBlock.factsTitle).toMatch(/clients? · \d+ subscriptions?/);
  await scopeItems.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(":focus")).toHaveRole("treeitem");
  await page.keyboard.press("Enter");
  await expect(page.locator(":focus")).toHaveAttribute("aria-selected", "true");
  expect(await evidenceRows.count()).toBeGreaterThan(0);

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench keeps populated Scope picker controls above Evidence at normal and shallow geometry", async ({ page }, testInfo) => {
  await openScenario(page, "integrated-activity-main", { width: 900, height: 700 }, "light");
  const scope = page.getByRole("button", { name: "Scope", exact: true });
  await expect(scope).toHaveAttribute("aria-expanded", "false");
  await expect(scope).toHaveAttribute("aria-controls", "workbench-runtime-scope");
  await scope.focus();
  await scope.click();
  await expect(scope).toHaveAttribute("aria-expanded", "true");
  const normalClose = page.getByRole("button", { name: "Close Scope" });
  const normalFirstTreeItem = page.getByRole("tree").getByRole("treeitem").first();
  await expect(normalClose).toBeVisible();
  await expect(normalFirstTreeItem).toBeVisible();
  for (const target of [normalClose, normalFirstTreeItem]) expect(await target.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return hit !== null && element.contains(hit);
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("populated-scope-picker-normal.png") });
  await normalClose.click();
  await expect(scope).toBeFocused();
  await scope.click();
  await expect(page.locator(":focus")).toHaveRole("treeitem");
  await page.keyboard.press("Escape");
  await expect(scope).toHaveAttribute("aria-expanded", "false");
  await expect(scope).toBeFocused();

  await openScenario(page, "integrated-activity-main", { width: 900, height: 320 }, "dark");
  await scope.click();
  await expect(scope).toHaveAttribute("aria-expanded", "true");
  const shallowClose = page.getByRole("button", { name: "Close Scope" });
  const shallowFirstTreeItem = page.getByRole("tree").getByRole("treeitem").first();
  await expect(shallowClose).toBeVisible();
  await expect(shallowFirstTreeItem).toBeVisible();
  for (const target of [shallowClose, shallowFirstTreeItem]) expect(await target.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return hit !== null && element.contains(hit);
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("populated-scope-picker-shallow.png") });
  await shallowClose.click();
  await expect(scope).toBeFocused();
  await scope.click();
  await expect(page.locator(":focus")).toHaveRole("treeitem");
  await page.keyboard.press("Escape");
  await expect(scope).toBeFocused();

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench returns compact Scope commitment to the originating Evidence row", async ({ page }, testInfo) => {
  await openScenario(page, "live-selected", { width: 563, height: 700 }, "dark");
  const row = page.locator('[data-evidence-id="scenario-event-3"]');
  await row.focus();
  await page.getByRole("button", { name: "Scope", exact: true }).click();
  const selectedScope = page.getByRole("treeitem", { selected: true });
  await selectedScope.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Ordered Evidence")).toBeVisible();
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute("aria-selected", "true");

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench exposes selected captured Local Injection through the visible Context route", async ({ page }, testInfo) => {
  for (const [viewport, contextNeedsOpening] of [
    [{ width: 900, height: 700 }, false],
    [{ width: 563, height: 700 }, true]
  ] as const) {
    await openScenario(page, "local-injection-captured", viewport, "dark");
    const selectedEvidence = page.locator('[data-evidence-id="event-5"]');
    await selectedEvidence.click();
    await expect(selectedEvidence).toHaveAttribute("aria-selected", "true");

    if (contextNeedsOpening) {
      await page.getByRole("button", { name: "Open selected Context" }).click();
      await expect(page.getByRole("complementary", { name: "Context" })).toBeVisible();
    }

    const createDraft = page.getByRole("button", { name: "Create Local Injection Draft" });
    await expect(createDraft).toBeVisible();
    await expect(createDraft).toBeEnabled();
    await expect(createDraft).toHaveAccessibleName("Create Local Injection Draft");
    await expect(createDraft).toHaveCSS("border-top-style", "solid");
    await createDraft.focus();
    await expect(createDraft).toBeFocused();
    await createDraft.click();

    const draft = page.getByRole("region", { name: "Local Injection Draft" });
    await expect(draft).toBeVisible();
    await expect(draft).toContainText("topology-small-subscription");
    await expect(draft).toContainText("Session topology-small-session");
    await expect(draft).toContainText("Source event-5 · immutable");
    await expect(draft).toContainText("LOCAL ONLY");
    await expect(page.getByRole("textbox", { name: "Local Injection JSON", exact: true })).toBeFocused();
    await expectShellFits(page);
  }

  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench keeps low-frequency session controls and scoped export deliberate", async ({ page }, testInfo) => {
  await openScenario(page, "live-selected", { width: 900, height: 700 }, "dark");

  const moreActions = page.getByRole("button", { name: "More actions" });
  await expect(moreActions).toHaveAttribute("aria-expanded", "false");
  await expect(moreActions).toHaveAttribute("aria-controls", "workbench-context");
  await moreActions.click();
  const operationsHeading = page.getByRole("heading", { name: "Session operations" });
  const operations = page.getByRole("region", { name: "Session operations" });
  await expect(operationsHeading).toBeFocused();
  await expect(moreActions).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Evidence is retained for this Panel Session.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear retained Evidence…" }).click();
  await expect(page.getByText(/Clear all \d+ retained Evidence events for this Panel Session\?/)).toBeVisible();
  await expect(operations.getByText(/Clear all \d+ retained Evidence events for this Panel Session\. Scope and Filter do not limit this destructive action\./)).toBeVisible();
  await expect(page.getByText("This removes retained Evidence from this Panel Session and cannot be undone.", { exact: true })).toBeVisible();
  const confirmation = operations.locator(".workbench-react__confirmation");
  const contextBody = page.locator(".workbench-react__context-body");
  const clearEvents = confirmation.getByRole("button", { name: "Clear retained events" });
  const keepEvidence = confirmation.getByRole("button", { name: "Keep Evidence" });
  await expect(clearEvents).not.toBeFocused();
  const initialContextScrollTop = await contextBody.evaluate((element) => element.scrollTop);
  await contextBody.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => contextBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(initialContextScrollTop);
  await page.keyboard.press("Tab");
  await expect(clearEvents).toBeFocused();
  const clearFocusStyle = await clearEvents.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset };
  });
  expect(clearFocusStyle).toEqual({ outlineStyle: "solid", outlineWidth: "3px", outlineOffset: "2px" });
  const confirmationViewport = await contextBody.evaluate((owner) => {
    const element = owner.querySelector<HTMLElement>(".workbench-react__confirmation");
    if (!element) throw new Error("Session operations confirmation is missing.");
    const ownerRect = owner.getBoundingClientRect();
    const elements = [element, ...Array.from(element.querySelectorAll("button"))];
    const fullyVisible = elements.every((target) => {
      const rect = target.getBoundingClientRect();
      return rect.top >= ownerRect.top && rect.bottom <= ownerRect.bottom && rect.left >= ownerRect.left && rect.right <= ownerRect.right;
    });
    const focused = document.activeElement;
    const focusedRect = focused instanceof HTMLElement ? focused.getBoundingClientRect() : null;
    const focusedVisible = Boolean(focused instanceof HTMLElement && focusedRect && focusedRect.top >= ownerRect.top && focusedRect.bottom <= ownerRect.bottom && focusedRect.left >= ownerRect.left && focusedRect.right <= ownerRect.right && focused.contains(document.elementFromPoint(focusedRect.left + focusedRect.width / 2, focusedRect.top + focusedRect.height / 2)));
    return {
      fullyVisible,
      focusedVisible,
      horizontalOverflow: owner.scrollWidth > owner.clientWidth,
      scrollTop: owner.scrollTop
    };
  });
  expect(confirmationViewport).toMatchObject({ fullyVisible: true, focusedVisible: true, horizontalOverflow: false });
  await expect(keepEvidence).toBeVisible();
  await page.getByRole("button", { name: "Keep Evidence" }).click();

  await page.getByRole("button", { name: "Export Scope…" }).click();
  await expect(page.getByRole("heading", { name: "Export current Scope" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Redact sensitive categories" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON" }).click();
  await expect((await download).suggestedFilename()).toMatch(/^lightstreamer-topology-.*\.json$/);

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench keeps More actions compact and returns to the exact prior high-volume investigation", async ({ page }, testInfo) => {
  await openScenario(page, "frozen-high-volume", { width: 900, height: 700 }, "light");
  const selectedIdentity = highVolumeEventId(3_970);
  const grid = page.getByRole("grid", { name: "Ordered Lightstreamer Evidence" });
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByLabel("Filter Evidence").fill("retained-evidence-event");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator(".workbench-react__active-filter")).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toHaveText("Filter: retained-evidence-event");
  await grid.hover();
  await page.mouse.wheel(0, 260);
  const beforeScrollTop = await grid.evaluate((element) => element.scrollTop);
  expect(beforeScrollTop).toBeGreaterThan(0);
  const priorHeading = page.getByRole("complementary", { name: "Context" }).getByRole("heading", { name: new RegExp(selectedIdentity) });
  await expect(priorHeading).toBeVisible();

  const more = page.getByRole("button", { name: "More actions" });
  await more.focus();
  await page.keyboard.press("Enter");
  const operations = page.getByRole("region", { name: "Session operations" });
  await expect(operations).toContainText("current Panel Session owns one temporary Event History");
  await expect(page.getByRole("button", { name: "Collapse Context" })).toHaveCount(0);
  await expect(operations).toContainText("4,000 retained");
  await expect(operations).toContainText("4,000 captured");
  await expect(operations).toContainText("60 currently shown");
  await expect(operations).toContainText("Capacity AVAILABLE (NORMAL)");
  await expect(operations).not.toContainText("Usage analytics");
  await expect(operations.getByRole("link", { name: "Documentation" })).toHaveAttribute(
    "href",
    "https://imom39a.github.io/lightstreamer-workbench-extension/docs/"
  );
  await expect(operations.getByRole("link", { name: "Privacy" })).toHaveAttribute(
    "href",
    "https://imom39a.github.io/lightstreamer-workbench-extension/privacy/"
  );
  await expect(operations.getByRole("link", { name: "Support" })).toHaveAttribute(
    "href",
    "https://imom39a.github.io/lightstreamer-workbench-extension/support/"
  );
  const clear = operations.getByRole("button", { name: "Clear retained Evidence…" });
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(operations).toContainText("Clear all 4,000 retained Evidence events for this Panel Session?");
  await expect(operations).toContainText("This removes retained Evidence from this Panel Session and cannot be undone.");
  await operations.getByRole("button", { name: "Keep Evidence" }).click();

  const operationsLayout = await operations.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const sections = Array.from(element.children).filter((child) => child instanceof HTMLElement && child.tagName === "SECTION") as HTMLElement[];
    const last = sections.at(-1)?.getBoundingClientRect();
    return {
      lastBottom: last?.bottom ?? rect.top,
      containerBottom: rect.bottom,
      sectionHeights: sections.map((section) => section.getBoundingClientRect().height)
    };
  });
  expect(operationsLayout.lastBottom).toBeLessThanOrEqual(operationsLayout.containerBottom);
  expect(Math.max(...operationsLayout.sectionHeights)).toBeLessThan(220);

  await page.getByRole("button", { name: "Back to prior investigation" }).click();
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(priorHeading).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toHaveText("Filter: retained-evidence-event");
  await expect(page.locator(`[data-evidence-id="${selectedIdentity}"]`)).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => grid.evaluate((element) => element.scrollTop)).toBe(beforeScrollTop);
  await expect(page.getByText(/View FROZEN/)).toBeVisible();

  for (const viewport of [
    { width: 563, height: 700 },
    { width: 900, height: 320 },
    { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await expect(more).toBeVisible();
    await more.focus();
    await page.keyboard.press("Enter");
    const back = page.getByRole("button", { name: "Back to prior investigation" });
    await expect(back).toBeVisible();
    const documentation = page.getByRole("link", { name: "Documentation" });
    const clearRetained = page.getByRole("button", { name: "Clear retained Evidence…" });
    await clearRetained.scrollIntoViewIfNeeded();
    await clearRetained.focus();
    await page.keyboard.press("Tab");
    await expect(documentation).toBeFocused();
    await expect(documentation).toBeInViewport();
    await expect(page.getByRole("heading", { name: "Help & resources" })).toBeInViewport();
    await expect(page.getByRole("link", { name: "Privacy" })).toBeInViewport();
    await expect(page.getByRole("link", { name: "Support" })).toBeInViewport();
    await expect.poll(() => documentation.evaluate((element) => {
      const style = getComputedStyle(element);
      return `${style.outlineStyle} ${style.outlineWidth}`;
    })).toBe("solid 2px");
    if (viewport.width === 563) {
      const compactTheme = page.getByLabel("Panel theme");
      await expect(compactTheme).toBeVisible();
      await compactTheme.selectOption("dark");
      await expect(page.locator(".workbench-react")).toHaveAttribute("data-theme", "dark");
      await attachNamedScenarioScreenshot(page, testInfo, "compact-more-actions-theme-route");
    }
    await back.click();
    await expect(more).toBeFocused();
  }
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Workbench keeps a compact Frozen high-volume investigation stable and restores Context", async ({
  page
}, testInfo) => {
  await openScenario(page, "frozen-high-volume", { width: 563, height: 700 }, "light");

  await expect(page.getByText("Capture RUNNING", { exact: true })).toBeVisible();
  await expect(page.getByText("Coverage USEFUL", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scope", exact: true })).toBeVisible();
  await expect(page.getByText(/View FROZEN .*30 newer/)).toBeVisible();
  await expect(page.locator(".workbench-react__evidence-row")).toHaveCount(60);

  const selectedRow = page.locator(`[data-evidence-id="${highVolumeEventId(3_970)}"]`);
  await expect(selectedRow).toHaveAttribute("aria-selected", "true");
  await selectedRow.focus();
  await page.getByRole("button", { name: "Open selected Context" }).click();
  await expect(page.getByRole("complementary", { name: "Context" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to Evidence" })).toBeVisible();
  await page.getByRole("button", { name: "Back to Evidence" }).click();
  await expect(selectedRow).toBeVisible();
  await expect(selectedRow).toBeFocused();
  await expect(selectedRow).toHaveAttribute("aria-selected", "true");

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench finds off-window matches across all retained Evidence without changing the investigation", async ({ page }, testInfo) => {
  await openScenario(page, "frozen-high-volume", { width: 900, height: 700 }, "dark");
  const shell = page.locator(".workbench-react");
  const operating = page.locator(".workbench-react__operating");
  const selectedIdentity = highVolumeEventId(3_970);
  await expect(page.getByText("Shown 60", { exact: true })).toBeVisible();
  await expect(page.getByText("Matching 3,970", { exact: true })).toBeVisible();
  await expect(page.getByText(/View FROZEN .*30 newer/)).toBeVisible();
  await expect(operating.getByRole("button", { name: "Find", exact: true })).toBeVisible();
  await expect(operating.getByRole("button", { name: "Filter", exact: true })).toBeVisible();

  const find = operating.getByRole("button", { name: "Find", exact: true });
  await find.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Find in ordered Evidence" }).fill("complete-retained-find-anchor");
  await expect(page.getByRole("search", { name: "Find in ordered Evidence" })).toContainText("1 of 3 matches");
  await expect(page.locator(`[data-evidence-id="${highVolumeEventId(5)}"]`)).toHaveAttribute("data-find-current", "true");
  await expect(page.locator(".workbench-react__evidence-row")).toHaveCount(60);

  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(`[data-evidence-id="${highVolumeEventId(2_050)}"]`)).toHaveAttribute("data-find-current", "true");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(`[data-evidence-id="${highVolumeEventId(3_995)}"]`)).toHaveAttribute("data-find-current", "true");
  await expect(page.getByText(/View FROZEN/)).toBeVisible();
  await expect(page.getByRole("heading", { name: new RegExp(selectedIdentity) })).toBeVisible();

  await page.getByRole("button", { name: "Close Find" }).click();
  await expect(find).toBeFocused();
  await expect(page.locator(`[data-evidence-id="${selectedIdentity}"]`)).toHaveAttribute("aria-selected", "true");
  await expect(shell).toHaveAttribute("data-geometry", "normal");
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Workbench keeps 4,000 long-identity Evidence rows bounded at every docked geometry", async ({ page }, testInfo) => {
  const selectedIdentity = highVolumeEventId(3_970);
  const longItem = "portfolio/orders/north-america/enterprise-customer-primary-book";
  const longClient = "lightstreamer-client-for-global-orders-monitoring-workspace";
  const longSession = "session-2026-08-05-primary-production-orders-command-stream";
  const longSubscription = "subscription-orders-command-all-regions-with-production-identities";
  const longKey = "customer-order-command-key-with-long-production-identity-9";
  await openScenario(page, "frozen-high-volume", { width: 563, height: 700 }, "light");
  const shell = page.locator(".workbench-react");
  const ledger = page.getByRole("grid", { name: "Ordered Lightstreamer Evidence" });
  const selected = page.locator(`[data-evidence-id="${selectedIdentity}"]`);
  const missingKey = page.locator(`[data-evidence-id="${highVolumeEventId(3_969)}"]`);
  const nonUpdate = page.locator(`[data-evidence-id="${highVolumeEventId(3_968)}"]`);
  const assertCommandKeyContract = async () => {
    const headers = await page.locator('[role="columnheader"]').allTextContents();
    expect(headers).toEqual(["Order", "Evidence", "Command", "Object"]);
    await expect(selected.locator('[role="gridcell"]').nth(3).locator("small")).toHaveText(`Key ${longKey}`);
    await expect(selected.locator('[role="gridcell"]').nth(3).locator("small")).toHaveAttribute("title", longKey);
    await expect(missingKey.locator('[role="gridcell"]').nth(3).locator("small")).toHaveText("Key —");
    await expect(missingKey.locator('[role="gridcell"]').nth(3).locator("small")).toHaveAttribute("title", "No COMMAND key");
    await expect(missingKey).not.toContainText("field-only-key-must-not-be-inferred");
    await expect(nonUpdate.locator('[role="gridcell"]').nth(2)).toHaveText("—");
    await expect(nonUpdate.locator('[role="gridcell"]').nth(3).locator("small")).toHaveText("Key —");
  };
  await expect(page.locator(".workbench-react__evidence-row")).toHaveCount(60);
  await expect(selected).toHaveAttribute("title", new RegExp(selectedIdentity));
  await expect(selected.locator('[role="gridcell"]').nth(3).locator("strong")).toHaveAttribute("title", longItem);
  const compactHeights = await page.locator(".workbench-react__evidence-row").evaluateAll((rows) =>
    [...new Set(rows.map((row) => row.getBoundingClientRect().height))]
  );
  expect(compactHeights).toHaveLength(1);
  expect(compactHeights[0]).toBeGreaterThanOrEqual(48);
  expect(compactHeights[0]).toBeLessThanOrEqual(54);
  const priorityRow = await selected.evaluate((row) => {
    const order = row.querySelector<HTMLElement>(".workbench-react__evidence-order")!;
    const meaning = row.querySelector<HTMLElement>(".workbench-react__evidence-meaning")!;
    const object = row.querySelector<HTMLElement>(".workbench-react__evidence-object")!;
    const orderParts = order.querySelectorAll<HTMLElement>("small, strong");
    return {
      orderLabel: orderParts[0]?.textContent,
      orderValue: orderParts[1]?.textContent,
      orderTitle: order.querySelector("strong")?.title,
      meaningPrimaryTop: meaning.querySelector("strong")!.getBoundingClientRect().top,
      meaningSecondaryTop: meaning.querySelector("small")!.getBoundingClientRect().top,
      objectPrimaryTop: object.querySelector("strong")!.getBoundingClientRect().top,
      objectSecondaryTop: object.querySelector("small")!.getBoundingClientRect().top
    };
  });
  expect(priorityRow.orderLabel).toBe("Event");
  expect(priorityRow.orderValue).toBe("3970");
  expect(priorityRow.orderTitle).toBe(selectedIdentity);
  expect(priorityRow.meaningSecondaryTop).toBeGreaterThan(priorityRow.meaningPrimaryTop);
  expect(priorityRow.objectSecondaryTop).toBeGreaterThan(priorityRow.objectPrimaryTop);
  await assertCommandKeyContract();

  const operatingTop = await page.locator(".workbench-react__operating").evaluate((element) => element.getBoundingClientRect().top);
  await ledger.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect(await page.locator(".workbench-react__operating").evaluate((element) => element.getBoundingClientRect().top)).toBe(operatingTop);
  const shellScroll = await shell.evaluate((element) => ({ client: element.clientHeight, scroll: element.scrollHeight }));
  expect(shellScroll.scroll).toBe(shellScroll.client);

  for (const viewport of [
    { width: 900, height: 700, geometry: "normal" },
    { width: 900, height: 320, geometry: "shallow" },
    { width: 1440, height: 900, geometry: "wide" }
  ] as const) {
    await page.setViewportSize(viewport);
    await expect(shell).toHaveAttribute("data-geometry", viewport.geometry);
    await expect(page.locator(".workbench-react__evidence-row")).toHaveCount(60);
    await expect(selected).toHaveCSS("height", "52px");
    if (viewport.geometry === "normal" || viewport.geometry === "wide") {
      const columnWidths = await selected.locator('[role="gridcell"]').evaluateAll((cells) =>
        cells.map((cell) => cell.getBoundingClientRect().width)
      );
      expect(columnWidths).toHaveLength(4);
      expect(columnWidths.every((width) => width >= 64)).toBe(true);
    }
    if (viewport.geometry === "normal" || viewport.geometry === "wide") {
      await assertCommandKeyContract();
    }
    await expectShellFits(page);
  }

  await page.setViewportSize({ width: 900, height: 700 });
  await assertCommandKeyContract();
  await selected.focus();
  await page.getByRole("button", { name: "Focus selected Context" }).click();
  const context = page.getByRole("complementary", { name: "Context" });
  await expect(context.getByRole("heading", { name: new RegExp(selectedIdentity) })).toBeVisible();
  const metadata = context.locator('details[aria-label="Evidence metadata"]');
  await expect(metadata).not.toHaveAttribute("open", "");
  await metadata.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(metadata).toHaveAttribute("open", "");
  await expect(context.getByText(longClient, { exact: true })).toBeVisible();
  await expect(context.getByText(longSession, { exact: true })).toBeVisible();
  await expect(context.getByText(longSubscription, { exact: true })).toBeVisible();
  await expect(context.getByText(longItem, { exact: true })).toBeVisible();
  await expect(context.locator(".workbench-react__context-fields dd").filter({ hasText: longKey })).toBeVisible();
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Workbench keeps a large live Scope contiguous while Ordered Evidence owns focus", async ({ page }, testInfo) => {
  await openScenario(page, "live-high-scope", { width: 1440, height: 900 }, "dark");
  const tree = page.getByRole("tree", { name: /Runtime Scope tree/ });
  const selectedScope = tree.getByRole("treeitem", { name: /high-scope-subscription-220/, selected: true });
  const evidence = page.locator('[data-evidence-id="high-scope-event-220"]');
  const scopeLabel = page.locator(".workbench-react__scope-label");
  const contextHeading = page.getByRole("complementary", { name: "Context" }).getByRole("heading", { level: 2 });

  await tree.evaluate((element) => { element.scrollTop = 270; });
  await evidence.focus();
  await expect(evidence).toBeFocused();
  await expect(evidence).toHaveAttribute("aria-selected", "true");
  await expect(selectedScope).toHaveCount(0);
  const beforeGrowth = {
    scrollTop: await tree.evaluate((element) => element.scrollTop),
    scrollHeight: await tree.evaluate((element) => element.scrollHeight),
    scopeLabel: await scopeLabel.textContent(),
    contextHeading: await contextHeading.textContent()
  };
  expect(await page.evaluate(() => (window as unknown as {
    __appendDeferredWorkbenchEvents(): number;
  }).__appendDeferredWorkbenchEvents())).toBe(40);
  await expect.poll(() => tree.evaluate((element) => element.scrollHeight)).toBeGreaterThan(beforeGrowth.scrollHeight);
  expect(await tree.evaluate((element) => element.scrollTop)).toBe(beforeGrowth.scrollTop);
  await expect(scopeLabel).toHaveText(beforeGrowth.scopeLabel!);
  await expect(contextHeading).toHaveText(beforeGrowth.contextHeading!);
  await expect(evidence).toBeFocused();
  await expect(evidence).toHaveAttribute("aria-selected", "true");
  await expect(selectedScope).toHaveCount(0);
  const scopeWindow = await tree.evaluate((element) => {
    const treeRect = element.getBoundingClientRect();
    const rows = [...element.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const visibleRows = rows
      .map((row) => ({ id: row.dataset.scopeId, top: row.getBoundingClientRect().top }))
      .filter(({ top }) => top >= treeRect.top && top < treeRect.bottom)
      .sort((left, right) => left.top - right.top);
    return {
      mounted: Number(element.dataset.mountedNodeCount),
      visibleRows,
      scrollTop: element.scrollTop
    };
  });
  expect(scopeWindow.mounted).toBeLessThanOrEqual(127);
  expect(scopeWindow.visibleRows.length).toBeGreaterThan(3);
  expect(scopeWindow.visibleRows.slice(1).every((row, index) =>
    Math.abs(row.top - scopeWindow.visibleRows[index]!.top - 58) < 1
  )).toBe(true);

  const firstScopeRow = tree.getByRole("treeitem").first();
  await firstScopeRow.focus();
  await page.keyboard.press("End");
  const endRow = tree.locator('[role="treeitem"][tabindex="0"]');
  await expect(endRow).toBeFocused();
  await expect(endRow).toHaveAttribute("data-scope-id", /high-scope-subscription-259/);
  await expect(endRow).toBeInViewport();
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench keeps a normal high-cardinality Scope picker bounded through passive growth", async ({ page }, testInfo) => {
  await openScenario(page, "live-high-scope", { width: 900, height: 700 }, "light");
  await page.getByRole("button", { name: "Scope", exact: true }).click();
  const tree = page.getByRole("tree", { name: /Runtime Scope tree/ });
  const focused = tree.getByRole("treeitem", { name: /high-scope-subscription-220/ });
  await tree.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect(focused).toBeVisible();
  await focused.focus();
  await tree.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect(focused).toBeFocused();
  await expect(focused).toHaveAttribute("tabindex", "0");
  await expect(focused).not.toBeInViewport();
  const focusedId = await tree.evaluate((element) =>
    (element.ownerDocument.activeElement as HTMLElement | null)?.dataset.scopeId ?? null
  );
  expect(focusedId).not.toBeNull();
  const before = {
    top: await tree.evaluate((element) => element.scrollTop),
    height: await tree.evaluate((element) => element.scrollHeight)
  };
  await expect(tree.getByRole("treeitem", { name: /high-scope-subscription-000/ })).toHaveCount(0);

  expect(await page.evaluate(() => (window as unknown as {
    __appendDeferredWorkbenchEvents(): number;
  }).__appendDeferredWorkbenchEvents())).toBe(40);
  await expect.poll(() => tree.evaluate((element) => element.scrollHeight)).toBeGreaterThan(before.height);
  expect(await tree.evaluate((element) => element.scrollTop)).toBe(before.top);
  await expect(tree.getByRole("treeitem", { name: /high-scope-subscription-000/ })).toBeVisible();
  await expect.poll(() => tree.locator("[data-scope-id]").evaluateAll(
    (rows, id) => rows.some((row) => row.getAttribute("data-scope-id") === id && row === document.activeElement),
    focusedId
  )).toBe(true);
  await expect(focused).toHaveAttribute("tabindex", "0");
  await expect(focused).not.toBeInViewport();
  expect(Number(await tree.getAttribute("data-mounted-node-count"))).toBeLessThanOrEqual(127);

  await page.keyboard.press("Escape");
  await expect(page.locator('[data-evidence-id="high-scope-event-220"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".workbench-react__scope-label")).toContainText("high-scope-subscription-220");
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench keeps Find reachable and restorable in compact geometry", async ({ page }, testInfo) => {
  await openScenario(page, "filter-find", { width: 563, height: 700 }, "dark");
  const find = page.getByRole("button", { name: "Find", exact: true });
  const filter = page.getByRole("button", { name: "Filter", exact: true });
  await expect(find).toBeVisible();
  await expect(filter).toBeVisible();
  await filter.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Filter Evidence")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(filter).toBeFocused();
  await expect(page.locator(".workbench-react__active-filter")).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toHaveText("Filter: scenario-event");
  await find.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f");
  await expect(page.getByRole("search", { name: "Find in ordered Evidence" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "Find in ordered Evidence" })).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(find).toBeFocused();

  for (const viewport of [{ width: 900, height: 320 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("button", { name: "Find", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeVisible();
  }

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench drafts free-text Filter, exposes exact counts, and keeps Find independent", async ({ page }, testInfo) => {
  await openScenario(page, "filter-find", { width: 900, height: 700 }, "light");
  const filter = page.getByRole("button", { name: "Filter", exact: true });
  await filter.click();
  await expect(page.getByRole("button", { name: "Add structured criterion" })).toBeEnabled();
  await expect(page.getByText("Choose one of twelve Evidence facets to browse exact observed values.", { exact: true })).toBeVisible();
  await page.getByLabel("Filter Evidence").fill("not-applied-yet");
  await expect(page.locator(".workbench-react__active-filter")).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toHaveText("Filter: scenario-event");
  await page.evaluate(() => window.__makeWorkbenchFilterStale());
  await expect(page.getByLabel("Filter Evidence")).toHaveValue("not-applied-yet");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".workbench-react__filter-status")).toContainText("Filter revision is stale");
  await expect(page.getByLabel("Filter Evidence")).toHaveValue("not-applied-yet");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".workbench-react__active-filter")).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toHaveText("Filter: not-applied-yet");
  await expect(filter).toBeFocused();

  await filter.click();
  await page.getByLabel("Filter Evidence").fill("scenario-event-2");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".workbench-react__active-filter")).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toHaveText("Filter: scenario-event-2");
  await expect(page.getByText("Shown 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Matching 1", { exact: true })).toBeVisible();
  await expect(page.getByText("In Scope 1", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Find in ordered Evidence" })).toHaveValue("item update");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.locator(".workbench-react__active-filter")).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toHaveText("Filter: scenario-event-2");
  await page.getByRole("button", { name: "Reset Filter", exact: true }).click();
  await expect(page.locator(".workbench-react__active-filter")).toHaveCount(0);
  await expect(page.getByText("Shown 6", { exact: true })).toBeVisible();

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench lets wide panes resize, collapse, and restore independently", async ({ page }, testInfo) => {
  await openScenario(page, "live-selected", { width: 1440, height: 900 }, "dark");
  const scopeSplitter = page.getByRole("separator", { name: "Resize Scope" });
  const contextSplitter = page.getByRole("separator", { name: "Resize Context" });
  await expect(scopeSplitter).toHaveAttribute("aria-valuenow", "228");
  await scopeSplitter.focus();
  await expect(scopeSplitter).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("ArrowRight");
  await expect(scopeSplitter).toHaveAttribute("aria-valuenow", "252");
  await scopeSplitter.dispatchEvent("pointerdown", { clientX: 252 });
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointermove", { clientX: 276 })));
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointermove", { clientX: 300 })));
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { clientX: 300 })));
  await expect(scopeSplitter).toHaveAttribute("aria-valuenow", "300");
  await contextSplitter.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(contextSplitter).toHaveAttribute("aria-valuenow", "374");
  await contextSplitter.dispatchEvent("pointerdown", { clientX: 900 });
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointermove", { clientX: 924 })));
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { clientX: 924 })));
  await expect(contextSplitter).toHaveAttribute("aria-valuenow", "350");

  await page.getByRole("button", { name: "Collapse Scope" }).click();
  await expect(page.getByLabel("Structural runtime scope")).toBeHidden();
  expect(await page.getByLabel("Ordered Evidence").evaluate((pane) => pane.getBoundingClientRect().width)).toBeGreaterThanOrEqual(520);
  await expect(page.getByRole("button", { name: "Restore Scope" })).toBeFocused();
  await page.getByRole("button", { name: "Restore Scope" }).click();
  await expect(page.getByLabel("Structural runtime scope")).toBeVisible();
  await expect(page.getByRole("button", { name: "Collapse Scope" })).toBeFocused();
  await page.getByRole("button", { name: "Collapse Context" }).click();
  await expect(page.getByLabel("Context", { exact: true })).toBeHidden();
  const restoreSelectedContext = page.getByRole("button", { name: "Restore selected Context" });
  await restoreSelectedContext.click();
  await expect(page.getByLabel("Context", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "scenario-event-3 · Item Update" })).toBeFocused();
  await page.getByRole("button", { name: "Collapse Scope" }).click();
  await page.getByRole("button", { name: "Collapse Context" }).click();
  await expect(page.getByLabel("Ordered Evidence")).toBeVisible();
  await page.getByRole("button", { name: "Restore Scope" }).click();
  await page.getByRole("button", { name: "Restore Context" }).click();
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(contextSplitter).toHaveAttribute("aria-orientation", "horizontal");
  await contextSplitter.focus();
  await page.keyboard.press("ArrowUp");
  await expect(contextSplitter).toHaveAttribute("aria-valuenow", "284");
  await contextSplitter.dispatchEvent("pointerdown", { clientY: 300 });
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointermove", { clientY: 324 })));
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { clientY: 324 })));
  await expect(contextSplitter).toHaveAttribute("aria-valuenow", "260");
  await page.setViewportSize({ width: 1440, height: 900 });
  await scopeSplitter.focus();
  await page.keyboard.press("ArrowRight");
  await expect(contextSplitter).toHaveAttribute("aria-valuenow", "350");

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench derives non-starving geometry with resize hysteresis", async ({ page }, testInfo) => {
  await openScenario(page, "live-selected", { width: 1120, height: 700 }, "light");
  const shell = page.locator(".workbench-react");
  await expect(shell).toHaveAttribute("data-geometry", "wide");
  const widths = await page.locator(".workbench-react__workspace").evaluate(() => ({
    scope: document.querySelector(".workbench-react__scope")!.getBoundingClientRect().width,
    evidence: document.querySelector(".workbench-react__evidence")!.getBoundingClientRect().width,
    context: document.querySelector(".workbench-react__context")!.getBoundingClientRect().width
  }));
  expect(widths.scope).toBeGreaterThanOrEqual(216);
  expect(widths.evidence).toBeGreaterThanOrEqual(520);
  expect(widths.context).toBeGreaterThanOrEqual(320);
  await expectWorkspaceFitsExactly(page);

  await page.setViewportSize({ width: 900, height: 700 });
  await expect(shell).toHaveAttribute("data-geometry", "normal");
  await expectWorkspaceFitsExactly(page);
  await page.setViewportSize({ width: 690, height: 700 });
  await expect(shell).toHaveAttribute("data-geometry", "compact");
  await expectWorkspaceFitsExactly(page);
  await page.setViewportSize({ width: 720, height: 700 });
  await expect(shell).toHaveAttribute("data-geometry", "compact");
  await expectWorkspaceFitsExactly(page);
  await page.setViewportSize({ width: 740, height: 700 });
  await expect(shell).toHaveAttribute("data-geometry", "normal");
  await expectWorkspaceFitsExactly(page);

  await page.setViewportSize({ width: 900, height: 500 });
  await expect(shell).toHaveAttribute("data-geometry", "shallow");
  await expectWorkspaceFitsExactly(page);
  await page.setViewportSize({ width: 830, height: 320 });
  await expect(shell).toHaveAttribute("data-geometry", "compact");
  await expectWorkspaceFitsExactly(page);
  await page.setViewportSize({ width: 878, height: 320 });
  await expect(shell).toHaveAttribute("data-geometry", "shallow");
  await expectWorkspaceFitsExactly(page);
  await page.setViewportSize({ width: 845, height: 320 });
  await expect(shell).toHaveAttribute("data-geometry", "compact");
  await expectWorkspaceFitsExactly(page);

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench keeps active capture without selection and selected Local Evidence readable", async ({ page }, testInfo) => {
  await openScenario(page, "active-no-selection", { width: 900, height: 700 }, "light");
  await expect(page.getByText("Capture RUNNING", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inspected page" })).toBeVisible();
  await expect(page.getByRole("button", { name: /selected Context/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open complete raw" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export Scope…" })).toBeVisible();

  await openScenario(page, "selected-local-evidence", { width: 900, height: 320 }, "dark");
  const local = page.locator('[data-evidence-id="scenario-event-5"]');
  await expect(local).toHaveAttribute("aria-selected", "true");
  await expect(local).toContainText("LOCAL");
  const unavailableDraft = page.getByRole("button", { name: "Create Local Injection Draft" });
  await expect(unavailableDraft).toBeDisabled();
  await expect(unavailableDraft).toHaveAttribute("aria-describedby", "workbench-local-injection-unavailable-reason");
  await expect(page.locator("#workbench-local-injection-unavailable-reason")).toHaveText("Selected Evidence is not a compatible captured Item Update.");
  await expect(page.getByRole("button", { name: "Export Scope…" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy retained scoped Evidence" })).toHaveCount(0);
  await page.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("button", { name: "Copy retained scoped Evidence" })).toBeVisible();

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench visibly distinguishes an unavailable Local Injection Draft action", async ({ page }, testInfo) => {
  const cases = [
    ["normal-light", { width: 900, height: 700 }, "light", false],
    ["compact-dark", { width: 563, height: 700 }, "dark", true],
    ["shallow-dark", { width: 900, height: 320 }, "dark", false],
    ["wide-light", { width: 1440, height: 900 }, "light", false]
  ] as const;

  for (const [name, viewport, theme, openContext] of cases) {
    await openScenario(page, "selected-local-evidence", viewport, theme);
    if (openContext) await page.getByRole("button", { name: "Open selected Context" }).click();

    const unavailableDraft = page.locator('button[aria-describedby="workbench-local-injection-unavailable-reason"]');
    const reason = page.locator("#workbench-local-injection-unavailable-reason");
    await expect(unavailableDraft).toBeDisabled();
    await expect(unavailableDraft).toHaveAccessibleName("Create Local Injection Draft · Unavailable");
    await expect(reason).toHaveText("Selected Evidence is not a compatible captured Item Update.");

    const appearance = await unavailableDraft.evaluate((button) => {
      const enabledButton = [...document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent?.trim() === "Open complete raw");
      if (!enabledButton) throw new Error("Missing enabled comparison action.");
      const unavailable = getComputedStyle(button);
      const enabled = getComputedStyle(enabledButton);
      return {
        backgroundIsDistinct: unavailable.backgroundColor !== enabled.backgroundColor,
        borderStyle: unavailable.borderTopStyle,
        colorIsDistinct: unavailable.color !== enabled.color,
        cursor: unavailable.cursor,
        opacity: unavailable.opacity
      };
    });
    expect(appearance).toEqual({
      backgroundIsDistinct: true,
      borderStyle: "dashed",
      colorIsDistinct: true,
      cursor: "not-allowed",
      opacity: "1"
    });

    const contextHeaderAction = page
      .locator(".workbench-react__context")
      .getByRole("button", { name: openContext ? "Back to Evidence" : "Collapse Context", exact: true });
    const openRaw = page.getByRole("button", { name: "Open complete raw" });
    await contextHeaderAction.focus();
    for (let step = 0; step < 40 && !await openRaw.evaluate((button) => button === document.activeElement); step += 1) {
      await page.keyboard.press("Tab");
      await expect(unavailableDraft).not.toBeFocused();
    }
    await expect(openRaw).toBeFocused();
    await expectShellFits(page);
    await expectNoSeriousAxeViolations(page, testInfo);
    await attachNamedScenarioScreenshot(page, testInfo, `unavailable-local-injection-${name}`);
  }

  await openScenario(page, "selected-local-evidence", { width: 900, height: 700 }, "light");
  await page.emulateMedia({ forcedColors: "active" });
  const forcedColorsDraft = page.locator('button[aria-describedby="workbench-local-injection-unavailable-reason"]');
  await expect(forcedColorsDraft).toHaveAccessibleName("Create Local Injection Draft · Unavailable");
  await expect(forcedColorsDraft).toHaveCSS("border-top-style", "dashed");
  await expect(page.locator("#workbench-local-injection-unavailable-reason")).toBeVisible();
  await attachNamedScenarioScreenshot(page, testInfo, "unavailable-local-injection-forced-colors");
});

test("Workbench preserves structural selection contrast in forced colors", async ({ page }, testInfo) => {
  await page.emulateMedia({ forcedColors: "active" });
  await openScenario(page, "live-selected", { width: 900, height: 700 }, "dark");
  const selected = page.locator('[data-evidence-id="scenario-event-3"]');
  const unselected = page.locator('[data-evidence-id="scenario-event-4"]');
  await expect(selected).toHaveAttribute("aria-selected", "true");
  const selectedUnfocused = await selected.evaluate((row) => {
    const style = getComputedStyle(row);
    return { backgroundColor: style.backgroundColor, boxShadow: style.boxShadow, outlineStyle: style.outlineStyle };
  });
  expect(selectedUnfocused.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(selectedUnfocused.boxShadow).not.toBe("none");
  expect(selectedUnfocused.outlineStyle).toBe("none");
  await expect(selected.locator(".workbench-react__evidence-order")).toHaveCSS("background-color", selectedUnfocused.backgroundColor);

  await selected.focus();
  const selectedFocused = await selected.evaluate((row) => {
    const style = getComputedStyle(row);
    return { backgroundColor: style.backgroundColor, boxShadow: style.boxShadow, outlineStyle: style.outlineStyle };
  });
  expect(selectedFocused.backgroundColor).toBe(selectedUnfocused.backgroundColor);
  expect(selectedFocused.boxShadow).toBe(selectedUnfocused.boxShadow);
  expect(selectedFocused.outlineStyle).toBe("solid");

  await unselected.focus();
  const unselectedFocused = await unselected.evaluate((row) => {
    const style = getComputedStyle(row);
    return { backgroundColor: style.backgroundColor, boxShadow: style.boxShadow, outlineStyle: style.outlineStyle };
  });
  expect(unselectedFocused.backgroundColor).not.toBe(selectedFocused.backgroundColor);
  expect(unselectedFocused.boxShadow).toBe("none");
  expect(unselectedFocused.outlineStyle).toBe("solid");
  await expect(page.getByRole("button", { name: "Scope", exact: true })).toBeVisible();

  await openScenario(page, "local-injection-captured", { width: 900, height: 700 }, "dark");
  await page.getByRole("button", { name: "Create Local Injection Draft" }).click();
  const localDraft = page.getByRole("region", { name: "Local Injection Draft" });
  await expect(localDraft).toContainText("LOCAL ONLY");
  await expect(localDraft).toContainText("READY");
  const localEditor = page.getByRole("textbox", { name: "Local Injection JSON", exact: true });
  await localEditor.focus();
  await expect(page.locator(".workbench-react__local-code .cm-editor.cm-focused")).toHaveCSS("outline-style", "solid");
  const boundaryColors = await localDraft.locator(".workbench-react__local-only").evaluate((boundary) => {
    const style = getComputedStyle(boundary);
    return { color: style.color, backgroundColor: style.backgroundColor, borderTopStyle: style.borderTopStyle };
  });
  expect(boundaryColors.color).not.toBe(boundaryColors.backgroundColor);
  expect(boundaryColors.borderTopStyle).toBe("solid");
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench navigates retained Evidence windows without losing keyboard boundary focus", async ({ page }, testInfo) => {
  await openScenario(page, "frozen-high-volume", { width: 900, height: 700 }, "dark");
  const initial = page.locator(`[data-evidence-id="${highVolumeEventId(3_970)}"]`);
  await initial.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Home" : "Control+Home");
  const oldest = page.locator(`[data-evidence-id="${highVolumeEventId(1)}"]`);
  await expect(oldest).toHaveAttribute("aria-selected", "true");
  await expect(oldest).toBeFocused();

  await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  const newest = page.locator(`[data-evidence-id="${highVolumeEventId(3_970)}"]`);
  await expect(newest).toHaveAttribute("aria-selected", "true");
  await expect(newest).toBeFocused();
  const evidenceGrid = page.getByRole("grid", { name: "Ordered Lightstreamer Evidence" });
  await evidenceGrid.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await expect(newest).toBeFocused();
  await evidenceGrid.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await expect(newest).toBeFocused();
  const older = page.getByRole("button", { name: "Older" });
  await older.click();
  await expect(older).toBeFocused();

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench makes limited Capture actionable without hiding retained Evidence", async ({
  page
}, testInfo) => {
  await openScenario(page, "limited-capture", { width: 900, height: 700 }, "light");

  await expect(page.getByText("Capture RUNNING", { exact: true })).toBeVisible();
  await expect(page.getByText("Coverage LIMITED", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scope", exact: true })).toBeVisible();
  const diagnostics = page.getByRole("region", { name: "Workbench diagnostics" });
  await expect(
    diagnostics.getByText("Earlier Snapshot Evidence may be incomplete.")
  ).toBeVisible();
  await expect(
    diagnostics.getByText("Affected: Inspected page")
  ).toBeVisible();
  await expect(
    diagnostics.getByText("Recovery: Reload the inspected page with DevTools open")
  ).toBeVisible();
  await expect(page.getByText("Earlier Snapshot Evidence may be incomplete.", { exact: true })).toHaveCount(1);
  await expect(page.getByLabel("Ordered Evidence").locator(".workbench-react__condition--warning")).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Context" }).locator(".workbench-react__diagnostic")).toHaveCount(0);
  await expect(page.locator(".workbench-react__evidence-row")).not.toHaveCount(0);

  const notificationsTrigger = page.getByRole("button", { name: /^Notifications \(\d+\) · Warning$/ });
  const notificationCountLabel = await notificationsTrigger.textContent();
  await notificationsTrigger.click();
  const notifications = page.getByRole("region", { name: "Notifications", exact: true });
  await expect(notifications.getByText("Warning · Coverage LIMITED", { exact: true })).toHaveCount(1);
  await expect(notifications).toContainText("Earlier Snapshot Evidence may be incomplete.");
  await expect(notifications).toContainText("Reload the inspected page with DevTools open");
  await notifications.getByRole("button", { name: "Back to Evidence", exact: true }).click();

  await diagnostics.getByRole("button", { name: "Dismiss Coverage LIMITED", exact: true }).click();
  await expect(diagnostics.getByText("Warning · Coverage LIMITED", { exact: true })).toHaveCount(0);
  await expect(notificationsTrigger).toHaveText(notificationCountLabel ?? "");
  await expect(notificationsTrigger).toBeFocused();

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench keeps low storage headroom advisory, global, and keyboard reachable", async ({
  page
}, testInfo) => {
  const scenes = [
    { width: 900, height: 700, theme: "dark" as const },
    { width: 563, height: 700, theme: "light" as const },
    { width: 900, height: 320, theme: "dark" as const },
    { width: 1440, height: 900, theme: "light" as const }
  ];

  for (const scene of scenes) {
    await openScenario(page, "storage-headroom-warning", scene, scene.theme);
    const diagnostics = page.getByRole("region", { name: "Workbench diagnostics" });
    const diagnosticList = page.getByLabel("Workbench diagnostic entries");
    await expect(diagnostics.getByText("Warning · Estimated storage headroom is low", { exact: true })).toHaveCount(1);
    await expect(diagnostics.getByText("Affected: Extension origin", { exact: true })).toHaveCount(1);
    await expect(diagnostics).toContainText("advisory only");
    await expect(diagnostics).toContainText("QuotaExceededError");
    await expect(diagnostics).toContainText("Free browser storage");
    await expect(diagnostics.locator("[data-history-condition='true']")).toHaveCount(0);
    await expect(page.getByText("Coverage USEFUL", { exact: true })).toBeVisible();
    await diagnostics.focus();
    await expect(diagnostics).toBeFocused();
    await expectShellFits(page);
    await expectNoSeriousAxeViolations(page, testInfo);
    if (scene.height === 320) {
      const disclosure = diagnosticList.getByText("Diagnostic details", { exact: true });
      const detail = diagnosticList.locator(".workbench-react__status-detail");
      await expect(disclosure).toBeVisible();
      await expect(detail).toBeHidden();
      const geometry = await diagnosticList.evaluate((owner) => {
        const footer = owner.closest(".workbench-react__status");
        const statusLine = footer?.querySelector(".workbench-react__status-line");
        const ownerRect = owner.getBoundingClientRect();
        const footerRect = footer?.getBoundingClientRect();
        const statusLineRect = statusLine?.getBoundingClientRect();
        const overflowOwners = footer
          ? [...footer.querySelectorAll("*")].filter((element) => {
              if (!(element instanceof HTMLElement)) return false;
              const style = getComputedStyle(element);
              return ["auto", "scroll"].includes(style.overflowY) && element.scrollHeight > element.clientHeight;
            }).length
          : 0;
        return {
          ownerTop: ownerRect.top,
          ownerBottom: ownerRect.bottom,
          clientHeight: owner.clientHeight,
          scrollHeight: owner.scrollHeight,
          footerBottom: footerRect?.bottom ?? 0,
          statusLineTop: statusLineRect?.top ?? 0,
          overflowOwners
        };
      });
      expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight);
      expect(geometry.overflowOwners).toBe(0);
      expect(geometry.ownerTop).toBeGreaterThanOrEqual(0);
      expect(geometry.ownerBottom).toBeLessThanOrEqual(geometry.footerBottom + 1);
      expect(Math.abs(geometry.ownerBottom - geometry.statusLineTop)).toBeLessThanOrEqual(1);

      // Shallow geometry starts with complete summary rows. Long diagnostic
      // copy is deliberately disclosed instead of looking clipped mid-line.
      await attachNamedScenarioScreenshot(page, testInfo, `storage-headroom-${scene.width}x${scene.height}-${scene.theme}`);
      await disclosure.click();
      await expect(detail).toBeVisible();
      await diagnosticList.focus();
      await expect(diagnosticList).toBeFocused();
      await page.keyboard.press("End");
      await expect.poll(() => diagnosticList.evaluate((owner) => owner.scrollTop)).toBeGreaterThan(0);
      const reachability = await diagnosticList.evaluate((owner) => {
        const recovery = owner.querySelector(".workbench-react__status-recovery");
        const footer = owner.closest(".workbench-react__status");
        const statusLine = footer?.querySelector(".workbench-react__status-line");
        const ownerRect = owner.getBoundingClientRect();
        const recoveryRect = recovery?.getBoundingClientRect();
        const statusLineRect = statusLine?.getBoundingClientRect();
        return {
          recoveryVisible: Boolean(recoveryRect && recoveryRect.top >= ownerRect.top && recoveryRect.bottom <= ownerRect.bottom),
          recoveryBottom: recoveryRect?.bottom ?? 0,
          ownerBottom: ownerRect.bottom,
          statusLineTop: statusLineRect?.top ?? 0
        };
      });
      expect(reachability.recoveryVisible).toBe(true);
      expect(reachability.recoveryBottom).toBeLessThanOrEqual(reachability.ownerBottom + 1);
      expect(Math.abs(reachability.ownerBottom - reachability.statusLineTop)).toBeLessThanOrEqual(1);
      await attachNamedScenarioScreenshot(page, testInfo, `storage-headroom-${scene.width}x${scene.height}-${scene.theme}-scrolled`);
      await page.keyboard.press("Home");
      await expect.poll(() => diagnosticList.evaluate((owner) => owner.scrollTop)).toBe(0);
      await disclosure.click();
    } else {
      await attachNamedScenarioScreenshot(page, testInfo, `storage-headroom-${scene.width}x${scene.height}-${scene.theme}`);
    }
  }

  await openScenario(page, "storage-headroom-warning", { width: 900, height: 320 }, "dark");
  await page.emulateMedia({ colorScheme: "dark", forcedColors: "active" });
  const forcedColorsDiagnostics = page.getByRole("region", { name: "Workbench diagnostics" });
  const forcedColorsDiagnosticList = page.getByLabel("Workbench diagnostic entries");
  await expect(forcedColorsDiagnostics.getByText("Warning · Estimated storage headroom is low", { exact: true })).toHaveCount(1);
  await expect(forcedColorsDiagnostics).toContainText("advisory only");
  await forcedColorsDiagnostics.focus();
  await expect(forcedColorsDiagnostics).toBeFocused();
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachNamedScenarioScreenshot(page, testInfo, "storage-headroom-forced-colors");
  await forcedColorsDiagnosticList.getByText("Diagnostic details", { exact: true }).click();
  await forcedColorsDiagnosticList.focus();
  await page.keyboard.press("End");
  await expect.poll(() => forcedColorsDiagnosticList.evaluate((owner) => owner.scrollTop)).toBeGreaterThan(0);
  await expect(forcedColorsDiagnosticList.locator(".workbench-react__status-recovery")).toBeVisible();
  await page.keyboard.press("Home");
});

test("Notifications removes repeated notices from Context and returns to the unchanged investigation", async ({ page }, testInfo) => {
  for (const scene of [
    { width: 563, height: 700, theme: "dark" as const },
    { width: 900, height: 700, theme: "light" as const }
  ]) {
    await openScenario(page, "diagnostic-subscription-context", scene, scene.theme);
    await page.getByRole("button", { name: "Open Scope Context" }).click();
    await expect(page.getByRole("region", { name: "Context diagnostics" })).toHaveCount(0);
    const context = page.getByRole("complementary", { name: "Context", exact: true });
    await expect(context).not.toContainText("Exact duplicate Subscriptions");
    const contextTitle = await context.getByRole("heading", { level: 2 }).textContent();
    const trigger = page.getByRole("button", { name: /^Notifications/ });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const notifications = page.getByRole("region", { name: "Notifications", exact: true });
    await expect(notifications).toBeVisible();
    await expect(notifications.getByRole("heading", { name: "Notifications", exact: true })).toBeFocused();
    await expect(notifications).toContainText("Exact duplicate Subscriptions");
    await expect(context).toBeHidden();
    await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeDisabled();
    await expectShellFits(page);
    await expectNoSeriousAxeViolations(page, testInfo);
    await attachNamedScenarioScreenshot(page, testInfo, `notifications-${scene.width}-${scene.theme}`);
    await notifications.getByRole("button", { name: "Back to Evidence", exact: true }).click();
    await expect(notifications).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(context.getByRole("heading", { level: 2 })).toHaveText(contextTitle ?? "");
  }
});

test("Notifications keeps snapshot volume bounded, keyboard reachable, and linked to exact Evidence", async ({ page }, testInfo) => {
  for (const scene of [
    { width: 563, height: 700, theme: "dark" as const, forcedColors: false },
    { width: 900, height: 700, theme: "light" as const, forcedColors: false },
    { width: 900, height: 320, theme: "dark" as const, forcedColors: true },
    { width: 1440, height: 900, theme: "light" as const, forcedColors: false }
  ]) {
    await openScenario(page, "notifications-volume", scene, scene.theme);
    await page.emulateMedia({ forcedColors: scene.forcedColors ? "active" : "none" });
    await expect(page.getByText("Information · Snapshot completed", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Freeze Evidence", exact: true }).click();
    await page.getByRole("button", { name: "Notifications (100)", exact: true }).click();
    const notifications = page.getByRole("region", { name: "Notifications", exact: true });
    const entries = notifications.getByLabel("Notification entries");
    await expect(notifications.getByRole("article")).toHaveCount(100);
    await expect(notifications).toContainText("100 of 100 notifications");
    await expect(notifications).toContainText("Up to 100 recent diagnostics");
    await entries.focus();
    await page.keyboard.press("End");
    await expect.poll(() => entries.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press("Home");
    await expect.poll(() => entries.evaluate((element) => element.scrollTop)).toBe(0);
    await expect(entries).toBeFocused();
    await expect(entries).toHaveCSS("outline-style", "solid");
    await expectShellFits(page);
    await expectNoSeriousAxeViolations(page, testInfo);
    await attachNamedScenarioScreenshot(page, testInfo, `notifications-volume-${scene.width}x${scene.height}-${scene.theme}`);

    const notice = notifications.getByRole("article").filter({ hasText: "Affected: Evidence notification-snapshot-120" });
    await notice.locator("summary").click();
    await expect(notice.locator("details")).toHaveAttribute("open", "");
    const route = notice.getByRole("button", { name: "Inspect supporting Evidence" });
    await route.focus();
    const beforeGrowthY = await route.evaluate((element) => element.getBoundingClientRect().top);
    expect(await page.evaluate(() => (window as unknown as { __appendDeferredWorkbenchEvents(): number }).__appendDeferredWorkbenchEvents())).toBe(40);
    await expect(notifications.getByRole("article").last()).toContainText("notification-snapshot-190");
    await expect(notifications.getByRole("article")).toHaveCount(100);
    await expect(route).toBeFocused();
    // Native scroll anchoring rounds scrollTop to device pixels.
    expect(Math.abs(await route.evaluate((element) => element.getBoundingClientRect().top) - beforeGrowthY)).toBeLessThanOrEqual(1);
    const scroll = await entries.evaluate((element) => element.scrollTop);
    await page.keyboard.press("Enter");
    const selected = page.getByRole("heading", { name: "notification-snapshot-120 · End Of Snapshot" });
    await expect(selected).toBeVisible();
    await expect(selected).toBeFocused();
    await page.getByRole("button", { name: "Back investigation" }).click();
    await expect(notifications).toBeVisible();
    await expect.poll(() => entries.evaluate((element) => element.scrollTop)).toBe(scroll);
    await expect(notice.locator("details")).toHaveAttribute("open", "");
    await notifications.getByRole("button", { name: "Back to Evidence" }).click();
    await expect(page.locator('[data-evidence-id="notification-snapshot-100"]')).toHaveAttribute("aria-selected", "true");
    await expectShellFits(page);
  }
});

test("Notifications retains operational warnings after their footer copy is dismissed", async ({ page }, testInfo) => {
  await openScenario(page, "notifications-operational", { width: 563, height: 700 }, "light");
  const trigger = page.getByRole("button", { name: "Notifications (1) · Warning", exact: true });
  await trigger.click();
  const notifications = page.getByRole("region", { name: "Notifications", exact: true });
  await expect(notifications).toContainText("History using memory");
  await expect(notifications).toContainText("1 of 1 notifications");
  const activeCondition = notifications.getByRole("article").filter({ hasText: "History using memory" });
  await expect(activeCondition.locator("details")).not.toHaveAttribute("open", "");
  await expect(activeCondition.getByText(/^Recovery:/)).toBeVisible();
  const diagnostics = page.getByRole("region", { name: "Workbench diagnostics" });
  await expect(diagnostics).toContainText("History using memory");
  await diagnostics.getByRole("button", { name: "Dismiss History using memory", exact: true }).click();
  await expect(diagnostics).not.toContainText("History using memory");
  await expect(notifications).toContainText("History using memory");
  await expect(trigger).toBeFocused();
  await expect(notifications.getByRole("button", { name: "Back to Evidence" })).toBeInViewport();
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachNamedScenarioScreenshot(page, testInfo, "notifications-operational-memory-compact-light");

  await openScenario(page, "notifications-volume", { width: 900, height: 700 }, "dark");
  await page.getByRole("button", { name: "Freeze Evidence" }).click();
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("textbox", { name: "Filter Evidence", exact: true }).fill("notification-snapshot-100");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.getByRole("textbox", { name: "Find in ordered Evidence", exact: true }).fill("snapshot");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await notifications.getByText("Filter notifications", { exact: true }).click();
  await notifications.getByRole("button", { name: "Exclude Information", exact: true }).click();
  await expect(notifications).toContainText("0 of 100 notifications");
  await expect(notifications).toContainText("No notifications match the active notification filters.");
  await expect(page.getByRole("button", { name: "Notifications (100)", exact: true })).toBeVisible();
  await notifications.getByRole("button", { name: "Reset notification filters", exact: true }).click();
  await expect(notifications.getByRole("article")).toHaveCount(100);
  await notifications.getByRole("button", { name: "Back to Evidence" }).click();
  await expect(page.getByRole("textbox", { name: "Find in ordered Evidence", exact: true })).toHaveValue("snapshot");
  await expect(page.getByRole("button", { name: "Follow Live", exact: true })).toBeVisible();
  await expect(page.locator('[data-evidence-id="notification-snapshot-100"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('.workbench-react__evidence-row')).toHaveCount(1);
});

test("continuous Event History keeps rollover and journal incidents low-attention without stopping Capture", async ({ page }, testInfo) => {
  await openScenario(page, "history-rolling-high-volume", { width: 1440, height: 900 }, "light");
  await expect(page.getByText("Capture RUNNING", { exact: true })).toBeVisible();
  await expect(page.getByText("Coverage USEFUL", { exact: true })).toBeVisible();
  await expect(page.getByText("3/6 Evidence · Memory", { exact: true })).toBeVisible();
  await expect(page.locator(".workbench-react__evidence-row")).toHaveCount(3);
  await expect(page.getByRole("region", { name: "Workbench diagnostics" })).not.toContainText("Older Evidence removed");
  const rolloverTrigger = page.getByRole("button", { name: /^Notifications/ });
  await rolloverTrigger.click();
  let notifications = page.getByRole("region", { name: "Notifications", exact: true });
  await expect(notifications).toContainText("Older Evidence removed");
  await expect(notifications).toContainText("This Retention Advance is not an Evidence Gap");
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachNamedScenarioScreenshot(page, testInfo, "history-rollover-notifications-wide-light");
  await notifications.getByRole("button", { name: "Back to Evidence", exact: true }).click();
  await expect(rolloverTrigger).toBeFocused();

  await openScenario(page, "history-journal-recovered", { width: 900, height: 700 }, "dark");
  await expect(page.getByText("Capture RUNNING", { exact: true })).toBeVisible();
  await expect(page.getByText("Coverage USEFUL", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Workbench diagnostics" })).not.toContainText("History storage recovered");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  notifications = page.getByRole("region", { name: "Notifications", exact: true });
  await expect(notifications).toContainText("History storage recovered");
  await expect(notifications).toContainText("recovered after 2 retries");
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachNamedScenarioScreenshot(page, testInfo, "history-journal-recovered-notifications-normal-dark");

  await openScenario(page, "history-journal-memory-fallback", { width: 563, height: 700 }, "light");
  const memoryFooter = page.getByRole("region", { name: "Workbench diagnostics" });
  await expect(page.getByText("Capture RUNNING", { exact: true })).toBeVisible();
  await expect(page.getByText("Coverage USEFUL", { exact: true })).toBeVisible();
  await expect(memoryFooter.getByText("Warning · History using memory", { exact: true })).toHaveCount(1);
  await expect(page.getByText("3/3 Evidence · Memory", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  notifications = page.getByRole("region", { name: "Notifications", exact: true });
  await expect(notifications.getByRole("article").filter({ hasText: "History using memory" })).toHaveCount(1);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachNamedScenarioScreenshot(page, testInfo, "history-journal-memory-compact-light");

  await openScenario(page, "history-evidence-gap", { width: 900, height: 320 }, "dark");
  await page.emulateMedia({ forcedColors: "active" });
  const gapFooter = page.getByRole("region", { name: "Workbench diagnostics" });
  await expect(page.getByText("Capture RUNNING", { exact: true })).toBeVisible();
  await expect(page.getByText("Coverage LIMITED", { exact: true })).toBeVisible();
  await expect(gapFooter.getByText("Warning · History has an Evidence gap", { exact: true })).toHaveCount(1);
  await expect(page.locator('[data-evidence-id="history-after-gap-event"]')).toBeVisible();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  notifications = page.getByRole("region", { name: "Notifications", exact: true });
  await expect(notifications).toContainText("history-oversized-event");
  await expect(notifications).toContainText("Later Capture continues");
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachNamedScenarioScreenshot(page, testInfo, "history-evidence-gap-shallow-forced-dark");
  await expectShellFits(page);
});

test("Workbench explains server errors and keepalives in Notifications without a health verdict", async ({ page }, testInfo) => {
  const scenes = [
    { width: 563, height: 700, theme: "dark" as const },
    { width: 900, height: 700, theme: "light" as const },
    { width: 900, height: 320, theme: "dark" as const },
    { width: 1440, height: 900, theme: "light" as const }
  ];
  for (const scene of scenes) {
    await openScenario(page, "diagnostic-server-callbacks", scene, scene.theme);
    const trigger = page.getByRole("button", { name: "Notifications (2) · Warning", exact: true });
    await trigger.click();
    const notifications = page.getByRole("region", { name: "Notifications", exact: true });
    await notifications.getByText("Filter notifications", { exact: true }).click();
    await notifications.getByRole("button", { name: "Exclude Warning", exact: true }).click();
    await expect(notifications).toContainText("1 of 2 notifications");
    await expect(trigger).toBeVisible();
    await notifications.getByRole("button", { name: "Reset notification filters", exact: true }).click();
    await notifications.getByText("Filter notifications", { exact: true }).click();
    await expect(page.getByRole("region", { name: "Workbench diagnostics" })).not.toContainText("Server keepalive observed");
    await expect(notifications.getByText("Warning · Server error -7", { exact: true })).toHaveCount(1);
    await expect(notifications.getByText("Information · Server keepalive observed", { exact: true })).toHaveCount(1);
    await expect(notifications).toContainText("Affected: Session diagnostic-session");
    await expect(notifications).toContainText("Non-positive codes can be application-specific");
    await expect(notifications).toContainText("14 keepalive callbacks in bounded window diagnostic-session:1");
    await expect(notifications).toContainText("does not prove that the connection, application, or end-to-end data flow is healthy");
    await expect(page.getByText("Server error -7", { exact: false })).toHaveCount(1);
    const routes = notifications.getByRole("button", { name: "Inspect supporting Evidence" });
    await expect(routes).toHaveCount(2);
    await routes.first().focus();
    await expect(routes.first()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "diagnostic-server-error · Server Error" })).toBeVisible();
    const back = page.getByRole("button", { name: "Back investigation" });
    await expect(back).toBeEnabled();
    await back.click();
    await expect(page.getByRole("heading", { name: "diagnostic-server-error · Server Error" })).toHaveCount(0);
    await expectShellFits(page);
    await expectNoSeriousAxeViolations(page, testInfo);
    await attachNamedScenarioScreenshot(page, testInfo, `server-diagnostics-${scene.width}x${scene.height}-${scene.theme}`);
  }
  await page.emulateMedia({ forcedColors: "active" });
  const forcedFooter = page.getByRole("region", { name: "Notifications", exact: true });
  await expect(forcedFooter).toContainText("Warning · Server error -7");
  await expect(forcedFooter).toContainText("Information · Server keepalive observed");
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Workbench explains committed Subscription and topology diagnostics in Notifications", async ({ page }, testInfo) => {
  const scenes = [
    { width: 563, height: 700, theme: "dark" as const },
    { width: 900, height: 700, theme: "light" as const },
    { width: 900, height: 320, theme: "dark" as const },
    { width: 1440, height: 900, theme: "light" as const }
  ];
  for (const [sceneIndex, scene] of scenes.entries()) {
    await openScenario(page, "diagnostic-subscription-context", scene, scene.theme);
    await page.getByRole("button", { name: /^Notifications/ }).click();
    const footer = page.getByRole("region", { name: "Workbench diagnostics" });
    const contextDiagnostics = page.getByRole("region", { name: "Notifications", exact: true });
    await expect(contextDiagnostics).toContainText("Information · Exact duplicate Subscriptions");
    await expect(contextDiagnostics).toContainText("Information · Semantic Subscription overlap");
    await expect(contextDiagnostics).toContainText("Information · Listener registration churn");
    await expect(contextDiagnostics).toContainText("immutable committed topology facts");
    await expect(contextDiagnostics).toContainText("does not infer application intent");
    await expect(footer).not.toContainText("Exact duplicate Subscriptions");

    if (sceneIndex === 0) {
      await contextDiagnostics.getByText("Filter notifications", { exact: true }).click();
      const includeExact = contextDiagnostics.getByRole("button", { name: "Include ls.subscription.exact-duplicate", exact: true });
      const includeOverlap = contextDiagnostics.getByRole("button", { name: "Include ls.subscription.semantic-overlap", exact: true });
      await includeExact.click();
      await expect(contextDiagnostics).toContainText("Exact duplicate Subscriptions");
      await expect(contextDiagnostics).not.toContainText("Semantic Subscription overlap");
      await expect(includeOverlap).toBeVisible();
      await expect(contextDiagnostics.getByRole("button", { name: "Include Information", exact: true })).toBeVisible();
      await expect(contextDiagnostics.getByRole("button", { name: "Include Subscription duplicate-a", exact: true })).toBeVisible();
      await includeOverlap.click();
      await expect(contextDiagnostics).toContainText("Exact duplicate Subscriptions");
      await expect(contextDiagnostics).toContainText("Semantic Subscription overlap");
      await expect(contextDiagnostics.getByRole("button", { name: "Remove Include ls.subscription.exact-duplicate", exact: true })).toBeVisible();
      await contextDiagnostics.getByRole("button", { name: "Exclude ls.subscription.exact-duplicate", exact: true }).click();
      await expect(contextDiagnostics).not.toContainText("Exact duplicate Subscriptions");
      await expect(contextDiagnostics).toContainText("Semantic Subscription overlap");
      await expect(contextDiagnostics.getByRole("button", { name: "Remove Exclude ls.subscription.exact-duplicate", exact: true })).toBeVisible();
      await contextDiagnostics.getByRole("button", { name: "Remove Include ls.subscription.semantic-overlap", exact: true }).click();
      await expect(contextDiagnostics).not.toContainText("Exact duplicate Subscriptions");
      await contextDiagnostics.getByRole("button", { name: "Reset notification filters", exact: true }).click();
      await expect(contextDiagnostics).toContainText("Exact duplicate Subscriptions");
      await expect(contextDiagnostics).toContainText("Semantic Subscription overlap");
      await expect(contextDiagnostics).toContainText("Listener registration churn");
    }

    const exactDuplicate = contextDiagnostics.locator(".workbench-react__notification").filter({ hasText: "Exact duplicate Subscriptions" }).first();
    const exactRoute = exactDuplicate.getByRole("button", { name: "Inspect supporting Evidence" });
    await exactRoute.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /duplicate-b · Subscription Started/ })).toBeVisible();
    await page.getByRole("button", { name: "Back investigation" }).click();
    const rawNotice = contextDiagnostics.getByRole("article").filter({ hasText: "RAW snapshot unavailable" });
    await rawNotice.getByRole("button", { name: "Inspect affected Scope", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /raw-capability/ })).toBeFocused();
    await expect(page.getByRole("navigation", { name: "Current runtime scope" })).toContainText("raw-capability");
    await page.getByRole("button", { name: /^Notifications/ }).click();
    const selectedContextDiagnostics = page.getByRole("region", { name: "Notifications", exact: true });
    await expect(selectedContextDiagnostics).toContainText("RAW snapshot unavailable");
    await expect(selectedContextDiagnostics).toContainText("Buffer request not applicable");
    await expect(selectedContextDiagnostics).toContainText("Exact duplicate Subscriptions");
    await expect(footer).not.toContainText("RAW snapshot unavailable");
    await expectShellFits(page);
    await expectNoSeriousAxeViolations(page, testInfo);
    await attachNamedScenarioScreenshot(page, testInfo, `subscription-diagnostics-${scene.width}x${scene.height}-${scene.theme}`);
  }
  await page.emulateMedia({ forcedColors: "active" });
  await expect(page.getByRole("region", { name: "Notifications", exact: true })).toContainText("RAW snapshot unavailable");
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Workbench presents lost-update, snapshot, and COMMAND anomalies without duplicate banners", async ({ page }, testInfo) => {
  await openScenario(page, "diagnostic-anomalies", { width: 900, height: 700 }, "dark");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const footer = page.getByRole("region", { name: "Workbench diagnostics" });
  const contextDiagnostics = page.getByRole("region", { name: "Notifications", exact: true });
  await expect(contextDiagnostics).toContainText("Warning · Snapshot phase incomplete");
  await expect(contextDiagnostics).toContainText("Warning · Unknown COMMAND key update");
  await expect(contextDiagnostics).toContainText("Warning · Subscription updates lost");
  await expect(contextDiagnostics.getByText("Snapshot phase incomplete", { exact: false })).toHaveCount(1);
  await expect(footer).not.toContainText("Snapshot phase incomplete");
  const routes = contextDiagnostics.getByRole("button", { name: "Inspect supporting Evidence" });
  await expect(routes).not.toHaveCount(0);
  await routes.last().focus();
  await expect(routes.last()).toBeFocused();
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachNamedScenarioScreenshot(page, testInfo, "diagnostic-anomalies-normal-dark");
});

test("Workbench retains ordered Evidence while a typed Session recovery is in progress", async ({
  page
}, testInfo) => {
  await openScenario(page, "recovering", { width: 900, height: 700 }, "dark");

  await expect(page.getByText("Capture RUNNING", { exact: true })).toBeVisible();
  await expect(page.getByText("Coverage USEFUL", { exact: true })).toBeVisible();
  await expect(page.getByText("Warning · Session recovering", { exact: true })).toBeVisible();
  await expect(page.getByText("Affected: Session topology-small-session", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "The official client is attempting Session recovery. Evidence remains ordered, but current runtime availability may change.",
      { exact: true }
    )
  ).toBeVisible();
  await expect(page.locator(".workbench-react__evidence-row")).toHaveCount(5);
  await expect(page.locator(".workbench-react__evidence-row").evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-evidence-id"))
  )).resolves.toEqual(["event-1", "event-2", "event-3", "event-4", "event-5"]);
  await page.getByRole("button", { name: "Scope", exact: true }).click();
  await expect(page.getByRole("treeitem").filter({ hasText: "topology-small-session" })).toContainText("Recovering");
  await page.keyboard.press("Escape");

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench preserves footer focus while lower-capacity history remains active", async ({
  page
}, testInfo) => {
  await openScenario(page, "memory-fallback", { width: 900, height: 700 }, "dark");
  const diagnostics = page.getByRole("region", { name: "Workbench diagnostics" });

  await diagnostics.focus();
  await expect(diagnostics).toBeFocused();
  await expect(page.getByText("Warning · History using memory", { exact: true })).toBeVisible();
  await expect(diagnostics).toContainText("Observation Coverage is unchanged");
  await expect(diagnostics).toBeFocused();
  await expect(diagnostics).toHaveAttribute("tabindex", "0");
  await expect(diagnostics).toHaveCSS("outline-style", "solid");
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Workbench renders one typed history condition across geometry, theme, and forced colors", async ({
  page
}, testInfo) => {
  const scenes = [
    { width: 900, height: 700, theme: "dark" as const },
    { width: 563, height: 700, theme: "light" as const },
    { width: 900, height: 320, theme: "dark" as const },
    { width: 1440, height: 900, theme: "light" as const }
  ];

  for (const scene of scenes) {
    await openScenario(page, "memory-fallback", scene, scene.theme);
    const diagnostics = page.getByRole("region", { name: "Workbench diagnostics" });
    await expect(diagnostics.getByText("Warning · History using memory", { exact: true })).toHaveCount(1);
    await expect(diagnostics.locator("[data-history-condition='true']")).toHaveCount(1);
    await expect(page.locator(".workbench-react__history-live-region")).toHaveCount(1);
    await expect(page.locator(".workbench-react__history-live-region")).toHaveAttribute("aria-live", "polite");
    await expect(diagnostics).toContainText("Observation Coverage is unchanged");
    await expectShellFits(page);
    await expectNoSeriousAxeViolations(page, testInfo);
  }

  await page.emulateMedia({ forcedColors: "active" });
  const forcedColorsDiagnostics = page.getByRole("region", { name: "Workbench diagnostics" });
  await expect(forcedColorsDiagnostics.getByText("Warning · History using memory", { exact: true })).toHaveCount(1);
  await expect(forcedColorsDiagnostics).toContainText("Observation Coverage is unchanged");
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Workbench keeps mixed-size footer diagnostics readable and bounded across geometry", async ({
  page
}, testInfo) => {
  const scenes = [
    { width: 1440, height: 900, theme: "light" as const },
    { width: 900, height: 700, theme: "dark" as const },
    { width: 900, height: 320, theme: "light" as const },
    { width: 563, height: 700, theme: "dark" as const }
  ];

  for (const scene of scenes) {
    await openScenario(page, "diagnostics-stress", scene, scene.theme);
    const footer = page.getByRole("region", { name: "Workbench diagnostics" });
    const entries = footer.locator(".workbench-react__status-diagnostic");
    await expect(entries).toHaveCount(2);
    await expect(footer.getByText("Warning · History catching up", { exact: true })).toHaveCount(0);
    await expect(footer.getByText("Error · Capture disconnected", { exact: true })).toHaveCount(1);
    await expect(footer.getByText("Information · Retired Scope", { exact: true })).toHaveCount(1);
    await expect(footer.getByText("2 diagnostics · Scroll to review all", { exact: true })).toBeVisible();

    const layout = await entries.evaluateAll((diagnostics) => diagnostics.map((diagnostic) => {
      const affected = diagnostic.querySelector(".workbench-react__status-affected");
      const detail = diagnostic.querySelector(".workbench-react__status-detail");
      const recovery = diagnostic.querySelector(".workbench-react__status-recovery");
      const diagnosticWidth = diagnostic.getBoundingClientRect().width;
      return {
        diagnosticWidth,
        affectedWidth: affected?.getBoundingClientRect().width ?? 0,
        detailWidth: detail?.getBoundingClientRect().width ?? 0,
        recoveryWidth: recovery?.getBoundingClientRect().width ?? diagnosticWidth
      };
    }));
    for (const entry of layout) {
      expect(entry.affectedWidth).toBeGreaterThanOrEqual(Math.min(320, entry.diagnosticWidth * 0.35));
      if (scene.height !== 320) {
        expect(entry.detailWidth).toBeGreaterThanOrEqual(entry.diagnosticWidth * 0.75);
        expect(entry.recoveryWidth).toBeGreaterThanOrEqual(entry.diagnosticWidth * 0.75);
      }
    }

    const workspace = page.locator(".workbench-react__workspace");
    const footerSize = await footer.evaluate((element) => ({
      clientHeight: element.clientHeight,
      viewportHeight: window.innerHeight
    }));
    expect(footerSize.clientHeight).toBeLessThan(footerSize.viewportHeight * 0.5);
    await expect(workspace).toBeVisible();
    expect(await workspace.evaluate((element) => element.clientHeight)).toBeGreaterThanOrEqual(64);
    await expect(footer.getByRole("button", { name: "Freeze Evidence" })).toBeVisible();

    if (scene.height === 320) {
      const evidenceViewport = page.getByRole("grid", { name: "Ordered Lightstreamer Evidence" });
      const firstEvidenceRow = evidenceViewport.locator(".workbench-react__evidence-row").first();
      const evidenceVisibility = await firstEvidenceRow.evaluate((row) => {
        const viewport = row.parentElement;
        if (!(viewport instanceof HTMLElement)) return null;
        const rowRect = row.getBoundingClientRect();
        const viewportRect = viewport.getBoundingClientRect();
        return { rowTop: rowRect.top, rowBottom: rowRect.bottom, viewportTop: viewportRect.top, viewportBottom: viewportRect.bottom };
      });
      expect(evidenceVisibility).not.toBeNull();
      expect(evidenceVisibility!.rowTop).toBeGreaterThanOrEqual(evidenceVisibility!.viewportTop - 1);
      expect(evidenceVisibility!.rowBottom).toBeLessThanOrEqual(evidenceVisibility!.viewportBottom + 1);

      const diagnosticList = footer.getByLabel("Workbench diagnostic entries");
      const firstDetailsCue = entries.first().getByText("Diagnostic details", { exact: true });
      const cueVisibility = await firstDetailsCue.evaluate((cue) => {
        const owner = cue.closest(".workbench-react__status-diagnostics");
        if (!(owner instanceof HTMLElement)) return null;
        const cueRect = cue.getBoundingClientRect();
        const ownerRect = owner.getBoundingClientRect();
        return { cueTop: cueRect.top, cueBottom: cueRect.bottom, ownerTop: ownerRect.top, ownerBottom: ownerRect.bottom };
      });
      expect(cueVisibility).not.toBeNull();
      expect(cueVisibility!.cueTop).toBeGreaterThanOrEqual(cueVisibility!.ownerTop - 1);
      expect(cueVisibility!.cueBottom).toBeLessThanOrEqual(cueVisibility!.ownerBottom + 1);
      await diagnosticList.focus();
      await expect(diagnosticList).toBeFocused();
      await page.keyboard.press("End");
      await expect.poll(() => diagnosticList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      const lastEntry = entries.last();
      const visibility = await lastEntry.evaluate((entry) => {
        const owner = entry.parentElement;
        if (!(owner instanceof HTMLElement)) return null;
        const entryRect = entry.getBoundingClientRect();
        const ownerRect = owner.getBoundingClientRect();
        return { entryTop: entryRect.top, entryBottom: entryRect.bottom, ownerTop: ownerRect.top, ownerBottom: ownerRect.bottom };
      });
      expect(visibility).not.toBeNull();
      // A mixed-size card may be taller than this shallow scrollport. End must
      // expose its trailing content; requiring both edges would make that
      // legitimate, scrollable layout impossible.
      expect(visibility!.entryBottom).toBeGreaterThan(visibility!.ownerTop);
      expect(visibility!.entryBottom).toBeLessThanOrEqual(visibility!.ownerBottom + 1);
      await expect(lastEntry).toContainText("Select a current runtime Scope before starting Local Injection");
      await page.keyboard.press("Home");
      await expect.poll(() => diagnosticList.evaluate((element) => element.scrollTop)).toBe(0);
    }
    const dismissActions = footer.getByRole("button", { name: /^Dismiss / });
    await expect(dismissActions).toHaveCount(2);
    for (let index = 0; index < 2; index += 1) {
      const action = dismissActions.nth(index);
      await action.focus();
      await expect(action).toBeFocused();
      await expect(action).toBeInViewport();
      expect(await action.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
      })).toBe(true);
    }
    await page.getByLabel("Workbench diagnostic entries").focus();
    await page.keyboard.press("Home");
    await expectShellFits(page);
    await expectNoSeriousAxeViolations(page, testInfo);
    await attachNamedScenarioScreenshot(page, testInfo, `diagnostics-${scene.width}x${scene.height}-${scene.theme}`);
  }

  await openScenario(page, "diagnostics-stress", { width: 900, height: 700 }, "dark");
  const footer = page.getByRole("region", { name: "Workbench diagnostics" });
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const notifications = page.getByRole("region", { name: "Notifications", exact: true });
  await expect(notifications).not.toContainText("History near capacity");
  await expect(notifications).toContainText("Capture disconnected");
  await expect(notifications).toContainText("Retired Scope");
  await footer.getByRole("button", { name: "Dismiss Capture disconnected", exact: true }).click();
  await expect(footer.getByText("Error · Capture disconnected", { exact: true })).toHaveCount(0);
  await expect(notifications).toContainText("Capture disconnected");
  await expect(footer.getByRole("button", { name: "Dismiss Retired Scope", exact: true })).toBeFocused();
});

test("Workbench keeps a retired Session readable, scoped, and explicitly read-only", async ({
  page
}, testInfo) => {
  await openScenario(page, "retired-scope", { width: 900, height: 700 }, "light");

  await expect(page.locator(".workbench-react__scope-label")).toContainText("Historical session topology-small-session");
  await expect(page.locator(".workbench-react__scope-status")).toContainText("Historical · read-only");
  await expect(page.getByText("Information · Retired Scope", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "This historical runtime object is read-only. Matching retained Evidence remains available.",
      { exact: true }
    )
  ).toBeVisible();
  await expect(page.locator(".workbench-react__evidence-row")).toHaveCount(4);
  await expect(page.locator('[data-evidence-id="event-1"]')).toBeVisible();
  await expect(page.locator('[data-evidence-id="event-4"]')).toBeVisible();
  await expect(page.locator('[data-evidence-id="event-5"]')).toHaveCount(0);
  const retiredSession = page.locator('.workbench-react__scope-node[role="treeitem"]', {
    hasText: "Historical session topology-small-session"
  });
  await expect(retiredSession).toHaveAttribute("data-retired", "true");
  await expect(retiredSession).toHaveAttribute("aria-selected", "true");

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench gives an empty current Scope a truthful compact orientation", async ({ page }, testInfo) => {
  await openScenario(page, "empty-scope", { width: 563, height: 700 }, "dark");

  await expect(page.getByText("Capture IDLE", { exact: true })).toBeVisible();
  await expect(page.getByText("Coverage USEFUL", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scope", exact: true })).toBeVisible();
  await expect(page.getByText("No Evidence in the current Scope.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Change Scope" })).toBeVisible();

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench routes an empty Scope change through the temporary picker above Evidence", async ({ page }, testInfo) => {
  for (const [viewport, theme, label] of [
    [{ width: 900, height: 700 }, "light", "normal"],
    [{ width: 900, height: 320 }, "dark", "shallow"]
  ] as const) {
    await openScenario(page, "empty-scope", viewport, theme);
    const changeScope = page.getByRole("button", { name: "Change Scope" });
    await changeScope.click();
    const closeScope = page.getByRole("button", { name: "Close Scope" });
    const scopeTree = page.getByRole("tree", { name: /Runtime Scope tree/ });
    await expect(closeScope).toBeVisible();
    await expect(scopeTree.getByRole("treeitem").first()).toBeVisible();
    expect(await closeScope.evaluate(button => {
      const bounds = button.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return hit !== null && button.contains(hit);
    })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`empty-scope-picker-${label}.png`) });
    await closeScope.click();
    await expect(changeScope).toBeFocused();
  }
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench keeps Filter and Find separate across raw, disconnected, fallback, and reopened scenarios", async ({ page }, testInfo) => {
  await openScenario(page, "filter-find", { width: 900, height: 700 }, "auto");
  await expect(page.locator(".workbench-react")).toHaveAttribute("data-theme", "auto");
  await expect(page.locator(".workbench-react")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
    document.querySelector<HTMLElement>("#app")!.dataset.theme = "dark";
  });
  await expect(page.locator(".workbench-react")).toHaveCSS("background-color", "rgb(27, 29, 32)");
  await expect(page.locator(".workbench-react__active-filter")).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toHaveText("Filter: scenario-event");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.getByRole("search", { name: "Find in ordered Evidence" })).toContainText(/matches/);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Find", exact: true })).toBeFocused();

  await openScenario(page, "raw-evidence", { width: 900, height: 700 }, "dark");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(page.url()).origin
  });
  await page.getByRole("button", { name: "Copy raw Evidence" }).click();
  await expect(page.getByRole("status")).toContainText("Copied raw Evidence");

  await openScenario(page, "disconnected", { width: 900, height: 320 }, "light");
  await expect(page.getByText("Capture STOPPED", { exact: true })).toBeVisible();
  await expect(page.getByText("Coverage USEFUL", { exact: true })).toBeVisible();
  const disconnectedDiagnostics = page.getByRole("region", { name: "Workbench diagnostics" });
  await expect(disconnectedDiagnostics.getByText("Error · Capture disconnected", { exact: true })).toBeVisible();
  const disconnectedDetails = disconnectedDiagnostics.getByText("Diagnostic details", { exact: true });
  await expect(disconnectedDetails).toBeVisible();
  await disconnectedDetails.click();
  await expect(disconnectedDiagnostics.getByText(/cannot observe new inspected-page activity/)).toBeVisible();
  await expect(disconnectedDiagnostics.getByText("Warning · Coverage LIMITED", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open complete raw" }).focus();
  await page.keyboard.press("Tab");
  await expect(disconnectedDiagnostics).toBeFocused();
  await expect(disconnectedDiagnostics).toHaveCSS("outline-style", "solid");
  const diagnosticEntries = page.getByLabel("Workbench diagnostic entries");
  await diagnosticEntries.focus();
  await page.keyboard.press("End");
  await expect.poll(() => diagnosticEntries.evaluate((region) => region.scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => diagnosticEntries.evaluate((region) => {
    const regionRect = region.getBoundingClientRect();
    const diagnostic = region.querySelector<HTMLElement>(".workbench-react__status-diagnostic:last-child");
    if (!diagnostic) return false;
    const diagnosticRect = diagnostic.getBoundingClientRect();
    return diagnosticRect.top < regionRect.bottom && diagnosticRect.bottom > regionRect.top;
  })).toBe(true);
  await expect.poll(() => page.getByLabel("Ordered Evidence").evaluate((evidence) => {
    const evidenceRect = evidence.getBoundingClientRect();
    return [...evidence.querySelectorAll<HTMLElement>(".workbench-react__evidence-row")].filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.height > 0 && rect.top >= evidenceRect.top && rect.bottom <= evidenceRect.bottom;
    }).length;
  })).toBeGreaterThanOrEqual(1);
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);

  await openScenario(page, "memory-fallback", { width: 563, height: 700 }, "dark");
  const fallbackDiagnostics = page.getByRole("region", { name: "Workbench diagnostics" });
  const fallbackDetail = "PRIMARY_JOURNAL_UNAVAILABLE. Capture continues with a rolling memory Retained Range of 5,000 Evidence records or 32 MiB. No Evidence Gap was created by this storage change, and Observation Coverage is unchanged.";
  await expect(page.getByText("Coverage USEFUL", { exact: true })).toBeVisible();
  await expect(fallbackDiagnostics.getByText("Warning · History using memory", { exact: true })).toBeVisible();
  await expect(fallbackDiagnostics).toContainText(fallbackDetail);
  await expect(page.getByText(fallbackDetail, { exact: false })).toHaveCount(1);
  await expect.poll(() => page.getByLabel("Ordered Evidence").evaluate((evidence) => {
    const rect = evidence.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  })).toEqual({ left: 0, right: 563 });
  await page.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByText("in-memory fallback")).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench preserves a Filter-hidden selection through passive Capture and provides deliberate recovery", async ({ page }, testInfo) => {
  await openScenario(page, "filter-hidden-selection", { width: 900, height: 700 }, "dark");

  await expect(page.getByText("Selected event outside current results", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "scenario-event-3 · Item Update" })).toBeVisible();
  const selectedUpdate = page.getByRole("complementary", { name: "Context" })
    .getByRole("region", { name: "Selected update" });
  await expect(selectedUpdate.getByRole("region", { name: "Fields", exact: true }))
    .toContainText('"selected": false');
  await expect(selectedUpdate.getByRole("region", { name: "Changed fields", exact: true })).toHaveCount(0);
  await expect(selectedUpdate.getByRole("region", { name: "JSON patches", exact: true })).toHaveCount(0);
  const focusedVisible = page.locator('[data-evidence-id="scenario-event-1"]');
  await expect(focusedVisible).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("grid", { name: "Ordered Lightstreamer Evidence" })).toHaveAttribute("tabindex", "0");
  await expect(page.locator('[data-evidence-id="scenario-event-1-passive"]')).toBeVisible();

  await page.getByRole("button", { name: "Open complete raw" }).click();
  const rawEvidence = page.getByLabel("Complete raw Evidence");
  await expect(rawEvidence).toContainText("scenario-event-3 · immutable SERVER Evidence");
  await expect(rawEvidence.locator("pre")).toContainText('"changedFields"');
  await expect(rawEvidence.locator("pre")).toContainText('"jsonPatches"');
  await page.getByRole("button", { name: "Back to Evidence" }).click();
  await expect(page.getByText("Selected event outside current results", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Reveal selected Evidence" }).click();
  await expect(page.getByText("Selected event outside current results", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-evidence-id="scenario-event-3"]')).toHaveAttribute("aria-selected", "true");

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench marks and navigates Find results without changing selected Evidence", async ({ page }, testInfo) => {
  await openScenario(page, "filter-find", { width: 900, height: 700 }, "light");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  const current = page.locator('[data-find-current="true"]');
  const before = await current.getAttribute("data-evidence-id");
  await expect(current).toContainText(/Find 1 of/);
  await page.keyboard.press("Enter");
  await expect.poll(() => page.locator('[data-find-current="true"]').getAttribute("data-evidence-id")).not.toBe(before);
  await expect(page.locator('[data-evidence-id="scenario-event-3"]')).toHaveAttribute("aria-selected", "true");
  const findCurrent = page.locator('[data-find-current="true"]');
  const findIdentityCell = findCurrent.locator('[role="gridcell"]').first();
  expect(await findIdentityCell.evaluate((cell) => {
    const match = cell.querySelector<HTMLElement>(".workbench-react__find-match");
    if (!match) return false;
    const cellRect = cell.getBoundingClientRect();
    const matchRect = match.getBoundingClientRect();
    return matchRect.top >= cellRect.top && matchRect.bottom <= cellRect.bottom;
  })).toBe(true);

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench keeps retired Scope selectable and explicitly historical", async ({ page }, testInfo) => {
  await openScenario(page, "retired-scope", { width: 1440, height: 900 }, "dark");
  const retired = page.locator('[role="treeitem"][data-retired="true"]').first();
  await expect(retired).toContainText("Retired");
  await expect(retired).not.toHaveAttribute("aria-disabled", "true");
  await retired.click();
  await expect(retired).toHaveAttribute("aria-selected", "true");

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench exposes selected Item Update Fields while Evidence metadata is collapsed and preserves readable JSON strings", async ({ page }, testInfo) => {
  await openScenario(page, "local-injection-json", { width: 1440, height: 900 }, "dark");

  const context = page.getByRole("complementary", { name: "Context" });
  const selectedUpdate = context.getByRole("region", { name: "Selected update" });
  const metadata = context.locator('details[aria-label="Evidence metadata"]');
  const contextFields = metadata.locator(".workbench-react__context-fields");
  await expect(metadata).not.toHaveAttribute("open", "");
  await expect(contextFields.getByText("Source", { exact: true })).toBeHidden();
  await expect(selectedUpdate).toBeVisible();
  await expect(selectedUpdate.getByRole("region", { name: "Fields", exact: true })).toContainText("modelValues");
  await expect(selectedUpdate.getByRole("region", { name: "Changed fields", exact: true })).toHaveCount(0);
  await expect(selectedUpdate.getByRole("region", { name: "JSON patches", exact: true })).toHaveCount(0);
  await expect(selectedUpdate.getByText("JSON string", { exact: true })).toHaveCount(1);
  await expect(selectedUpdate).toContainText('"selected": false');
  await expect(selectedUpdate).toContainText('{"passenger":');
  await expect(context.getByRole("region", { name: "COMMAND projection summary" })).toHaveCount(0);
  await expect(context.getByRole("button", { name: /COMMAND projections/ })).toHaveCount(0);
  expect(await metadata.evaluate((details, update) =>
    Boolean(details.compareDocumentPosition(update as Node) & Node.DOCUMENT_POSITION_FOLLOWING),
    await selectedUpdate.elementHandle()
  )).toBe(true);
  await metadata.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(contextFields.getByText("Source", { exact: true })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(metadata).not.toHaveAttribute("open", "");

  await page.setViewportSize({ width: 900, height: 700 });
  const selectedHeading = selectedUpdate.getByRole("heading", { name: "Selected update" });
  await selectedHeading.scrollIntoViewIfNeeded();
  await expect(selectedHeading).toBeInViewport();
  const modelValues = selectedUpdate.getByText("modelValues", { exact: true }).first();
  await modelValues.scrollIntoViewIfNeeded();
  await expect(modelValues).toBeInViewport();

  await page.setViewportSize({ width: 563, height: 700 });
  await page.getByRole("button", { name: "Open selected Context" }).click();
  await expect(selectedUpdate).toBeVisible();
  await context.getByRole("button", { name: "Create Local Injection Draft" }).click();

  const draft = page.getByRole("region", { name: "Local Injection Draft" });
  const editor = page.getByRole("textbox", { name: "Local Injection JSON", exact: true });
  const scrollOwner = draft.locator('[data-shared-scroll-owner="true"]');
  await expect(editor).toContainText('"modelValues": {');
  await expect(editor).toContainText('"itinerary": [');
  await expect(editor).not.toContainText('\\"selected\\"');
  await expect.poll(() => scrollOwner.evaluate((owner) => owner.scrollHeight > owner.clientHeight)).toBe(true);
  await editor.focus();
  await scrollOwner.evaluate((owner) => { owner.scrollTop = 0; });
  await page.keyboard.press("PageDown");
  await expect.poll(() => scrollOwner.evaluate((owner) => owner.scrollTop)).toBeGreaterThan(0);
  const afterPageDown = await scrollOwner.evaluate((owner) => owner.scrollTop);
  await editor.hover();
  await page.mouse.wheel(0, 400);
  await expect.poll(() => scrollOwner.evaluate((owner) => owner.scrollTop)).toBeGreaterThan(afterPageDown);
  const beforePageUp = await scrollOwner.evaluate((owner) => owner.scrollTop);
  await editor.focus();
  await page.keyboard.press("PageUp");
  await expect.poll(() => scrollOwner.evaluate((owner) => owner.scrollTop)).toBeLessThan(beforePageUp);
  await scrollOwner.evaluate((owner) => { owner.scrollTop = 0; });
  await editor.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await expect.poll(() => scrollOwner.evaluate((owner) => owner.scrollTop)).toBeGreaterThan(0);
  const scrollContract = await draft.evaluate((region) => ({
    owners: region.querySelectorAll('[data-shared-scroll-owner="true"]').length,
    nestedScrollable: Array.from(region.querySelectorAll<HTMLElement>(".cm-scroller"))
      .some((node) => getComputedStyle(node).overflowY !== "visible")
  }));
  expect(scrollContract).toEqual({ owners: 1, nestedScrollable: false });

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench edits one protected captured Local Injection Draft in lazy CodeMirror", async ({ page }, testInfo) => {
  await openScenario(page, "local-injection-captured", { width: 1440, height: 900 }, "dark");
  await page.getByRole("button", { name: "Create Local Injection Draft" }).click();

  const draft = page.getByRole("region", { name: "Local Injection Draft" });
  await expect(draft).toBeVisible();
  await expect(draft).toContainText("topology-small-subscription");
  await expect(draft).toContainText("Session topology-small-session");
  await expect(draft).toContainText("Source event-5 · immutable");
  await expect(draft).toContainText("LOCAL ONLY");
  await expect(draft).toContainText("READY");
  const editor = page.getByRole("textbox", { name: "Local Injection JSON", exact: true });
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  await expect(page.locator('[data-editor-engine="codemirror-6"]')).toBeVisible();
  await expect(page.getByText("Immutable Source", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Compare Source" }).click();
  await expect(page.getByText("Immutable Source", { exact: true })).toBeVisible();
  await expect(page.getByText("Injection Draft", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Immutable Injection Source JSON")).toBeVisible();
  const scrollContract = await draft.evaluate((region) => {
    const owner = region.querySelector<HTMLElement>('[data-shared-scroll-owner="true"]')!;
    const scrollers = Array.from(region.querySelectorAll<HTMLElement>(".cm-scroller"));
    return {
      ownerOverflowY: getComputedStyle(owner).overflowY,
      ownerScrollHeight: owner.scrollHeight,
      ownerClientHeight: owner.clientHeight,
      inner: scrollers.map((scroller) => ({
        overflowY: getComputedStyle(scroller).overflowY,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight
      }))
    };
  });
  expect(scrollContract.ownerOverflowY).toBe("auto");
  expect(scrollContract.ownerScrollHeight).toBeGreaterThanOrEqual(scrollContract.ownerClientHeight);
  expect(scrollContract.inner).toHaveLength(2);
  expect(scrollContract.inner.every(({ overflowY, scrollHeight, clientHeight }) =>
    overflowY === "visible" && scrollHeight === clientHeight
  )).toBe(true);

  await page.setViewportSize({ width: 900, height: 700 });
  await expect(draft).toHaveAttribute("data-compare-layout", "inline");
  const compareTops = await page.locator(".workbench-react__local-compare-labels strong").evaluateAll((labels) =>
    labels.map((label) => label.getBoundingClientRect().top)
  );
  expect(compareTops[1]).toBeGreaterThan(compareTops[0]!);
  await page.getByRole("button", { name: "Compare Source" }).click();
  await expect(page.getByText("Immutable Source", { exact: true })).toHaveCount(0);

  await editor.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f");
  await expect(page.locator(".cm-search")).toBeVisible();
  await expect(page.getByRole("search", { name: "Find in ordered Evidence" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await editor.focus();
  await page.keyboard.press("Tab");
  await expect(editor).not.toBeFocused();
  await page.getByLabel("Tab inserts indentation").check();
  await editor.focus();
  await page.keyboard.press("Tab");
  await expect(editor).toBeFocused();

  await expect(draft.getByRole("button", { name: "Review Local Injection" })).toBeEnabled();
  await expect(draft.locator('[role="tablist"]')).toHaveCount(0);
  await expect(draft).not.toContainText("Add event");
  await expect(draft).not.toContainText("Server Injection");
  await expect(draft).not.toContainText("Replay");

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench authors a source-free COMMAND Item Update from a live single-item Subscription without captured Evidence selection", async ({ page }, testInfo) => {
  await openScenario(page, "local-injection-authored", { width: 900, height: 700 }, "light");
  await expect(page.locator('[aria-label="Ordered Lightstreamer Evidence"] [aria-selected="true"]')).toHaveCount(0);
  const author = page.getByRole("button", { name: "Author COMMAND Item Update" });
  await expect(author).toBeVisible();
  await author.focus();
  await expect(author).toBeFocused();
  await page.keyboard.press("Enter");

  const draft = page.getByRole("region", { name: "Local Injection Draft" });
  const editor = page.getByRole("textbox", { name: "Local Injection JSON", exact: true });
  await expect(editor).toBeFocused();
  await expect(draft).toContainText("topology-small-subscription");
  await expect(draft).toContainText("Session topology-small-session");
  await expect(draft).toContainText("LOCAL ONLY");
  await expect(draft).toContainText("Source None · newly authored");
  await expect(page.getByRole("button", { name: "Compare Source" })).toBeDisabled();
  await expect(draft.getByRole("button", { name: "Review Local Injection" })).toBeDisabled();

  const authoredJson = JSON.stringify({
    command: "ADD",
    key: "authored-local-1",
    isSnapshot: false,
    fields: { command: "ADD", key: "authored-local-1", value: "42" }
  }, null, 2);
  await editor.fill(authoredJson);
  await expect(draft).toContainText("Ready for Review");
  await draft.getByRole("button", { name: "Review Local Injection" }).click();
  const reviewRegion = draft.getByRole("region", { name: "Review Local Injection" });
  await expect(reviewRegion).toBeVisible();
  await expect(reviewRegion.getByRole("heading", { name: "Review Local Injection" })).toBeFocused();
  await expect(editor).toBeHidden();
  await expect(page.getByLabel("Reviewed Local Injection JSON", { exact: true })).toContainText("authored-local-1");
  await expect(draft.getByRole("button", { name: "Inject locally" })).toBeEnabled();
  await expect(draft).toContainText("Observed Server COMMAND State remains unchanged");
  await draft.getByRole("button", { name: "Back to JSON" }).click();
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  await expect(editor).toContainText("authored-local-1");

  await page.setViewportSize({ width: 563, height: 700 });
  await editor.focus();
  await draft.getByRole("button", { name: "Collapse Draft event" }).click();
  await expect(draft.getByRole("button", { name: "Expand Draft event" })).toBeFocused();
  await expect(draft).toContainText("topology-small-subscription");
  await expect(draft).toContainText("Source None · newly authored");
  await draft.getByRole("button", { name: "Expand Draft event" }).click();
  await expect(editor).toBeFocused();
  await draft.getByRole("button", { name: "Park draft and return to Evidence" }).click();
  const parked = page.getByRole("region", { name: "Parked Local Injection Draft" });
  await expect(parked).toContainText("topology-small-subscription");
  const resume = parked.getByRole("button", { name: "Resume Local Injection Draft" });
  await expect(resume).toBeFocused();
  await resume.click();
  await expect(editor).toBeFocused();
  await expect(editor).toContainText("authored-local-1");

  const discard = draft.getByRole("button", { name: "Discard draft" });
  await discard.click();
  const confirmation = draft.getByRole("alertdialog", { name: "Discard Local Injection Draft" });
  await expect(confirmation).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(discard).toBeFocused();

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);

  await discard.click();
  await confirmation.getByRole("button", { name: "Confirm discard" }).click();
  await expect(page.getByRole("button", { name: "Scope", exact: true })).toBeFocused();
});

test("Workbench blocks syntax, duplicate, and COMMAND semantic errors until corrected", async ({ page }, testInfo) => {
  await openScenario(page, "local-injection-invalid", { width: 900, height: 700 }, "dark");
  const draft = page.getByRole("region", { name: "Local Injection Draft" });
  const editor = page.getByRole("textbox", { name: "Local Injection JSON", exact: true });
  const review = draft.getByRole("button", { name: "Review Local Injection" });

  await expect(draft).toContainText('Duplicate JSON key "command" is not allowed.');
  await expect(review).toBeDisabled();
  await editor.fill("{");
  await expect(draft).toContainText("SYNTAX");
  await expect(page.locator(".cm-lintRange-error")).not.toHaveCount(0);
  await expect(review).toBeDisabled();

  const semanticallyInvalid = JSON.stringify({
    command: "UPDATE",
    key: "missing-key",
    isSnapshot: false,
    fields: { command: "UPDATE", key: "missing-key", value: "2" }
  }, null, 2);
  await editor.fill(semanticallyInvalid);
  await expect(draft).toContainText("SEMANTIC");
  await expect(review).toBeDisabled();

  const corrected = semanticallyInvalid.replaceAll("missing-key", "small-alpha");
  await editor.fill(corrected);
  await expect(draft).toContainText("Ready for Review");
  await expect(review).toBeEnabled();

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench keeps a 500-field Draft editor model across compare, geometry, minimize, and park", async ({ page }, testInfo) => {
  await openScenario(page, "local-injection-large", { width: 1440, height: 900 }, "light");
  const draft = page.getByRole("region", { name: "Local Injection Draft" });
  const editor = page.getByRole("textbox", { name: "Local Injection JSON", exact: true });
  const scrollOwner = draft.locator('[data-shared-scroll-owner="true"]');

  await expect(page.getByText("Immutable Source", { exact: true })).toBeVisible();
  await expect(page.locator(".cm-collapsedLines")).not.toHaveCount(0);
  await page.getByRole("button", { name: "Compare Source" }).click();
  await editor.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f");
  await page.locator(".cm-search input[name=search]").fill("field_498");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(editor).toContainText("field_498");
  await editor.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Home" : "Control+Home");
  await page.locator('.cm-mergeViewEditor:last-child [title="Fold line"]').nth(1).click();
  await expect(page.locator(".cm-foldPlaceholder")).toBeVisible();

  await page.setViewportSize({ width: 900, height: 700 });
  await draft.getByRole("button", { name: "Collapse Draft event" }).click();
  await draft.getByRole("button", { name: "Expand Draft event" }).click();
  await draft.getByRole("button", { name: "Park draft and return to Evidence" }).click();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("region", { name: "Notifications", exact: true })).toBeVisible();
  await page.getByRole("region", { name: "Notifications", exact: true }).getByRole("button", { name: "Back to Evidence" }).click();
  await page.getByRole("region", { name: "Parked Local Injection Draft" }).getByRole("button", { name: "Resume Local Injection Draft" }).click();
  await expect(page.locator(".cm-foldPlaceholder")).toBeVisible();
  await page.locator(".cm-foldPlaceholder").click();

  await expect.poll(() => scrollOwner.evaluate((owner) => owner.scrollHeight > owner.clientHeight)).toBe(true);
  await scrollOwner.evaluate((owner) => { owner.scrollTop = 420; });
  await editor.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+a" : "Control+a");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Compare Source" }).click();
  await expect(page.getByText("Immutable Source", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Compare Source" }).click();
  await page.setViewportSize({ width: 900, height: 700 });
  await draft.getByRole("button", { name: "Collapse Draft event" }).click();
  await draft.getByRole("button", { name: "Expand Draft event" }).click();
  await draft.getByRole("button", { name: "Park draft and return to Evidence" }).click();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await page.getByRole("region", { name: "Parked Local Injection Draft" }).getByRole("button", { name: "Resume Local Injection Draft" }).click();
  await expect(page.getByRole("region", { name: "Notifications", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Notifications/ })).toHaveAttribute("aria-expanded", "false");
  expect(await scrollOwner.evaluate((owner) => owner.scrollTop)).toBe(420);

  const replacement = JSON.stringify({
    command: "UPDATE",
    key: "small-alpha",
    isSnapshot: false,
    fields: Object.fromEntries(Array.from({ length: 500 }, (_, index) => {
      if (index === 0) return ["command", "UPDATE"];
      if (index === 1) return ["key", "small-alpha"];
      return [`field_${String(index - 1).padStart(3, "0")}`, index === 499 ? "selection-survived" : `value-${index - 1}`];
    }))
  }, null, 2);
  await editor.focus();
  await page.keyboard.insertText(replacement);
  await expect(editor).toContainText("selection-survived");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(editor).toContainText('"field_498": "value-498"');

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench blocks a target that becomes stale after Review without executing", async ({ page }, testInfo) => {
  await openScenario(page, "local-injection-stale-edit", { width: 900, height: 700 }, "light");
  const staleAtReview = page.getByRole("region", { name: "Local Injection Draft" });
  await expect(staleAtReview).toContainText("The inspected-page Local Injection delivery target is disconnected");
  await expect(staleAtReview.getByRole("button", { name: "Review Local Injection" })).toBeDisabled();
  await expect(staleAtReview.getByRole("region", { name: "Review Local Injection" })).toBeHidden();

  await openScenario(page, "local-injection-stale-review", { width: 900, height: 700 }, "dark");
  const draft = page.getByRole("region", { name: "Local Injection Draft" });
  await expect(draft).toContainText("BLOCKED");
  await expect(draft).toContainText("The inspected-page Local Injection delivery target is disconnected");
  await expect(page.getByRole("textbox", { name: "Local Injection JSON", exact: true })).toBeVisible();
  await expect(draft.getByRole("button", { name: "Review Local Injection" })).toBeDisabled();
  await expect(draft.getByRole("region", { name: "Review Local Injection" })).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __localInjectionExecutionCount(): number }).__localInjectionExecutionCount())).toBe(0);
  await expect(draft.getByRole("button", { name: "Inject locally" })).toHaveCount(0);

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench prevents duplicate execution while one Local Injection acknowledgement is pending", async ({ page }, testInfo) => {
  await openScenario(page, "local-injection-pending", { width: 563, height: 700 }, "light");
  const draft = page.getByRole("region", { name: "Local Injection Draft" });
  await expect(draft).toContainText("DELIVERY PENDING");
  await expect(draft).toContainText("No repeat or automatic retry is available");
  await expect(draft.getByRole("button", { name: "Collapse Draft event" })).toBeDisabled();
  await expect(draft.getByRole("button", { name: "Park draft and return to Evidence" })).toBeDisabled();
  await expect(draft.getByRole("button", { name: "Discard draft" })).toBeDisabled();
  await expect(draft.getByRole("button", { name: "Inject locally" })).toHaveCount(0);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __localInjectionExecutionCount(): number }).__localInjectionExecutionCount())).toBe(1);

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench protects the current Draft when another entry conflicts and discards deliberately", async ({ page }, testInfo) => {
  await openScenario(page, "local-injection-conflict", { width: 563, height: 700 }, "light");
  const draft = page.getByRole("region", { name: "Local Injection Draft" });
  const scrollOwner = draft.locator('[data-shared-scroll-owner="true"]');
  await expect(draft).toContainText("Another draft entry is blocked");
  await expect(draft).toContainText("Selected Evidence event-5 cannot replace this protected draft");
  await expect.poll(() => scrollOwner.evaluate((owner) => owner.scrollWidth > owner.clientWidth)).toBe(true);
  await scrollOwner.evaluate((owner) => { owner.scrollLeft = 100; });
  expect(await scrollOwner.evaluate((owner) => owner.scrollLeft)).toBeGreaterThan(0);
  await draft.getByRole("button", { name: "Discard current and continue" }).click();
  const confirmation = draft.getByRole("alertdialog", { name: "Discard Local Injection Draft" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Confirm discard" }).click();
  await expect(draft).not.toContainText("Another draft entry is blocked");
  await expect(draft).toContainText("Source event-5 · immutable");
  await expect(draft).toContainText("READY");
  await expect(page.getByRole("textbox", { name: "Local Injection JSON", exact: true })).toBeFocused();
  expect(await scrollOwner.evaluate((owner) => owner.scrollLeft)).toBe(0);

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench keeps delivered, failed, partial, and unknown Local Injection outcomes durable", async ({ page }, testInfo) => {
  const cases = [
    ["local-injection-delivered", "DELIVERED LOCALLY", "1 delivered · 0 failed · 1 attempted"],
    ["local-injection-failed", "DELIVERY FAILED", "0 delivered · 1 failed · 1 attempted"],
    ["local-injection-partial", "PARTIALLY DELIVERED", "1 delivered · 1 failed · 2 attempted"],
    ["local-injection-unknown", "DELIVERY UNKNOWN", "could prove delivery"]
  ] as const;

  for (const [scenario, headline, detail] of cases) {
    await openScenario(page, scenario, { width: 900, height: 700 }, scenario === "local-injection-delivered" ? "dark" : "light");
    const draft = page.getByRole("region", { name: "Local Injection Draft" });
    await expect(draft.getByRole("heading", { name: headline })).toBeVisible();
    await expect(draft).toContainText(detail);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __localInjectionExecutionCount(): number }).__localInjectionExecutionCount())).toBe(1);
    await expect(draft.getByRole("button", { name: "Finish Local Injection" })).toBeVisible();

    if (scenario === "local-injection-delivered") {
      await expect(draft).toContainText("Local Evidence was appended");
      await expect(draft).toContainText("Observed Server COMMAND State remains unchanged");
      await draft.getByRole("button", { name: "Finish Local Injection" }).click();
      await expect(page.locator(".workbench-react__evidence-row").filter({ hasText: "LOCAL" })).not.toHaveCount(0);
      await expect(page.locator('[data-evidence-id="event-5"]')).toBeFocused();
      await expect(page.getByRole("region", { name: "COMMAND projection summary" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /COMMAND projections/ })).toHaveCount(0);
    }
  }

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench keeps dense Evidence controls and protected Local Injection boundaries operable at every docked geometry", async ({
  page
}, testInfo) => {
  await openScenario(page, "live-selected", { width: 900, height: 700 }, "dark");
  const evidenceHeader = page.locator(".workbench-react__evidence > .workbench-react__pane-header");
  const evidenceSummary = evidenceHeader.locator(".workbench-react__evidence-summary");
  await expect(evidenceSummary).toHaveCSS("display", "flex");
  expect(await evidenceHeader.evaluate((header) => header.getBoundingClientRect().height)).toBeLessThanOrEqual(44);
  const focusSelectedContext = page.getByRole("button", { name: "Focus selected Context" });
  await expectCoreControlInViewport(page, focusSelectedContext);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "scenario-event-3 · Item Update" })).toBeFocused();
  await focusSelectedContext.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "scenario-event-3 · Item Update" })).toBeFocused();
  await expectShellFitsExactly(page);
  await expectShellFits(page);
  await attachMatrixScreenshot(page, testInfo, "normal-dark-evidence");

  await openScenario(page, "local-injection-captured", { width: 563, height: 700 }, "light");
  await page.getByRole("button", { name: "Open selected Context" }).click();
  const createDraft = page.getByRole("button", { name: "Create Local Injection Draft" });
  await expectCoreControlInViewport(page, createDraft);
  await page.keyboard.press("Enter");
  const compactDraft = page.getByRole("region", { name: "Local Injection Draft" });
  await expect(compactDraft).toBeVisible();
  await expect(page.getByRole("button", { name: "Scope", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "More actions" })).toBeDisabled();
  await expectProtectedBoundaryValues(compactDraft);
  const compactBoundaryRows = await compactDraft.locator(".workbench-react__local-boundary > div").evaluateAll((items) =>
    [...new Set(items.map((item) => Math.round(item.getBoundingClientRect().top)))]
  );
  expect(compactBoundaryRows).toHaveLength(3);
  expect(await compactDraft.locator('[data-shared-scroll-owner="true"]').evaluate((owner) => owner.getBoundingClientRect().height)).toBeGreaterThanOrEqual(300);
  await expectCoreControlInViewport(page, compactDraft.getByRole("button", { name: "Review Local Injection" }));
  await expectShellFitsExactly(page);
  await expectShellFits(page);
  await attachMatrixScreenshot(page, testInfo, "compact-light-captured-edit");

  await openScenario(page, "local-injection-authored", { width: 900, height: 320 }, "dark");
  const author = page.getByRole("button", { name: "Author COMMAND Item Update" });
  await expectCoreControlInViewport(page, author);
  await page.keyboard.press("Enter");
  const authoredDraft = page.getByRole("region", { name: "Local Injection Draft" });
  await expect(authoredDraft).toBeVisible();
  const editor = page.getByRole("textbox", { name: "Local Injection JSON", exact: true });
  await editor.fill(JSON.stringify({
    command: "ADD",
    key: "density-check",
    isSnapshot: false,
    fields: { command: "ADD", key: "density-check", value: "42" }
  }, null, 2));
  const review = authoredDraft.getByRole("button", { name: "Review Local Injection" });
  await expectCoreControlInViewport(page, review);
  await page.keyboard.press("Enter");
  const reviewRegion = authoredDraft.getByRole("region", { name: "Review Local Injection" });
  await expect(reviewRegion).toBeVisible();
  const reviewHeading = reviewRegion.getByRole("heading", { name: "Review Local Injection" });
  const reviewLocalOnly = reviewRegion.locator(".workbench-react__local-review-local-only");
  const reviewScrollOwner = authoredDraft.locator('[data-shared-scroll-owner="true"]');
  await expectContentInViewport(reviewHeading);
  await reviewHeading.focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => reviewScrollOwner.evaluate((owner) => owner.scrollTop)).toBeGreaterThan(0);
  await expectContentInViewport(reviewLocalOnly);
  await expectCoreControlInViewport(page, authoredDraft.getByRole("button", { name: "Inject locally" }));
  await expectShellFitsExactly(page);
  await expectShellFits(page);
  await attachMatrixScreenshot(page, testInfo, "shallow-dark-authored-review");

  await openScenario(page, "local-injection-delivered", { width: 1440, height: 900 }, "light");
  const deliveredDraft = page.getByRole("region", { name: "Local Injection Draft" });
  await expectProtectedBoundaryValues(deliveredDraft);
  await expectCoreControlInViewport(page, deliveredDraft.getByRole("button", { name: "Finish Local Injection" }));
  await expectShellFitsExactly(page);
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachMatrixScreenshot(page, testInfo, "wide-light-delivered-outcome");
});

test("reviewed same-target Scenario steps exactly one Injection and retains its trace", async ({ page }, testInfo) => {
  for (const scene of [
    { scenario: "local-injection-scenario-edit" as const, width: 563, height: 700, theme: "light" as const },
    { scenario: "local-injection-scenario-review" as const, width: 900, height: 700, theme: "dark" as const },
    { scenario: "local-injection-scenario-complete" as const, width: 1440, height: 900, theme: "light" as const }
  ]) {
    await openScenario(page, scene.scenario, { width: scene.width, height: scene.height }, scene.theme);
    const document = page.getByRole("region", { name: "Local Injection Scenario" });
    await expect(document).toBeVisible();
    await expect(document.getByRole("article")).toHaveCount(2);
    await expect(document).toContainText("exact shared Subscription target");
    await expect(document).toContainText("LOCAL ONLY");
    await expectShellFitsExactly(page);
    await expectShellFits(page);
    await expectNoSeriousAxeViolations(page, testInfo);
    if (scene.scenario === "local-injection-scenario-edit") {
      const add = document.getByRole("button", { name: "Add captured update" });
      await add.focus();
      await expect(add).toBeFocused();
      await add.press("Enter");
      await expect(page.getByRole("region", { name: "Scenario Evidence picker" })).toBeVisible();
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(add).toBeFocused();
    }
    if (scene.scenario === "local-injection-scenario-review") {
      await expect(document.getByRole("button", { name: "Pause" })).toBeVisible();
      await expect(document).toContainText("WAITING · Step 1 dispatch is scheduled on active time");
      await expect(document).toContainText("Scenario revision 4");
    }
    if (scene.scenario === "local-injection-scenario-complete") {
      await expect(document).toContainText("RUN COMPLETE · 2 independently traced Injections");
      await expect(document.getByText(/Local Evidence synthetic-/)).toHaveCount(2);
    }
    await attachNamedScenarioScreenshot(page, testInfo, `${scene.scenario}-${scene.width}x${scene.height}-${scene.theme}`);
  }
});

test("completed Scenario restores focus to its document heading", async ({ page }) => {
  await openScenario(page, "local-injection-scenario-complete", { width: 1440, height: 900 }, "light");
  const heading = page.getByRole("heading", { name: "Local Injection Scenario", exact: true });

  await expect(heading).toBeVisible();
  const headingFocus = await heading.evaluate((element) => ({
    active: document.activeElement === element,
    focusVisible: element.matches(":focus-visible")
  }));
  expect(headingFocus.active).toBe(true);
  expect(headingFocus.focusVisible).toBe(true);
});

test("Scenario clock controls preserve focus, hidden pause, manual stepping, and stopped remainder", async ({ page }, testInfo) => {
  await openScenario(page, "local-injection-scenario-review", { width: 563, height: 700 }, "light");
  const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
  const reviewedJson = scenario.getByLabel("Step 1 reviewed JSON");
  await reviewedJson.focus();
  await page.waitForTimeout(40);
  await expect(reviewedJson).toBeFocused();

  await page.evaluate(() => (window as unknown as { __setWorkbenchVisible(visible: boolean): void }).__setWorkbenchVisible(false));
  await expect(scenario).toContainText("PAUSED — PANEL HIDDEN · explicit Resume required");
  await page.evaluate(() => (window as unknown as { __setWorkbenchVisible(visible: boolean): void }).__setWorkbenchVisible(true));
  const resume = scenario.getByRole("button", { name: "Resume" });
  await expect(resume).toBeEnabled();
  await resume.click();
  await expect(scenario.getByRole("button", { name: "Pause" })).toBeVisible();
  await scenario.getByRole("button", { name: "Pause" }).click();
  await expect(scenario.getByRole("button", { name: "Step next" })).toBeVisible();
  await scenario.getByRole("button", { name: "Step next" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __localInjectionExecutionCount(): number }).__localInjectionExecutionCount())).toBe(1);
  await expect(scenario).toContainText("STEP NEXT bypassed");
  await expect(scenario.getByRole("button", { name: "Resume" })).toBeVisible();
  await scenario.getByRole("button", { name: "Stop" }).click();
  await expect(scenario).toContainText("RUN STOPPED");
  await expect(scenario.getByText("NOT RUN", { exact: true })).toBeVisible();
  await expectNoSeriousAxeViolations(page, testInfo);
  await expectShellFitsExactly(page);
  await expectShellFits(page);
  await attachMatrixScreenshot(page, testInfo, "scenario-clock-compact-light-stopped");
});

test("Scenario authoring confirms explicit membership and keeps only the focused large editor mounted", async ({ page }, testInfo) => {
  await openScenario(page, "local-injection-scenario-edit", { width: 900, height: 700 }, "dark");
  const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
  await expect(scenario.getByRole("textbox", { name: /Step \d+ Local Injection JSON/ })).toHaveCount(1);
  await expect(scenario.getByRole("textbox", { name: "Step 2 Local Injection JSON" })).toBeVisible();

  await scenario.getByRole("button", { name: "Step 1", exact: true }).click();
  await expect(scenario.getByRole("textbox", { name: "Step 1 Local Injection JSON" })).toBeVisible();
  await expect(scenario.getByRole("textbox", { name: /Step \d+ Local Injection JSON/ })).toHaveCount(1);

  await scenario.getByRole("button", { name: "Step 2", exact: true }).click();
  await scenario.getByLabel("Step 2 actions").getByRole("button", { name: "Move earlier" }).click();
  await expect(scenario.getByRole("article").first()).toContainText("step-2");
  await scenario.getByLabel("Step 1 actions").getByRole("button", { name: "Duplicate Step" }).click();
  await expect(scenario.getByRole("article")).toHaveCount(3);
  await scenario.getByLabel("Step 2 actions").getByRole("button", { name: "Remove Step" }).click();
  await expect(scenario.getByRole("article")).toHaveCount(2);
  await scenario.getByRole("button", { name: "Undo removal" }).click();
  await expect(scenario.getByRole("article")).toHaveCount(3);

  await scenario.getByRole("button", { name: "Add captured update" }).click();
  const picker = page.getByRole("region", { name: "Scenario Evidence picker" });
  await picker.getByRole("button", { name: "Preview visible set" }).click();
  await expect(picker).toContainText(/retained .* sequence/);
  await expect(picker).toContainText("Already an explicit Scenario Step");
  await expect(picker).toContainText("Will add after confirmation");
  await picker.getByRole("button", { name: "Confirm compatible Steps" }).click();
  await expect(picker).toBeHidden();
  await expect(scenario).toContainText("scenario-compatible-bulk-update");

  await scenario.getByRole("button", { name: "Add authored update" }).click();
  await expect(scenario.getByText("None · newly authored")).toBeVisible();
  await expect(scenario).toContainText(/\/100 explicit Steps/);
  await expectNoSeriousAxeViolations(page, testInfo);
  await expectShellFitsExactly(page);
  await expectShellFits(page);
  await attachMatrixScreenshot(page, testInfo, "scenario-membership-normal-dark");
});

test("Scenario Checkpoint authoring stays protected, keyboard reachable, and Reviewable without an Injection editor", async ({ page }, testInfo) => {
  await openScenario(page, "local-injection-scenario-edit", { width: 900, height: 700 }, "dark");
  const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
  const addCheckpoint = scenario.getByRole("button", { name: "Add checkpoint" });
  await addCheckpoint.focus();
  await expect(addCheckpoint).toBeFocused();
  await page.keyboard.press("Enter");

  const checkpoint = scenario.locator(".workbench-react__scenario-checkpoint").last();
  await expect(checkpoint).toBeVisible();
  await expect(checkpoint).toContainText("Zero Injections");
  await expect(checkpoint.getByLabel("Protected Checkpoint authoring")).toContainText("Exact committed Evidence boundary at evaluation");
  await expect(checkpoint.locator(".cm-editor")).toHaveCount(0);
  const name = checkpoint.getByRole("textbox", { name: /Checkpoint \d+ name/ });
  await name.fill("Portfolio row is locally settled");
  await expect(name).toHaveValue("Portfolio row is locally settled");
  await expect(checkpoint).toHaveAttribute("aria-label", "Scenario Checkpoint Portfolio row is locally settled");
  const assertionKind = checkpoint.getByRole("combobox", { name: /Assertion .* kind/ });
  await expect(assertionKind.locator("option")).toHaveCount(6);
  await expect(assertionKind.locator("option").filter({ hasText: "Diagnostic Observation exists" })).toHaveCount(1);
  await assertionKind.selectOption("diagnostic-observation-exists");
  await expect(checkpoint).toContainText("Diagnostic Observation contract v1");
  await expect(checkpoint.getByRole("textbox", { name: "Diagnostic rule code" })).toHaveValue("capture.disconnected");
  await expect(checkpoint.getByRole("combobox", { name: "Diagnostic affected kind" })).toHaveValue("unavailable");
  await assertionKind.selectOption("correlated-local-evidence-exists");
  await expect(checkpoint).toContainText("Correlated committed Local Evidence exists after Step");
  const within = checkpoint.getByRole("spinbutton", { name: "Within active ms" });
  await within.fill("2000");

  await checkpoint.getByRole("button", { name: "Add assertion" }).click();
  await expect(checkpoint.locator(".workbench-react__scenario-assertion-authoring")).toHaveCount(2);
  const assertionKinds = checkpoint.getByRole("combobox", { name: /Assertion .* kind/ });
  await assertionKinds.nth(1).selectOption("prior-injection-outcome");
  await expect(checkpoint.getByRole("combobox", { name: "Outcome" }).locator('option[value="acknowledgement-unknown"]')).toHaveCount(1);
  await assertionKinds.nth(0).selectOption("command-key-exists");
  const keyExpectation = checkpoint.getByRole("combobox", { name: "Expected" }).first();
  await checkpoint.getByRole("textbox", { name: "Key" }).fill("order-1");
  await checkpoint.getByRole("spinbutton", { name: "Within active ms" }).fill("100");
  await keyExpectation.selectOption("absent");
  await expect(checkpoint.getByRole("spinbutton", { name: "Within active ms" })).toHaveCount(0);
  await checkpoint.getByRole("button", { name: /Remove assertion/ }).last().click();
  await expect(checkpoint.locator(".workbench-react__scenario-assertion-authoring")).toHaveCount(1);

  const focusCheckpoint = checkpoint.getByRole("button", { name: /CHECKPOINT \d+/ });
  await focusCheckpoint.focus();
  await expect(focusCheckpoint).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(name).toBeFocused();
  await scenario.getByRole("button", { name: "Review Scenario" }).click();
  await expect(checkpoint).toContainText("REVIEWED");
  await expect(checkpoint).toContainText("zero Injections dispatched");
  await expectNoSeriousAxeViolations(page, testInfo);
  await expectShellFitsExactly(page);
  await expectShellFits(page);
  await attachMatrixScreenshot(page, testInfo, "scenario-checkpoint-authoring-normal-dark");
});

test("Scenario Diagnostic Observation Review and Trace expose bounded provenance without copying messages", async ({ page }, testInfo) => {
  await openScenario(page, "local-injection-scenario-diagnostic-pass", { width: 900, height: 700 }, "light");
  const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
  await expect(scenario.getByLabel("Protected Scenario target and execution boundary")).not.toContainText("Diagnostic authorization seed");
  await expect(scenario.getByRole("region", { name: "Scenario Run ledger" })).toContainText(/Evidence boundary .*Diagnostic Observation cursor .*sequence 0/);

  const checkpoint = page.getByRole("article", { name: "Scenario Checkpoint Later lost-updates observation exists" });
  await expect(checkpoint).toContainText("PASS");
  await expect(checkpoint).toContainText("Exact affected identity subscription · page topology-small-page · client topology-small-client · session topology-small-session · subscription topology-small-subscription");
  await expect(checkpoint).toContainText(/Diagnostic Observation boundary .*sequence 1/);
  await expect(checkpoint).toContainText("Compact reference only · raw diagnostic messages are not copied into Scenario Trace");
  await expect(checkpoint).toContainText("Route inspect affected");
  const inspect = checkpoint.getByRole("button", { name: "Inspect Diagnostic Observation subscription.lost-updates" });
  await inspect.focus();
  await expect(inspect).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("navigation", { name: "Current runtime scope" })).toContainText("topology-small-subscription");
  const back = page.getByRole("button", { name: "Back investigation" });
  await expect(back).toBeEnabled();
  await back.focus();
  await expect(back).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(back).toBeDisabled();
  await expect(page.getByRole("navigation", { name: "Current runtime scope" })).toContainText("Inspected page");
  await expect(inspect).toBeVisible();
  await expectNoSeriousAxeViolations(page, testInfo);
  await expectShellFitsExactly(page);
  await expectShellFits(page);
  await attachMatrixScreenshot(page, testInfo, "scenario-diagnostic-trace-normal-light");
});

test("Scenario high-volume document mounts one of 100 representative large editors and keeps keyboard reorder usable", async ({ page }, testInfo) => {
  await openScenario(page, "live-selected", { width: 563, height: 700 }, "light");
  expect(await page.locator('[data-editor-engine="codemirror-6"]').count()).toBe(0);
  expect(await page.evaluate(() => performance.getEntriesByType("resource").some(({ name }) => name.includes("local-injection-document.js")))).toBe(false);
  await openScenario(page, "local-injection-scenario-high-volume", { width: 563, height: 700 }, "light");
  const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
  await expect(scenario.getByRole("article")).toHaveCount(100);
  await expect(scenario.getByRole("textbox", { name: /Step \d+ Local Injection JSON/ })).toHaveCount(1);
  await expect(scenario.getByText("Collapsed Draft · Open editor", { exact: false })).toHaveCount(99);
  await expect(scenario).toContainText("100/100 explicit Steps");
  await scenario.getByRole("button", { name: "Add authored update" }).click();
  await expect(scenario.getByRole("alert")).toContainText("at most 100 Steps");
  await expect(scenario.getByRole("article")).toHaveCount(100);
  const step100Editor = scenario.getByRole("textbox", { name: "Step 100 Local Injection JSON" });
  await step100Editor.focus();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  const step100Host = step100Editor.locator('xpath=ancestor::*[@data-editor-engine="codemirror-6"]');
  await step100Host.locator(".cm-scroller").evaluate((scroller) => {
    scroller.scrollTop = 500;
    scroller.dispatchEvent(new Event("scroll"));
  });
  const beforePresentation = await step100Host.evaluate((host) => ({
    anchor: host.getAttribute("data-selection-anchor"), head: host.getAttribute("data-selection-head"), scrollTop: host.getAttribute("data-scroll-top")
  }));
  await scenario.getByRole("button", { name: "Step 99", exact: true }).click();
  await expect(scenario.getByRole("textbox", { name: "Step 99 Local Injection JSON" })).toBeVisible();
  await scenario.getByRole("button", { name: "Step 100", exact: true }).click();
  await expect(step100Editor).toBeVisible();
  await expect.poll(() => step100Host.evaluate((host) => ({
    anchor: host.getAttribute("data-selection-anchor"), head: host.getAttribute("data-selection-head"), scrollTop: host.getAttribute("data-scroll-top")
  }))).toEqual(beforePresentation);
  await scenario.getByRole("button", { name: "Review Scenario" }).click();
  await expect(scenario.getByRole("button", { name: "Edit Scenario" })).toBeVisible();
  await scenario.getByRole("button", { name: "Edit Scenario" }).click();
  await expect(scenario.getByRole("article")).toHaveCount(100);
  await expect(scenario.getByRole("textbox", { name: "Step 100 Local Injection JSON" })).toBeVisible();
  await expect.poll(() => step100Host.evaluate((host) => ({
    anchor: host.getAttribute("data-selection-anchor"), head: host.getAttribute("data-selection-head"), scrollTop: host.getAttribute("data-scroll-top")
  }))).toEqual(beforePresentation);
  const heapBytes = await page.evaluate(() => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0);
  expect(heapBytes).toBeGreaterThan(0);
  expect(heapBytes).toBeLessThan(256 * 1024 * 1024);
  await scenario.getByRole("button", { name: "Step 99", exact: true }).click();
  const moveLater = scenario.getByLabel("Step 99 actions").getByRole("button", { name: "Move later" });
  await moveLater.focus();
  await page.keyboard.press("Enter");
  await expect(scenario.getByRole("article").last()).toContainText("step-99");
  await expectShellFitsExactly(page);
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachMatrixScreenshot(page, testInfo, "scenario-high-volume-compact-light");
});

test("Scenario fails closed for incompatible membership, invalid Review, and partial delivery", async ({ page }, testInfo) => {
  await openScenario(page, "local-injection-scenario-edit", { width: 900, height: 700 }, "dark");
  const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
  const add = scenario.getByRole("button", { name: "Add captured update" });
  await add.click();
  const picker = page.getByRole("region", { name: "Scenario Evidence picker" });
  const unavailable = picker.getByRole("button", { name: "Add this update", disabled: true });
  await expect(unavailable.first()).toBeDisabled();
  await expect(picker.getByText(/Unavailable ·/).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(add).toBeFocused();

  const secondEditor = scenario.getByRole("textbox", { name: "Step 2 Local Injection JSON" });
  await secondEditor.fill('{"command":"UPDATE"}');
  await scenario.getByRole("button", { name: "Review Scenario" }).click();
  await expect(scenario.getByRole("alert")).toContainText("step-2");
  await expect(scenario).toContainText("No Injection was attempted");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __localInjectionExecutionCount(): number }).__localInjectionExecutionCount())).toBe(0);
  await expectNoSeriousAxeViolations(page, testInfo);

  await openScenario(page, "local-injection-scenario-partial", { width: 900, height: 700 }, "light");
  const stopped = page.getByRole("region", { name: "Local Injection Scenario" });
  await expect(stopped).toContainText("RUN STOPPED");
  await expect(stopped).toContainText("PARTIALLY DELIVERED");
  await expect(stopped).toContainText("remaining Steps were NOT RUN");
  const stoppedSteps = stopped.getByLabel("Ordered Scenario Steps");
  const partialTrace = stoppedSteps.getByText("PARTIALLY DELIVERED");
  const notRunTrace = stoppedSteps.getByText("NOT RUN", { exact: true });
  await partialTrace.scrollIntoViewIfNeeded();
  await expect(partialTrace).toBeVisible();
  await notRunTrace.scrollIntoViewIfNeeded();
  await expect(notRunTrace).toBeVisible();

  await page.setViewportSize({ width: 900, height: 320 });
  await expect.poll(() => stoppedSteps.evaluate((element) => element.clientHeight)).toBeGreaterThan(100);
  await partialTrace.scrollIntoViewIfNeeded();
  await expect(partialTrace).toBeInViewport();
  await notRunTrace.scrollIntoViewIfNeeded();
  await expect(notRunTrace).toBeInViewport();
  await expect(stopped.getByText(/Injection local-injection-/)).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __localInjectionExecutionCount(): number }).__localInjectionExecutionCount())).toBe(1);
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Scenario halt ledger exposes drift authorization, unknown, unretained, and cleared Evidence truth", async ({ page }, testInfo) => {
  await openScenario(page, "local-injection-scenario-listener-drift", { width: 900, height: 700 }, "dark");
  let scenario = page.getByRole("region", { name: "Local Injection Scenario" });
  await expect(scenario).toContainText("DRIFT REVIEW REQUIRED");
  await expect(scenario.getByLabel("Scenario Run ledger")).toContainText("LISTENER_SET");
  await expect(scenario.getByLabel("Scenario Run ledger")).toContainText("scenario-listener-2");
  const rereview = scenario.getByRole("button", { name: "Re-review immutable plan" });
  await rereview.focus();
  await expect(rereview).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(scenario.getByLabel("Scenario Run ledger")).toContainText("RE-AUTHORIZED");
  await expect(scenario.getByRole("button", { name: "Resume" })).toBeVisible();

  await openScenario(page, "local-injection-scenario-server-drift", { width: 1440, height: 900 }, "light");
  scenario = page.getByRole("region", { name: "Local Injection Scenario" });
  await expect(scenario.getByLabel("Scenario Run ledger")).toContainText("SERVER_ITEM_UPDATE");
  await expect(scenario.getByLabel("Scenario Run ledger")).toContainText("scenario-server-interleave");

  await openScenario(page, "local-injection-scenario-unknown", { width: 900, height: 320 }, "dark");
  scenario = page.getByRole("region", { name: "Local Injection Scenario" });
  await expect(scenario).toContainText("DELIVERY UNKNOWN");
  await expect(scenario).toContainText("retention NOT_CREATED");
  await expect(scenario.getByText("NOT RUN", { exact: true })).toBeVisible();

  await openScenario(page, "local-injection-scenario-unretained", { width: 900, height: 700 }, "light");
  scenario = page.getByRole("region", { name: "Local Injection Scenario" });
  await expect(scenario).toContainText("DELIVERED LOCALLY");
  await expect(scenario).toContainText("DELIVERED_UNRETAINED");
  await expect(scenario).toContainText("no committed Local Evidence");

  await openScenario(page, "local-injection-scenario-cleared", { width: 563, height: 700 }, "dark");
  scenario = page.getByRole("region", { name: "Local Injection Scenario" });
  await expect(scenario).toContainText("UNAVAILABLE_AFTER_CLEAR");
  await expect(scenario).toContainText("Local Evidence");
  await expectShellFitsExactly(page);
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Scenario Trace explicitly reports bounded executor-controlled terminal values", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/?scenario=local-injection-scenario-partial&theme=light&terminalLimit=1");
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
  await expect(scenario.getByRole("note")).toHaveCount(1);
  await expect(scenario.getByRole("note").first()).toContainText("TRACE VALUE LIMITED");
  await expect(scenario.getByRole("note").first()).toContainText("Delivery semantics are unchanged");
  await expect(scenario.getByRole("note")).toContainText("inspect the page's own diagnostics");
});

test("Draft conversion and Scenario Edit restore the exact editor selection and workflow origin", async ({ page }) => {
  await openScenario(page, "local-injection-captured", { width: 900, height: 700 }, "dark");
  const openContext = page.getByRole("button", { name: "Open selected Context" });
  if (await openContext.isVisible()) await openContext.click();
  const originScopeId = await page.locator('[role="treeitem"][aria-current="true"]').getAttribute("data-scope-id");
  await page.getByRole("button", { name: "Create Local Injection Draft" }).click();
  const editor = page.getByRole("textbox", { name: "Local Injection JSON", exact: true });
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowLeft");
  const originalPresentation = await editor.locator('xpath=ancestor::*[@data-editor-engine="codemirror-6"]').evaluate((host) => ({
    anchor: host.dataset.selectionAnchor,
    head: host.dataset.selectionHead,
    scrollTop: host.dataset.scrollTop,
    scrollLeft: host.dataset.scrollLeft
  }));
  expect(originalPresentation.anchor).not.toBe(originalPresentation.head);
  await page.getByRole("button", { name: "Convert to Scenario" }).click();
  const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
  const converted = scenario.getByRole("textbox", { name: "Step 1 Local Injection JSON" });
  await converted.focus();
  await expect.poll(() => converted.locator('xpath=ancestor::*[@data-editor-engine="codemirror-6"]').evaluate((host) => ({
    anchor: host.dataset.selectionAnchor,
    head: host.dataset.selectionHead,
    scrollTop: host.dataset.scrollTop,
    scrollLeft: host.dataset.scrollLeft
  }))).toEqual(originalPresentation);
  await scenario.getByRole("button", { name: "Review Scenario" }).click();
  await scenario.getByRole("button", { name: "Edit Scenario" }).click();
  const restored = scenario.getByRole("textbox", { name: "Step 1 Local Injection JSON" });
  await restored.focus();
  await expect.poll(() => restored.locator('xpath=ancestor::*[@data-editor-engine="codemirror-6"]').evaluate((host) => ({
    anchor: host.dataset.selectionAnchor,
    head: host.dataset.selectionHead,
    scrollTop: host.dataset.scrollTop,
    scrollLeft: host.dataset.scrollLeft
  }))).toEqual(originalPresentation);
  await scenario.getByRole("button", { name: "Review Scenario" }).click();
  await scenario.getByRole("button", { name: "Step next" }).click();
  await expect(scenario).toContainText("RUN STOPPED");
  await scenario.getByRole("button", { name: "Finish Scenario" }).click();
  await expect(scenario).toHaveCount(0);
  await expect(page.locator('[data-evidence-id="event-5"]')).toBeFocused();
  await expect(page.getByRole("heading", { name: "event-5 · Item Update" })).toBeVisible();
  await expect(page.locator('[role="treeitem"][aria-current="true"]')).toHaveAttribute("data-scope-id", originScopeId ?? "");
});

test("Draft conversion preserves CodeMirror undo history", async ({ page }) => {
  await openScenario(page, "local-injection-captured", { width: 900, height: 700 }, "dark");
  const openContext = page.getByRole("button", { name: "Open selected Context" });
  if (await openContext.isVisible()) await openContext.click();
  await page.getByRole("button", { name: "Create Local Injection Draft" }).click();
  const editor = page.getByRole("textbox", { name: "Local Injection JSON", exact: true });
  const original = await editor.textContent();
  await editor.fill(`${original} `);
  await page.getByRole("button", { name: "Convert to Scenario" }).click();
  const converted = page.getByRole("textbox", { name: "Step 1 Local Injection JSON" });
  await converted.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => converted.textContent()).toBe(original);
  await page.getByRole("button", { name: "Review Scenario" }).click();
  await page.getByRole("button", { name: "Edit Scenario" }).click();
  await converted.focus();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => converted.textContent()).toBe(`${original} `);
});

async function expectProtectedBoundaryValues(draft: ReturnType<Page["getByRole"]>): Promise<void> {
  const values = await draft.locator(".workbench-react__local-boundary > div").evaluateAll((boundaries) =>
    boundaries.map((boundary) => {
      const label = boundary.querySelector("dt")?.textContent?.trim();
      const value = boundary.querySelector("dd");
      if (!(value instanceof HTMLElement)) throw new Error(`Protected boundary ${label ?? "Unknown"} is missing its value.`);
      const style = getComputedStyle(value);
      return {
        label,
        text: value.textContent?.trim() ?? "",
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
        scrollWidth: value.scrollWidth,
        clientWidth: value.clientWidth
      };
    })
  );
  expect(values.map(({ label }) => label)).toEqual(expect.arrayContaining(["Target", "Session", "Source", "Validation", "Delivery", "Boundary"]));
  for (const value of values) {
    expect(value.textOverflow, `${value.label} must not silently ellipsize`).not.toBe("ellipsis");
    expect(value.whiteSpace, `${value.label} must expose its complete value`).not.toBe("nowrap");
    expect(value.scrollWidth, `${value.label} must fit or wrap its complete value`).toBeLessThanOrEqual(value.clientWidth);
  }
  expect(values.find(({ label }) => label === "Boundary")?.text).toContain("LOCAL ONLY");
}

async function expectCoreControlInViewport(page: Page, control: ReturnType<Page["getByRole"]>): Promise<void> {
  await expect(control).toBeVisible();
  await control.focus();
  await expect(control).toBeFocused();
  const geometry = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    return {
      intersectsViewport: rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
      unobscured: element.contains(document.elementFromPoint(centerX, centerY))
    };
  });
  expect(geometry.intersectsViewport).toBe(true);
  expect(geometry.unobscured).toBe(true);
}

async function expectContentInViewport(content: ReturnType<Page["getByRole"]>): Promise<void> {
  await expect(content).toBeVisible();
  const geometry = await content.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    return {
      width: rect.width,
      height: rect.height,
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: window.innerHeight,
      unobscured: element.contains(document.elementFromPoint(centerX, centerY))
    };
  });
  expect(geometry.width).toBeGreaterThan(0);
  expect(geometry.height).toBeGreaterThan(0);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.unobscured).toBe(true);
}

async function attachMatrixScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(`current-repair-03-${name}.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png"
  });
}
