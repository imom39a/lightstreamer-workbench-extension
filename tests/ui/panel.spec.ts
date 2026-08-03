import { expect, test, type Page } from "@playwright/test";

import {
  getPanelScenario,
  isPanelScenarioId,
  PANEL_SCENARIO_IDS,
  type PanelScenarioId
} from "../support/panel-scenarios";

const theme = parseTheme(process.env.LSEW_UI_THEME ?? "auto");
const scenarioIds = selectedScenarioIds();
const diagnosticsByPage = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const diagnostics: string[] = [];
  diagnosticsByPage.set(page, diagnostics);
  page.on("console", (message) => {
    diagnostics.push(`[console:${message.type()}] ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    diagnostics.push(`[pageerror] ${error.message}`);
  });
  page.on("requestfailed", (request) => {
    diagnostics.push(`[requestfailed] ${request.url()} — ${request.failure()?.errorText ?? "unknown"}`);
  });
  await page.addInitScript((preference) => {
    window.localStorage.setItem("lightstreamer-workbench.theme", preference);
  }, theme);
});

test.afterEach(async ({ page }, testInfo) => {
  const diagnostics = diagnosticsByPage.get(page) ?? [];
  if (diagnostics.length > 0) {
    await testInfo.attach("browser-console.log", {
      body: diagnostics.join("\n"),
      contentType: "text/plain"
    });
  }
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach("panel.html", {
      body: await page.content(),
      contentType: "text/html"
    });
  }
});

for (const scenarioId of scenarioIds) {
  test(`renders the ${scenarioId} scenario and supports panel interaction`, async ({ page }) => {
    const scenario = getPanelScenario(scenarioId);
    await page.goto(`/index.html?scenario=${encodeURIComponent(scenarioId)}`);

    await expect(page.locator("html")).toHaveAttribute("data-scene-ready", "true");
    await expect(page.locator("html")).toHaveAttribute("data-scenario", scenarioId);
    await expect(page.locator(".workbench-shell")).toBeVisible();
    await expect(page.locator(".theme-select")).toHaveValue(theme);
    await expect(
      page.locator('.view-selector button[data-active="true"]')
    ).toHaveText(scenario.initialView);

    await expect(page).toHaveScreenshot(snapshotName(scenarioId, page));

    if (scenarioId === "command-state") {
      await page.locator(".view-selector button", { hasText: "Topology" }).click();
      await expect(page.locator(".topology-workspace")).toBeVisible();
    }
    if (scenarioId === "timeline-detail") {
      const selectedRow = page.locator('.event-row[data-event-id="scenario-event-3"]');
      await expect(selectedRow).toBeVisible();
      await expect(selectedRow).toHaveAttribute("data-selected", "true");
      await expect(page.locator(".detail-pane")).toBeVisible();
    }
    if (scenarioId === "new-command") {
      const quantityInput = page.locator(
        '.command-draft-field-input[data-field-name="qty"]'
      );
      await quantityInput.fill("43");
      await expect(quantityInput).toHaveValue("43");
    }
  });
}

function selectedScenarioIds(): PanelScenarioId[] {
  const requested = process.env.LSEW_UI_SCENARIO?.trim();
  if (!requested || requested === "all") {
    return [...PANEL_SCENARIO_IDS];
  }
  if (!isPanelScenarioId(requested)) {
    throw new Error(
      `Unsupported UI scenario ${JSON.stringify(requested)}. Use ${PANEL_SCENARIO_IDS.join(", ")}.`
    );
  }
  return [requested];
}

function snapshotName(scenarioId: PanelScenarioId, page: Page): string {
  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error("UI screenshot verification requires a fixed viewport.");
  }
  return `${scenarioId}-${theme}-${viewport.width}x${viewport.height}.png`;
}

function parseTheme(value: string): "auto" | "dark" | "light" {
  if (value === "auto" || value === "dark" || value === "light") {
    return value;
  }
  throw new Error(`Unsupported UI theme ${JSON.stringify(value)}. Use auto, dark, or light.`);
}
