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
  const activitySummary = actions.locator('details[aria-label="Activity summary"]');
  const selectedFilter = actions.locator('details[aria-label="Filter selected Evidence"]');
  const selectedFilterSummary = selectedFilter.locator(":scope > summary");
  const evidenceMetadata = actions.locator('details[aria-label="Evidence metadata"]');
  await expect(selectedFilter).not.toHaveAttribute("open", "");
  await expect(activitySummary.locator("xpath=following-sibling::*[1]")).toHaveAttribute("aria-label", "Filter selected Evidence");
  await expect(selectedFilter.locator("xpath=following-sibling::*[1]")).toHaveAttribute("aria-label", "Evidence metadata");
  await expect(evidenceMetadata).not.toHaveAttribute("open", "");
  await expect(actions.getByRole("region", { name: "Selected update" })).toBeVisible();
  const fieldsHeading = actions.getByRole("heading", { name: "Fields", exact: true });
  await expect(fieldsHeading).toBeVisible();
  await expect(fieldsHeading).toBeInViewport();
  await expect(evidenceMetadata.getByText("Source", { exact: true })).toBeHidden();
  const metadataSummary = evidenceMetadata.locator("summary");
  await metadataSummary.focus();
  await page.keyboard.press("Enter");
  await expect(evidenceMetadata).toHaveAttribute("open", "");
  await expect(evidenceMetadata.getByText("Source", { exact: true })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(evidenceMetadata).not.toHaveAttribute("open", "");
  await expect(selectedFilterSummary).toBeVisible();
  await selectedFilterSummary.focus();
  await page.keyboard.press("Enter");
  await expect(selectedFilter).toHaveAttribute("open", "");
  await expect(actions.getByRole("radiogroup", { name: /^Client:/ }).getByRole("radio", { name: "Include", exact: true })).toBeVisible();
  await expect(actions.getByRole("radiogroup", { name: /^Client:/ }).getByRole("radio", { name: "Exclude", exact: true })).toBeVisible();
  await expect(actions.locator('[data-filter-action-kind="around"]')).toHaveCount(1);
  await expect(actions.getByRole("button", { name: "Around selected Evidence ±5 seconds" })).toBeVisible();
  await page.locator(".workbench-react").screenshot({ path: `${evidenceRoot}/base-normal-selected-action-context-light.png` });

  await actions.getByRole("radiogroup", { name: /^COMMAND key:/ }).getByRole("radio", { name: "Include", exact: true }).click();
  await expect(activeFilter).toBeVisible();
  await expect(activeFilter).toHaveText("Filter: scenario-event · key: alpha");
  await expect(actions.getByRole("radiogroup", { name: /^Client:/ }).getByRole("radio", { name: "Exclude", exact: true })).toBeVisible();
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

test("selected Context disclosures preserve Fields real estate across compact, normal, shallow and wide layouts", async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(120_000);
  mkdirSync(evidenceRoot, { recursive: true });
  const scenes = [
    { name: "compact-dark", width: 563, height: 700, theme: "dark" as const, forcedColors: "none" as const },
    { name: "normal-light", width: 900, height: 700, theme: "light" as const, forcedColors: "none" as const },
    { name: "shallow-forced-dark", width: 900, height: 320, theme: "dark" as const, forcedColors: "active" as const },
    { name: "wide-light", width: 1440, height: 900, theme: "light" as const, forcedColors: "none" as const }
  ];
  for (const scene of scenes) {
    await page.setViewportSize({ width: scene.width, height: scene.height });
    await page.emulateMedia({ colorScheme: scene.theme, forcedColors: scene.forcedColors });
    await page.goto(`/?scenario=filter-find&theme=${scene.theme}`);
    await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
    const contextEntry = page.getByRole("button", { name: /^(Open|Focus|Restore) selected Context$/ });
    await contextEntry.focus();
    await page.keyboard.press("Enter");
    const context = page.getByRole("complementary", { name: "Context" });
    await expect(context.getByText("Selected Evidence · SERVER", { exact: true })).toBeVisible();
    const activitySummary = context.locator('details[aria-label="Activity summary"]');
    const selectedFilter = context.locator('details[aria-label="Filter selected Evidence"]');
    const evidenceMetadata = context.locator('details[aria-label="Evidence metadata"]');
    await expect(activitySummary).not.toHaveAttribute("open", "");
    await expect(selectedFilter).not.toHaveAttribute("open", "");
    await expect(evidenceMetadata).not.toHaveAttribute("open", "");
    await expect(activitySummary.locator("xpath=following-sibling::*[1]")).toHaveAttribute("aria-label", "Filter selected Evidence");
    await expect(selectedFilter.locator("xpath=following-sibling::*[1]")).toHaveAttribute("aria-label", "Evidence metadata");
    const fieldsHeading = context.getByRole("heading", { name: "Fields", exact: true });
    await expect(fieldsHeading).toBeVisible();
    await expect(fieldsHeading).toBeInViewport();
    await context.screenshot({ path: `${evidenceRoot}/context-disclosures-${scene.name}.png` });
    await testInfo.attach(`context-disclosures-${scene.name}.png`, {
      path: `${evidenceRoot}/context-disclosures-${scene.name}.png`,
      contentType: "image/png"
    });
    await assertAxe(page);
  }
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
