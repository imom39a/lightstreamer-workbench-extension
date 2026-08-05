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

test("React Diagnose edits one protected captured Local Injection Draft in lazy CodeMirror", async ({ page }, testInfo) => {
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

test("React Diagnose authors a source-free COMMAND Item Update and seals Review read-only", async ({ page }, testInfo) => {
  await openScenario(page, "local-injection-authored", { width: 900, height: 700 }, "light");
  await page.getByRole("button", { name: "Author COMMAND Item Update" }).click();

  const draft = page.getByRole("region", { name: "Local Injection Draft" });
  const editor = page.getByRole("textbox", { name: "Local Injection JSON", exact: true });
  await expect(editor).toBeFocused();
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
  await draft.getByRole("button", { name: "Minimize" }).click();
  await expect(draft.getByRole("button", { name: "Expand draft" })).toBeFocused();
  await expect(draft).toContainText("topology-small-subscription");
  await expect(draft).toContainText("Source None · newly authored");
  await draft.getByRole("button", { name: "Expand draft" }).click();
  await expect(editor).toBeFocused();
  await draft.getByRole("button", { name: "Park draft" }).click();
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

test("React Diagnose blocks syntax, duplicate, and COMMAND semantic errors until corrected", async ({ page }, testInfo) => {
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

test("React Diagnose keeps a 500-field Draft editor model across compare, geometry, minimize, and park", async ({ page }, testInfo) => {
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
  await draft.getByRole("button", { name: "Minimize" }).click();
  await draft.getByRole("button", { name: "Expand draft" }).click();
  await draft.getByRole("button", { name: "Park draft" }).click();
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
  await draft.getByRole("button", { name: "Minimize" }).click();
  await draft.getByRole("button", { name: "Expand draft" }).click();
  await draft.getByRole("button", { name: "Park draft" }).click();
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

test("React Diagnose blocks a target that becomes stale after Review without executing", async ({ page }, testInfo) => {
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

test("React Diagnose prevents duplicate execution while one Local Injection acknowledgement is pending", async ({ page }, testInfo) => {
  await openScenario(page, "local-injection-pending", { width: 563, height: 700 }, "light");
  const draft = page.getByRole("region", { name: "Local Injection Draft" });
  await expect(draft).toContainText("DELIVERY PENDING");
  await expect(draft).toContainText("No repeat or automatic retry is available");
  await expect(draft.getByRole("button", { name: "Park draft" })).toBeDisabled();
  await expect(draft.getByRole("button", { name: "Discard draft" })).toBeDisabled();
  await expect(draft.getByRole("button", { name: "Inject locally" })).toHaveCount(0);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __localInjectionExecutionCount(): number }).__localInjectionExecutionCount())).toBe(1);

  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScenarioScreenshot(page, testInfo);
});

test("React Diagnose protects the current Draft when another entry conflicts and discards deliberately", async ({ page }, testInfo) => {
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

test("React Diagnose keeps delivered, failed, partial, and unknown Local Injection outcomes durable", async ({ page }, testInfo) => {
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
