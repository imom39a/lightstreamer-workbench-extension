import { expect, test, type Page } from "@playwright/test";

import rawMatrix from "./visual-matrix.json" with { type: "json" };

type VisualCase = Readonly<{
  id: string;
  viewport: { width: number; height: number };
  theme: "dark" | "light";
  prototype: { variant: string; state: string; frame: string };
  production: { scenario: string; setup: "none" | "captured-draft" | "authored-review" | "command-comparison" };
}>;
const matrix = rawMatrix as readonly VisualCase[];

for (const visual of matrix) {
  test(`visual baseline: ${visual.id} · ${visual.theme} · ${visual.viewport.width}x${visual.viewport.height}`, async ({ page }) => {
    await openScenario(page, visual);
    await prepareProductionState(page, visual);
    await expect(page.locator(".workbench-react")).toHaveScreenshot(`${visual.id}.png`);
  });
}

async function openScenario(page: Page, visual: VisualCase): Promise<void> {
  await page.setViewportSize(visual.viewport);
  await page.emulateMedia({ colorScheme: visual.theme });
  await page.goto(`/?scenario=${visual.production.scenario}&theme=${visual.theme}`);
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  const workbench = page.locator(".workbench-react");
  await expect(workbench).toBeVisible();
  const dimensions = await workbench.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  });
  expect(dimensions).toEqual({
    left: 0,
    top: 0,
    width: visual.viewport.width,
    height: visual.viewport.height,
    viewportWidth: visual.viewport.width,
    viewportHeight: visual.viewport.height
  });
}

async function prepareProductionState(page: Page, visual: VisualCase): Promise<void> {
  switch (visual.production.setup) {
    case "none":
      await expect(page.locator(".workbench-react__evidence-summary")).toHaveCSS("display", "flex");
      return;
    case "captured-draft": {
      await page.getByRole("button", { name: "Open Context" }).click();
      const create = page.getByRole("button", { name: "Create Local Injection Draft" });
      await expectVisibleKeyboardTarget(page, create);
      await page.keyboard.press("Enter");
      const draft = page.getByRole("region", { name: "Local Injection Draft" });
      await expect(draft).toBeVisible();
      await expect(draft).toContainText("LOCAL ONLY");
      return;
    }
    case "authored-review": {
      const author = page.getByRole("button", { name: "Author COMMAND Item Update" });
      await expectVisibleKeyboardTarget(page, author);
      await page.keyboard.press("Enter");
      await page.getByRole("textbox", { name: "Local Injection JSON", exact: true }).fill(JSON.stringify({
        command: "ADD",
        key: "visual-review",
        isSnapshot: false,
        fields: { command: "ADD", key: "visual-review", value: "42" }
      }, null, 2));
      const review = page.getByRole("button", { name: "Review Local Injection" });
      await expectVisibleKeyboardTarget(page, review);
      await page.keyboard.press("Enter");
      const reviewRegion = page.getByRole("region", { name: "Review Local Injection" });
      await expect(reviewRegion).toBeVisible();
      const heading = reviewRegion.getByRole("heading", { name: "Review Local Injection" });
      await heading.focus();
      await page.keyboard.press("ArrowDown");
      const scrollOwner = page.locator(".workbench-react__local-scroll");
      await expect.poll(() => scrollOwner.evaluate((owner) => owner.scrollTop)).toBeGreaterThan(0);
      const localOnly = reviewRegion.getByText(/Local only:/);
      await localOnly.scrollIntoViewIfNeeded();
      await expect(localOnly).toBeInViewport();
      const partiallyClippedParagraphs = await reviewRegion.locator("p").evaluateAll((paragraphs, ownerSelector) => {
        const owner = document.querySelector(String(ownerSelector));
        if (!(owner instanceof HTMLElement)) throw new Error("Local Injection scroll owner is missing.");
        const ownerRect = owner.getBoundingClientRect();
        return paragraphs.flatMap((paragraph) => {
          const rect = paragraph.getBoundingClientRect();
          const intersects = rect.bottom > ownerRect.top && rect.top < ownerRect.bottom;
          const contained = rect.top >= ownerRect.top && rect.bottom <= ownerRect.bottom;
          return intersects && !contained ? [paragraph.textContent?.trim() ?? ""] : [];
        });
      }, ".workbench-react__local-scroll");
      expect(partiallyClippedParagraphs).toEqual([]);
      return;
    }
    case "command-comparison": {
      const compare = page.getByRole("button", { name: "Compare COMMAND projections" });
      await expectVisibleKeyboardTarget(page, compare);
      await page.keyboard.press("Enter");
      await expect(page.getByRole("region", { name: "COMMAND projection comparison" })).toBeVisible();
      return;
    }
  }
}

async function expectVisibleKeyboardTarget(page: Page, control: ReturnType<Page["getByRole"]>): Promise<void> {
  await expect(control).toBeVisible();
  await control.focus();
  await expect(control).toBeFocused();
  const geometry = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    return {
      nonZero: rect.width > 0 && rect.height > 0,
      inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
      unobscured: element.contains(document.elementFromPoint(x, y))
    };
  });
  expect(geometry).toEqual({ nonZero: true, inViewport: true, unobscured: true });
}
