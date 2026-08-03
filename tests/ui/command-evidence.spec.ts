import { expect, test } from "@playwright/test";

test("topology-large bounds COMMAND evidence and preserves investigation context", async ({
  page
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/index.html?scenario=topology-large");

  await expect(page.locator("html")).toHaveAttribute("data-scene-ready", "true");
  await expect(page.locator(".topology-workspace")).toBeVisible();
  await expect(page.locator(".topology-node")).toHaveCount(6);
  await expect(
    page.locator(".topology-node").filter({ hasText: "COMMAND KEY" })
  ).toHaveCount(0);
  const structuralKinds = await page.locator(".topology-node-kind").allTextContents();
  expect(new Set(structuralKinds)).toEqual(
    new Set(["PAGE", "CLIENT", "SESSION", "SUB", "ITEM", "LISTENER"])
  );
  await expect(page.locator(".topology-tree-pane")).not.toContainText("large-0001");
  await expect(page.locator(".topology-tree-pane")).not.toContainText("generation:");
  await expect(page.locator(".topology-command-evidence")).toHaveCount(0);

  await page
    .locator(".topology-node")
    .filter({ hasText: "topology-large-subscription" })
    .click();

  const evidence = page.locator(".topology-command-evidence");
  await expect(evidence).toBeVisible();
  await expect(evidence.locator("summary")).toContainText("25 of 1,000 shown");
  await expect(evidence.locator(".topology-command-evidence-entry")).toHaveCount(25);

  const detailPane = page.locator(".topology-detail-pane");
  const scrollBefore = await detailPane.evaluate((element) => {
    const pane = element as HTMLElement;
    pane.scrollTop = Math.min(80, Math.max(0, pane.scrollHeight - pane.clientHeight));
    return pane.scrollTop;
  });
  expect(scrollBefore).toBeGreaterThan(0);

  await evidence.locator("summary").click();
  await evidence.locator(".topology-show-more-command-evidence").click();

  await expect(page.locator(".topology-command-evidence").locator("summary")).toContainText(
    "50 of 1,000 shown"
  );
  await expect(
    page.locator(".topology-command-evidence-entry")
  ).toHaveCount(50);
  await expect(
    page.locator('.topology-node[data-selected="true"] .topology-node-label')
  ).toHaveText("topology-large-subscription");
  const scrollAfter = await detailPane.evaluate((element) => (element as HTMLElement).scrollTop);
  expect(scrollAfter).toBeGreaterThanOrEqual(scrollBefore);

  await page.locator(".topology-copy-command-evidence").click();
  await expect(page.locator(".topology-copy-command-evidence")).toHaveText(
    "Copied 1,000 entries"
  );
  const copiedEvidence = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(copiedEvidence)).toHaveLength(1_000);
  await expect(page.locator(".topology-command-evidence-entry")).toHaveCount(50);

  await page.locator(".topology-open-command-state").click();
  await expect(
    page.locator('.view-selector button[data-active="true"]')
  ).toHaveText("COMMAND State");
  await expect(page.locator(".command-group-pane")).toContainText(
    "topology-large-subscription"
  );
});
