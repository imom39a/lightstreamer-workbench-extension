import type { Page } from "@playwright/test";

export type VisualLayoutSample = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}>;

export async function waitForStableVisualLayout(
  waitForFonts: () => Promise<void>,
  sample: () => Promise<VisualLayoutSample>,
  nextFrame: () => Promise<void>,
  maxFrames = 60
): Promise<VisualLayoutSample> {
  await waitForFonts();
  let previous = await sample();
  for (let frame = 0; frame < maxFrames; frame += 1) {
    await nextFrame();
    const current = await sample();
    if (sameVisualLayout(previous, current)) return current;
    previous = current;
  }
  throw new Error(`Visual layout did not stabilize within ${maxFrames} animation frames.`);
}

export async function waitForVisualReadiness(page: Page, selector: string): Promise<void> {
  await page.evaluate(waitForVisualReadinessInPage, selector);
}

/**
 * Prime Chrome's renderer/font rasterization before the screenshot under test.
 * The result is deliberately discarded; this is a read-only harness warm-up,
 * not a baseline or tolerance adjustment.
 */
export async function warmVisualRenderer(page: Page, selector: string): Promise<void> {
  await waitForVisualReadiness(page, selector);
  await page.locator(selector).screenshot({ animations: "disabled", caret: "hide" });
  await waitForVisualReadiness(page, selector);
}

function sameVisualLayout(left: VisualLayoutSample, right: VisualLayoutSample): boolean {
  return left.left === right.left &&
    left.top === right.top &&
    left.width === right.width &&
    left.height === right.height &&
    left.viewportWidth === right.viewportWidth &&
    left.viewportHeight === right.viewportHeight;
}

async function waitForVisualReadinessInPage(selector: string): Promise<VisualLayoutSample> {
  await document.fonts.ready;
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Visual readiness target ${JSON.stringify(selector)} is missing.`);
  }
  const sample = (): VisualLayoutSample => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  };
  let previous = sample();
  for (let frame = 0; frame < 60; frame += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const current = sample();
    if (
      previous.left === current.left &&
      previous.top === current.top &&
      previous.width === current.width &&
      previous.height === current.height &&
      previous.viewportWidth === current.viewportWidth &&
      previous.viewportHeight === current.viewportHeight
    ) {
      return current;
    }
    previous = current;
  }
  throw new Error("Visual layout did not stabilize within 60 animation frames.");
}
