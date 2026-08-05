import axe from "axe-core";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { type ReactDiagnoseScenarioId } from "../support/react-diagnose-scenarios";

const reactHarnessUrl = "http://127.0.0.1:4180";
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
  scenario: ReactDiagnoseScenarioId,
  viewport: { width: number; height: number },
  theme: "dark" | "light" | "auto"
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme === "auto" ? "light" : theme });
  await page.goto(`${reactHarnessUrl}/?scenario=${scenario}&theme=${theme}`);
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

test("React Diagnose keeps selected Evidence, roving focus, and distinct COMMAND projections usable", async ({
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

test("React Diagnose exposes structural Scope as a roving tree at wide geometry", async ({ page }, testInfo) => {
  await openScenario(page, "live-selected", { width: 1440, height: 900 }, "light");

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

test("React Diagnose opens and restores the temporary Scope picker at normal and shallow geometry", async ({ page }, testInfo) => {
  await openScenario(page, "live-selected", { width: 900, height: 700 }, "light");
  const scope = page.getByRole("button", { name: "Scope", exact: true });
  await scope.focus();
  await scope.click();
  await expect(page.getByRole("button", { name: "Close Scope" })).toBeVisible();
  await expect(page.getByRole("tree")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(scope).toBeFocused();

  await openScenario(page, "live-selected", { width: 900, height: 320 }, "dark");
  await scope.click();
  await expect(page.getByRole("button", { name: "Close Scope" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(scope).toBeFocused();

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("React Diagnose returns compact Scope commitment to the originating Evidence row", async ({ page }, testInfo) => {
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

test("React Diagnose keeps low-frequency session controls and scoped export deliberate", async ({ page }, testInfo) => {
  await openScenario(page, "live-selected", { width: 900, height: 700 }, "dark");

  await page.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("heading", { name: "Session operations" })).toBeVisible();
  await page.getByRole("button", { name: "Clear retained Evidence…" }).click();
  await expect(page.getByText(/Clear \d+ retained events\?/)).toBeVisible();
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

test("React Diagnose keeps a compact Frozen high-volume investigation stable and restores Context", async ({
  page
}, testInfo) => {
  await openScenario(page, "frozen-high-volume", { width: 563, height: 700 }, "light");

  await expect(page.getByText("Capture RUNNING", { exact: true })).toBeVisible();
  await expect(page.getByText("Coverage USEFUL", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scope", exact: true })).toBeVisible();
  await expect(page.getByText(/View FROZEN .*30 newer/)).toBeVisible();
  await expect(page.locator(".workbench-react__evidence-row")).toHaveCount(60);

  const selectedRow = page.locator('[data-evidence-id="high-volume-90"]');
  await expect(selectedRow).toHaveAttribute("aria-selected", "true");
  await selectedRow.focus();
  await page.getByRole("button", { name: "Open Context" }).click();
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

test("React Diagnose keeps Find reachable and restorable in compact geometry", async ({ page }, testInfo) => {
  await openScenario(page, "filter-find", { width: 563, height: 700 }, "dark");
  const find = page.getByRole("button", { name: "Find", exact: true });
  await expect(find).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Workbench theme" })).toBeVisible();
  await find.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f");
  await expect(page.getByRole("search", { name: "Find in ordered Evidence" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "Find in ordered Evidence" })).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(find).toBeFocused();

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("React Diagnose lets wide panes resize, collapse, and restore independently", async ({ page }, testInfo) => {
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
  await page.getByRole("button", { name: "Restore Context" }).click();
  await expect(page.getByLabel("Context", { exact: true })).toBeVisible();
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

test("React Diagnose derives non-starving geometry with resize hysteresis", async ({ page }, testInfo) => {
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

test("React Diagnose keeps active capture without selection and selected Local Evidence readable", async ({ page }, testInfo) => {
  await openScenario(page, "active-no-selection", { width: 900, height: 700 }, "light");
  await expect(page.getByText("Capture RUNNING", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inspected page" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Context" })).toHaveCount(0);

  await openScenario(page, "selected-local-evidence", { width: 900, height: 320 }, "dark");
  const local = page.locator('[data-evidence-id="scenario-event-5"]');
  await expect(local).toHaveAttribute("aria-selected", "true");
  await expect(local).toContainText("LOCAL");
  await expect(page.getByRole("button", { name: "Copy complete scoped Evidence" })).toBeVisible();

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("React Diagnose preserves structural selection contrast in forced colors", async ({ page }, testInfo) => {
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
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("React Diagnose navigates retained Evidence windows without losing keyboard boundary focus", async ({ page }, testInfo) => {
  await openScenario(page, "frozen-high-volume", { width: 900, height: 700 }, "dark");
  const initial = page.locator('[data-evidence-id="high-volume-90"]');
  await initial.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Home" : "Control+Home");
  const oldest = page.locator('[data-evidence-id="high-volume-1"]');
  await expect(oldest).toHaveAttribute("aria-selected", "true");
  await expect(oldest).toBeFocused();

  await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  const newest = page.locator('[data-evidence-id="high-volume-120"]');
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

test("React Diagnose makes limited Capture actionable without hiding retained Evidence", async ({
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

test("React Diagnose retains ordered Evidence while a typed Session recovery is in progress", async ({
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

test("React Diagnose keeps a retired Session readable, scoped, and explicitly read-only", async ({
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

test("React Diagnose gives an empty current Scope a truthful compact orientation", async ({ page }, testInfo) => {
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

test("React Diagnose routes an empty normal Scope change through the temporary picker", async ({ page }, testInfo) => {
  await openScenario(page, "empty-scope", { width: 900, height: 700 }, "light");
  await page.getByRole("button", { name: "Change Scope" }).click();
  await expect(page.getByRole("button", { name: "Close Scope" })).toBeVisible();
  await page.getByRole("button", { name: "Close Scope" }).click();
  await expect(page.getByRole("button", { name: "Change Scope" })).toBeFocused();
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("React Diagnose keeps Filter and Find separate across raw, disconnected, fallback, and reopened scenarios", async ({ page }, testInfo) => {
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
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: reactHarnessUrl });
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

test("React Diagnose preserves a Filter-hidden selection through passive Capture and provides deliberate recovery", async ({ page }, testInfo) => {
  await openScenario(page, "filter-hidden-selection", { width: 900, height: 700 }, "dark");

  await expect(page.getByText("Selected event outside current results", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "scenario-event-3 · Item Update" })).toBeVisible();
  const focusedVisible = page.locator('[data-evidence-id="scenario-event-1"]');
  await expect(focusedVisible).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("grid", { name: "Ordered Lightstreamer Evidence" })).toHaveAttribute("tabindex", "0");
  await expect(page.locator('[data-evidence-id="scenario-event-1-passive"]')).toBeVisible();

  await page.getByRole("button", { name: "Open complete raw" }).click();
  await expect(page.getByLabel("Complete raw Evidence")).toContainText("scenario-event-3 · immutable SERVER Evidence");
  await page.getByRole("button", { name: "Back to Evidence" }).click();
  await expect(page.getByText("Selected event outside current results", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Reveal selected Evidence" }).click();
  await expect(page.getByText("Selected event outside current results", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-evidence-id="scenario-event-3"]')).toHaveAttribute("aria-selected", "true");

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("React Diagnose marks and navigates Find results without changing selected Evidence", async ({ page }, testInfo) => {
  await openScenario(page, "filter-find", { width: 900, height: 700 }, "light");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  const current = page.locator('[data-find-current="true"]');
  const before = await current.getAttribute("data-evidence-id");
  await expect(current).toContainText(/Find 1 of/);
  await page.keyboard.press("Enter");
  await expect.poll(() => page.locator('[data-find-current="true"]').getAttribute("data-evidence-id")).not.toBe(before);
  await expect(page.locator('[data-evidence-id="scenario-event-3"]')).toHaveAttribute("aria-selected", "true");

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("React Diagnose keeps retired Scope selectable and explicitly historical", async ({ page }, testInfo) => {
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
