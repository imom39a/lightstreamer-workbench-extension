import axe from "axe-core";
import { expect, test, type Locator, type Page } from "@playwright/test";

const browserDiagnostics = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const diagnostics: string[] = [];
  browserDiagnostics.set(page, diagnostics);
  page.on("pageerror", error => diagnostics.push(error.message));
  page.on("console", message => {
    if (["warning", "error"].includes(message.type())) diagnostics.push(message.text());
  });
});
test.afterEach(async ({ page }, testInfo) => {
  const diagnostics = browserDiagnostics.get(page) ?? [];
  await testInfo.attach("browser-diagnostics.log", { body: diagnostics.join("\n"), contentType: "text/plain" });
  expect(diagnostics).toEqual([]);
});

async function open(page: Page, scenario = "live-selected", width = 900, height = 700, forced = false): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme: "dark", forcedColors: forced ? "active" : "none" });
  await page.goto(`/?scenario=${scenario}&theme=dark`);
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
}
async function accessible(page: Page): Promise<void> {
  await page.addScriptTag({ path: new URL("../../node_modules/axe-core/axe.min.js", import.meta.url).pathname });
  const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } })).violations.filter(v => ["serious", "critical"].includes(v.impact ?? "")));
  expect(violations).toEqual([]);
}
async function inPane(control: Locator): Promise<void> {
  const fits = await control.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const owner = element.closest(".workbench-react__context-body")!;
    const pane = owner.getBoundingClientRect();
    return rect.top >= pane.top && rect.bottom <= pane.bottom && rect.left >= pane.left && rect.right <= pane.right;
  });
  expect(fits).toBe(true);
}

test("workspace facets are native Tab actions with exact Escape restoration", async ({ page }) => {
  for (const [width, height, forced] of [[563,700,false],[900,700,false],[900,320,false],[1440,900,false],[900,320,true]] as const) {
    await open(page, "filter-find", width, height, forced);
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    const trigger = page.getByRole("button", { name: "Add structured criterion", exact: true });
    await trigger.click();
    const facets = page.getByRole("group", { name: "Evidence facets", exact: true });
    await expect(facets.getByRole("button")).toHaveCount(12);
    await expect(page.getByRole("listbox", { name: "Evidence facets" })).toHaveCount(0);
    const actions = facets.getByRole("button");
    await expect(actions.first()).toBeFocused();
    for (let index = 1; index < 12; index++) {
      await page.keyboard.press("Tab");
      await expect(actions.nth(index)).toBeFocused();
      await expect(actions.nth(index)).toBeInViewport();
    }
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: /values$/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(actions.last()).toBeFocused();
    await accessible(page);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Filter", exact: true })).toBeFocused();
  }
});

test("workspace Copy and Export lead More actions in every geometry", async ({ page }) => {
  for (const [width, height] of [[563,700],[900,700],[900,320],[1440,900]] as const) {
    for (const scenario of ["live-selected", "active-no-selection"]) {
      await open(page, scenario, width, height);
      const trigger = page.getByRole("button", { name: "More actions", exact: true });
      await trigger.click();
      const operations = page.getByRole("region", { name: "Session operations", exact: true });
      const copy = operations.getByRole("button", { name: "Copy retained scoped Evidence", exact: true });
      const exported = operations.getByRole("button", { name: "Export Scope…", exact: true });
      await inPane(copy);
      await inPane(exported);
      await copy.focus();
      await page.keyboard.press("Tab");
      await expect(exported).toBeFocused();
      await inPane(exported);
      expect(await operations.locator(":scope > section").last().getAttribute("class")).toBe("workbench-react__operations-danger");
      await page.getByRole("button", { name: "Back to prior investigation" }).click();
      await expect(trigger).toBeFocused();
    }
  }
});

test("workspace equal Evidence counts and repeated Scope labels collapse", async ({ page }) => {
  await open(page);
  const summary = page.locator(".workbench-react__evidence-summary");
  await expect(summary).toContainText(/\d+ Evidence/);
  await expect(summary).not.toContainText("Matching");
  await expect(summary).not.toContainText("In Scope");
  const label = await page.locator(".workbench-react__scope-label").textContent();
  await expect(page.locator(".workbench-react__evidence > header")).not.toContainText(label!);
  await page.getByText("Activity summary", { exact: true }).click();
  await expect(page.locator(".workbench-activity-summary > summary")).toHaveText("Activity summary");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByLabel("Filter Evidence").fill("no-such-event");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(summary).toContainText("0 Evidence");
  await expect(summary.getByRole("button", { name: "Reset Filter", exact: true })).toBeVisible();
  await expect(page.locator(".workbench-react__condition--selection")).toBeVisible();
  await open(page, "frozen-high-volume");
  await expect(summary).toContainText("Shown 60");
  await expect(summary).toContainText("Matching 3,970 in Scope");
});

async function explorer(page: Page, facet: string): Promise<Locator> {
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("button", { name: "Add structured criterion", exact: true }).click();
  await page.locator(`button[aria-label="Add ${facet} criterion"]`).click();
  const dialog = page.getByRole("dialog", { name: `${facet} values`, exact: true });
  await expect(dialog.getByRole("listitem").first()).toBeVisible();
  return dialog;
}

test("workspace Filter values appear once with one count summary and draft intent", async ({ page }) => {
  await open(page, "filter-find");
  const dialog = await explorer(page, "Evidence kind");
  await expect(dialog.locator("header")).not.toContainText("typed identities");
  await expect(dialog.locator(".workbench-react__filter-explorer-search > span")).toHaveCount(0);
  await expect(dialog.locator(".workbench-react__filter-explorer-counts")).toContainText("1 value");
  await expect(dialog.locator(".workbench-react__filter-value-label").first()).toHaveText("item-update");
  await expect(dialog.locator("footer")).toContainText("Draft");
  await dialog.getByRole("radio", { name: "Include", exact: true }).click();
  await expect(page.locator(".workbench-react__active-filter")).not.toContainText("kind");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await open(page, "filter-collision");
  const collisions = await explorer(page, "Item");
  const rows = collisions.getByRole("listitem");
  await expect(rows).toHaveCount(2);
  expect(new Set(await rows.locator(".workbench-react__filter-value-label summary").allTextContents()).size).toBe(2);
  for (const row of await rows.all()) {
    await row.locator("summary").click();
    await expect(row.locator("code")).toContainText("owner-v1");
  }
  await accessible(page);
});

test("workspace Notifications lead with counts and keep the open footer concise", async ({ page }) => {
  await open(page, "notifications-operational");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const summary = page.locator(".workbench-react__notifications-summary");
  await expect(summary).toContainText("All runtime Scopes");
  await expect(summary).toContainText("oldest first");
  await expect(summary.locator("p")).toHaveCount(0);
  const footer = page.locator(".workbench-react__status-diagnostic").filter({ hasText: "History using memory" });
  await expect(footer).toContainText("Warning");
  await expect(footer).toContainText("Affected:");
  await expect(footer.locator(".workbench-react__status-detail")).toHaveCount(0);
  await expect(footer.getByRole("button", { name: /^View History using memory for History Interval .* in Notifications$/ })).toBeVisible();
  await footer.getByRole("button", { name: "Dismiss History using memory", exact: true }).click();
  await expect(footer).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Notifications", exact: true })).toContainText("History using memory");
  await accessible(page);
});

test("workspace session background is disclosed and Clear preserves its global confirmation", async ({ page }) => {
  await open(page, "frozen-high-volume", 900, 320);
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  const operations = page.getByRole("region", { name: "Session operations", exact: true });
  await expect(operations.locator(":scope > p")).toHaveCount(0);
  await expect(operations.locator(".workbench-react__operations-transfer p")).toHaveCount(1);
  const details = operations.getByText("History and privacy details", { exact: true });
  await details.click();
  await expect(operations).toContainText("4,000 captured");
  await expect(operations).toContainText("latched");
  await expect(operations).toContainText("residual data");
  await operations.getByRole("button", { name: "Clear retained Evidence…", exact: true }).click();
  const confirmation = operations.locator(".workbench-react__confirmation");
  await expect(confirmation).toContainText("Clear all 4,000 retained Evidence events");
  await expect(confirmation).toContainText("Scope and Filter do not limit");
  await expect(confirmation).toContainText("cannot be undone");
  await operations.getByRole("button", { name: "Keep Evidence", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.locator("[data-history-status]")).toContainText("4,000/4,000");
});

test("workspace footer retains usable details when notification filters hide its condition", async ({ page }, testInfo) => {
  await open(page, "notifications-operational", 900, 320);
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const notifications = page.getByRole("region", { name: "Notifications", exact: true });
  await notifications.getByText("Filter notifications", { exact: true }).click();
  await notifications.getByRole("radiogroup").first().getByRole("radio", { name: "Exclude", exact: true }).click();
  await expect(notifications.getByRole("article")).toHaveCount(0);
  const footer = page.locator(".workbench-react__status-diagnostic").filter({ hasText: "History using memory" });
  await expect(footer.getByText("Diagnostic details", { exact: true })).toBeVisible();
  await footer.getByText("Diagnostic details", { exact: true }).click();
  await expect(footer.locator(".workbench-react__status-detail")).toBeVisible();
  await expect(footer.getByRole("button", { name: /View.*Notifications/ })).toHaveCount(0);
  await expect(notifications.getByRole("article")).toHaveCount(0);
  await expect(notifications.getByRole("radio", { name: "Exclude", exact: true }).first()).toBeChecked();
  await accessible(page);
  const screenshot = testInfo.outputPath("filtered-notifications-footer-fallback.png");
  await page.screenshot({ path: screenshot });
  await testInfo.attach("filtered Notifications footer fallback", { path: screenshot, contentType: "image/png" });
});

test("workspace long values and notification actions remain readable across docked layouts", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  for (const [width, height, forced] of [[563,700,false],[900,700,false],[900,320,false],[1440,900,false],[900,320,true]] as const) {
    const variant = `${width}x${height}-${forced ? "forced" : "dark"}`;
    await open(page, "frozen-high-volume", width, height, forced);
    const dialog = await explorer(page, "COMMAND key");
    const value = dialog.locator(".workbench-react__filter-value-label").first();
    await value.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(value).toHaveAttribute("open", "");
    const exact = value.locator("summary strong");
    await expect(exact).toContainText("customer-order-command-key-with-long-production-identity-");
    await expect(exact).toHaveCSS("white-space", "normal");
    await expect(value.locator("code")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Apply", exact: true }).focus();
    await expect(dialog.getByRole("button", { name: "Apply", exact: true })).toBeInViewport();
    await accessible(page);
    const filterImage = testInfo.outputPath(`filter-values-${variant}.png`);
    await page.screenshot({ path: filterImage });
    await testInfo.attach(`filter-values-${variant}.png`, { path: filterImage, contentType: "image/png" });
    await open(page, "notifications-operational", width, height, forced);
    await page.getByRole("button", { name: /^Notifications/ }).click();
    const view = page.getByRole("button", { name: /^View History using memory for History Interval .* in Notifications$/ });
    await view.focus();
    await expect(view).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("article")).toBeFocused();
    await page.getByRole("article").getByText("Details", { exact: true }).click();
    await accessible(page);
    const notificationImage = testInfo.outputPath(`notifications-${variant}.png`);
    await page.screenshot({ path: notificationImage });
    await testInfo.attach(`notifications-${variant}.png`, { path: notificationImage, contentType: "image/png" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("workspace Filter retains pinned zero values, exact identity and stale retry", async ({ page }) => {
  await open(page, "filter-active-zero");
  let dialog = await explorer(page, "Evidence kind");
  const group = dialog.getByRole("radiogroup", { name: /^Evidence kind value item-update \(/ });
  const identity = await group.locator("..").locator("..").getAttribute("data-filter-value-identity");
  expect(identity).toBeTruthy();
  await group.getByRole("radio", { name: "Include", exact: true }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByLabel("Filter Evidence").fill("filter-active-zero-client-status");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  dialog = await explorer(page, "Evidence kind");
  await expect(dialog.getByText(/pinned · zero/)).toBeVisible();
  await expect(group.getByRole("radio", { name: "Include", exact: true })).toBeChecked();
  expect(await group.locator("..").locator("..").getAttribute("data-filter-value-identity")).toBe(identity);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByLabel("Filter Evidence").fill("held-stale-draft");
  await page.evaluate(() => window.__makeWorkbenchFilterStale());
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".workbench-react__filter-status")).toContainText("Filter revision is stale");
  await expect(page.getByLabel("Filter Evidence")).toHaveValue("held-stale-draft");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".workbench-react__active-filter")).toContainText("held-stale-draft");
});

test("compact Local Draft pairs Target and Session without losing protected boundary width", async ({ page }, testInfo) => {
  for (const forced of [false, true]) {
    await open(page, "local-injection-grouped", 563, 700, forced);
    const draft = page.locator(".workbench-react__local-injection");
    await expect(draft).toBeVisible();
    const geometry = await draft.locator(".workbench-react__local-boundary").evaluate(boundary => {
      const target = boundary.querySelector('[data-protected-boundary="target"]')!.getBoundingClientRect();
      const session = boundary.querySelector('[data-protected-boundary="session"]')!.getBoundingClientRect();
      const owner = boundary.getBoundingClientRect();
      return { targetTop: target.top, sessionTop: session.top, targetRight: target.right, sessionLeft: session.left, targetWidth: target.width, sessionWidth: session.width, ownerWidth: owner.width };
    });
    expect(Math.abs(geometry.targetTop - geometry.sessionTop)).toBeLessThan(1);
    expect(geometry.targetRight).toBeLessThanOrEqual(geometry.sessionLeft + 1);
    expect(Math.abs(geometry.targetWidth - geometry.sessionWidth)).toBeLessThan(1);
    expect(geometry.targetWidth).toBeGreaterThan(geometry.ownerWidth * .45);
    for (const boundary of ["target", "session", "source", "validation", "delivery", "local-only"]) {
      await expect(draft.locator(`[data-protected-boundary="${boundary}"]`)).toBeInViewport();
    }
    await expect(draft.getByRole("button", { name: "Inject locally", exact: true })).toBeInViewport();
    await accessible(page);
    const screenshot = testInfo.outputPath(`compact-draft-grid-${forced ? "forced" : "dark"}.png`);
    await page.screenshot({ path: screenshot });
    await testInfo.attach("compact-draft-grid", { path: screenshot, contentType: "image/png" });
  }
});

test("Filter discovery counts omit its facet criterion and preserve the base during value search", async ({ page }) => {
  await open(page, "filter-active-zero");
  let dialog = await explorer(page, "Evidence kind");
  const initialCount = await dialog.locator(".workbench-react__filter-explorer-counts").textContent();
  const baseCount = Number(initialCount!.match(/([\d,]+) Evidence/)![1].replaceAll(",", ""));
  await dialog.getByRole("radiogroup", { name: /^Evidence kind value item-update \(/ }).getByRole("radio", { name: "Include", exact: true }).click();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".workbench-react__active-filter")).toContainText("kind: item-update");
  const filteredCount = Number((await page.locator(".workbench-react__evidence-summary").textContent())!.match(/([\d,]+) Evidence/)![1].replaceAll(",", ""));
  expect(filteredCount).toBeLessThan(baseCount);
  dialog = await explorer(page, "Evidence kind");
  const counts = dialog.locator(".workbench-react__filter-explorer-counts");
  await expect(counts).toContainText("other Filter criteria");
  await expect(counts).toContainText("2 values");
  await expect(counts).toContainText(`${baseCount.toLocaleString()} Evidence`);
  await dialog.getByLabel("Search values", { exact: true }).fill("client-status");
  await expect(counts).toContainText("1 value matching “client-status”");
  await expect(counts).toContainText(`${baseCount.toLocaleString()} Evidence`);
  await expect(dialog.getByRole("listitem")).toHaveCount(2);
  await expect(dialog.getByRole("listitem").filter({ hasText: "client-status" })).toHaveCount(1);
  await expect(dialog.getByRole("listitem").filter({ hasText: "pinned" })).toHaveCount(1);
});

test("More actions reaches Help links by native Tab and keeps Clear qualification visible", async ({ page }, testInfo) => {
  for (const [width, height] of [[563,700],[900,700],[900,320]] as const) {
    await open(page, "live-selected", width, height);
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    const operations = page.getByRole("region", { name: "Session operations", exact: true });
    const history = operations.getByText("History and privacy details", { exact: true });
    await history.focus();
    await page.keyboard.press("Tab");
    const documentation = operations.getByRole("link", { name: "Documentation", exact: true });
    await expect(documentation).toBeFocused();
    await expect(documentation).toBeInViewport();
    await page.keyboard.press("Tab");
    await expect(operations.getByRole("link", { name: "Privacy", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(operations.getByRole("link", { name: "Support", exact: true })).toBeFocused();
    await operations.getByRole("button", { name: "Clear retained Evidence…", exact: true }).click();
    const confirmation = operations.locator(".workbench-react__confirmation");
    const confirm = confirmation.getByRole("button", { name: "Clear retained events", exact: true });
    await confirm.focus();
    await inPane(confirm);
    await inPane(confirmation.locator("strong"));
    await inPane(confirmation.locator(":scope > span"));
    await expect(confirmation).toContainText("Scope and Filter do not limit this action");
    await expect(confirmation).toContainText("cannot be undone");
    await page.keyboard.press("Tab");
    const keep = confirmation.getByRole("button", { name: "Keep Evidence", exact: true });
    await expect(keep).toBeFocused();
    await inPane(keep);
    const metrics = await page.locator(".workbench-react__context-body").evaluate(owner => ({ clientHeight: owner.clientHeight, scrollHeight: owner.scrollHeight, scrollTop: owner.scrollTop }));
    console.info(`Clear ${width}x${height}: ${JSON.stringify(metrics)}`);
    await testInfo.attach(`clear-${width}x${height}-scroll.json`, { body: JSON.stringify(metrics), contentType: "application/json" });
    const screenshot = testInfo.outputPath(`clear-${width}x${height}.png`);
    await page.screenshot({ path: screenshot });
    await testInfo.attach("clear-qualification", { path: screenshot, contentType: "image/png" });
    await page.keyboard.press("Enter");
    await expect(confirmation).toHaveCount(0);
    await expect(page.locator("[data-history-status]")).toContainText("6/6 Evidence");
  }
});
