import { expect, test, type Page } from "@playwright/test";

import rawMatrix from "./visual-matrix.json" with { type: "json" };
import { waitForVisualReadiness, warmVisualRenderer } from "./visual-readiness";

type VisualCase = Readonly<{
  id: string;
  viewport: { width: number; height: number };
  theme: "dark" | "light";
  forcedColors?: boolean;
  prototype: { variant: string; state: string; frame: string; setup: string; surface?: string };
  production: { scenario: string; setup: "none" | "activity-10k" | "activity-graphical" | "activity-limited" | "activity-memory" | "scenario" | "scenario-checkpoint" | "scenario-checkpoint-high-volume" | "scenario-hidden-pause" | "scenario-inflight-stop" | "scenario-membership-preview" | "scenario-authored-undo" | "scenario-capacity-refusal" | "captured-draft" | "authored-review" | "command-comparison" | "retained-find" | "more-actions-help" | "clear-confirmation" | "memory-operations" | "diagnostics" };
}>;
const matrix = rawMatrix as readonly VisualCase[];

for (const visual of matrix) {
  test(`visual baseline: ${visual.id} · ${visual.theme} · ${visual.viewport.width}x${visual.viewport.height}`, async ({ page }) => {
    await openScenario(page, visual);
    await prepareProductionState(page, visual);
    await waitForVisualReadiness(page, ".workbench-react");
    await expect(page.locator(".workbench-react")).toHaveScreenshot(`${visual.id}.png`);
  });
}

async function openScenario(page: Page, visual: VisualCase): Promise<void> {
  await page.setViewportSize(visual.viewport);
  await page.emulateMedia({ colorScheme: visual.theme, forcedColors: visual.forcedColors ? "active" : "none" });
  await page.goto(`/?scenario=${visual.production.scenario}&theme=${visual.theme}`);
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await warmVisualRenderer(page, ".workbench-react");
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
    case "activity-10k":
    case "activity-graphical":
    case "activity-limited":
    case "activity-memory": {
      const open = page.getByRole("button", { name: "Open Activity" });
      await expectVisibleKeyboardTarget(page, open);
      await page.keyboard.press("Enter");
      const activity = page.getByRole("main", { name: "Observed Activity" });
      await expect(activity).toBeVisible();
      if (visual.production.setup === "activity-10k" || visual.production.setup === "activity-graphical") {
        await expect(activity.getByRole("grid", { name: "Activity timeline buckets" })).toBeVisible();
      }
      if (visual.production.setup === "activity-10k") await expect(activity).toContainText("9,999 Logical Updates");
      if (visual.production.setup === "activity-limited") await expect(activity).toContainText("Coverage LIMITED");
      if (visual.production.setup === "activity-memory") await expect(activity).toContainText("Coverage USEFUL");
      return;
    }
    case "scenario-hidden-pause": {
      const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
      await page.evaluate(() => (window as unknown as { __setWorkbenchVisible(visible: boolean): void }).__setWorkbenchVisible(false));
      await page.evaluate(() => (window as unknown as { __setWorkbenchVisible(visible: boolean): void }).__setWorkbenchVisible(true));
      await expect(scenario.getByRole("button", { name: "Resume" })).toBeVisible();
      return;
    }
    case "scenario-inflight-stop": {
      const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
      await expect(scenario).toContainText("IN FLIGHT");
      await scenario.getByRole("button", { name: "Stop" }).click();
      await expect(scenario).toContainText("RUN STOPPED");
      await expect(scenario.getByText("NOT RUN", { exact: true })).toBeVisible();
      const steps = scenario.getByLabel("Ordered Scenario Steps");
      expect(await steps.evaluate((element) => element.clientHeight)).toBeGreaterThan(100);
      await steps.evaluate((owner) => {
        const firstOutcome = owner.querySelector("article p");
        if (owner instanceof HTMLElement && firstOutcome instanceof HTMLElement) owner.scrollTop = firstOutcome.offsetTop - owner.offsetTop;
      });
      return;
    }
    case "scenario-membership-preview": {
      const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
      await scenario.getByRole("button", { name: "Add captured update" }).click();
      const picker = page.getByRole("region", { name: "Scenario Evidence picker" });
      await picker.getByRole("button", { name: "Preview visible set" }).click();
      await expect(picker).toContainText("Will add after confirmation");
      await expect(picker).toContainText("Unavailable");
      return;
    }
    case "scenario-authored-undo": {
      const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
      await scenario.getByRole("button", { name: "Add authored update" }).click();
      await scenario.getByLabel("Step 2 actions").getByRole("button", { name: "Remove Step" }).click();
      await expect(scenario.getByRole("button", { name: "Undo removal" })).toBeVisible();
      await expect(scenario.getByText("None · newly authored")).toBeVisible();
      return;
    }
    case "scenario-capacity-refusal": {
      const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
      await scenario.getByRole("button", { name: "Add authored update" }).click();
      await expect(scenario.getByRole("alert")).toContainText("at most 100 Steps");
      return;
    }
    case "scenario":
      await expect(page.getByRole("region", { name: "Local Injection Scenario" })).toBeVisible();
      if ([
        "local-injection-scenario-partial",
        "local-injection-scenario-unknown",
        "local-injection-scenario-unretained",
        "local-injection-scenario-cleared"
      ].includes(visual.production.scenario)) {
        const steps = page.getByLabel("Ordered Scenario Steps");
        if (visual.production.scenario === "local-injection-scenario-partial") {
          await expect(steps.getByText("PARTIALLY DELIVERED")).toBeVisible();
          await expect(steps.getByText("NOT RUN", { exact: true })).toBeVisible();
        }
        if (visual.production.scenario === "local-injection-scenario-cleared") {
          await expect(steps).toContainText("UNAVAILABLE_AFTER_CLEAR");
        }
        await steps.evaluate((owner) => {
          const firstOutcome = owner.querySelector("article p");
          if (owner instanceof HTMLElement && firstOutcome instanceof HTMLElement) owner.scrollTop = firstOutcome.offsetTop - owner.offsetTop;
        });
      }
      return;
    case "scenario-checkpoint": {
      const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
      const checkpoint = scenario.locator(".workbench-react__scenario-checkpoint");
      await expect(checkpoint).toHaveCount(1);
      await expect(checkpoint).toContainText("Zero Injections");
      if (visual.production.scenario.endsWith("authoring")) {
        await expect(checkpoint).toHaveAttribute("data-checkpoint-state", "authoring");
        await expect(checkpoint.getByRole("button", { name: "Remove assertion 1" })).toBeDisabled();
        const addAssertion = checkpoint.getByRole("button", { name: "Add assertion" });
        await addAssertion.scrollIntoViewIfNeeded();
        await addAssertion.focus();
        await expect(addAssertion).toBeFocused();
        await expect(addAssertion).toBeInViewport();
      }
      if (visual.production.scenario.endsWith("review")) await expect(checkpoint).toContainText("REVIEWED");
      if (visual.production.scenario.endsWith("waiting")) await expect(checkpoint).toContainText("WAITING");
      if (visual.production.scenario.endsWith("pass")) await expect(checkpoint).toContainText("PASS");
      if (visual.production.scenario.endsWith("fail")) await expect(checkpoint).toContainText("FAIL");
      if (["waiting", "pass", "fail", "ambiguous-null"].some((suffix) => visual.production.scenario.endsWith(suffix))) {
        const route = checkpoint.getByRole("button", { name: /Inspect Evidence/ });
        await expect(route).toBeVisible();
        await route.focus();
        await page.keyboard.press("Enter");
        await expect(route).toBeFocused();
      }
      if (visual.production.scenario.endsWith("wire-unavailable")) {
        await expect(scenario.getByRole("alert")).toContainText("Wire delivery does not expose listener counts");
        await expect(checkpoint).toHaveAttribute("aria-label", "Scenario Checkpoint Listener count unavailable on wire");
        const assertion = checkpoint.getByRole("combobox", { name: /Assertion/ });
        await assertion.scrollIntoViewIfNeeded();
        await assertion.focus();
        await expect(assertion).toBeFocused();
        await expect(assertion).toBeInViewport();
        await expect(checkpoint.getByRole("button", { name: /Inspect Evidence/ })).toHaveCount(0);
      }
      if (visual.production.scenario.endsWith("ambiguous-null")) {
        await expect(checkpoint).toContainText("NOT-EVALUABLE");
        await expect(checkpoint).toContainText("ambiguous · server");
      }
      return;
    }
    case "scenario-checkpoint-high-volume": {
      const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
      await expect(scenario.locator("article")).toHaveCount(200);
      await expect(scenario.locator(".workbench-react__scenario-checkpoint")).toHaveCount(100);
      await expect(scenario.locator(".workbench-react__scenario-checkpoint .workbench-react__scenario-collapsed")).toHaveCount(99);
      await expect(scenario.getByText("Collapsed Draft · Open editor", { exact: false })).toHaveCount(100);
      await expect(scenario.locator(".cm-editor")).toHaveCount(0);
      await expect(scenario).toContainText("100/100 explicit Steps");
      return;
    }
    case "none":
      await expect(page.locator(".workbench-react__evidence-summary")).toHaveCSS("display", "flex");
      return;
    case "diagnostics": {
      const diagnostics = page.getByLabel("Workbench diagnostic entries");
      await expect(diagnostics).toContainText("3 diagnostics · Scroll to review all");
      await diagnostics.focus();
      const overflows = await diagnostics.evaluate((element) => element.scrollHeight > element.clientHeight);
      if (overflows) {
        await page.keyboard.press("End");
        await expect.poll(() => diagnostics.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      }
      await expect(diagnostics).toContainText("Information · Retired Scope");
      if (overflows) {
        await page.keyboard.press("Home");
        await expect.poll(() => diagnostics.evaluate((element) => element.scrollTop)).toBe(0);
      }
      return;
    }
    case "captured-draft": {
      await page.getByRole("button", { name: "Open selected Context" }).click();
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
    case "retained-find": {
      const find = page.getByRole("button", { name: "Find", exact: true });
      await expectVisibleKeyboardTarget(page, find);
      await page.keyboard.press("Enter");
      await page.getByRole("textbox", { name: "Find in ordered Evidence" }).fill("complete-retained-find-anchor");
      await expect(page.getByRole("search", { name: "Find in ordered Evidence" })).toContainText("1 of 3 matches");
      await expect(page.locator('[data-find-current="true"]')).toBeVisible();
      return;
    }
    case "more-actions-help": {
      const more = page.getByRole("button", { name: "More actions" });
      await expectVisibleKeyboardTarget(page, more);
      await page.keyboard.press("Enter");
      const operations = page.getByRole("region", { name: "Session operations" });
      await expect(operations).toBeVisible();
      await expect(page.getByRole("button", { name: "Back to prior investigation" })).toBeVisible();
      const help = operations.getByRole("heading", { name: "Help & resources" });
      const documentation = operations.getByRole("link", { name: "Documentation" });
      const clear = operations.getByRole("button", { name: "Clear retained Evidence…" });
      await clear.scrollIntoViewIfNeeded();
      await expectVisibleKeyboardTarget(page, clear);
      await page.keyboard.press("Tab");
      await expect(documentation).toBeFocused();
      await expect(help).toBeInViewport();
      await expect(documentation).toBeInViewport();
      await expect(operations.getByRole("link", { name: "Privacy" })).toBeInViewport();
      await expect(operations.getByRole("link", { name: "Support" })).toBeInViewport();
      await expect.poll(() => documentation.evaluate((element) => {
        const style = getComputedStyle(element);
        return `${style.outlineStyle} ${style.outlineWidth}`;
      })).toBe("solid 2px");
      return;
    }
    case "memory-operations": {
      const more = page.getByRole("button", { name: "More actions" });
      await expectVisibleKeyboardTarget(page, more);
      await page.keyboard.press("Enter");
      const operations = page.getByRole("region", { name: "Session operations" });
      await expect(operations).toContainText("current Panel Session owns one temporary Event History using in-memory fallback");
      await expect(operations).toContainText("Closing attempts controlled erasure");
      return;
    }
    case "clear-confirmation": {
      const more = page.getByRole("button", { name: "More actions" });
      await expectVisibleKeyboardTarget(page, more);
      await page.keyboard.press("Enter");
      const operations = page.getByRole("region", { name: "Session operations" });
      const trigger = operations.getByRole("button", { name: "Clear retained Evidence…" });
      await trigger.click();
      const clear = operations.getByRole("button", { name: "Clear retained events" });
      const keep = operations.getByRole("button", { name: "Keep Evidence" });
      await expect(clear).not.toBeFocused();
      const owner = page.locator(".workbench-react__context-body");
      const before = await owner.evaluate((element) => element.scrollTop);
      await owner.hover();
      await page.mouse.wheel(0, 500);
      await expect.poll(() => owner.evaluate((element) => element.scrollTop)).toBeGreaterThan(before);
      await page.keyboard.press("Tab");
      await expect(clear).toBeFocused();
      await expect(keep).toBeVisible();
      await expect.poll(() => clear.evaluate((element) => {
        const style = getComputedStyle(element);
        return `${style.outlineStyle} ${style.outlineWidth} ${style.outlineOffset}`;
      })).toBe("solid 3px 2px");
      const geometry = await clear.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          visible: rect.top >= 0 && rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
          unobscured: element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)),
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
        };
      });
      expect(geometry).toEqual({ visible: true, unobscured: true, horizontalOverflow: false });
      return;
    }
  }
  throw new Error(`Unknown production visual setup: ${String(visual.production.setup)}`);
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
