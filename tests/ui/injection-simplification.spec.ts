import axe from "axe-core";
import { expect, test, type Page } from "@playwright/test";
import type { Locator } from "@playwright/test";
import { focusScenarioMember } from "./scenario-ui";
import { getWorkbenchScenario } from "../support/workbench-scenarios";

const browserDiagnostics = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const diagnostics: string[] = [];
  browserDiagnostics.set(page, diagnostics);
  page.on("console", message => { if (message.type() === "error" || message.type() === "warning") diagnostics.push(message.text()); });
  page.on("pageerror", error => diagnostics.push(error.message));
});
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === "passed") {
    const path = testInfo.outputPath("current-ui.png");
    await page.screenshot({ path });
    await testInfo.attach("current-ui", { path, contentType: "image/png" });
  }
  expect(browserDiagnostics.get(page) ?? []).toEqual([]);
});

async function open(page: Page, scenario: string, width = 900, height = 700) {
  await page.setViewportSize({ width, height });
  await page.goto(`/?scenario=${scenario}&theme=dark`);
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  if (["local-injection-scenario-edit", "local-injection-grouped", "local-injection-invalid", "local-injection-stale-edit", "local-injection-large"].includes(scenario)) await expect(page.locator(".cm-content").first()).toBeVisible();
}

async function expectWithinSharedViewport(locator: Locator) {
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate(element => {
    const owner = element.closest(".workbench-react__local-scroll")!;
    const range = document.createRange();
    range.selectNodeContents(element);
    const rect = element.classList.contains("cm-line") ? range.getBoundingClientRect() : element.getBoundingClientRect();
    const bounds = owner.getBoundingClientRect();
    const toolbar = owner.querySelector(".workbench-react__local-editor-toolbar")!.getBoundingClientRect();
    const x = rect.left + Math.min(rect.width / 2, 20);
    const y = rect.top + rect.height / 2;
    const visible = document.elementFromPoint(x, y);
    return rect.top >= Math.max(bounds.top, toolbar.bottom) - 1 && rect.bottom <= bounds.bottom + 1
      && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
      && (visible === element || element.contains(visible));
  })).toBe(true);
}

for (const primitive of ['"alpha"', "-1", "true", "1.5", "false", "null"]) {
  test(`Checkpoint physically types ${primitive} and preserves its exact primitive`, async ({ page }) => {
    await open(page, "local-injection-scenario-edit");
    const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
    await scenario.getByRole("button", { name: "Add checkpoint", exact: true }).click();
    const checkpoint = scenario.locator(".workbench-react__scenario-checkpoint").last();
    await checkpoint.getByRole("combobox", { name: /Assertion .* kind/ }).selectOption("command-field-equals");
    const input = checkpoint.getByRole("textbox", { name: "Primitive JSON", exact: true });
    await input.focus();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(primitive, { delay: 25 });
    await expect(input).toHaveValue(primitive);
    await checkpoint.getByRole("textbox", { name: "Key", exact: true }).fill("order-1");
    await checkpoint.getByRole("textbox", { name: "Field", exact: true }).fill("price");
    await focusScenarioMember(page, "Step 1");
    await focusScenarioMember(page, "Checkpoint 1");
    await expect(input).toHaveValue(primitive);
    await scenario.getByRole("button", { name: "Review Scenario", exact: true }).click();
    await expect(scenario).toHaveAttribute("data-phase", "review");
    await expect(checkpoint).toContainText(`strictly equals ${primitive}`);
    await expect(checkpoint.locator(".cm-editor")).toHaveCount(0);
  });
}

test("invalid pending primitive survives blur, focus changes and Park and blocks Review", async ({ page }, testInfo) => {
  await open(page, "local-injection-scenario-edit", 563, 700);
  const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
  await scenario.getByRole("button", { name: "Add checkpoint", exact: true }).click();
  const checkpoint = scenario.locator(".workbench-react__scenario-checkpoint").last();
  await checkpoint.getByRole("combobox", { name: /Assertion .* kind/ }).selectOption("command-field-equals");
  const input = checkpoint.getByRole("textbox", { name: "Primitive JSON", exact: true });
  await input.fill('"unfinished');
  await page.keyboard.press("Tab");
  await expect(input).toHaveValue('"unfinished');
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(scenario.getByRole("button", { name: "Review Scenario", exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("invalid-checkpoint-primitive.png") });
  await focusScenarioMember(page, "Step 1");
  await focusScenarioMember(page, "Checkpoint 1");
  await expect(input).toHaveValue('"unfinished');
  await scenario.getByRole("button", { name: "Back to Evidence", exact: true }).click();
  await page.getByRole("button", { name: "Resume Scenario", exact: true }).click();
  await expect(input).toHaveValue('"unfinished');
  await input.fill("{}");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(scenario).toContainText("Enter a JSON string, number, boolean, or null");
  await input.fill("-1.5");
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
  await expect(scenario.getByRole("button", { name: "Review Scenario", exact: true })).toBeEnabled();
});

for (const width of [563, 900, 1440]) {
  test(`short unchanged captured Source and Draft stay readable at ${width}px`, async ({ page }) => {
    await open(page, "local-injection-grouped", width);
    const draft = page.getByRole("region", { name: "Local Injection Draft" });
    await expect(draft.getByRole("button", { name: "Compare Source", exact: true })).toHaveAttribute("aria-pressed", "true");
    const editors = draft.locator(".cm-content");
    await expect(editors).toHaveCount(2);
    await expect(editors.nth(0)).toContainText('"fields"');
    await expect(editors.nth(1)).toContainText('"fields"');
    await expect(draft.locator(".cm-collapsedLines")).toHaveCount(0);
    const source = await editors.first().textContent();
    const draftEditor = editors.last();
    await draftEditor.fill(JSON.stringify(JSON.parse(source!.replace("2666", "2667")), null, 2));
    expect(await editors.first().textContent()).toBe(source);
    await expect(draft).toContainText("Changed from immutable Source");
    await expect(draft.locator('[data-shared-scroll-owner="true"]')).toHaveCount(1);
    expect(await draft.locator(".cm-scroller").evaluateAll(elements => elements.some(element => element.scrollHeight > element.clientHeight + 1))).toBe(false);
    expect(await page.locator(".workbench-react").evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
    await page.evaluate(axe.source);
    const violations = await page.evaluate(async () => (await (window as unknown as { axe: typeof axe }).axe.run()).violations.filter(v => v.impact === "serious" || v.impact === "critical"));
    expect(violations).toEqual([]);
  });
}

for (const width of [563, 900]) {
  test(`short comparison has unobscured Source and labelled Draft at ${width}px`, async ({ page }, testInfo) => {
    await open(page, "local-injection-grouped", width);
    const draft = page.getByRole("region", { name: "Local Injection Draft" });
    const source = draft.getByRole("textbox", { name: "Immutable Injection Source JSON", exact: true });
    const editor = draft.getByRole("textbox", { name: "Local Injection JSON", exact: true });
    const sourceLine = source.locator(".cm-line").filter({ hasText: '"command": "UPDATE"' }).first();
    await expectWithinSharedViewport(sourceLine);
    await expectWithinSharedViewport(draft.getByText("Immutable Source", { exact: true }));
    await page.screenshot({ path: testInfo.outputPath("initial-source.png") });
    for (let stops = 0; stops < 12 && !await editor.evaluate(element => element === document.activeElement); stops += 1) {
      await page.keyboard.press("Tab");
    }
    await expect(editor).toBeFocused();
    await expectWithinSharedViewport(draft.getByText("Injection Draft", { exact: true }));
    const text = await source.textContent();
    await editor.fill(JSON.stringify(JSON.parse(text!.replace("2666", "2667")), null, 2));
    await expectWithinSharedViewport(draft.getByText("Injection Draft", { exact: true }));
    await expectWithinSharedViewport(editor.locator(".cm-line").filter({ hasText: '"qty": 2667' }));
    await page.screenshot({ path: testInfo.outputPath("edited-draft.png") });
    const owner = draft.locator(".workbench-react__local-scroll");
    await owner.focus();
    await page.keyboard.press("ControlOrMeta+Home");
    await expectWithinSharedViewport(sourceLine);
    await expectWithinSharedViewport(draft.getByText("Immutable Source", { exact: true }));
    await expect(source).toContainText('"qty": 2666');
    await expect(draft.locator(".cm-scroller")).toHaveCount(2);
    expect(await draft.locator(".cm-scroller").evaluateAll(elements => elements.every(element => element.scrollTop === 0))).toBe(true);
  });
}

for (const [width, height] of [[563, 700], [900, 320]] as const) {
  for (const scenarioName of ["local-injection-invalid", "local-injection-stale-edit"]) {
    test(`disabled Injection exposes its specific blocking cause at ${width}x${height} ${scenarioName}`, async ({ page }) => {
      await open(page, scenarioName, width, height);
      const draft = page.getByRole("region", { name: "Local Injection Draft" });
      const firstProblem = await draft.locator(".workbench-react__local-problems li span").first().textContent();
      const readiness = draft.locator(".workbench-react__local-footer [data-readiness]");
      await expect(readiness).toContainText(firstProblem!.split(" · ").at(-1)!);
      await expect(readiness).toContainText("No Injection attempted.");
      const geometry = await readiness.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, full: element.scrollHeight <= element.clientHeight + 1 };
      });
      expect(geometry.top).toBeGreaterThanOrEqual(0);
      expect(geometry.bottom).toBeLessThanOrEqual(height);
      expect(geometry.full).toBe(true);
      const inject = draft.getByRole("button", { name: "Inject locally", exact: true });
      await expect(inject).toBeDisabled();
      await expect(inject).toHaveAttribute("aria-describedby", /.+/);
      const details = draft.getByRole("button", { name: "Show validation details", exact: true });
      await details.focus();
      await page.keyboard.press("Enter");
      await expect(draft.getByLabel("Local Injection validation")).toBeFocused();
      await expectWithinSharedViewport(draft.locator(".workbench-react__local-problems li span").first());
    });
  }
}

test("Run outcomes keep delivery and Step references visible with correlations under Trace details", async ({ page }) => {
  await open(page, "local-injection-scenario-complete");
  const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
  await expect(scenario).not.toContainText("Temporary promoted document");
  await expect(scenario).not.toContainText("stable identity");
  await focusScenarioMember(page, "Step 1");
  const step = scenario.locator('article[data-step-state="complete"]').first();
  await expect(step).toContainText("DELIVERED LOCALLY");
  const trace = step.locator("details").filter({ has: page.locator("summary", { hasText: "Trace details" }) });
  await expect(trace).toHaveCount(1);
  await expect(trace).toHaveJSProperty("open", false);
  await trace.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(trace).toHaveJSProperty("open", true);
  await expect(trace).toContainText("Injection");
  await expect(trace).toContainText("execution");
  await expect(trace).toContainText("request");
});

test("Park replaces Collapse while preserving Draft edits, undo, focus and scroll", async ({ page }) => {
  await open(page, "local-injection-grouped", 563, 700);
  const draft = page.getByRole("region", { name: "Local Injection Draft" });
  await expect(draft.getByRole("button", { name: /Collapse Draft|Expand Draft/ })).toHaveCount(0);
  const editor = draft.getByRole("textbox", { name: "Local Injection JSON", exact: true });
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n ");
  const value = await editor.textContent();
  const owner = draft.locator(".workbench-react__local-scroll");
  await owner.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const scroll = await owner.evaluate(element => element.scrollTop);
  await draft.getByRole("button", { name: "Park draft and return to Evidence", exact: true }).click();
  await page.getByRole("button", { name: "Resume Local Injection Draft", exact: true }).click();
  await expect(editor).toBeFocused();
  await expect(editor).toHaveText(value!);
  expect(await owner.evaluate(element => element.scrollTop)).toBe(scroll);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => editor.textContent()).not.toBe(value);
});

for (const scenarioName of ["local-injection-grouped", "local-injection-invalid", "local-injection-stale-edit"]) {
  test(`readiness is stated at the delivery boundary for ${scenarioName}`, async ({ page }) => {
    await open(page, scenarioName);
    const draft = page.getByRole("region", { name: "Local Injection Draft" });
    await expect(draft.locator("[data-readiness]")).toHaveCount(1);
    await expect(draft.locator(".workbench-react__local-footer [data-readiness]")).toBeVisible();
    for (const boundary of ["target", "session", "source", "delivery", "local-only", "validation"]) await expect(draft.locator(`[data-protected-boundary="${boundary}"]`)).toBeVisible();
    const inject = draft.getByRole("button", { name: "Inject locally", exact: true });
    if (scenarioName === "local-injection-grouped") {
      await expect(draft.locator(".workbench-react__local-problems")).toHaveCount(0);
      await expect(draft.getByText(/READY/)).toHaveCount(1);
      await expect(inject).toBeEnabled();
    } else {
      await expect(draft).toContainText("No Injection attempted.");
      await expect(draft.getByLabel("Local Injection validation")).toBeVisible();
      await expect(inject).toBeDisabled();
    }
  });
}

test("programmatic Review refuses an invalid primitive after Park and permits correction", async ({ page }) => {
  await open(page, "local-injection-scenario-edit");
  const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
  await scenario.getByRole("button", { name: "Add checkpoint", exact: true }).click();
  const checkpoint = scenario.locator(".workbench-react__scenario-checkpoint").last();
  await checkpoint.getByRole("combobox", { name: /Assertion .* kind/ }).selectOption("command-field-equals");
  await checkpoint.getByRole("textbox", { name: "Key", exact: true }).fill("order-1");
  await checkpoint.getByRole("textbox", { name: "Field", exact: true }).fill("price");
  const input = checkpoint.getByRole("textbox", { name: "Primitive JSON", exact: true });
  await input.fill("-1.");
  await scenario.getByRole("button", { name: "Back to Evidence", exact: true }).click();
  await page.evaluate(() => (window as unknown as { __reviewWorkbenchScenario(): void }).__reviewWorkbenchScenario());
  await page.getByRole("button", { name: "Resume Scenario", exact: true }).click();
  await expect(scenario).toHaveAttribute("data-phase", "edit");
  await expect(input).toHaveValue("-1.");
  await expect(scenario).toContainText("No Injection attempted.");
  await input.fill("-1.5");
  await page.evaluate(() => (window as unknown as { __reviewWorkbenchScenario(): void }).__reviewWorkbenchScenario());
  await expect(scenario).toHaveAttribute("data-phase", "review");
  await expect(checkpoint).toContainText("strictly equals -1.5");
});

test("large captured comparison exposes payload meaning and one shared scroll", async ({ page }) => {
  await open(page, "local-injection-large", 1440, 900);
  const draft = page.getByRole("region", { name: "Local Injection Draft" });
  const source = draft.getByRole("textbox", { name: "Immutable Injection Source JSON", exact: true });
  const editor = draft.getByRole("textbox", { name: "Local Injection JSON", exact: true });
  await expect(source).toContainText('"command"');
  await expect(editor).toContainText('"command"');
  await expect(draft.locator(".cm-collapsedLines")).toHaveCount(0);
  const owner = draft.locator(".workbench-react__local-scroll");
  await owner.evaluate(element => { element.scrollTop = 400; });
  expect(await owner.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await draft.locator(".cm-scroller").evaluateAll(elements => elements.every(element => element.scrollTop === 0))).toBe(true);
  // A large CodeMirror document virtualizes text; use the declared fixture's
  // full payload rather than treating the visible DOM excerpt as the document.
  const captured = getWorkbenchScenario("local-injection-large").initialEvents.at(-1)!.update!;
  await editor.fill(JSON.stringify({ command: captured.command, key: captured.key, isSnapshot: captured.isSnapshot, fields: { ...captured.fields, field_001: "edited-value" } }, null, 2));
  await owner.evaluate(element => { element.scrollTop = 0; });
  await expect(editor).toContainText("edited-value");
  await expect(source).toContainText('"field_001": "value-1"');
  await expect(source).not.toContainText("edited-value");
});

test("source-free authoring keeps one editable Draft and no comparison control", async ({ page }) => {
  await open(page, "local-injection-authored");
  await page.getByRole("button", { name: "Author COMMAND Item Update", exact: true }).click();
  const draft = page.getByRole("region", { name: "Local Injection Draft" });
  await expect(draft.locator(".cm-content")).toHaveCount(1);
  const editor = draft.getByRole("textbox", { name: "Local Injection JSON", exact: true });
  await expect(editor).toBeVisible();
  await expect(draft.getByRole("button", { name: "Compare Source", exact: true })).toHaveCount(0);
  await editor.fill(JSON.stringify({ command: "ADD", key: "authored-value", isSnapshot: false, fields: { command: "ADD", key: "authored-value", value: "42" } }, null, 2));
  await expect(draft.getByRole("button", { name: "Inject locally", exact: true })).toBeEnabled();
  await expect(draft.locator('[data-protected-boundary="source"]')).toContainText("Newly authored");
});

test("Run fingerprint and Diagnostic cursors are behind native keyboard Trace disclosures", async ({ page }) => {
  await open(page, "local-injection-scenario-diagnostic-pass");
  const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
  const ledger = scenario.getByRole("region", { name: "Scenario Run ledger", exact: true });
  const summary = ledger.locator("summary", { hasText: "Trace details" });
  await expect(ledger.locator("details")).toHaveJSProperty("open", false);
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(ledger.locator("details")).toHaveJSProperty("open", true);
  await expect(ledger).toContainText("Target fingerprint");
  await expect(ledger).toContainText("Diagnostic Observation cursor");
  const observation = scenario.getByRole("region", { name: "Diagnostic Observation Trace reference subscription.lost-updates", exact: true });
  await expect(observation.locator("details")).toHaveJSProperty("open", false);
  await expect(observation.getByRole("button", { name: "Inspect Diagnostic Observation subscription.lost-updates", exact: true })).toBeVisible();
  await observation.locator("summary").focus();
  await page.keyboard.press("Space");
  await expect(observation.locator("details")).toHaveJSProperty("open", true);
  await expect(observation).toContainText("Diagnostic Observation boundary");
  await expect(observation).toContainText("Exact affected identity subscription");
});

test("cleared Scenario Evidence qualifies delivered outcomes and preserves exact Trace references", async ({ page }) => {
  await open(page, "local-injection-scenario-cleared");
  const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
  await focusScenarioMember(page, "Step 1");
  const step = scenario.locator('article[data-step-state="complete"]').first();
  await expect(step).toContainText("DELIVERED LOCALLY");
  const outcome = step.locator(":scope > p").first();
  await expect(outcome).toBeVisible();
  await expect(outcome).toContainText("Local Evidence is unavailable after Clear");
  await expect(outcome).not.toContainText("Local Evidence committed");
  const trace = step.locator("details");
  await expect(trace).toHaveJSProperty("open", false);
  await trace.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(trace).toContainText("UNAVAILABLE_AFTER_CLEAR");
  await expect(trace).toContainText(/Evidence [^ ·]+ · availability UNAVAILABLE_AFTER_CLEAR/);

  await scenario.getByRole("button", { name: "Run again", exact: true }).click();
  const prior = scenario.getByRole("region", { name: "Prior Scenario Run ledgers", exact: true });
  await expect(prior).toContainText("Evidence is unavailable after Clear");
  const priorTrace = prior.locator("details").first();
  await expect(priorTrace).toHaveJSProperty("open", false);
  await expect(priorTrace.locator("summary")).toContainText("Evidence is unavailable after Clear");
  await priorTrace.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(priorTrace).toContainText("UNAVAILABLE_AFTER_CLEAR");
  await expect(priorTrace).toContainText(/Evidence [^ ·]+ · availability UNAVAILABLE_AFTER_CLEAR/);
});


for (const [scenarioName, heading] of [["local-injection-pending", "Local Injection pending"], ["local-injection-delivered", "DELIVERED LOCALLY"]] as const) {
  test(`first mounted ${scenarioName} focuses its current delivery state`, async ({ page }) => {
    await open(page, scenarioName, 900, 700);
    const document = page.getByRole("region", { name: "Local Injection Draft" });
    await expect(document.getByRole("heading", { name: heading, exact: true })).toBeFocused();
  });
}

for (const [width, height, forcedColors] of [[563, 700, false], [900, 700, false], [1440, 900, false], [900, 320, true]] as const) {
  test(`long comparison field end is reachable through the shared scroll at ${width}x${height}${forcedColors ? " forced colors" : ""}`, async ({ page }, testInfo) => {
    if (forcedColors) await page.emulateMedia({ forcedColors: "active" });
    await open(page, "local-injection-grouped", width, height);
    const draft = page.getByRole("region", { name: "Local Injection Draft" });
    const source = draft.getByRole("textbox", { name: "Immutable Injection Source JSON", exact: true });
    const editor = draft.getByRole("textbox", { name: "Local Injection JSON", exact: true });
    const original = await source.innerText();
    const payload = JSON.parse(original);
    const field = Object.keys(payload.fields).find(name => name !== "command" && name !== "key");
    expect(field).toBeDefined();
    payload.fields[field!] = `${"wide-field-value-".repeat(80)}END-WIDE`;
    await editor.fill(JSON.stringify(payload, null, 2));
    const owner = draft.locator('[data-shared-scroll-owner="true"]');
    const line = editor.locator(".cm-line").filter({ hasText: "END-WIDE" });
    await expect(line).toHaveCount(1);
    await expect.poll(() => owner.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await line.evaluate(element => {
      const scroll = element.closest(".workbench-react__local-scroll")!;
      const top = Math.max(scroll.getBoundingClientRect().top, scroll.querySelector(".workbench-react__local-editor-toolbar")!.getBoundingClientRect().bottom);
      scroll.scrollTop += element.getBoundingClientRect().top - top - 8;
    });
    await owner.hover();
    await page.mouse.wheel(20_000, 0);
    await expect.poll(() => line.evaluate(element => {
      const nodes = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = nodes.nextNode())) {
        const index = node.textContent?.indexOf("END-WIDE") ?? -1;
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + "END-WIDE".length);
        const rect = range.getBoundingClientRect();
        const scroll = element.closest(".workbench-react__local-scroll")!;
        const bounds = scroll.getBoundingClientRect();
        const top = Math.max(bounds.top, scroll.querySelector(".workbench-react__local-editor-toolbar")!.getBoundingClientRect().bottom);
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= top
          && rect.bottom <= bounds.bottom && !!hit && element.contains(hit);
      }
      return false;
    })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("long-field-end.png") });
    expect(await draft.locator(".cm-scroller").evaluateAll(elements => elements.every(element => element.scrollLeft === 0 && element.scrollTop === 0))).toBe(true);
    await owner.focus();
    await page.keyboard.press("ControlOrMeta+Home");
    await expect.poll(() => owner.evaluate(element => element.scrollLeft)).toBe(0);
    await expect(source).toHaveText(original, { useInnerText: true });
    await expectWithinSharedViewport(draft.getByText("Immutable Source", { exact: true }));
    expect(await page.locator(".workbench-react").evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
  });
}
