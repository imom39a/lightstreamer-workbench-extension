import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

for (const forcedColors of ["none", "active"] as const) {
  test(`Workbench stays dark under legacy preferences and light system settings with forced colors ${forcedColors}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light", forcedColors });
    for (const theme of ["light", "auto", "dark"]) {
      for (const viewport of [{ width: 900, height: 700 }, { width: 563, height: 700 }]) {
        await page.setViewportSize(viewport);
        await page.goto(`/?scenario=filter-find&theme=${theme}`);
        await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
        const panel = page.locator(".workbench-react");
        await expect(panel).toHaveAttribute("data-theme", "dark");
        await expect(panel).toHaveCSS("background-color", "rgb(27, 29, 32)");
        await expect(panel).toHaveCSS("color-scheme", "dark");
        await expect(panel).toHaveCSS("color", "rgb(237, 240, 243)");
        const moreActions = page.getByRole("button", { name: "More actions", exact: true });
        await expect(moreActions).toHaveCSS("background-color", "rgb(41, 45, 51)");
        await expect(moreActions).toHaveCSS("color", "rgb(237, 240, 243)");
        await expect(page.getByLabel("Workbench theme", { exact: true })).toHaveCount(0);
        await page.getByRole("button", { name: "More actions", exact: true }).click();
        await expect(page.getByLabel("Panel theme", { exact: true })).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "Panel appearance", exact: true })).toHaveCount(0);
        await page.getByRole("button", { name: "Back to prior investigation", exact: true }).click();
        await page.emulateMedia({ colorScheme: "dark" });
        await expect(panel).toHaveCSS("background-color", "rgb(27, 29, 32)");
        await page.emulateMedia({ colorScheme: "light" });
      }
    }
    if (forcedColors === "active") {
      const directory = resolve("test-results/filter-state-review/supplemental");
      await mkdir(directory, { recursive: true });
      await page.locator(".workbench-react").screenshot({ path: resolve(directory, "dark-only-light-system-forced-colors.png") });
    }
  });
}


test("downloaded Topology report keeps dark surfaces under a light high-contrast system theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", forcedColors: "active" });
  await page.goto("/?scenario=filter-find&theme=light");
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("button", { name: "Export Scope…", exact: true }).click();
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download HTML", exact: true }).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toMatch(/^lightstreamer-topology-.*\.html$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  await page.setContent(await readFile(path!, "utf8"));
  await expect(page.getByRole("heading", { name: "Lightstreamer Workbench Topology report", exact: true })).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(17, 24, 39)");
  await expect(page.locator("body")).toHaveCSS("color", "rgb(229, 231, 235)");
  await expect(page.getByLabel("Search hierarchy", { exact: true })).toHaveCSS("background-color", "rgb(17, 24, 39)");
});
