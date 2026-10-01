import { expect, test, type Page } from "@playwright/test";

async function accessible(page: Page): Promise<void> {
  await page.addScriptTag({ path: new URL("../../node_modules/axe-core/axe.min.js", import.meta.url).pathname });
  const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } })).violations.filter(violation => ["serious", "critical"].includes(violation.impact ?? "")));
  expect(violations).toEqual([]);
}

for (const viewport of [
  { width: 563, height: 700, forced: false },
  { width: 900, height: 700, forced: false },
  { width: 900, height: 320, forced: true }
]) {
  test(`deleted COMMAND count explains retained identities at ${viewport.width}x${viewport.height}${viewport.forced ? " forced colors" : ""}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ forcedColors: viewport.forced ? "active" : "none" });
    await page.goto("/?scenario=topology-deleted-key-retention&theme=dark");
    await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
    expect(await page.evaluate(() => (window as unknown as { __appendDeferredWorkbenchEvents(): number }).__appendDeferredWorkbenchEvents())).toBe(9);
    await page.getByRole("button", { name: "Scope", exact: true }).click();
    const tree = page.getByRole("tree", { name: /Runtime Scope tree/ });
    const subscription = tree.getByRole("treeitem", { name: /topology-small-subscription/ });
    await subscription.focus();
    if (await subscription.getAttribute("aria-expanded") === "false") await page.keyboard.press("ArrowRight");
    await tree.getByRole("treeitem", { name: /topology-small-item/ }).click();
    await page.getByRole("button", { name: "Open Scope Context", exact: true }).click();
    const context = page.getByRole("complementary", { name: "Context", exact: true });
    const counters = context.locator('details[aria-label="Counters"]');
    await counters.locator("summary").focus();
    await page.keyboard.press("Enter");
    const count = counters.getByText("8 retained (older identities not retained)", { exact: true });
    await count.scrollIntoViewIfNeeded();
    await expect(count).toBeVisible();
    const geometry = await count.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const owner = element.closest(".workbench-react__context-body") ?? element.closest('[role="complementary"]');
      const ownerRect = owner?.getBoundingClientRect();
      return {
        withinOwner: Boolean(ownerRect && rect.left >= ownerRect.left - 1 && rect.right <= ownerRect.right + 1),
        noShellOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
        noTextOverflow: element.scrollWidth <= element.clientWidth + 1
      };
    });
    expect(geometry).toEqual({ withinOwner: true, noShellOverflow: true, noTextOverflow: true });
    await accessible(page);
    await page.screenshot({ path: testInfo.outputPath("retained-deleted-command-count.png") });
  });
}

for (const width of [563, 900]) {
  test(`runtime Context prioritizes Subscription facts at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/?scenario=diagnostic-anomalies&theme=dark");
    await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
    await page.getByRole("button", { name: "Open Scope Context", exact: true }).click();
    const context = page.getByRole("complementary", { name: "Context", exact: true });
    const primary = context.getByLabel("Runtime metadata", { exact: true });
    await expect(primary).toContainText("Subscription ID");
    await expect(primary).toContainText("Mode");
    await expect(primary).toContainText("Active");
    await expect(primary).toContainText("Server established");
    await expect(primary).toContainText("Historical");
    await expect(primary).toContainText("Fields");
    await expect(primary).not.toContainText("Capture coverage");
    await expect(primary).not.toContainText("Visible Evidence");
    await expect(primary).not.toContainText("Requested buffer size");
    await page.screenshot({ path: testInfo.outputPath(`runtime-context-primary-${width}.png`) });
    for (const title of ["Settings", "Counters", "Metadata"]) {
      const details = context.locator(`details[aria-label="${title}"]`);
      await expect(details).not.toHaveAttribute("open", "");
      await details.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(details).toHaveAttribute("open", "");
      await expect(details.locator("dl")).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(details).not.toHaveAttribute("open", "");
    }
    await accessible(page);
    await page.screenshot({ path: testInfo.outputPath(`runtime-context-${width}.png`) });
  });

  test(`storage warning keeps advisory measurements in Details at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/?scenario=storage-headroom-warning&theme=dark");
    await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
    const condition = page.getByRole("region", { name: "Workbench diagnostics" }).locator("section").filter({ hasText: "Estimated storage headroom is low" });
    await expect(condition).toContainText("Future History writes may fail; the browser estimate is advisory.");
    const details = condition.locator("details");
    await expect(details).not.toHaveAttribute("open", "");
    await expect(condition.getByText(/The browser estimates about/)).not.toBeVisible();
    await details.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await expect(details).toContainText("168 MiB");
    await expect(details).toContainText("not a reservation or acceptance guarantee");
    await expect(details).toContainText("QuotaExceededError");
    await expect(details).toContainText("Free browser storage");
    await accessible(page);
    await page.screenshot({ path: testInfo.outputPath(`storage-details-${width}.png`) });
  });
}
