import axe from "axe-core";
import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { focusScenarioMember, scenarioDocument } from "./scenario-ui";

const output = resolve("test-results/mcp-agent-audit/temporal-absence-ui");

async function ready(page: Page, width: number, height: number, forcedColors: boolean): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ colorScheme: "dark", forcedColors: forcedColors ? "active" : "none" });
  await page.goto("/?scenario=local-injection-authored&theme=dark&nativeMode=MERGE&nativeUseful=1");
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
}

async function assertAccessibleAndScrollable(page: Page): Promise<void> {
  await page.evaluate(axe.source);
  const violations = await page.evaluate(async () => (await (window as any).axe.run()).violations.filter((v: any) => ["serious", "critical"].includes(v.impact)));
  expect(violations).toEqual([]);
  const scenario = scenarioDocument(page);
  const pane = scenario.locator(".workbench-react__scenario-steps");
  await pane.focus();
  await expect(pane).toBeFocused();
  const before = await pane.evaluate(node => node.scrollTop);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(60);
  const after = await pane.evaluate(node => node.scrollTop);
  const max = await pane.evaluate(node => node.scrollHeight - node.clientHeight);
  expect(after > before || max === 0).toBe(true);
  expect(await page.locator(".workbench-react").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  return;
}

async function captureShallowTerminalViewport(page: Page, prefix: string, status: "PASS" | "FAIL", durationMs: number): Promise<void> {
  const scenario = scenarioDocument(page);
  const pane = scenario.getByLabel("Focused Scenario member", { exact: true });
  await expect(pane).toBeVisible();
  await pane.evaluate(node => { node.scrollTop = 0; });
  const before = await pane.evaluate(node => node.scrollTop);
  const terminal = scenario.getByText(`${status} · zero Injections dispatched.`, { exact: true });
  await pane.focus();
  await expect(pane).toBeFocused();
  const assertion = scenario.locator(".workbench-react__scenario-assertions > li").nth(1);
  const description = assertion.locator("strong");
  const result = assertion.locator("span");
  const viewportRatio = (locator: typeof assertion) => locator.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const owner = node.closest<HTMLElement>(".workbench-react__scenario-steps")?.getBoundingClientRect();
      if (!owner) return 0;
      const width = Math.max(0, Math.min(rect.right, owner.right, window.innerWidth) - Math.max(rect.left, owner.left, 0));
      const height = Math.max(0, Math.min(rect.bottom, owner.bottom, window.innerHeight) - Math.max(rect.top, owner.top, 0));
      return rect.width && rect.height ? width * height / (rect.width * rect.height) : 0;
  });
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (await viewportRatio(description) >= 0.8 && await viewportRatio(result) >= 0.8 && await viewportRatio(terminal) >= 0.8) break;
    const prior = await pane.evaluate(node => node.scrollTop);
    await page.keyboard.press(attempt < 4 ? "PageDown" : "ArrowDown");
    const after = await pane.evaluate(node => node.scrollTop);
    if (after <= prior) break;
  }
  const after = await pane.evaluate(node => node.scrollTop);
  expect(after).toBeGreaterThan(before);
  expect(await viewportRatio(description)).toBeGreaterThanOrEqual(0.8);
  expect(await viewportRatio(result)).toBeGreaterThanOrEqual(0.8);
  expect(await viewportRatio(terminal)).toBeGreaterThanOrEqual(0.8);

  await expect(assertion).toContainText(`No captured Server Item Update for item topology-small-item during ${durationMs} ms active time`);
  await expect(assertion).toContainText(status === "PASS" ? "PASS · observed absent-over-observed-window" : "FAIL · observed fail");
  await page.screenshot({ path: resolve(output, `${prefix}-${status.toLowerCase()}-scrolled.png`) });
}

for (const [width, height, forcedColors] of [[900, 700, false], [900, 320, true]] as const) {
  test(`temporal absence has visible pass/fail trace at ${width}x${height}${forcedColors ? " forced colors" : ""}`, async ({ page }) => {
    test.setTimeout(60000);
    await mkdir(output, { recursive: true });
    await ready(page, width, height, forcedColors);
    await page.evaluate(() => (window as any).__prepareAgentNativeAssertions(180));
    const scenario = scenarioDocument(page);
    await focusScenarioMember(page, "Checkpoint 1", true);
    await expect(scenario).toContainText("Committed Local Evidence from Step native-step field value strictly equals null");
    await expect(scenario).toContainText("No captured Server Item Update for item topology-small-item during 180 ms active time");
    await expect(scenario).toContainText("REVIEWED · zero Injections dispatched.");
    const prefix = `${width}x${height}${forcedColors ? "-forced" : ""}`;
    await page.screenshot({ path: resolve(output, `${prefix}-reviewed.png`) });
    await assertAccessibleAndScrollable(page);

    await page.evaluate(() => (window as any).__stepAgentNativeAssertions());
    await expect.poll(() => page.evaluate(() => (window as any).__getWorkbenchScenarioSnapshot()?.run?.trace.length)).toBe(1);
    await page.evaluate(() => (window as any).__stepAgentNativeAssertions());
    await expect.poll(() => page.evaluate(() => (window as any).__getWorkbenchScenarioSnapshot()?.run?.trace[1]?.status), { timeout: 10000 }).toBe("pass");
    const passed = await page.evaluate(() => (window as any).__getWorkbenchScenarioSnapshot().run.trace[1]);
    expect(passed).toMatchObject({ kind: "checkpoint", status: "pass", assertions: [
      { assertionId: "native-field", status: "pass", observed: { provenance: "committed-local-evidence" } },
      { assertionId: "native-absence", status: "pass", observed: { state: "absent-over-observed-window" } }
    ] });
    await expect(scenario).toContainText("Committed Local Evidence from Step native-step field value strictly equals null");
    await expect(scenario).toContainText("No captured Server Item Update for item topology-small-item during 180 ms active time");
    await expect(scenario).toContainText("PASS · zero Injections dispatched.");
    await page.screenshot({ path: resolve(output, `${prefix}-completed.png`) });
    await assertAccessibleAndScrollable(page);
    if (forcedColors) await captureShallowTerminalViewport(page, prefix, "PASS", 180);

    await ready(page, width, height, forcedColors);
    await page.evaluate(() => (window as any).__prepareAgentNativeAssertions(1200));
    await page.evaluate(() => (window as any).__stepAgentNativeAssertions());
    await expect.poll(() => page.evaluate(() => (window as any).__getWorkbenchScenarioSnapshot()?.run?.trace.length)).toBe(1);
    await page.evaluate(() => (window as any).__scheduleNativeServerItemUpdate(300));
    await page.evaluate(() => (window as any).__stepAgentNativeAssertions());
    await expect.poll(() => page.evaluate(() => (window as any).__getWorkbenchScenarioSnapshot()?.run?.trace[1]?.status), { timeout: 10000 }).toMatch(/^(fail|inconclusive)$/);
    const failed = await page.evaluate(() => (window as any).__getWorkbenchScenarioSnapshot().run.trace[1]);
    expect(failed, JSON.stringify(failed)).toMatchObject({ kind: "checkpoint", status: "fail", assertions: [
      { assertionId: "native-field", status: "pass" },
      { assertionId: "native-absence", status: "fail", observed: { state: "fail" } }
    ] });
    await focusScenarioMember(page, "Checkpoint 1", true);
    await expect(scenario).toContainText("No captured Server Item Update for item topology-small-item during 1200 ms active time");
    await expect(scenario).toContainText("FAIL · zero Injections dispatched.");
    await page.screenshot({ path: resolve(output, `${prefix}-failed.png`) });
    await assertAccessibleAndScrollable(page);
    if (forcedColors) await captureShallowTerminalViewport(page, prefix, "FAIL", 1200);
  });
}
