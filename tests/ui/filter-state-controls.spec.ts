import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import axe from "axe-core";
import { expect, test, type Page } from "@playwright/test";
import { FILTER_STATE_VISUALS, prepareFilterStateVisual } from "../support/filter-state-visuals.mjs";
import { waitForVisualReadiness, warmVisualRenderer } from "./visual-readiness";

test("selected value states switch atomically and Off preserves unrelated filters and selection", async ({ page }) => {
  await prepareFilterStateVisual(page, FILTER_STATE_VISUALS.find(scene => scene.id === "filter-state-context-normal-dark")!);
  const disclosure = page.locator('details[aria-label="Filter selected Evidence"]');
  const key = disclosure.getByRole("radiogroup", { name: "COMMAND key: alpha", exact: true });
  await expect(key).toHaveCount(1);
  await expect(key.getByRole("radio", { name: "Off", exact: true })).toBeChecked();
  await expect(disclosure).not.toContainText("Typed actions apply");
  const active = page.locator(".workbench-react__active-filter");
  await key.getByRole("radio", { name: "Include", exact: true }).check();
  await expect(active).toHaveText("Filter: scenario-event · key: alpha");
  await expect(key.getByRole("radio", { name: "Include", exact: true })).toBeChecked();
  await key.getByRole("radio", { name: "Exclude", exact: true }).check();
  await expect(key.getByRole("radio", { name: "Include", exact: true })).not.toBeChecked();
  await expect(key.getByRole("radio", { name: "Exclude", exact: true })).toBeChecked();
  await expect(page.getByText("Selected event outside current results", { exact: true })).toBeVisible();
  await key.getByRole("radio", { name: "Off", exact: true }).check();
  await expect(active).toHaveText("Filter: scenario-event");
  await expect(page.locator('[data-evidence-id="scenario-event-3"]')).toHaveAttribute("aria-selected", "true");
  await expect(disclosure).toHaveAttribute("open", "");
  await key.getByRole("radio", { name: "Off", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(key.getByRole("radio", { name: "Include", exact: true })).toBeChecked();
  await expect(key.getByRole("radio", { name: "Include", exact: true })).toBeFocused();
  await captureSupplement(page, "context-include-keyboard-focus");
  await page.keyboard.press("ArrowRight");
  await expect(key.getByRole("radio", { name: "Exclude", exact: true })).toBeChecked();
  await captureSupplement(page, "context-exclude-keyboard-focus");
  await page.keyboard.press("ArrowRight");
  await expect(key.getByRole("radio", { name: "Off", exact: true })).toBeChecked();
  await expect(active).toHaveText("Filter: scenario-event");
  await assertAccessibleLayout(page);
});

test("Filter editor stages the same value states and preserves Cancel and Apply", async ({ page }) => {
  await page.goto("/?scenario=filter-find&theme=light");
  await page.locator('html[data-react-scene-ready="true"]').waitFor();
  const openValues = async () => {
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    await page.getByRole("button", { name: "Add structured criterion", exact: true }).click();
    await page.getByRole("option", { name: "Add Evidence kind criterion", exact: true }).click();
  };
  await openValues();
  const group = page.getByRole("dialog", { name: "Evidence kind exact values" }).getByRole("radiogroup").first();
  await group.getByRole("radio", { name: "Include", exact: true }).check();
  await group.getByRole("radio", { name: "Exclude", exact: true }).check();
  await expect(group.getByRole("radio", { name: "Include", exact: true })).not.toBeChecked();
  await expect(page.locator(".workbench-react__active-filter")).toHaveText("Filter: scenario-event");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await openValues();
  await expect(group.getByRole("radio", { name: "Off", exact: true })).toBeChecked();
  await group.getByRole("radio", { name: "Include", exact: true }).check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".workbench-react__active-filter")).toContainText("kind: item-update");
  await openValues();
  await expect(group.getByRole("radio", { name: "Include", exact: true })).toBeChecked();
  await group.getByRole("radio", { name: "Off", exact: true }).check();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".workbench-react__active-filter")).toHaveText("Filter: scenario-event");
});


test("compact and shallow Context filters keep keyboard focus reachable through scrolled properties", async ({ page }) => {
  for (const id of ["filter-state-context-compact-dark", "filter-state-context-shallow-forced-dark"]) {
    await prepareFilterStateVisual(page, FILTER_STATE_VISUALS.find(scene => scene.id === id)!);
    const disclosure = page.locator('details[aria-label="Filter selected Evidence"]');
    const more = disclosure.locator(".workbench-react__filter-action-more > summary");
    await more.focus();
    await page.keyboard.press("Enter");
    const groups = disclosure.getByRole("radiogroup");
    await groups.first().getByRole("radio", { name: "Off", exact: true }).focus();
    const count = await groups.count();
    let visited = 0;
    for (let step = 0; step < count + 6 && visited < count; step++) {
      if (await page.locator('input[type="radio"]:focus').count()) {
        await expectFocusedControlUnobscured(page);
        visited++;
      }
      await page.keyboard.press("Tab");
    }
    expect(visited).toBe(count);
    await captureSupplement(page, `${id}-scrolled-keyboard`);
    await assertAccessibleLayout(page);
  }
});

test("shallow Notifications retain visible keyboard focus through every filter facet", async ({ page }) => {
  await prepareFilterStateVisual(page, FILTER_STATE_VISUALS.find(scene => scene.id === "filter-state-notifications-shallow-forced-dark")!);
  const groups = page.getByRole("region", { name: "Notifications", exact: true }).getByRole("radiogroup");
  const count = await groups.count();
  expect(count).toBeGreaterThan(2);
  await groups.first().getByRole("radio", { name: "Off", exact: true }).focus();
  for (let step = 0; step < count; step++) {
    await expect(page.locator('input[type="radio"]:focus')).toHaveCount(1);
    await expectFocusedControlUnobscured(page);
    if (step < count - 1) await page.keyboard.press("Tab");
  }
  await captureSupplement(page, "notifications-shallow-scrolled-focus");
  await page.keyboard.press("ArrowRight");
  await expect(groups.last().getByRole("radio", { name: "Include", exact: true })).toBeChecked();
  await expectFocusedControlUnobscured(page);
  await captureSupplement(page, "notifications-shallow-include-focus");
  await page.keyboard.press("ArrowRight");
  await expect(groups.last().getByRole("radio", { name: "Exclude", exact: true })).toBeChecked();
  await expectFocusedControlUnobscured(page);
  await captureSupplement(page, "notifications-shallow-exclude-focus");
  await assertAccessibleLayout(page);
});

async function expectFocusedControlUnobscured(page: Page) {
  const focused = await page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth && (hit === element || element.contains(hit));
  });
  expect(focused).toBe(true);
}

async function captureSupplement(page: Page, name: string) {
  const directory = resolve("test-results/filter-state-review/supplemental");
  await mkdir(directory, { recursive: true });
  await page.locator(".workbench-react").screenshot({ path: resolve(directory, `${name}.png`) });
}

for (const scene of FILTER_STATE_VISUALS) {
  test(`filter state visual: ${scene.id}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await prepareFilterStateVisual(page, scene);
    const firstOff = page.getByRole("radio", { name: "Off", exact: true }).first();
    await expect(firstOff).toBeVisible();
    await expect(firstOff).toBeInViewport({ ratio: 1 });
    await warmVisualRenderer(page, ".workbench-react");
    await waitForVisualReadiness(page, ".workbench-react");
    await assertAccessibleLayout(page);
    expect(errors).toEqual([]);
    const directory = resolve("test-results/filter-state-review/current");
    await mkdir(directory, { recursive: true });
    const path = resolve(directory, `${scene.id}.png`);
    await page.locator(".workbench-react").screenshot({ path });
    await testInfo.attach(scene.id, { path, contentType: "image/png" });
    await expect(page.locator(".workbench-react")).toHaveScreenshot(`${scene.id}.png`);
  });
}

async function assertAccessibleLayout(page: Page) {
  await page.addScriptTag({ content: axe.source });
  const result = await page.evaluate(async () => {
    const checks = await (window as unknown as { axe: typeof axe }).axe.run(document, { resultTypes: ["violations"] });
    return {
      violations: checks.violations.filter(violation => violation.impact === "serious" || violation.impact === "critical").map(({ id, help }) => ({ id, help })),
      overflow: document.documentElement.scrollWidth > innerWidth || (document.querySelector(".workbench-react")?.scrollWidth ?? 0) > innerWidth
    };
  });
  expect(result).toEqual({ violations: [], overflow: false });
}
