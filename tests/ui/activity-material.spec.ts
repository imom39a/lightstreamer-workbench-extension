import axe from "axe-core";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

type Theme = "dark" | "light";

async function openActivity(page: Page, scenario: "activity-10k" | "activity-graphical" | "limited-capture" | "memory-fallback", viewport: { width: number; height: number }, theme: Theme): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme });
  await page.goto(`/?scenario=${scenario}&theme=${theme}`);
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await page.getByRole("button", { name: "Open Activity" }).click();
  await expect(page.getByRole("main", { name: "Observed Activity" })).toBeVisible();
}

async function expectNoSeriousAxeViolations(page: Page, testInfo: TestInfo): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, { resultTypes: ["violations"] });
    return result.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => ({ id: violation.id, impact: violation.impact, help: violation.help, nodes: violation.nodes.map((node) => node.html) }));
  });
  await testInfo.attach("axe-violations.json", {
    body: JSON.stringify(violations, null, 2),
    contentType: "application/json"
  });
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function expectNoHorizontalShellOverflow(page: Page): Promise<void> {
  const dimensions = await page.locator(".workbench-react").evaluate((shell) => ({
    shellWidth: shell.clientWidth,
    shellScrollWidth: shell.scrollWidth,
    documentWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth
  }));
  expect(dimensions.shellScrollWidth).toBeLessThanOrEqual(dimensions.shellWidth);
  expect(dimensions.documentScrollWidth).toBeLessThanOrEqual(dimensions.documentWidth);
}

async function attachActivityScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(`${name}.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png"
  });
}

test("Activity 10k remains exact and keyboard-focusable at normal geometry", async ({ page }, testInfo) => {
  await openActivity(page, "activity-10k", { width: 900, height: 700 }, "light");
  const activity = page.getByRole("main", { name: "Observed Activity" });
  await expect(activity).toContainText("9,999 Logical Updates");
  await expect(activity).toContainText("9,999 Update Deliveries");
  const grid = activity.getByRole("grid", { name: "Activity timeline buckets" });
  await expect(grid).toBeVisible();
  await grid.focus();
  await expect(grid).toBeFocused();
  await page.keyboard.press("End");
  await expect(activity.locator("tr[aria-selected='true']")).toHaveCount(1);
  await expectNoHorizontalShellOverflow(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachActivityScreenshot(page, testInfo, "activity-10k-normal-light");
});

test("Activity retains its bounded timeline in narrow and wide themes", async ({ page }, testInfo) => {
  await openActivity(page, "activity-graphical", { width: 563, height: 700 }, "dark");
  const narrowActivity = page.getByRole("main", { name: "Observed Activity" });
  await expect(narrowActivity.getByRole("grid", { name: "Activity timeline buckets" })).toBeVisible();
  await expectNoHorizontalShellOverflow(page);
  await attachActivityScreenshot(page, testInfo, "activity-narrow-dark");

  await openActivity(page, "activity-graphical", { width: 1440, height: 900 }, "light");
  const wideActivity = page.getByRole("main", { name: "Observed Activity" });
  await expect(wideActivity.getByRole("group", { name: "Server activity small multiples" })).toBeVisible();
  await expect(wideActivity.getByRole("grid", { name: "Activity timeline buckets" })).toBeVisible();
  await expectNoHorizontalShellOverflow(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachActivityScreenshot(page, testInfo, "activity-wide-light");
});

test("Activity labels limited and memory-fallback states without changing exact boundaries", async ({ page }, testInfo) => {
  await openActivity(page, "limited-capture", { width: 900, height: 700 }, "dark");
  const limited = page.getByRole("main", { name: "Observed Activity" });
  await expect(limited).toContainText("Coverage LIMITED");
  await expect(limited).toContainText("Observation Coverage is limited");
  await expectNoHorizontalShellOverflow(page);
  await attachActivityScreenshot(page, testInfo, "activity-limited-normal-dark");

  await openActivity(page, "memory-fallback", { width: 563, height: 700 }, "light");
  const memory = page.getByRole("main", { name: "Observed Activity" });
  await expect(memory).toContainText("Coverage USEFUL");
  await expect(memory).toContainText("History Interval");
  await expectNoHorizontalShellOverflow(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachActivityScreenshot(page, testInfo, "activity-memory-fallback-narrow-light");
});

test("Activity keeps textual meaning in forced-colors mode", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.emulateMedia({ colorScheme: "dark", forcedColors: "active" });
  await page.goto("/?scenario=activity-graphical&theme=dark");
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await page.getByRole("button", { name: "Open Activity" }).click();
  const activity = page.getByRole("main", { name: "Observed Activity" });
  await expect(activity).toContainText("Observed Server activity");
  await expect(activity).toContainText("Server Logical Updates");
  await expect(activity).toContainText("Update Deliveries");
  await expectNoHorizontalShellOverflow(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachActivityScreenshot(page, testInfo, "activity-forced-colors-dark");
});
