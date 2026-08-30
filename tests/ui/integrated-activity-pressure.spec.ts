import { writeFileSync } from "node:fs";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

declare global {
  interface Window {
    __setWorkbenchCaptureStatus: (status: "capturing" | "bridge disconnected") => void;
  }
}

async function openPanel(page: Page, scenario: string, height: number, forced = false): Promise<void> {
  await page.setViewportSize({ width: 900, height });
  await page.emulateMedia({ colorScheme: "dark", forcedColors: forced ? "active" : "none" });
  await page.goto(`/?scenario=${scenario}&theme=dark`);
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
}

async function recordPaneGeometry(page: Page, testInfo: TestInfo): Promise<void> {
  const geometry = await page.getByRole("complementary", { name: "Context" }).evaluate(context => ({
    workspaceHeight: context.closest("main")!.getBoundingClientRect().height,
    contextHeight: context.getBoundingClientRect().height,
    evidenceHeight: document.querySelector('[aria-label="Ordered Evidence"]')!.getBoundingClientRect().height
  }));
  writeFileSync(testInfo.outputPath("pane-geometry.json"), JSON.stringify(geometry));
  await testInfo.attach("pane-geometry", { body: JSON.stringify(geometry), contentType: "application/json" });
}

async function fullEvidenceRows(page: Page): Promise<number> {
  return page.getByRole("grid", { name: "Ordered Lightstreamer Evidence" }).evaluate(grid => {
    const rect = grid.getBoundingClientRect();
    const header = grid.querySelector('[role="row"]')!.getBoundingClientRect();
    const footer = document.querySelector('[aria-label="Workbench diagnostics"]')!.getBoundingClientRect();
    return Array.from(grid.querySelectorAll('[data-evidence-id]')).filter(row => {
      const bounds = row.getBoundingClientRect();
      return bounds.top >= Math.max(rect.top, header.bottom) - .5 && bounds.bottom <= Math.min(rect.bottom, footer.top) + .5;
    }).length;
  });
}

test("Normal Find retains a useful multirow Evidence ledger", async ({ page }, testInfo) => {
  await openPanel(page, "frozen-high-volume", 700);
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.getByRole("textbox", { name: "Find in ordered Evidence" }).fill("complete-retained-find-anchor");
  await expect(page.getByRole("search", { name: "Find in ordered Evidence" })).toContainText("of 3 matches");
  await expect.poll(() => fullEvidenceRows(page)).toBeGreaterThanOrEqual(2);
  await expect(page.getByText(/View FROZEN/)).toBeVisible();
  const contextHeight = await page.getByRole("complementary", { name: "Context" }).evaluate(context => context.getBoundingClientRect().height);
  const actualSize = Number(await page.getByRole("separator", { name: "Resize Context" }).getAttribute("aria-valuenow"));
  expect(Math.abs(actualSize - contextHeight)).toBeLessThan(1);
  await recordPaneGeometry(page, testInfo);
  await page.screenshot({ path: testInfo.outputPath("normal-find-pressure.png") });
});

for (const scene of [
  { scenario: "storage-headroom-warning", height: 700, minimum: 2, forced: false },
  { scenario: "disconnected", height: 320, minimum: 1, forced: false },
  { scenario: "storage-headroom-warning", height: 320, minimum: 1, forced: false },
  { scenario: "storage-headroom-warning", height: 320, minimum: 1, forced: true }
]) test(`Evidence keeps full rows with ${scene.scenario} at ${scene.height}px${scene.forced ? " forced colors" : ""}`, async ({ page }, testInfo) => {
  await openPanel(page, scene.scenario, scene.height, scene.forced);
  await expect(page.getByRole("region", { name: "Workbench diagnostics" })).toContainText(scene.scenario === "disconnected" ? "Capture disconnected" : /headroom/i);
  await expect.poll(() => fullEvidenceRows(page)).toBeGreaterThanOrEqual(scene.minimum);
  await expect(page.getByLabel("Update source legend")).toContainText("SERVER");
  await expect(page.getByLabel("Update source legend")).toContainText("LOCAL");
  await recordPaneGeometry(page, testInfo);
  await page.screenshot({ path: testInfo.outputPath(`${scene.scenario}-${scene.height}.png`) });
});

test("Scenario Review is unobscured on initial shallow diagnostic presentation", async ({ page }, testInfo) => {
  await openPanel(page, "local-injection-scenario-checkpoint-wire-unavailable", 320, true);
  const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
  const review = scenario.getByRole("button", { name: "Review Scenario", exact: true });
  await expect(review).toBeVisible();
  const readBounds = () => review.evaluate(button => {
    const rect = button.getBoundingClientRect();
    const footer = document.querySelector('[aria-label="Workbench diagnostics"]')!.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { top: rect.top, bottom: rect.bottom, footerTop: footer.top, unobscured: hit !== null && button.contains(hit) };
  });
  const bounds = await readBounds();
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.footerTop);
  expect(bounds.unobscured).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("scenario-initial-footer.png") });
  await review.focus();
  await expect(review).toBeFocused();
  expect(await readBounds()).toEqual(bounds);
  await expect(scenario.getByRole("heading", { name: "Local Injection Scenario", exact: true })).toBeInViewport();
});

test("Shallow forced-color anomaly diagnostics keep Evidence summary controls below the timeline", async ({ page }, testInfo) => {
  await openPanel(page, "diagnostic-anomalies", 320, true);
  const timeline = page.getByRole("region", { name: "Activity timeline" });
  const evidence = page.locator('[aria-label="Ordered Evidence"]');
  const header = evidence.locator(":scope > .workbench-react__pane-header");
  const controls = [
    header.getByText("Shown 10", { exact: true }),
    header.getByText("Matching 10", { exact: true }),
    header.getByText("In Scope 10", { exact: true }),
    header.getByRole("button", { name: "Open Scope Context", exact: true })
  ];

  await expect(timeline).toBeVisible();
  for (const control of controls) {
    await expect(control).toBeVisible();
    const bounds = await control.evaluate(element => {
      const controlBounds = element.getBoundingClientRect();
      const headerBounds = element.closest(".workbench-react__pane-header")!.getBoundingClientRect();
      const timelineBounds = document.querySelector('[aria-label="Activity timeline"]')!.getBoundingClientRect();
      return {
        controlTop: controlBounds.top,
        controlBottom: controlBounds.bottom,
        headerTop: headerBounds.top,
        headerBottom: headerBounds.bottom,
        timelineBottom: timelineBounds.bottom
      };
    });
    expect(bounds.controlTop).toBeGreaterThanOrEqual(bounds.timelineBottom - .5);
    expect(bounds.controlTop).toBeGreaterThanOrEqual(bounds.headerTop - .5);
    expect(bounds.controlBottom).toBeLessThanOrEqual(bounds.headerBottom + .5);
  }

  await expect.poll(() => fullEvidenceRows(page)).toBeGreaterThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("anomaly-diagnostics-summary-header.png") });
});


test("Pressure never folds a focused source mark or collision chooser", async ({ page }) => {
  await openPanel(page, "integrated-activity-main", 900);
  const timeline = page.getByRole("region", { name: "Activity timeline" });
  await expect(timeline).toHaveAttribute("aria-busy", "false");
  const toggle = timeline.getByRole("button", { name: "Timeline", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const source = timeline.getByRole("button", { name: /^Select LOCAL Item Update at .*; Evidence activity-main-local-1$/ });
  await source.focus();
  await page.setViewportSize({ width: 900, height: 320 });
  await expect(source).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Find", exact: true }).focus();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const collision = timeline.getByRole("button", { name: /^\d+ captured Activity events; choose Evidence$/ }).last();
  await collision.click();
  const choice = page.getByRole("dialog", { name: "Choose captured Activity event" }).getByRole("button", { name: /^Inspect SERVER Lost updates/ });
  await expect(choice).toBeFocused();
  await page.setViewportSize({ width: 900, height: 320 });
  await expect(choice).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(collision).toBeFocused();
});

test("Explicit timeline expansion and collapse survive pressure while the active range stays visible", async ({ page }) => {
  await openPanel(page, "integrated-activity-main", 320);
  const timeline = page.getByRole("region", { name: "Activity timeline" });
  await expect(timeline).toHaveAttribute("aria-busy", "false");
  const toggle = timeline.getByRole("button", { name: "Timeline", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await timeline.getByRole("button", { name: /^Show snapshot burst .+ in Evidence$/ }).click();
  await expect(timeline).toContainText("Range +2.0s–+10.456s");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(timeline.getByText("Range +2.0s–+10.456s", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await page.setViewportSize({ width: 900, height: 320 });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Reset Filter" })).toBeVisible();
});


test("A pager appearing during passive Capture preserves the focused visible Evidence row", async ({ page }) => {
  await openPanel(page, "integrated-activity-pager-growth", 700);
  const grid = page.getByRole("grid", { name: "Ordered Lightstreamer Evidence" });
  await expect(page.getByRole("button", { name: "Older", exact: true })).toHaveCount(0);
  const focusedId = await grid.evaluate(owner => {
    const rect = owner.getBoundingClientRect();
    return Array.from(owner.querySelectorAll<HTMLElement>("[data-evidence-id]")).filter(row => {
      const bounds = row.getBoundingClientRect();
      return bounds.top >= rect.top + 27 && bounds.bottom <= rect.bottom;
    }).at(-1)!.dataset.evidenceId!;
  });
  const row = grid.locator(`[data-evidence-id="${focusedId}"]`);
  await row.click();
  await expect(row).toHaveAttribute("aria-selected", "true");
  await row.focus();
  await expect(row).toBeFocused();
  await page.evaluate(() => window.__appendDeferredWorkbenchEvents());
  await expect(page.getByRole("button", { name: "Older", exact: true })).toBeVisible();
  await expect(row).toBeFocused();
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => row.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const owner = element.closest('[role="grid"]')!.getBoundingClientRect();
    return bounds.top >= owner.top + 27 && bounds.bottom <= owner.bottom;
  })).toBe(true);
});


test("Normal Context retains its preferred resize after available height clamps it", async ({ page }) => {
  await openPanel(page, "frozen-high-volume", 900);
  const splitter = page.getByRole("separator", { name: "Resize Context" });
  await splitter.focus();
  await page.keyboard.press("Home");
  await expect(splitter).toHaveAttribute("aria-valuenow", "520");
  await page.setViewportSize({ width: 900, height: 700 });
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect.poll(async () => Number(await splitter.getAttribute("aria-valuenow"))).toBeLessThan(520);
  const context = page.getByRole("complementary", { name: "Context" });
  expect(await context.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(210);
  await page.setViewportSize({ width: 900, height: 900 });
  const find = page.getByRole("textbox", { name: "Find in ordered Evidence" });
  await expect(find).toBeFocused();
  await expect.poll(async () => {
    const now = Number(await splitter.getAttribute("aria-valuenow"));
    const maximum = Number(await splitter.getAttribute("aria-valuemax"));
    return now === maximum && maximum > 311;
  }).toBe(true);
  await page.getByRole("button", { name: "Close Find", exact: true }).click();
  await expect(splitter).toHaveAttribute("aria-valuenow", "520");
});


test("Near the Normal gate, storage diagnostics and Find preserve useful Evidence and Context", async ({ page }) => {
  await openPanel(page, "storage-headroom-warning", 700);
  await page.getByRole("button", { name: "Find", exact: true }).click();
  const find = page.getByRole("textbox", { name: "Find in ordered Evidence" });
  await find.fill("scenario");
  await page.setViewportSize({ width: 900, height: 526 });
  await expect(find).toBeFocused();
  await expect.poll(() => fullEvidenceRows(page)).toBeGreaterThanOrEqual(1);
  const context = page.getByRole("complementary", { name: "Context" });
  expect(await context.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(210);
  await expect(page.getByRole("separator", { name: "Resize Context" })).toHaveAttribute("aria-orientation", "vertical");
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(page.getByRole("separator", { name: "Resize Context" })).toHaveAttribute("aria-orientation", "horizontal");
  await expect(find).toBeFocused();
  await expect(find).toHaveValue("scenario");
});

for (const height of [556, 568]) test(`Closing Find restores pressure-parked Context without a viewport resize at ${height}px`, async ({ page }) => {
  await openPanel(page, "integrated-activity-main", height);
  await page.setViewportSize({ width: 800, height });
  const context = page.getByRole("complementary", { name: "Context" });
  const splitter = page.getByRole("separator", { name: "Resize Context" });
  await expect(context).toBeVisible();
  await expect(splitter).toHaveAttribute("aria-orientation", "horizontal");
  const findTrigger = page.getByRole("button", { name: "Find", exact: true });
  await findTrigger.click();
  await expect(page.getByRole("textbox", { name: "Find in ordered Evidence" })).toBeFocused();
  await expect(context).toHaveCount(0);
  await page.getByRole("button", { name: "Close Find", exact: true }).click();
  await expect(context).toBeVisible();
  await expect(splitter).toHaveAttribute("aria-orientation", "horizontal");
  await expect(findTrigger).toBeFocused();
});

test("Recovered diagnostic chrome restores Normal without Shallow footer oscillation", async ({ page }) => {
  await openPanel(page, "integrated-activity-main", 600);
  const splitter = page.getByRole("separator", { name: "Resize Context" });
  await expect(splitter).toHaveAttribute("aria-orientation", "horizontal");
  const findTrigger = page.getByRole("button", { name: "Find", exact: true });
  await findTrigger.focus();
  await page.evaluate(() => window.__setWorkbenchCaptureStatus("bridge disconnected"));
  await expect(page.getByRole("region", { name: "Workbench diagnostics" })).toContainText("Capture disconnected");
  await expect(splitter).toHaveAttribute("aria-orientation", "vertical");
  const orientations = await page.evaluate(async () => {
    const observed: Array<string | null> = [];
    for (let frame = 0; frame < 8; frame += 1) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      observed.push(document.querySelector('[aria-label="Resize Context"]')?.getAttribute("aria-orientation") ?? null);
    }
    return observed;
  });
  expect(orientations).toEqual(Array(8).fill("vertical"));
  await expect(findTrigger).toBeFocused();
  await page.evaluate(() => window.__setWorkbenchCaptureStatus("capturing"));
  await expect(splitter).toHaveAttribute("aria-orientation", "horizontal");
  await expect(findTrigger).toBeFocused();
});
