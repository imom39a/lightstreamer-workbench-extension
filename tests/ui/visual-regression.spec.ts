import { expect, test } from "@playwright/test";

import { PANEL_VISUAL_MATRIX, type VisualMatrixCase } from "./visual-matrix";

for (const visual of PANEL_VISUAL_MATRIX) {
  test(`visual baseline: ${visual.id} · ${visual.theme} · ${visual.viewport.width}x${visual.viewport.height}`, async ({
    page
  }) => {
    await page.setViewportSize(visual.viewport);
    await page.emulateMedia({ colorScheme: visual.theme });
    await page.addInitScript((theme) => {
      window.localStorage.setItem("lightstreamer-workbench.theme", theme);
    }, visual.theme);

    const scenario = scenarioForVisual(visual);
    await page.goto(`/index.html?scenario=${scenario}`);
    await expect(page.locator("html")).toHaveAttribute("data-scene-ready", "true");

    if (visual.id === "timeline-live") {
      await expect(page.locator("html")).toHaveAttribute("data-stream-ready", "true");
    }
    if (visual.id === "timeline-frozen") {
      await page.locator(".search-input").fill("timeline-match");
      await page.locator(".event-row").first().click();
      await page.locator(".timeline-display-state button", { hasText: "Freeze view" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-stream-ready", "true");
    }
    if (visual.id === "topology-collapsed") {
      await page.locator(".topology-expand-items").click();
    }
    if (visual.id === "topology-command-evidence") {
      await page.locator(".topology-node", { hasText: "topology-large-subscription" }).click();
      await page.locator(".topology-command-evidence summary").click();
    }

    await expect(page).toHaveScreenshot(snapshotName(visual));
  });
}

function scenarioForVisual(visual: VisualMatrixCase): string {
  switch (visual.id) {
    case "timeline-live":
    case "timeline-frozen":
      return visual.id;
    case "topology-expanded":
    case "topology-collapsed":
      return "topology-small";
    case "topology-command-evidence":
      return "topology-large";
    case "export-open":
      return "export-open";
  }
}

function snapshotName(visual: VisualMatrixCase): string {
  return `${visual.id}-${visual.theme}-${visual.viewport.width}x${visual.viewport.height}.png`;
}
