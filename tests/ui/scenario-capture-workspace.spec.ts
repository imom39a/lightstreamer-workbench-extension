import axe from "axe-core";
import { expect, test, type Page, type Locator } from "@playwright/test";
import type { WorkbenchScenarioSnapshot } from "../../src/extension/panel/workbench-runtime";
import { focusScenarioMember, showScenarioSurface } from "./scenario-ui";

type Harness = {
  __getWorkbenchScenarioSnapshot(): NonNullable<WorkbenchScenarioSnapshot>;
  __localInjectionExecutionCount(): number;
  __serverInjectionExecutionCount(): number;
  __appendDeferredWorkbenchEvents(): number;
  __clearWorkbenchScenarioHistory(): Promise<unknown>;
  __closeWorkbenchScenarioHistory(): Promise<unknown>;
  __setWorkbenchCaptureStatus(status: string): void;
};
const diagnostics = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const messages: string[] = [];
  diagnostics.set(page, messages);
  page.on("console", message => { if (message.type() === "error") messages.push(message.text()); });
  page.on("pageerror", error => messages.push(error.message));
});
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === "passed") {
    const path = testInfo.outputPath("scenario-capture-current.png");
    await page.screenshot({ path });
    await testInfo.attach("scenario-capture-current", { path, contentType: "image/png" });
  }
  if (page.url().includes("history=indexeddb")) await page.evaluate(() => (window as unknown as Partial<Harness>).__closeWorkbenchScenarioHistory?.());
  expect(diagnostics.get(page) ?? []).toEqual([]);
});
async function open(page: Page, scenario = "local-injection-scenario-edit", width = 900, height = 700, history = "memory") {
  await page.setViewportSize({ width, height });
  await page.goto(`/?scenario=${scenario}&theme=dark&history=${history}`);
  // Durable volume setup first commits the fixture and resolves both off-page
  // Sources. The full journey keeps its 60-second budget; this is bootstrap,
  // not the Scenario action/refresh/selection timeout.
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true", { timeout: history === "indexeddb" ? 30_000 : 10_000 });
}
function scenarioDocument(page: Page) { return page.getByRole("region", { name: "Local Injection Scenario", exact: true }); }
function captures(page: Page) { return scenarioDocument(page).getByRole("region", { name: "Scenario captured updates", exact: true }); }
function queue(page: Page) { return scenarioDocument(page).getByRole("navigation", { name: "Ordered Scenario Steps", exact: true }); }
async function showCaptures(page: Page) {
  await showScenarioSurface(page, "capture");
  await expect(captures(page)).toHaveAttribute("aria-busy", "false");
}
async function focusStep(page: Page, ordinal: number) {
  await focusScenarioMember(page, `Step ${ordinal}`);
}
async function snapshot(page: Page) { return page.evaluate(() => (window as unknown as Harness).__getWorkbenchScenarioSnapshot()); }
async function executions(page: Page) { return page.evaluate(() => [(window as unknown as Harness).__localInjectionExecutionCount(), (window as unknown as Harness).__serverInjectionExecutionCount()]); }
async function unobscured(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  expect(await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = element.ownerDocument.elementFromPoint(rect.left + Math.min(rect.width / 2, 40), rect.top + rect.height / 2);
    return hit === element || element.contains(hit);
  })).toBe(true);
}
async function fitsAndAccessible(page: Page) {
  expect(await page.evaluate(() => ({
    html: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    body: document.body.scrollWidth > document.body.clientWidth + 1,
    shell: (() => { const shell = document.querySelector(".workbench-react")!; return shell.scrollWidth > shell.clientWidth + 1; })()
  }))).toEqual({ html: false, body: false, shell: false });
  const violations = await page.evaluate(async source => {
    (0, eval)(source);
    const result = await (window as typeof window & { axe: typeof axe }).axe.run(document.documentElement);
    return result.violations.filter(violation => violation.impact === "serious" || violation.impact === "critical").map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }));
  }, axe.source);
  expect(violations).toEqual([]);
}

test("Scenario capture search remains beside the queue and focused Draft", async ({ page }) => {
  await open(page);
  await showCaptures(page);
  await expect(captures(page).getByRole("searchbox", { name: "Search captured updates", exact: true })).toBeVisible();
  await expect(queue(page)).toBeVisible();
  await expect(scenarioDocument(page).getByRole("textbox", { name: "Step 2 Local Injection JSON", exact: true })).toBeVisible();
  await expect(captures(page).getByRole("checkbox")).toHaveCount(3);
  await expect(captures(page)).toContainText("Already used");
  await expect(scenarioDocument(page).getByRole("region", { name: "Scenario Evidence picker", exact: true })).toHaveCount(0);
  expect(await executions(page)).toEqual([0, 0]);
});

for (const history of ["memory", "indexeddb"]) {
  test(`${history}: 5,000 captures stay bounded and cross-page selection adds once in retained order`, async ({ page }) => {
    test.setTimeout(60_000);
    await open(page, "local-injection-scenario-capture-volume", 900, 700, history);
    await showCaptures(page);
    await expect(captures(page).getByRole("checkbox")).toHaveCount(40);
    const initial = await snapshot(page);
    expect(initial.captureWorkspace.total).toBeGreaterThanOrEqual(5_000);
    const first = captures(page).getByRole("checkbox", { name: "Select captured update scenario-capture-05000", exact: true });
    await first.check();
    const search = captures(page).getByRole("searchbox", { name: "Search captured updates", exact: true });
    await search.fill("capture-value-00001");
    const earliest = captures(page).getByRole("checkbox", { name: "Select captured update scenario-capture-00001", exact: true });
    await earliest.check();
    await expect(captures(page)).toContainText("2 selected across pages");
    await search.fill("capture-value");
    await expect(captures(page).getByRole("checkbox")).toHaveCount(40);
    expect((await snapshot(page)).captureWorkspace.total).toBe(5_000);
    await captures(page).getByRole("button", { name: "Show older captured updates", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).captureWorkspace.pageOffset).toBe(40);
    await expect(captures(page)).toHaveAttribute("aria-busy", "false");
    expect((await snapshot(page)).captureWorkspace.total).toBe(5_000);
    const middle = captures(page).getByRole("checkbox", { name: "Select captured update scenario-capture-04960", exact: true });
    await middle.check();
    const scroll = captures(page).locator(".workbench-react__scenario-capture-scroll");
    await scroll.evaluate(element => { element.scrollTop = 120; element.dispatchEvent(new Event("scroll")); });
    const before = await snapshot(page);
    await captures(page).getByRole("button", { name: "Add selected updates", exact: true }).click();
    await expect.poll(async () => (await snapshot(page)).scenario.steps.length).toBe(5);
    const after = await snapshot(page);
    expect(after.scenario.steps.slice(2).map(({ draft }) => draft.sourceEventId)).toEqual(["scenario-capture-00001", "scenario-capture-04960", "scenario-capture-05000"]);
    expect(after.captureWorkspace.search).toBe(before.captureWorkspace.search);
    expect(after.captureWorkspace.pageOffset).toBe(before.captureWorkspace.pageOffset);
    expect(after.captureWorkspace.scrollTop).toBe(before.captureWorkspace.scrollTop);
    await expect(captures(page)).toContainText("Added 3 captured Steps in retained Evidence order.");
    await expect(queue(page).getByRole("button")).toHaveCount(5);
    await expect(scenarioDocument(page).getByRole("textbox", { name: /Step \d+ Local Injection JSON/ })).toHaveCount(1);
    await focusStep(page, 3);
    const editor = scenarioDocument(page).getByRole("textbox", { name: "Step 3 Local Injection JSON", exact: true });
    await expect(editor).toContainText("capture-value-00001");
    const source = (await snapshot(page)).scenario.steps[2]!.draft.sourceRawText;
    await scenarioDocument(page).getByRole("region", { name: "Step 3 Injection Draft" }).getByRole("button", { name: "Compare Source", exact: true }).click();
    const value = JSON.parse((await snapshot(page)).scenario.steps[2]!.draft.rawText);
    value.fields.value = "deliberate-draft-edit";
    await editor.fill(JSON.stringify(value));
    await scenarioDocument(page).getByLabel("Step 3 actions", { exact: true }).getByRole("button", { name: "Move earlier", exact: true }).click();
    expect((await snapshot(page)).scenario.steps[1]!.draft.sourceRawText).toBe(source);
    expect((await snapshot(page)).scenario.steps[1]!.draft.rawText).toContain("deliberate-draft-edit");
    expect((await snapshot(page)).captureWorkspace.search).toBe("capture-value");
    expect((await snapshot(page)).captureWorkspace.pageOffset).toBe(40);
    await expect(scenarioDocument(page).getByRole("textbox", { name: /Step \d+ Local Injection JSON/ })).toHaveCount(1);
    expect(await executions(page)).toEqual([0, 0]);
    await fitsAndAccessible(page);
  });
}

test("capture addition Undo preserves the workspace and deliberate duplicate reuse remains available", async ({ page }) => {
  await open(page);
  await showCaptures(page);
  const input = captures(page).getByRole("checkbox", { name: "Select captured update scenario-compatible-bulk-update", exact: true });
  await input.check();
  await captures(page).getByRole("button", { name: "Add selected updates", exact: true }).click();
  await expect(queue(page).getByRole("button")).toHaveCount(3);
  await captures(page).getByRole("button", { name: "Undo added updates", exact: true }).click();
  await expect(queue(page).getByRole("button")).toHaveCount(2);
  await expect(input).toBeEnabled();
  await focusStep(page, 2);
  await scenarioDocument(page).getByLabel("Step 2 actions", { exact: true }).getByRole("button", { name: "Duplicate Step", exact: true }).click();
  await expect(queue(page).getByRole("button")).toHaveCount(3);
  const state = await snapshot(page);
  expect(state.scenario.steps[2]!.draft.sourceEventId).toBe(state.scenario.steps[1]!.draft.sourceEventId);
  expect(await executions(page)).toEqual([0, 0]);
});

test("100-Step capacity has a physically visible recovery beside disabled captured add", async ({ page }) => {
  await open(page, "local-injection-scenario-high-volume");
  await showCaptures(page);
  const reason = captures(page).getByText(/100-Step capacity reached/);
  await unobscured(reason);
  await expect(captures(page).getByRole("button", { name: "Add selected updates", exact: true })).toBeDisabled();
  await expect(captures(page).getByRole("checkbox", { name: "Select captured update event-5", exact: true })).toBeDisabled();
  await scenarioDocument(page).getByRole("button", { name: "Add authored update", exact: true }).click();
  const alert = scenarioDocument(page).getByRole("alert");
  await expect(alert).toContainText("at most 100 Steps");
  await unobscured(alert);
  await expect(queue(page).getByRole("button")).toHaveCount(100);
  expect(await executions(page)).toEqual([0, 0]);
});

test("new Capture requires explicit refresh and preserves selected membership", async ({ page }) => {
  await open(page, "local-injection-scenario-capture-volume");
  await showCaptures(page);
  await captures(page).getByRole("checkbox", { name: "Select captured update scenario-capture-05000", exact: true }).check();
  const before = await snapshot(page);
  expect(await page.evaluate(() => (window as unknown as Harness).__appendDeferredWorkbenchEvents())).toBe(2);
  await expect(captures(page)).toContainText("2 newer accepted Evidence");
  expect((await snapshot(page)).captureWorkspace.total).toBe(before.captureWorkspace.total);
  await captures(page).getByRole("button", { name: "Refresh captures", exact: true }).click();
  await expect(captures(page).getByRole("checkbox", { name: "Select captured update scenario-capture-05002", exact: true })).toBeVisible();
  expect((await snapshot(page)).captureWorkspace.selected).toEqual(before.captureWorkspace.selected);
  await expect(queue(page).getByRole("button")).toHaveCount(2);
  expect(await executions(page)).toEqual([0, 0]);
});

test("expired retained Source refuses visibly and Clear selection plus Refresh recovers an empty workspace", async ({ page }) => {
  await open(page);
  await showCaptures(page);
  await captures(page).getByRole("checkbox", { name: "Select captured update scenario-compatible-bulk-update", exact: true }).check();
  await page.evaluate(() => (window as unknown as Harness).__clearWorkbenchScenarioHistory());
  await captures(page).getByRole("button", { name: "Add selected updates", exact: true }).click();
  const alert = captures(page).getByRole("alert").filter({ hasText: "no longer retained" });
  await expect(alert).toBeVisible();
  await unobscured(alert);
  await captures(page).getByRole("button", { name: "Clear selection", exact: true }).click();
  await captures(page).getByRole("button", { name: "Refresh captures", exact: true }).click();
  await expect(captures(page)).toContainText("No retained captured updates");
  await expect(captures(page).getByRole("checkbox")).toHaveCount(0);
  await expect(queue(page).getByRole("button")).toHaveCount(2);
  expect(await executions(page)).toEqual([0, 0]);
  await fitsAndAccessible(page);
});

test("target invalidation during capture selection refuses Add without changing the queue", async ({ page }) => {
  await open(page);
  await showCaptures(page);
  await captures(page).getByRole("checkbox", { name: "Select captured update scenario-compatible-bulk-update", exact: true }).check();
  await page.evaluate(() => (window as unknown as Harness).__setWorkbenchCaptureStatus("bridge disconnected"));
  await captures(page).getByRole("button", { name: "Add selected updates", exact: true }).click();
  await expect(captures(page).getByRole("alert")).toContainText(/Target changed|unavailable|Capture/);
  await unobscured(captures(page).getByRole("alert"));
  await expect(queue(page).getByRole("button")).toHaveCount(2);
  expect(await executions(page)).toEqual([0, 0]);
});

test("capture query failure preserves selection and refuses membership without a delivery", async ({ page }) => {
  await open(page);
  await showCaptures(page);
  await captures(page).getByRole("checkbox", { name: "Select captured update scenario-compatible-bulk-update", exact: true }).check();
  const before = await snapshot(page);
  await page.evaluate(() => (window as unknown as Harness).__closeWorkbenchScenarioHistory());
  await captures(page).getByRole("button", { name: "Refresh captures", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).captureWorkspace.queryState).toBe("error");
  await unobscured(captures(page).getByRole("alert"));
  expect((await snapshot(page)).captureWorkspace.selected).toEqual(before.captureWorkspace.selected);
  const results = captures(page).getByRole("region", { name: "Captured update results", exact: true });
  await results.focus();
  await expect(results).toBeFocused();
  await fitsAndAccessible(page);
  await captures(page).getByRole("button", { name: "Add selected updates", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).captureWorkspace.adding).toBe(false);
  expect((await snapshot(page)).scenario.steps).toEqual(before.scenario.steps);
  await captures(page).getByRole("button", { name: "Clear selection", exact: true }).click();
  expect((await snapshot(page)).captureWorkspace.selected).toEqual([]);
  expect(await executions(page)).toEqual([0, 0]);
});

for (const { width, height, forced } of [
  { width: 1440, height: 900, forced: false }, { width: 900, height: 700, forced: false },
  { width: 563, height: 700, forced: false }, { width: 900, height: 320, forced: true }
]) {
  test(`capture and queue keyboard routes survive Park at ${width}x${height}${forced ? " forced colors" : ""}`, async ({ page }) => {
    await page.emulateMedia({ forcedColors: forced ? "active" : "none" });
    await open(page, "local-injection-scenario-edit", width, height);
    await showCaptures(page);
    const search = captures(page).getByRole("searchbox", { name: "Search captured updates", exact: true });
    await search.fill("bulk-update");
    await search.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(search).toBeFocused();
    const checkbox = captures(page).getByRole("checkbox", { name: "Select captured update scenario-compatible-bulk-update", exact: true });
    await checkbox.focus();
    await page.keyboard.press("Space");
    await expect(checkbox).toBeChecked();
    await scenarioDocument(page).getByRole("button", { name: "Back to Evidence", exact: true }).click();
    await page.getByRole("region", { name: "Parked Local Injection Scenario", exact: true }).getByRole("button", { name: "Resume Scenario", exact: true }).click();
    await showCaptures(page);
    await expect(search).toHaveValue("bulk-update");
    await expect(checkbox).toBeChecked();
    const add = captures(page).getByRole("button", { name: "Add selected updates", exact: true });
    await add.scrollIntoViewIfNeeded();
    await add.focus();
    await unobscured(add);
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await snapshot(page)).scenario.steps.length).toBe(3);
    await focusStep(page, 3);
    const editor = scenarioDocument(page).getByRole("textbox", { name: "Step 3 Local Injection JSON", exact: true });
    await expect(editor).toBeVisible();
    await expect(scenarioDocument(page).getByRole("textbox", { name: /Step \d+ Local Injection JSON/ })).toHaveCount(1);
    await expect(scenarioDocument(page).getByLabel("Protected Scenario target and execution boundary", { exact: true })).toContainText("LOCAL ONLY");
    expect(await executions(page)).toEqual([0, 0]);
    await fitsAndAccessible(page);
  });
}
