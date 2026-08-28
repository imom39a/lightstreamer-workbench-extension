import { mkdirSync } from "node:fs";

import axe from "axe-core";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

declare global {
  interface Window {
    axe: typeof axe;
  }
}

const evidenceRoot = process.env.LSEW_FILTER_IMPL_14_EVIDENCE_DIR ?? "/tmp/filter-impl-14-visual-evidence";

test("filter-impl-14 exposes typed selected-Evidence actions and immediate recovery", async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(120_000);
  mkdirSync(evidenceRoot, { recursive: true });
  await page.setViewportSize({ width: 900, height: 700 });
  await page.emulateMedia({ colorScheme: "light", forcedColors: "none" });
  await page.goto("/?scenario=filter-find&theme=light");
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");

  const selected = page.locator('[data-evidence-id="scenario-event-3"]');
  const activeFilter = page.locator(".workbench-react__active-filter");
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Focus selected Context" }).click();
  const actions = page.getByRole("complementary", { name: "Context" });
  await expect(actions.getByRole("heading", { name: "Filter selected Evidence" })).toBeVisible();
  await expect(actions.getByRole("button", { name: /^Include Client/ })).toBeVisible();
  await expect(actions.getByRole("button", { name: /^Exclude Client/ })).toBeVisible();
  await expect(actions.locator('[data-filter-action-kind="around"]')).toHaveCount(1);
  await expect(actions.getByRole("button", { name: "Around selected Evidence ±5 seconds" })).toBeVisible();
  await page.locator(".workbench-react").screenshot({ path: `${evidenceRoot}/base-normal-selected-action-context-light.png` });

  await actions.getByRole("button", { name: /^Include COMMAND key/ }).click();
  await expect(activeFilter).toBeVisible();
  await expect(activeFilter).toHaveText("Filter: scenario-event · key: alpha");
  await expect(actions.getByRole("button", { name: /^Exclude Client/ })).toBeVisible();
  await actions.getByRole("button", { name: "Around selected Evidence ±5 seconds" }).click();
  await expect(activeFilter).toBeVisible();
  await expect(activeFilter).toHaveText("Filter: scenario-event · key: alpha · Range −4.998s–+5.002s");
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Reset Filter", exact: true })).toBeVisible();

  await page.locator(".workbench-react").screenshot({ path: `${evidenceRoot}/current-normal-selected-action-context-light.png` });
  await testInfo.attach("current-normal-selected-action-context-light.png", {
    path: `${evidenceRoot}/current-normal-selected-action-context-light.png`,
    contentType: "image/png"
  });
  await page.getByRole("button", { name: "Reset Filter", exact: true }).click();
  await expect(activeFilter).toHaveCount(0);
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await assertAxe(page);
});

test("filter-impl-14 retains hidden selection and exposes minimal Reveal recovery", async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(120_000);
  mkdirSync(evidenceRoot, { recursive: true });
  await page.setViewportSize({ width: 900, height: 700 });
  await page.emulateMedia({ colorScheme: "dark", forcedColors: "none" });
  await page.goto("/?scenario=filter-hidden-selection&theme=dark");
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");

  const condition = page.locator(".workbench-react__condition--selection").filter({ hasText: "Selected event outside current results" });
  await expect(condition).toBeVisible();
  await expect(condition.getByRole("button", { name: "Reveal selected Evidence" })).toBeVisible();
  await expect(condition.getByRole("button", { name: "Clear selection" })).toBeVisible();
  await expect(page.locator('[data-evidence-id="scenario-event-3"]')).toHaveCount(0);
  await page.locator(".workbench-react").screenshot({ path: `${evidenceRoot}/base-hidden-selection-reveal-dark.png` });

  await condition.getByRole("button", { name: "Reveal selected Evidence" }).click();
  await expect(page.locator('[data-evidence-id="scenario-event-3"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-evidence-id="scenario-event-3"]')).toBeFocused();
  await expect(page.locator(".workbench-react__condition--selection")).toHaveCount(0);
  await page.locator(".workbench-react").screenshot({ path: `${evidenceRoot}/current-hidden-selection-reveal-dark.png` });
  await testInfo.attach("current-hidden-selection-reveal-dark.png", {
    path: `${evidenceRoot}/current-hidden-selection-reveal-dark.png`,
    contentType: "image/png"
  });
  await assertAxe(page);
});

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
