import { expect, type Locator, type Page } from "@playwright/test";

export function scenarioDocument(page: Page): Locator {
  return page.getByRole("region", { name: "Local Injection Scenario", exact: true });
}

/** Compact/shallow geometry parks panes without changing their semantic state. */
export async function showScenarioSurface(page: Page, surface: "queue" | "editor" | "capture"): Promise<void> {
  const scenario = scenarioDocument(page);
  await expect(scenario).toBeVisible();
  if (surface === "capture") {
    const choose = scenario.getByRole("button", { name: "Choose captured updates", exact: true });
    if (await choose.count()) await choose.click();
    else {
      const control = scenario.getByRole("button", { name: "Captured updates", exact: true, includeHidden: true });
      if (await control.isVisible()) await control.click();
    }
    await expect(scenario.getByRole("region", { name: "Scenario captured updates", exact: true })).toBeVisible();
    return;
  }
  const control = scenario.getByRole("button", { name: surface === "queue" ? "Scenario queue" : "Focused editor", exact: true, includeHidden: true });
  await control.waitFor({ state: "attached" });
  if (await control.isVisible()) await control.click();
  await expect(surface === "queue" ? scenario.getByRole("navigation", { name: "Ordered Scenario Steps", exact: true }) : scenario.getByLabel("Focused Scenario member", { exact: true })).toBeVisible();
}

export async function focusScenarioMember(page: Page, name: `Step ${number}` | `Checkpoint ${number}`, keyboard = false): Promise<void> {
  await showScenarioSurface(page, "queue");
  const queue = scenarioDocument(page).getByRole("navigation", { name: "Ordered Scenario Steps", exact: true, includeHidden: true });
  const button = queue.getByRole("button", { name, exact: true, includeHidden: true });
  if (keyboard) { await button.focus(); await expect(button).toBeFocused(); await button.press("Enter"); }
  else await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(scenarioDocument(page).getByLabel("Focused Scenario member", { exact: true })).toBeVisible();
}
