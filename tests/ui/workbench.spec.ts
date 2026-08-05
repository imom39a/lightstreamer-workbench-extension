import axe from "axe-core";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { highVolumeEventId, type WorkbenchScenarioId } from "../support/workbench-scenarios";

const browserDiagnostics = new WeakMap<Page, string[]>();

declare global {
  interface Window {
    axe: typeof axe;
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

test("Workbench keeps selected Evidence, roving focus, and distinct COMMAND projections usable", async ({
  page
}, testInfo) => {
  await openScenario(page, "live-selected", { width: 900, height: 700 }, "dark");

  await expect(page.getByText("Capture RUNNING", { exact: true })).toBeVisible();
  await expect(page.getByText("Coverage USEFUL", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scope", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Observed Server COMMAND State" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Local Effective COMMAND State" })).toBeVisible();

  const initialRow = page.locator('[data-evidence-id="scenario-event-3"]');
  const normalRowHeight = await initialRow.evaluate((row) => row.getBoundingClientRect().height);
  expect(normalRowHeight).toBeGreaterThanOrEqual(26);
  expect(normalRowHeight).toBeLessThanOrEqual(28);
  const eventIdentity = initialRow.locator('[role="gridcell"]').first().locator("small").first();
  await expect(eventIdentity).toHaveText("scenario-event-3");
  expect(await eventIdentity.evaluate((identity) => identity.scrollWidth <= identity.clientWidth)).toBe(true);
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

test("Workbench promotes distinct COMMAND projections and restores the investigation", async ({ page }, testInfo) => {
  await openScenario(page, "command-projection-matching", { width: 900, height: 700 }, "dark");
  const contextSummary = page.getByRole("region", { name: "COMMAND projection summary" });
  await expect(contextSummary.getByLabel("Observed Server COMMAND State")).toContainText(
    "Captured Server Updates only"
  );
  await expect(contextSummary.getByLabel("Local Effective COMMAND State")).toContainText(
    "Server Updates plus successfully delivered Local Injected Updates"
  );
  await expect(contextSummary).toContainText("Observed Server COMMAND State");
  await expect(contextSummary).toContainText("Captured Server Updates only");
  await expect(contextSummary).toContainText("Local Effective COMMAND State");
  await expect(contextSummary).toContainText("Server Updates plus successfully delivered Local Injected Updates");
  await expect(contextSummary).toContainText("Matching projections");
  await expect(contextSummary.locator("li")).toHaveCount(0);
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
  await expect(page.locator('[data-evidence-id="scenario-event-3"]')).toBeFocused();
  await expect(page.locator('[data-evidence-id="scenario-event-3"]')).toHaveAttribute("aria-selected", "true");

  await openScenario(page, "command-projection-matching", { width: 563, height: 700 }, "light");
  await page.getByRole("button", { name: "Open selected Context" }).click();
  await page.getByRole("button", { name: "Compare COMMAND projections" }).click();
  const compactComparison = page.getByRole("region", { name: "COMMAND projection comparison" });
  const compactColumns = await compactComparison.locator(".workbench-react__projection-column").evaluateAll((columns) =>
    columns.map((column) => ({ top: column.getBoundingClientRect().top, width: column.getBoundingClientRect().width }))
  );
  expect(compactColumns).toHaveLength(2);
  expect(compactColumns[1]?.top).toBeGreaterThan(compactColumns[0]?.top ?? 0);
  expect(compactColumns.every(({ width }) => width > 0)).toBe(true);
  await attachNamedScenarioScreenshot(page, testInfo, "command-projection-compact-light");
  await expect(compactComparison.getByRole("button", { name: "Reveal Evidence" })).toHaveCount(0);
  await compactComparison.getByRole("button", { name: "Back to Evidence" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-evidence-id="scenario-event-3"]')).toBeFocused();

  await openScenario(page, "command-projection-matching", { width: 900, height: 320 }, "light");
  await page.getByRole("button", { name: "Compare COMMAND projections" }).click();
  const shallowComparison = page.getByRole("region", { name: "COMMAND projection comparison" });
  await expect(shallowComparison).toBeVisible();
  const shallowColumns = await shallowComparison.locator(".workbench-react__projection-column").evaluateAll((columns) =>
    columns.map((column) => ({ top: column.getBoundingClientRect().top, width: column.getBoundingClientRect().width }))
  );
  expect(shallowColumns).toHaveLength(2);
  expect(shallowColumns[1]?.top).toBeGreaterThan(shallowColumns[0]?.top ?? 0);
  expect(await shallowComparison.evaluate((document) => document.scrollWidth <= document.clientWidth)).toBe(true);
  await expect(shallowComparison).toContainText("Comparing Observed Server COMMAND State with Local Effective COMMAND State.");
  await attachNamedScenarioScreenshot(page, testInfo, "command-projection-shallow-light");
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench restores the Evidence anchor after COMMAND projection comparison", async ({ page }, testInfo) => {
  await openScenario(page, "frozen-high-volume", { width: 900, height: 700 }, "dark");
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByLabel("Filter Evidence").fill("retained-evidence-event");
  await page.getByRole("button", { name: "Apply Filter" }).click();
  await expect(page.getByText("Filter: retained-evidence-event", { exact: true })).toBeVisible();

  const grid = page.getByRole("grid", { name: "Ordered Lightstreamer Evidence" });
  const focused = page.locator(`[data-evidence-id="${highVolumeEventId(3_970)}"]`);
  await focused.focus();
  await expect(focused).toBeFocused();
  await grid.hover();
  await page.mouse.wheel(0, -240);
  const beforeScrollTop = await grid.evaluate((ledger) => ledger.scrollTop);
  expect(beforeScrollTop).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Compare COMMAND projections" }).click();
  await page.getByRole("button", { name: "Back to Evidence" }).click();

  await expect.poll(() => grid.evaluate((ledger) => ledger.scrollTop)).toBe(beforeScrollTop);
  await expect(page.getByText("Filter: retained-evidence-event", { exact: true })).toBeVisible();
  await expect(focused).toHaveAttribute("aria-selected", "true");
  await expect(focused).toBeFocused();

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Workbench explains Local-only COMMAND projection differences without changing the observed projection", async ({ page }, testInfo) => {
  await openScenario(page, "command-projection-before-local", { width: 1440, height: 900 }, "dark");
  await page.getByRole("button", { name: "Compare COMMAND projections" }).click();
  const observedBeforeDelivery = await page.getByLabel("Observed Server COMMAND State").textContent();

  await openScenario(page, "command-projection-local-difference", { width: 1440, height: 900 }, "dark");
  const draft = page.getByRole("region", { name: "Local Injection Draft" });
  await expect(draft.getByRole("heading", { name: "DELIVERED LOCALLY" })).toBeVisible();
  await draft.getByRole("button", { name: "Finish Local Injection" }).click();
  const originatingEvidence = page.locator('[data-evidence-id="event-5"]');
  await expect(originatingEvidence).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".workbench-react__evidence-row").filter({ hasText: "LOCAL" })).not.toHaveCount(0);
  const divergentSummary = page.getByRole("region", { name: "COMMAND projection summary" });
  await expect(divergentSummary).toContainText("Projections differ");
  await expect(divergentSummary).toContainText("successful Local Injected Update");
  await expect(divergentSummary.getByRole("button", { name: "Reveal supporting Evidence" })).toBeVisible();
  await page.getByRole("button", { name: "Compare COMMAND projections" }).click();

  const comparison = page.getByRole("region", { name: "COMMAND projection comparison" });
  await expect(comparison.getByText("Why different?", { exact: true })).toBeVisible();
  await expect(comparison).toContainText("Successful Local Injected Updates advance Local Effective COMMAND State only");
  const observed = comparison.getByLabel("Observed Server COMMAND State");
  const localEffective = comparison.getByLabel("Local Effective COMMAND State");
  await expect(observed).toHaveText(observedBeforeDelivery ?? "");
  await expect(observed).not.toContainText("value=9");
  await expect(localEffective).toContainText("command=UPDATE, key=small-alpha, value=9");
  await expect(comparison).toContainText("Neither projection is Authoritative COMMAND State.");
  await attachNamedScenarioScreenshot(page, testInfo, "command-projection-wide-dark-local-difference");
  const supportingLocalEvidence = page.locator(".workbench-react__evidence-row", { hasText: "LOCAL" }).last();
  await comparison.getByRole("button", { name: "Back to Evidence" }).click();
  await expect(originatingEvidence).toHaveAttribute("aria-selected", "true");
  await expect(originatingEvidence).toBeFocused();
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

  const unrelatedPriorLocal = page.locator('[data-evidence-id="retained-prior-local-evidence"]');
  await expect(unrelatedPriorLocal).toBeVisible();
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
  await expect(scopeItems.first()).toContainText("Active");
  await scopeItems.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(":focus")).toHaveRole("treeitem");
  await page.keyboard.press("Enter");
  await expect(page.locator(":focus")).toHaveAttribute("aria-selected", "true");

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench opens and restores the temporary Scope picker at normal and shallow geometry", async ({ page }, testInfo) => {
  await openScenario(page, "live-selected", { width: 900, height: 700 }, "light");
  const scope = page.getByRole("button", { name: "Scope", exact: true });
  await expect(scope).toHaveAttribute("aria-expanded", "false");
  await expect(scope).toHaveAttribute("aria-controls", "workbench-runtime-scope");
  await scope.focus();
  await scope.click();
  await expect(scope).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Close Scope" })).toBeVisible();
  await expect(page.getByRole("tree")).toBeVisible();
  await expect(page.locator(":focus")).toHaveRole("treeitem");
  await page.keyboard.press("Escape");
  await expect(scope).toHaveAttribute("aria-expanded", "false");
  await expect(scope).toBeFocused();

  await openScenario(page, "live-selected", { width: 900, height: 320 }, "dark");
  await scope.click();
  await expect(scope).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Close Scope" })).toBeVisible();
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
  await expect(operationsHeading).toBeFocused();
  await expect(moreActions).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Clear retained Evidence…" }).click();
  await expect(page.getByText(/Clear all \d+ retained Evidence events for this DevTools session\?/)).toBeVisible();
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
  await page.getByRole("button", { name: "Apply Filter" }).click();
  await expect(page.getByText("Filter: retained-evidence-event", { exact: true })).toBeVisible();
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
  await expect(operations).toContainText("current DevTools session history");
  await expect(page.getByRole("button", { name: "Collapse Context" })).toHaveCount(0);
  await expect(operations).toContainText("4,000 retained");
  await expect(operations).toContainText("4,000 captured");
  await expect(operations).toContainText("60 currently shown");
  const clear = operations.getByRole("button", { name: "Clear retained Evidence…" });
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(operations).toContainText("Clear all 4,000 retained Evidence events for this DevTools session?");
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
  await expect(page.getByText("Filter: retained-evidence-event", { exact: true })).toBeVisible();
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
  await expect(page.getByText(/60 shown \/ 4,000/)).toBeVisible();
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
    expect(headers).toContain("COMMAND key");
    expect(headers).not.toContain("Change");
    await expect(selected.locator('[role="gridcell"]').nth(5)).toHaveText(longKey);
    await expect(selected.locator('[role="gridcell"]').nth(5)).toHaveAttribute("title", longKey);
    await expect(missingKey.locator('[role="gridcell"]').nth(5)).toHaveText("—");
    await expect(missingKey.locator('[role="gridcell"]').nth(5)).toHaveAttribute("title", "No COMMAND key");
    await expect(missingKey).not.toContainText("field-only-key-must-not-be-inferred");
    await expect(nonUpdate.locator('[role="gridcell"]').nth(3)).toHaveText("—");
    await expect(nonUpdate.locator('[role="gridcell"]').nth(5)).toHaveText("—");
  };
  await expect(page.locator(".workbench-react__evidence-row")).toHaveCount(60);
  await expect(selected).toHaveAttribute("title", new RegExp(selectedIdentity));
  await expect(selected.locator('[role="gridcell"]').nth(4)).toHaveAttribute("title", longItem);
  const compactHeights = await page.locator(".workbench-react__evidence-row").evaluateAll((rows) =>
    [...new Set(rows.map((row) => row.getBoundingClientRect().height))]
  );
  expect(compactHeights).toHaveLength(1);
  expect(compactHeights[0]).toBeGreaterThanOrEqual(48);
  expect(compactHeights[0]).toBeLessThanOrEqual(54);
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
    if (viewport.geometry === "normal" || viewport.geometry === "wide") {
      const columnWidths = await selected.locator('[role="gridcell"]').evaluateAll((cells) =>
        cells.map((cell) => cell.getBoundingClientRect().width)
      );
      expect(columnWidths).toHaveLength(6);
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
    Math.abs(row.top - scopeWindow.visibleRows[index]!.top - 27) < 1
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
  await expect(page.getByText("Filter: scenario-event", { exact: true })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Copy complete scoped Evidence" })).toHaveCount(0);
  await page.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("button", { name: "Copy complete scoped Evidence" })).toBeVisible();

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
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
  const newest = page.locator(`[data-evidence-id="${highVolumeEventId(4_000)}"]`);
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
  await expect(
    page.getByLabel("Ordered Evidence").getByText("Earlier Snapshot Evidence may be incomplete.")
  ).toBeVisible();
  await expect(
    page.getByLabel("Ordered Evidence").getByRole("button", { name: "Open Capture diagnostics" })
  ).toBeVisible();
  await expect(page.locator(".workbench-react__evidence-row")).not.toHaveCount(0);

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("Workbench retains ordered Evidence while a typed Session recovery is in progress", async ({
  page
}, testInfo) => {
  await openScenario(page, "recovering", { width: 900, height: 700 }, "dark");

  await expect(page.getByText("Capture RUNNING", { exact: true })).toBeVisible();
  await expect(page.getByText("Coverage USEFUL", { exact: true })).toBeVisible();
  await expect(page.getByText("Warning · Session recovering", { exact: true })).toBeVisible();
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

test("Workbench routes an empty normal Scope change through the temporary picker", async ({ page }, testInfo) => {
  await openScenario(page, "empty-scope", { width: 900, height: 700 }, "light");
  await page.getByRole("button", { name: "Change Scope" }).click();
  await expect(page.getByRole("button", { name: "Close Scope" })).toBeVisible();
  await page.getByRole("button", { name: "Close Scope" }).click();
  await expect(page.getByRole("button", { name: "Change Scope" })).toBeFocused();
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
  await expect(page.getByText("Filter: scenario-event")).toBeVisible();
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

  await openScenario(page, "disconnected", { width: 900, height: 700 }, "light");
  await expect(page.getByText("Capture STOPPED", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Ordered Evidence").getByText(/Capture bridge disconnected/)).toBeVisible();

  await openScenario(page, "memory-fallback", { width: 900, height: 700 }, "dark");
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

test("Workbench exposes selected Item Update fields after Evidence metadata and preserves readable JSON strings", async ({ page }, testInfo) => {
  await openScenario(page, "local-injection-json", { width: 1440, height: 900 }, "dark");

  const context = page.getByRole("complementary", { name: "Context" });
  const selectedUpdate = context.getByRole("region", { name: "Selected update" });
  const contextFields = context.locator(".workbench-react__context-fields");
  await expect(selectedUpdate).toBeVisible();
  await expect(selectedUpdate.getByRole("region", { name: "Fields", exact: true })).toContainText("modelValues");
  await expect(selectedUpdate.getByRole("region", { name: "Changed fields", exact: true })).toHaveCount(0);
  await expect(selectedUpdate.getByRole("region", { name: "JSON patches", exact: true })).toHaveCount(0);
  await expect(contextFields.getByText("Source", { exact: true })).toBeVisible();
  await expect(selectedUpdate.getByText("JSON string", { exact: true })).toHaveCount(1);
  await expect(selectedUpdate).toContainText('"selected": false');
  await expect(selectedUpdate).toContainText('{"passenger":');
  await expect(context.getByText("Observed Server COMMAND State", { exact: true })).toBeVisible();
  await expect(context.getByText("Local Effective COMMAND State", { exact: true })).toBeVisible();
  expect(await selectedUpdate.evaluate((node) => {
    const projection = node.parentElement?.querySelector(".workbench-react__projection-summary");
    return projection ? node.getBoundingClientRect().top < projection.getBoundingClientRect().top : false;
  })).toBe(true);
  expect(await contextFields.evaluate((fields, update) =>
    Boolean(fields.compareDocumentPosition(update as Node) & Node.DOCUMENT_POSITION_FOLLOWING),
    await selectedUpdate.elementHandle()
  )).toBe(true);

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
  await page.getByRole("region", { name: "Parked Local Injection Draft" }).getByRole("button", { name: "Resume Local Injection Draft" }).click();
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
      await expect(page.getByRole("heading", { name: "Local Effective COMMAND State" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Observed Server COMMAND State" })).toBeVisible();
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
