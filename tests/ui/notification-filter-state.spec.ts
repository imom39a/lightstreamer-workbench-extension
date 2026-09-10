import axe from "axe-core";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import type { WorkbenchScenarioId } from "../support/workbench-scenarios";

declare global {
  interface Window { axe: typeof axe; }
}

async function openScenario(page: Page, scenario: WorkbenchScenarioId, viewport: { width: number; height: number }, theme: "dark" | "light"): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme, forcedColors: "none" });
  await page.goto(`/?scenario=${scenario}&theme=${theme}`);
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await expect(page.locator(".workbench-react")).toBeVisible();
}

function filterValue(notifications: Locator, value: string): Locator {
  return notifications.locator(`fieldset[aria-label^="${value}"]`).locator("..");
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

async function expectNoSeriousAxeViolations(page: Page, testInfo: TestInfo): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, { resultTypes: ["violations"] });
    return result.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map(({ id, impact, help, nodes }) => ({ id, impact, help, nodes: nodes.map((node) => node.html) }));
  });
  await testInfo.attach("axe-violations.json", { body: JSON.stringify(violations, null, 2), contentType: "application/json" });
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

test("Notifications expose independent three-state controls with keyboard and zero-result recovery", async ({ page }, testInfo) => {
  await openScenario(page, "diagnostic-subscription-context", { width: 900, height: 700 }, "dark");
  const evidenceSelection = page.locator(".workbench-react__evidence-row").first();
  const selectedEvidenceId = await evidenceSelection.getAttribute("data-evidence-id");
  expect(selectedEvidenceId).toBeTruthy();

  await page.getByRole("button", { name: /^Notifications/ }).click();
  const notifications = page.getByRole("region", { name: "Notifications", exact: true });
  await notifications.getByText("Filter notifications", { exact: true }).click();

  const exact = filterValue(notifications, "ls.subscription.exact-duplicate");
  const affected = filterValue(notifications, "Subscription duplicate-b");
  await expect(exact.locator(".workbench-react__notifications-filter-label")).toContainText("ls.subscription.exact-duplicate");
  const radios = exact.getByRole("radio");
  await expect(radios).toHaveCount(3);
  await expect(radios.nth(0)).toBeChecked();

  // Physical ArrowRight + Space moves Off → Include, then Include → Exclude.
  await radios.nth(0).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect(radios.nth(1)).toBeChecked();
  await expect(notifications).toContainText("Exact duplicate Subscriptions");
  await expect(notifications.getByRole("button", { name: "Remove Include ls.subscription.exact-duplicate", exact: true })).toBeVisible();
  await affected.getByRole("radio", { name: "Include", exact: true }).click();
  await expect(affected.getByRole("radio", { name: "Include", exact: true })).toBeChecked();
  await exact.getByRole("radio", { name: "Exclude", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(exact.getByRole("radio", { name: "Exclude", exact: true })).toBeChecked();
  await expect(exact.getByRole("radio", { name: "Exclude", exact: true })).toBeFocused();
  await expect(affected.getByRole("radio", { name: "Include", exact: true })).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect(exact.getByRole("radio", { name: "Off", exact: true })).toBeChecked();

  // Tab exits the native group. Off restores the exact value while the unrelated facet remains selected.
  await page.keyboard.press("Tab");
  await expect(exact.getByRole("radio", { name: "Off", exact: true })).not.toBeFocused();
  await expect(notifications.getByRole("article")).toHaveCount(1);
  await expect(exact.getByRole("radio", { name: "Off", exact: true })).toBeChecked();

  await notifications.getByRole("button", { name: "Back to Evidence", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Notifications/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Freeze Evidence", exact: true })).toBeVisible();
  await expect(page.locator(`[data-evidence-id="${selectedEvidenceId}"]`)).toBeVisible();
  await expectShellFits(page);
  await expectNoSeriousAxeViolations(page, testInfo);
});

test("Notifications controls stay reachable in compact and shallow forced-colors layouts", async ({ page }, testInfo) => {
  for (const scene of [
    { width: 563, height: 700, theme: "light" as const },
    { width: 900, height: 320, theme: "dark" as const }
  ]) {
    await openScenario(page, "diagnostic-subscription-context", scene, scene.theme);
    await page.emulateMedia({ colorScheme: scene.theme, forcedColors: "active" });
    await page.getByRole("button", { name: /^Notifications/ }).click();
    const notifications = page.getByRole("region", { name: "Notifications", exact: true });
    await notifications.getByText("Filter notifications", { exact: true }).click();
    const exact = filterValue(notifications, "ls.subscription.exact-duplicate");
    await expect(exact).toBeVisible();
    await expect(exact.locator(".workbench-react__notifications-filter-label")).toContainText("ls.subscription.exact-duplicate");
    await expect(exact.getByRole("radio", { name: "Off", exact: true })).toBeVisible();
    await expectShellFits(page);
    await expectNoSeriousAxeViolations(page, testInfo);
  }

  await openScenario(page, "notifications-volume", { width: 900, height: 700 }, "dark");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const notifications = page.getByRole("region", { name: "Notifications", exact: true });
  await notifications.getByText("Filter notifications", { exact: true }).click();
  const information = filterValue(notifications, "Information");
  await information.getByRole("radio", { name: "Exclude", exact: true }).click();
  await expect(notifications).toContainText("0 of 100 notifications");
  await expect(notifications).toContainText("No notifications match the active notification filters.");
  await expect(information.getByRole("radio", { name: "Exclude", exact: true })).toBeFocused();
  await information.getByRole("radio", { name: "Off", exact: true }).click();
  await expect(notifications.getByRole("article")).toHaveCount(100);
  await expect(information.getByRole("radio", { name: "Off", exact: true })).toBeChecked();
  await expectNoSeriousAxeViolations(page, testInfo);
});
