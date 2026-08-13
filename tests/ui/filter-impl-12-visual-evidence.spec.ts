import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __makeWorkbenchFilterStale?: () => void;
  }
}

const evidenceRoot = process.env.LSEW_FILTER_EVIDENCE_DIR ?? "/tmp/filter-impl-12-composer-evidence";
const evidenceVariant = process.env.LSEW_FILTER_EVIDENCE_VARIANT ?? "current";

test("filter-impl-12 visual evidence: open composer and stale status", async ({ page }) => {
  mkdirSync(`${evidenceRoot}/${evidenceVariant}`, { recursive: true });

  for (const scene of [
    { id: "compact-563x700-light", width: 563, height: 700 },
    { id: "normal-900x700-light", width: 900, height: 700 }
  ]) {
    await page.setViewportSize({ width: scene.width, height: scene.height });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/?scenario=filter-find&theme=light");
    await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");

    await page.getByRole("button", { name: "Filter", exact: true }).click();
    await expect(page.getByLabel("Filter Evidence")).toBeVisible();
    await page.getByLabel("Filter Evidence").fill("not-applied-yet");
    await page.locator(".workbench-react").screenshot({
      path: `${evidenceRoot}/${evidenceVariant}/${scene.id}-open-composer.png`
    });

    const hasStaleHook = await page.evaluate(() => typeof window.__makeWorkbenchFilterStale === "function");
    if (!hasStaleHook) continue;

    await page.evaluate(() => window.__makeWorkbenchFilterStale?.());
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.locator(".workbench-react__filter-status")).toContainText("Filter revision is stale");
    await expect(page.getByLabel("Filter Evidence")).toHaveValue("not-applied-yet");
    await page.locator(".workbench-react").screenshot({
      path: `${evidenceRoot}/${evidenceVariant}/${scene.id}-stale-status.png`
    });
  }
});
