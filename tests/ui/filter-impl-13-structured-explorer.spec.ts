import { mkdirSync } from "node:fs";

import axe from "axe-core";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

declare global {
  interface Window {
    axe: typeof axe;
    __getWorkbenchFilterDiscoveryCount: () => number;
    __makeWorkbenchFilterStale: () => void;
  }
}

const evidenceRoot = process.env.LSEW_FILTER_IMPL_13_EVIDENCE_DIR ?? "/tmp/filter-impl-13-visual-evidence";

test("filter-impl-13 structured explorer has bounded recovery, state, and keyboard evidence", async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(120_000);
  mkdirSync(evidenceRoot, { recursive: true });

  await page.setViewportSize({ width: 563, height: 700 });
  await page.emulateMedia({ colorScheme: "light", forcedColors: "none" });
  await page.goto("/?scenario=filter-find&theme=light");
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await page.locator(".workbench-react").screenshot({ path: `${evidenceRoot}/base-compact-light.png` });
  await openExplorer(page, "filter-find", { width: 563, height: 700 }, "light", "Evidence kind");
  await expect(page.getByRole("listbox", { name: "Evidence facets" })).toHaveCount(0);
  await expect(page.getByText("1 exact value", { exact: true })).toBeVisible();
  await expect(page.getByText(/1 distinct value/)).toBeVisible();
  await assertExplorerLayout(page);
  await page.locator(".workbench-react").screenshot({ path: `${evidenceRoot}/current-compact-light.png` });
  await testInfo.attach("current-compact-light.png", { path: `${evidenceRoot}/current-compact-light.png`, contentType: "image/png" });

  const include = page.getByRole("button", { name: /^Include / }).first();
  await include.click();
  await expect(include).toHaveAttribute("aria-pressed", "true");
  await assertAxe(page);
  await page.emulateMedia({ colorScheme: "light", forcedColors: "active" });
  await expect(page.getByRole("dialog", { name: "Evidence kind exact values" })).toBeVisible();
  await page.locator(".workbench-react").screenshot({ path: `${evidenceRoot}/current-forced-colors-light.png` });
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".workbench-react__active-filter")).toContainText("kind");

  await page.emulateMedia({ colorScheme: "light", forcedColors: "none" });
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("button", { name: "Add structured criterion", exact: true }).click();
  await page.getByRole("option", { name: "Add Evidence kind criterion" }).click();
  await expect(page.getByRole("dialog", { name: "Evidence kind exact values" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "Evidence facets" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Add Evidence kind criterion" })).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.__getWorkbenchFilterDiscoveryCount())).toBe(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Add structured criterion", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.__getWorkbenchFilterDiscoveryCount())).toBe(0);

  for (const [id, viewport, theme] of [
    ["normal-900x700-light", { width: 900, height: 700 }, "light"],
    ["shallow-900x320-light", { width: 900, height: 320 }, "light"],
    ["wide-1440x900-dark", { width: 1440, height: 900 }, "dark"]
  ] as const) {
    await openExplorer(page, "filter-find", viewport, theme, "Evidence kind");
    await assertExplorerLayout(page);
    await page.getByRole("button", { name: "Apply", exact: true }).focus();
    await expect(page.getByRole("button", { name: "Apply", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Cancel", exact: true }).focus();
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await assertAxe(page);
    await page.locator(".workbench-react").screenshot({ path: `${evidenceRoot}/current-${id}.png` });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeFocused();
  }

  await openExplorer(page, "filter-high-cardinality", { width: 900, height: 320 }, "light", "Item");
  const valueList = page.locator('[role="list"][aria-label="Item values"]');
  await expect(page.getByText("220 exact values", { exact: true })).toBeVisible();
  await expect(valueList.getByRole("listitem")).toHaveCount(12);
  const initialScroll = await valueList.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollTop: element.scrollTop
  }));
  expect(initialScroll.overflowY).toMatch(/auto|scroll/);
  expect(initialScroll.scrollHeight).toBeGreaterThan(initialScroll.clientHeight);
  await page.getByRole("button", { name: "Show more exact values", exact: true }).click();
  await expect(valueList.getByRole("listitem")).toHaveCount(24);
  await valueList.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => valueList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const lastValue = valueList.getByRole("listitem").last();
  await lastValue.scrollIntoViewIfNeeded();
  await lastValue.getByRole("button", { name: /^Include / }).focus();
  await expect(lastValue.getByRole("button", { name: /^Include / })).toBeFocused();
  await page.getByLabel("Search exact values").fill("220");
  await expect(valueList.getByRole("listitem")).toHaveCount(1);
  await expect(valueList.getByRole("listitem").first()).toContainText("high-scope-item-220");
  await assertExplorerLayout(page);
  await assertAxe(page);
  await page.locator(".workbench-react").screenshot({ path: `${evidenceRoot}/current-high-cardinality-shallow-light.png` });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await openExplorer(page, "filter-find", { width: 900, height: 700 }, "light", "Evidence kind");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".workbench-react__active-filter")).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toHaveText("Filter: scenario-event");
  await expect(page.locator(".workbench-react__active-filter")).not.toContainText("kind");

  await page.goto("/?scenario=filter-find&theme=light");
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByLabel("Filter Evidence").fill("filter-zero-result");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".workbench-react__active-filter")).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toHaveText("Filter: filter-zero-result");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("button", { name: "Add structured criterion", exact: true }).click();
  await page.getByRole("option", { name: "Add Evidence kind criterion" }).click();
  await expect(page.getByText("Exact values unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("No Evidence is in the current Scope", { exact: false })).toBeVisible();
  await assertExplorerLayout(page);
  await page.locator(".workbench-react").screenshot({ path: `${evidenceRoot}/current-zero-light.png` });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await openExplorer(page, "filter-no-concrete", { width: 900, height: 700 }, "dark", "COMMAND operation");
  await expect(page.getByText("Exact values unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText("No observed concrete values exist", { exact: false })).toBeVisible();
  await assertExplorerLayout(page);
  await assertAxe(page);
  await page.locator(".workbench-react").screenshot({ path: `${evidenceRoot}/current-unavailable-dark.png` });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await openExplorer(page, "filter-active-zero", { width: 900, height: 700 }, "light", "Evidence kind");
  await page.getByRole("button", { name: /^Include item-update/ }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".workbench-react__active-filter")).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toHaveText(/Filter:.*item-update/);
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByLabel("Filter Evidence").fill("filter-active-zero-client-status");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText("Shown 0", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("button", { name: "Add structured criterion", exact: true }).click();
  await page.getByRole("option", { name: "Add Evidence kind criterion" }).click();
  await expect(page.getByText(/pinned · zero/)).toBeVisible();
  await assertExplorerLayout(page);
  await page.locator(".workbench-react").screenshot({ path: `${evidenceRoot}/current-active-zero-light.png` });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await openExplorer(page, "filter-collision", { width: 900, height: 700 }, "light", "Item");
  const collisionRows = page.locator('[role="list"][aria-label="Item values"] [data-filter-value-identity]');
  await expect(collisionRows).toHaveCount(2);
  const collisionIdentities = await collisionRows.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-filter-value-identity")));
  expect(new Set(collisionIdentities).size).toBe(2);
  await expect(page.getByRole("button", { name: /^Include 1; typed identity / })).toHaveCount(2);
  await assertExplorerLayout(page);
  await assertAxe(page);
  await page.locator(".workbench-react").screenshot({ path: `${evidenceRoot}/current-collision-light.png` });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.goto("/?scenario=filter-find&theme=light");
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  const filter = page.getByRole("button", { name: "Filter", exact: true });
  await filter.click();
  await page.getByLabel("Filter Evidence").fill("not-applied-yet");
  await page.evaluate(() => window.__makeWorkbenchFilterStale());
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".workbench-react__filter-status")).toContainText("Filter revision is stale");
  await expect(page.getByLabel("Filter Evidence")).toHaveValue("not-applied-yet");
  await page.locator(".workbench-react").screenshot({ path: `${evidenceRoot}/current-stale-retry-light.png` });
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".workbench-react__active-filter")).toBeVisible();
  await expect(page.locator(".workbench-react__active-filter")).toHaveText("Filter: not-applied-yet");
  await expect(filter).toBeFocused();
  await assertAxe(page);
});

async function openExplorer(
  page: Page,
  scenario: string,
  viewport: { width: number; height: number },
  theme: "dark" | "light",
  facetLabel: string
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme, forcedColors: "none" });
  await page.goto(`/?scenario=${scenario}&theme=${theme}`);
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("button", { name: "Add structured criterion", exact: true }).click();
  await expect(page.getByRole("listbox", { name: "Evidence facets" })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Evidence facets" }).getByRole("option")).toHaveCount(12);
  await page.getByRole("option", { name: `Add ${facetLabel} criterion` }).click();
  await expect(page.getByRole("dialog", { name: `${facetLabel} exact values` })).toBeVisible();
}

async function assertExplorerLayout(page: Page): Promise<void> {
  const layout = await page.locator(".workbench-react").evaluate((shell) => {
    const dialog = shell.querySelector<HTMLElement>('[role="dialog"]');
    const list = dialog?.querySelector<HTMLElement>('[role="list"]');
    const shellRect = shell.getBoundingClientRect();
    const required = [...(dialog?.querySelectorAll("input, button") ?? [])]
      .filter((element) => element.id === "workbench-filter-value-search" || ["Apply", "Cancel", "Back to facets"].includes(element.getAttribute("aria-label") ?? element.textContent?.trim() ?? ""))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      });
    return {
      shellWidth: shell.clientWidth,
      shellScrollWidth: shell.scrollWidth,
      dialog: dialog ? { top: dialog.getBoundingClientRect().top, bottom: dialog.getBoundingClientRect().bottom } : null,
      shellRect: { top: shellRect.top, bottom: shellRect.bottom },
      required,
      list: list ? { clientHeight: list.clientHeight, scrollHeight: list.scrollHeight, overflowY: getComputedStyle(list).overflowY } : null
    };
  });
  expect(layout.shellScrollWidth).toBeLessThanOrEqual(layout.shellWidth);
  expect(layout.dialog).not.toBeNull();
  for (const control of layout.required) {
    expect(control.width).toBeGreaterThan(0);
    expect(control.height).toBeGreaterThan(0);
    expect(control.top).toBeGreaterThanOrEqual(layout.shellRect.top);
    expect(control.bottom).toBeLessThanOrEqual(layout.shellRect.bottom);
  }
  if (layout.list) expect(layout.list.overflowY).toMatch(/auto|scroll/);
}

async function assertAxe(page: Page): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, { resultTypes: ["violations"] });
    return result.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map(({ id, impact, help }) => ({ id, impact, help }));
  });
  expect(violations).toEqual([]);
}
