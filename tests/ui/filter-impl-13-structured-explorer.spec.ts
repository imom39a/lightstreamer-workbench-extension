import { mkdirSync } from "node:fs";

import axe from "axe-core";
import { expect, test, type TestInfo } from "@playwright/test";

declare global {
  interface Window { axe: typeof axe; }
}

const evidenceRoot = process.env.LSEW_FILTER_IMPL_13_EVIDENCE_DIR ?? "/tmp/filter-impl-13-visual-evidence";

test("filter-impl-13 structured composer discovers exact values and restores nested focus", async ({ page }, testInfo: TestInfo) => {
  mkdirSync(evidenceRoot, { recursive: true });
  await page.setViewportSize({ width: 563, height: 700 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/?scenario=filter-find&theme=light");
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await page.locator(".workbench-react").screenshot({ path: `${evidenceRoot}/base-compact-light.png` });

  const filter = page.getByRole("button", { name: "Filter", exact: true });
  await filter.click();
  await page.getByRole("button", { name: "Add structured criterion", exact: true }).click();
  await expect(page.getByRole("listbox", { name: "Evidence facets" })).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(12);

  await page.getByRole("option", { name: "Add Evidence kind criterion" }).click();
  await expect(page.getByRole("dialog", { name: "Evidence kind exact values" })).toBeVisible();
  await expect(page.getByText(/Exact contextual counts:/)).toBeVisible();
  await page.locator(".workbench-react").screenshot({ path: `${evidenceRoot}/current-compact-light.png` });
  await testInfo.attach("current-compact-light.png", { path: `${evidenceRoot}/current-compact-light.png`, contentType: "image/png" });
  const include = page.getByRole("button", { name: /^Include / }).first();
  await expect(include).toBeVisible();
  await include.click();
  await expect(include).toHaveAttribute("aria-pressed", "true");
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, { resultTypes: ["violations"] });
    return result.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map(({ id, impact, help }) => ({ id, impact, help }));
  });
  expect(violations).toEqual([]);
  await page.emulateMedia({ forcedColors: "active" });
  await expect(page.getByRole("dialog", { name: "Evidence kind exact values" })).toBeVisible();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText(/Filter:.*kind/)).toBeVisible();

  await filter.click();
  await page.getByRole("button", { name: "Add structured criterion", exact: true }).click();
  await page.getByRole("option", { name: "Add Evidence kind criterion" }).click();
  await expect(page.getByRole("dialog", { name: "Evidence kind exact values" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "Evidence facets" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Add Evidence kind criterion" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Add structured criterion", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(filter).toBeFocused();

  for (const viewport of [{ width: 900, height: 700 }, { width: 900, height: 320 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: "light", forcedColors: "none" });
    await filter.click();
    await page.getByRole("button", { name: "Add structured criterion", exact: true }).click();
    await page.getByRole("option", { name: "Add Evidence kind criterion" }).click();
    await expect(page.getByRole("dialog", { name: "Evidence kind exact values" })).toBeVisible();
    const dimensions = await page.locator(".workbench-react").evaluate((shell) => ({ width: shell.clientWidth, scrollWidth: shell.scrollWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(filter).toBeFocused();
  }
});
