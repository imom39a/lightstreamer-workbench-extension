import axe from "axe-core";
import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, width = 900, height = 700, scenario = "frozen-high-volume") {
  await page.setViewportSize({ width, height });
  await page.goto(`/?scenario=${scenario}&theme=dark`);
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
}

async function matchIsUnobscured(page: Page) {
  return page.locator('[data-find-current="true"]').evaluateAll(rows => {
    if (rows.length !== 1) return false;
    const row = rows[0]!.getBoundingClientRect();
    const grid = rows[0]!.closest('[role="grid"]')!;
    const viewport = grid.getBoundingClientRect();
    const header = grid.querySelector('[role="columnheader"]')!.getBoundingClientRect();
    return row.top >= Math.max(viewport.top, header.bottom) - .5 && row.bottom <= Math.min(viewport.bottom, innerHeight) + .5;
  });
}

async function opHeaderIsUnobscured(page: Page) {
  return page.getByRole("columnheader", { name: "Op", exact: true }).evaluate(header => {
    const rect = header.getBoundingClientRect();
    return header.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  });
}

test("Find reveals every cross-window match in the real viewport without changing selection", async ({ page }, info) => {
  await open(page);
  const original = await page.locator('[aria-label="Context"] [role="heading"]').textContent();
  await page.getByRole("button", { name: "Find", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Find in ordered Evidence" });
  await input.fill("complete-retained-find-anchor");
  await expect(page.getByRole("search", { name: "Find in ordered Evidence" })).toContainText("of 3 matches");
  const visited = new Set<string | null>();
  for (let index = 0; index < 3; index++) {
    await expect.poll(() => matchIsUnobscured(page)).toBe(true);
    await expect.poll(() => opHeaderIsUnobscured(page)).toBe(true);
    await expect(input).toBeFocused();
    const id = await page.locator('[data-find-current="true"]').getAttribute("data-evidence-id");
    visited.add(id);
    await expect(page.locator('[aria-label="Context"] [role="heading"]')).toHaveText(original!);
    await page.screenshot({ path: info.outputPath(`match-${index + 1}.png`) });
    if (index < 2) {
      await input.press("Enter");
      await expect.poll(() => page.locator('[data-find-current="true"]').getAttribute("data-evidence-id")).not.toBe(id);
    }
  }
  expect(visited.size).toBe(3);
  await input.press("Shift+Enter");
  await expect.poll(() => matchIsUnobscured(page)).toBe(true);
});

test("Inspect match deliberately updates Context and explains the matching field", async ({ page }, info) => {
  await open(page);
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.getByRole("textbox", { name: "Find in ordered Evidence" }).fill("complete-retained-find-anchor");
  await expect(page.getByRole("region", { name: "Find match detail" })).toContainText("complete-retained-find-anchor");
  const id = await page.locator('[data-find-current="true"]').getAttribute("data-evidence-id");
  await page.getByRole("button", { name: "Inspect match", exact: true }).click();
  await expect(page.locator('[aria-label="Context"] [role="heading"]')).toContainText(id!);
  await page.screenshot({ path: info.outputPath("inspect-match.png") });
});

for (const viewport of [{ width: 563, height: 700 }, { width: 900, height: 700 }, { width: 900, height: 320 }, { width: 1440, height: 900 }]) {
  test(`Scope search discovers collapsed branches without committing while typing at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await open(page, viewport.width, viewport.height, "live-high-scope");
    const origin = await page.locator(".workbench-react__scope-label").textContent();
    await page.getByRole("button", { name: "Scope", exact: true }).click();
    await page.getByRole("treeitem").first().focus();
    await page.keyboard.press("Home");
    const root = page.locator('[role="treeitem"][aria-level="1"]');
    await expect(root).toBeFocused();
    await root.press("ArrowLeft");
    await page.screenshot({ path: info.outputPath("scope-tree.png") });
    await page.getByRole("button", { name: "Search scopes", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Search scopes", exact: true });
    await expect(input).toBeFocused();
    await input.fill("high-scope-subscription-219");
    const matches = page.getByRole("listbox", { name: "Matching scopes" });
    await expect(matches.getByRole("option").first()).toBeVisible();
    await expect(page.locator(".workbench-react__scope-label")).toHaveText(origin!);
    await input.press("ArrowDown");
    await expect(page.locator(".workbench-react__scope-label")).toHaveText(origin!);
    await page.screenshot({ path: info.outputPath("scope-search.png") });
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const result = await (window as any).axe.run();
      return result.violations.filter((violation: { impact: string }) => ["serious", "critical"].includes(violation.impact));
    });
    expect(violations).toEqual([]);
    await input.press("Escape");
    await expect(input).toHaveValue("");
    await input.press("Escape");
    await expect(page.getByRole("button", { name: "Search scopes", exact: true })).toBeFocused();
    await expect(root).toHaveAttribute("aria-expanded", "false");
    await root.focus();
    await root.press("Control+f");
    await expect(page.getByRole("textbox", { name: "Search scopes", exact: true })).toBeFocused();
    await expect(page.getByRole("search", { name: "Find in ordered Evidence" })).toHaveCount(0);
  });
}

for (const viewport of [{ width: 563, height: 700 }, { width: 900, height: 320 }]) {
  test(`Find keeps the matched row and excerpt reachable at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await open(page, viewport.width, viewport.height);
    await page.getByRole("button", { name: "Find", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Find in ordered Evidence" });
    await input.fill("complete-retained-find-anchor");
    await expect(page.getByRole("search", { name: "Find in ordered Evidence" })).toContainText("of 3 matches");
    await expect.poll(() => matchIsUnobscured(page)).toBe(true);
    const excerpt = page.getByRole("region", { name: "Find match detail" });
    await expect(excerpt.locator("mark")).toHaveText("complete-retained-find-anchor");
    await page.screenshot({ path: info.outputPath("find-layout.png") });
    await input.press("Escape");
    await expect(input).toHaveValue("");
    await input.press("Escape");
    await expect(page.getByRole("button", { name: "Find", exact: true })).toBeFocused();
  });
}

for (const viewport of [
  { width: 563, height: 700, forced: false },
  { width: 900, height: 320, forced: false },
  { width: 900, height: 320, forced: true }
]) {
  test(`Find preserves the horizontal Evidence scroll and keeps Data reachable at ${viewport.width}x${viewport.height}${viewport.forced ? " forced colors" : ""}`, async ({ page }, info) => {
    if (viewport.forced) await page.emulateMedia({ forcedColors: "active" });
    await open(page, viewport.width, viewport.height);
    await page.getByRole("button", { name: "Find", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Find in ordered Evidence" });
    await input.fill("complete-retained-find-anchor");
    await expect(page.getByRole("search", { name: "Find in ordered Evidence" })).toContainText("of 3 matches");
    const ledger = page.getByRole("grid", { name: "Ordered Lightstreamer Evidence" });
    const data = ledger.getByRole("columnheader", { name: "Data", exact: true });
    const revealData = () => data.evaluate(header => {
      const ledger = header.closest<HTMLElement>('[role="grid"]')!;
      const pinned = ledger.querySelector('[role="columnheader"]')!.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(header);
      ledger.scrollLeft += range.getBoundingClientRect().left - pinned.right - 32;
    });
    await revealData();
    const left = await ledger.evaluate(element => element.scrollLeft);
    expect(left).toBeGreaterThan(0);
    const dataHeadingIsReachable = () => data.evaluate(header => {
      const range = document.createRange();
      range.selectNodeContents(header);
      const text = range.getBoundingClientRect();
      const ledger = header.closest('[role="grid"]')!.getBoundingClientRect();
      const pinned = header.closest('[role="grid"]')!.querySelector('[role="columnheader"]')!.getBoundingClientRect();
      return text.left >= pinned.right + 1 && text.right <= ledger.right && text.top >= ledger.top
        && text.bottom <= ledger.bottom
        && [text.left + 1, text.left + text.width / 2, text.right - 1].every(x =>
          header.contains(document.elementFromPoint(x, text.top + text.height / 2)));
    });
    await expect.poll(dataHeadingIsReachable).toBe(true);
    await expect.poll(() => opHeaderIsUnobscured(page)).toBe(true);
    await expect.poll(() => matchIsUnobscured(page)).toBe(true);
    await expect(input).toBeFocused();
    const prior = await page.locator('[data-find-current="true"]').getAttribute("data-evidence-id");
    await input.press("Enter");
    await expect.poll(() => page.locator('[data-find-current="true"]').getAttribute("data-evidence-id")).not.toBe(prior);
    await expect.poll(() => ledger.evaluate(element => element.scrollLeft)).toBe(left);
    await expect.poll(() => matchIsUnobscured(page)).toBe(true);
    await expect(input).toBeFocused();
    // Another page can change the content-sized Key column. After proving
    // Find preserved the user's offset, prove Data is still fully reachable.
    await revealData();
    await expect.poll(dataHeadingIsReachable).toBe(true);
    await expect.poll(() => opHeaderIsUnobscured(page)).toBe(true);
    await expect(input).toBeFocused();
    await page.screenshot({ path: info.outputPath("find-data-horizontal-scroll.png") });
  });
}

test("Scope search refreshes new captured branches explicitly and commits only on Enter", async ({ page }) => {
  await open(page, 900, 700, "live-high-scope");
  const origin = await page.locator(".workbench-react__scope-label").textContent();
  await page.getByRole("button", { name: "Scope", exact: true }).click();
  await page.getByRole("button", { name: "Search scopes", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Search scopes", exact: true });
  await input.fill("high-scope-subscription-259");
  await expect(page.getByText("No matching scopes", { exact: true })).toBeVisible();
  await page.addScriptTag({ content: axe.source });
  const emptyViolations = await page.evaluate(async () => (await (window as any).axe.run()).violations.filter((violation: { impact: string }) => ["serious", "critical"].includes(violation.impact)));
  expect(emptyViolations).toEqual([]);
  await page.evaluate(() => (window as unknown as { __appendDeferredWorkbenchEvents(): number }).__appendDeferredWorkbenchEvents());
  await expect(page.getByText("No matching scopes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Refresh scopes", exact: true }).click();
  await expect(page.getByRole("listbox", { name: "Matching scopes" }).getByRole("option")).toHaveCount(3);
  await expect(page.locator(".workbench-react__scope-label")).toHaveText(origin!);
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  await expect(page.locator(".workbench-react__scope-label")).toContainText("high-scope-subscription-259");
});

test("Choosing an off-screen Scope result expands its ancestors and restores visible tree focus in wide geometry", async ({ page }) => {
  await open(page, 1440, 900, "live-high-scope");
  await page.getByRole("treeitem").first().focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowLeft");
  await page.getByRole("button", { name: "Search scopes", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Search scopes", exact: true });
  await input.fill("high-scope-subscription-219");
  await expect(page.getByRole("listbox", { name: "Matching scopes" }).getByRole("option")).toHaveCount(3);
  await input.press("Enter");
  const selected = page.locator('[role="treeitem"][aria-selected="true"]');
  await expect(selected).toContainText("high-scope-subscription-219");
  await expect(selected).toBeFocused();
  expect(await selected.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const tree = node.closest('[role="tree"]')!.getBoundingClientRect();
    return rect.top >= tree.top && rect.bottom <= tree.bottom &&
      node.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  })).toBe(true);
});

test("Escape in Evidence Find owns its query while Scope search remains open", async ({ page }) => {
  await open(page, 1440, 900, "live-high-scope");
  await page.getByRole("button", { name: "Search scopes", exact: true }).click();
  const scopes = page.getByRole("textbox", { name: "Search scopes", exact: true });
  await scopes.fill("high-scope-subscription-219");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  const evidence = page.getByRole("textbox", { name: "Find in ordered Evidence" });
  await evidence.fill("high-scope");
  await evidence.press("Escape");
  await expect(evidence).toHaveValue("");
  await expect(evidence).toBeFocused();
  await expect(scopes).toHaveValue("high-scope-subscription-219");
  await evidence.press("Escape");
  await expect(page.getByRole("button", { name: "Find", exact: true })).toBeFocused();
});
