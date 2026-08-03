import { expect, test } from "@playwright/test";

test("topology-small collapses and restores every structural branch in Chromium", async ({
  page
}) => {
  await page.goto("/index.html?scenario=topology-small");

  await expect(page.locator("html")).toHaveAttribute("data-scene-ready", "true");
  await expect(page.locator(".topology-workspace")).toBeVisible();
  for (const label of [
    "topology-small-client",
    "Session topology-small-session",
    "topology-small-subscription",
    "topology-small-item",
    "topology-small-listener"
  ]) {
    await expect(
      page.locator(".topology-node-label").filter({ hasText: label })
    ).toBeVisible();
  }

  const action = page.locator(".topology-expand-items");
  await expect(action).toHaveText("Collapse all");
  await expect(action).toHaveAttribute("aria-pressed", "true");

  await action.click();

  await expect(page.locator(".topology-expand-items")).toHaveText("Expand all");
  await expect(page.locator(".topology-expand-items")).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  expect(
    await page.locator(".topology-tree-group").evaluateAll((groups) =>
      groups.every((group) => (group as HTMLElement).hidden)
    )
  ).toBe(true);
  expect(
    await page.locator("[data-topology-collapse-key]").evaluateAll((toggles) =>
      toggles.every((toggle) => toggle.getAttribute("aria-expanded") === "false")
    )
  ).toBe(true);

  await page.locator(".topology-expand-items").click();

  await expect(page.locator(".topology-expand-items")).toHaveText("Collapse all");
  await expect(page.locator(".topology-expand-items")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  expect(
    await page.locator(".topology-tree-group").evaluateAll((groups) =>
      groups.every((group) => !(group as HTMLElement).hidden)
    )
  ).toBe(true);
  for (const label of [
    "topology-small-client",
    "Session topology-small-session",
    "topology-small-subscription",
    "topology-small-item",
    "topology-small-listener"
  ]) {
    await expect(
      page.locator(".topology-node-label").filter({ hasText: label })
    ).toBeVisible();
  }
  await expect(page.locator(".topology-expand-items")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});
