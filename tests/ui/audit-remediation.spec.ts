import { expect, test } from "@playwright/test";
import axe from "axe-core";

for (const [name, width, height] of [["compact", 563, 700], ["normal", 900, 700], ["shallow", 900, 320]] as const) {
  for (const theme of ["dark", "light"] as const) {
    test(`Selected value fidelity and certainty stay inspectable: ${name} ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`/?scenario=live-selected&selected-values=fidelity&theme=${theme}`);
      // The accepted dark-only product normalizes legacy theme inputs.
      await expect(page.locator(".workbench-react")).toHaveAttribute("data-theme", "dark");
      expect(await page.evaluate(() => matchMedia("(prefers-color-scheme: light)").matches)).toBe(theme === "light");
      const openContext = page.getByRole("button", { name: "Open selected Context" });
      if (await openContext.isVisible()) await openContext.click();
      const context = page.getByRole("complementary", { name: "Context" });
      const selected = context.getByRole("region", { name: "Selected update" });
      await expect(selected).toContainText("9007199254740993");
      await expect(selected).toContainText("1.2300");
      await expect(selected).toContainText("Ambiguous null; the field value is not proven.");
      await expect(selected).toContainText("Value unavailable.");
      const confirmed = selected.locator("dt").filter({ hasText: /^confirmedNull$/ });
      await expect(confirmed.locator("xpath=following-sibling::dd[1]")).toHaveText("null");
      await selected.getByText("uncertainNull", { exact: true }).scrollIntoViewIfNeeded();
      await expect(selected.getByText("uncertainNull", { exact: true })).toBeInViewport();
      await page.screenshot({ path: info.outputPath("selected-values.png") });
      const metadata = context.locator("summary").filter({ hasText: /^Evidence metadata$/ });
      await metadata.click();
      await expect(context).toContainText("logical-fidelity-update");
      await expect(context).toContainText("listener-fidelity");
      await expect(context).toContainText("Captured patch; prior value and application have not been verified.");
      await context.getByText("JSON Patch basis", { exact: true }).scrollIntoViewIfNeeded();
      await expect(context.getByText("JSON Patch basis", { exact: true })).toBeInViewport();
      await page.screenshot({ path: info.outputPath("selected-metadata.png") });
      await page.addScriptTag({ content: axe.source });
      expect(await page.evaluate(async () => (await window.axe.run()).violations.filter(entry => ["serious", "critical"].includes(entry.impact ?? "")))).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.emulateMedia({ forcedColors: "active" });
      expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
      expect(await page.locator(".workbench-react").evaluate(element => getComputedStyle(element).forcedColorAdjust)).toBe("none");
      await context.getByText("JSON Patch basis", { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath("selected-metadata-forced.png") });
    });
  }
}
