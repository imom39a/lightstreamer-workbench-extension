import axe from "axe-core";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

for (const [width, height, theme] of [[563, 700, "light"], [900, 700, "dark"], [900, 320, "dark"], [1440, 900, "light"]] as const) {
  for (const scenario of ["local-injection-grouped", "history-journal-memory-fallback"] as const) {
    test(`${scenario} at ${width}x${height} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/?scenario=${scenario}&theme=${theme}`);
      await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
      if (scenario === "local-injection-grouped") {
        await expect(page.getByText("Active · 1 clients · 1 subscriptions", { exact: true })).toBeVisible();
        if (process.env.LSEW_REPAIR_EVIDENCE !== "base") await expect(page.getByRole("button", { name: "Inject locally", exact: true })).toBeEnabled();
      }
      if (scenario === "history-journal-memory-fallback") {
        await page.evaluate(() => (window as unknown as { __setWorkbenchStorageMode(mode: string): void }).__setWorkbenchStorageMode("indexeddb"));
        await page.getByRole("button", { name: /^Notifications/ }).click();
      }
      const artifactDir = resolve("test-results/injection-history-repair", process.env.LSEW_REPAIR_EVIDENCE ?? "current");
      await mkdir(artifactDir, { recursive: true });
      await page.screenshot({ path: resolve(artifactDir, `${scenario}-${width}x${height}-${theme}.png`) });
      if (process.env.LSEW_REPAIR_EVIDENCE === "base") return;
      if (scenario === "local-injection-grouped") {
        const inject = page.getByRole("button", { name: "Inject locally", exact: true });
        await expect(inject).toBeEnabled();
        await inject.focus();
        await expect(inject).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("heading", { name: "DELIVERED LOCALLY", exact: true })).toBeVisible();
        const scroll = page.locator(".workbench-react__local-scroll");
        await scroll.focus();
        await expect(scroll).toBeFocused();
        await page.keyboard.press("PageDown");
        await page.screenshot({ path: resolve(artifactDir, `outcome-focused-${width}x${height}-${theme}.png`) });
      } else {
        await expect(page.locator("[data-history-status]")).toContainText("Memory");
        const notice = page.getByRole("article").filter({ hasText: "History using memory" });
        await expect(notice).toContainText("Deterministic browser journal failure");
        await expect(notice).toContainText("25,000");
        await expect(notice).toContainText("128 MiB");
        await expect(notice).toContainText("3 failed journal attempts");
        await notice.scrollIntoViewIfNeeded();
        const details = notice.getByText("Details", { exact: true });
        await details.focus();
        await page.keyboard.press("PageDown");
        await page.screenshot({ path: resolve(artifactDir, `memory-scrolled-${width}x${height}-${theme}.png`) });
      }
      await page.evaluate(axe.source);
      const violations = await page.evaluate(async () => (await (window as unknown as { axe: typeof axe }).axe.run()).violations.filter(v => v.impact === "serious" || v.impact === "critical"));
      expect(violations).toEqual([]);
      expect(await page.locator(".workbench-react").evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
    });
  }
}
