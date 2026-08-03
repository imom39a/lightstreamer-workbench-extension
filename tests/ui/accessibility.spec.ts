import axe from "axe-core";
import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    axe: typeof axe;
  }
}

const cases = [
  { scenario: "timeline-live", viewport: { width: 900, height: 700 }, theme: "dark" as const },
  { scenario: "topology-small", viewport: { width: 1_280, height: 800 }, theme: "light" as const },
  { scenario: "topology-large", viewport: { width: 1_440, height: 900 }, theme: "dark" as const },
  { scenario: "export-open", viewport: { width: 563, height: 137 }, theme: "light" as const }
] as const;

for (const scenario of cases) {
  test(`accessibility audit: ${scenario.scenario} at ${scenario.viewport.width}x${scenario.viewport.height}`, async ({
    page
  }, testInfo) => {
    await page.setViewportSize(scenario.viewport);
    await page.emulateMedia({ colorScheme: scenario.theme });
    await page.addInitScript((theme) => {
      window.localStorage.setItem("lightstreamer-workbench.theme", theme);
    }, scenario.theme);
    await page.goto(`/index.html?scenario=${scenario.scenario}`);
    await expect(page.locator("html")).toHaveAttribute("data-scene-ready", "true");
    await page.addScriptTag({ content: axe.source });

    const violations = await page.evaluate(async () => {
      const result = await window.axe.run(document, {
        resultTypes: ["violations"]
      });
      return result.violations
        .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
        .map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes.map((node) => node.html)
        }));
    });
    await testInfo.attach("axe-violations.json", {
      body: JSON.stringify(violations, null, 2),
      contentType: "application/json"
    });

    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);

    if (scenario.scenario === "topology-small") {
      const pageNode = page.locator('.topology-node[tabindex="0"]');
      await pageNode.focus();
      await pageNode.press("ArrowDown");
      await expect(page.locator(":focus")).toHaveClass(/topology-node/);
      await page.locator(":focus").press("ArrowRight");
      await page.locator(":focus").press("End");
      await expect(page.locator(":focus .topology-node-label")).toHaveText(
        "topology-small-listener"
      );
      await page.locator(":focus").press("ArrowLeft");
      await expect(page.locator(":focus .topology-node-label")).toHaveText(/topology-small-item/);
      await page.locator(":focus").press("ArrowLeft");
      await expect(page.locator(":focus")).toHaveAttribute("aria-expanded", "false");
      await page.locator(":focus").press("ArrowRight");
      await expect(page.locator(":focus")).toHaveAttribute("aria-expanded", "true");
      await page.locator(":focus").press(" ");
      await expect(page.locator(":focus")).toHaveAttribute("aria-selected", "true");
      await page.locator(":focus").press("Home");
      await expect(page.locator(":focus .topology-node-label")).toHaveText("Inspected page");
    }
    if (scenario.scenario === "topology-large") {
      await page.locator(".topology-node", { hasText: "topology-large-subscription" }).click();
      const evidence = page.locator(".topology-command-evidence summary").first();
      await evidence.focus();
      await evidence.press("Enter");
      await expect(evidence.locator("..")).toHaveAttribute("open", "");
    }
    if (scenario.scenario === "export-open") {
      const toggle = page.locator(".topology-export-toggle");
      await toggle.focus();
      await toggle.press("Escape");
      await expect(page.locator(".topology-export-menu")).not.toHaveAttribute("open");
      await expect(page.locator(":focus")).toHaveClass(/topology-export-toggle/);
    }

    const focused = page.locator(":focus");
    if (await focused.count()) {
      const focusedBounds = await focused.boundingBox();
      expect(focusedBounds).not.toBeNull();
      if (focusedBounds) {
        expect(focusedBounds.x).toBeGreaterThanOrEqual(0);
        expect(focusedBounds.y).toBeGreaterThanOrEqual(0);
        expect(focusedBounds.x + focusedBounds.width).toBeLessThanOrEqual(scenario.viewport.width);
        expect(focusedBounds.y + focusedBounds.height).toBeLessThanOrEqual(scenario.viewport.height);
      }
    }
  });
}
