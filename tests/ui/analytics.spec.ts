import axe from "axe-core";
import { expect, test } from "@playwright/test";

for (const [name, viewport, theme] of [
  ["compact", { width: 563, height: 700 }, "dark"],
  ["normal", { width: 900, height: 700 }, "light"],
  ["shallow", { width: 900, height: 320 }, "dark"],
  ["wide", { width: 1440, height: 900 }, "light"]
] as const) {
  test(`usage analytics is disclosed, keyboard operable, and reversible at ${name} geometry`, async ({ page }, testInfo) => {
    const diagnostics: string[] = [];
    page.on("pageerror", error => diagnostics.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto(`/?scenario=frozen-high-volume&theme=${theme}`);
    await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
    const more = page.getByRole("button", { name: "More actions", exact: true });
    await more.click();
    const summary = page.locator("summary").filter({ hasText: "Usage analytics" });
    await summary.focus();
    await page.keyboard.press("Enter");
    const toggle = page.getByRole("checkbox", { name: "Share usage analytics" });
    await expect(toggle).toBeChecked();
    await page.keyboard.press("Tab");
    await expect(toggle).toBeFocused();
    await expect(toggle).toBeInViewport();
    await expect(page.getByText("Captured data, inspected URLs, and typed text stay local.", { exact: false })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`analytics-${name}-on.png`) });
    await page.keyboard.press("Space");
    await expect(toggle).not.toBeChecked();
    await expect(summary).toHaveText("Usage analytics · Off");
    await expect(page.getByText("Off. The saved analytics identifier is removed.")).toBeVisible();
    await expect(toggle).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`analytics-${name}-off.png`) });
    if (name === "shallow") {
      const owner = page.locator(".workbench-react__context-body");
      const status = page.getByText("Off. The saved analytics identifier is removed.");
      const initialScroll = await owner.evaluate(element => element.scrollTop);
      await owner.hover();
      await page.mouse.wheel(0, 400);
      await expect.poll(() => owner.evaluate(element => element.scrollTop)).toBeGreaterThan(initialScroll);
      const bounds = await status.boundingBox();
      const scrollBounds = await owner.boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(scrollBounds!.y + scrollBounds!.height);
      await expect(toggle).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath("analytics-shallow-off-scrolled.png") });
      await page.keyboard.press("Space");
      await expect(toggle).toBeChecked();
      await expect(summary).toHaveText("Usage analytics · On");
      await page.screenshot({ path: testInfo.outputPath("analytics-shallow-on-scrolled.png") });
      await page.keyboard.press("Space");
      await expect(toggle).not.toBeChecked();
      await page.emulateMedia({ forcedColors: "active" });
      await page.screenshot({ path: testInfo.outputPath("analytics-shallow-forced-colors.png") });
      await page.emulateMedia({ forcedColors: "none" });
    }
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => (await (window as unknown as { axe: typeof axe }).axe.run()).violations.filter(entry => entry.impact === "serious" || entry.impact === "critical"));
    expect(violations).toEqual([]);
    const overflow = await page.locator(".workbench-react").evaluate(element => element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight);
    expect(overflow).toBe(false);
    await page.getByRole("button", { name: "Back to prior investigation" }).click();
    await expect(more).toBeFocused();
    await page.reload();
    await more.click();
    await expect(summary).toHaveText("Usage analytics · Off");
    expect(diagnostics).toEqual([]);
  });
}

test("opt-out prevents subsequent UI events and opt-in starts with current state", async ({ page }) => {
  await page.goto("/?scenario=live-selected&theme=dark");
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.locator("summary").filter({ hasText: "Usage analytics" }).click();
  await page.getByRole("checkbox", { name: "Share usage analytics" }).uncheck();
  const count = await page.evaluate(() => (window as unknown as { __analyticsEvents(): unknown[] }).__analyticsEvents().length);
  await page.getByRole("button", { name: "Back to prior investigation" }).click();
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __analyticsEvents(): unknown[] }).__analyticsEvents().length)).toBe(count);
  await page.locator("summary").filter({ hasText: "Usage analytics" }).click();
  await page.getByRole("checkbox", { name: "Share usage analytics" }).check();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __analyticsEvents(): unknown[] }).__analyticsEvents().length)).toBeGreaterThan(count);
});

for (const state of ["error", "unconfigured"]) {
  test(`analytics ${state} leaves an empty Workbench usable and gives an honest status`, async ({ page }, testInfo) => {
    await page.goto(`/?scenario=empty-scope&theme=light&analytics=${state}`);
    await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await page.locator("summary").filter({ hasText: "Usage analytics" }).click();
    await expect(page.getByRole("checkbox", { name: "Share usage analytics" })).toBeDisabled();
    await expect(page.getByText(state === "error" ? "Could not save or read your preference. Analytics is paused. Reopen Workbench to try again." : "Analytics is unavailable in this build.")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`analytics-${state}.png`) });
    await page.getByRole("button", { name: "Back to prior investigation" }).click();
    await expect(page.getByRole("button", { name: "More actions", exact: true })).toBeFocused();
  });
}
