import axe from "axe-core";
import { focusScenarioMember } from "./scenario-ui";
import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve("test-results/mcp-agent-audit/native-scenarios");
const matrix = [[563, 700, false], [900, 700, false], [900, 320, false], [1440, 900, false], [900, 320, true]] as const;
async function ready(page: Page, query: string) { await page.goto(`/?scenario=local-injection-authored&theme=dark${query}`); await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true"); }
async function checks(page: Page) {
    await page.evaluate(axe.source);
    const violations = await page.evaluate(async () => (await (window as any).axe.run()).violations.filter((v: any) => ["serious", "critical"].includes(v.impact)));
    expect(violations).toEqual([]);
    expect(await page.locator(".workbench-react").evaluate(e => e.scrollWidth > e.clientWidth)).toBe(false);
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
    return { axeSeriousCritical: violations, noHorizontalOverflow: true, keyboardTabReachable: true };
}
async function delta(page: Page, prefix: string, base: string, current: string) {
    const before = (await readFile(resolve(root, base))).toString("base64"), after = (await readFile(resolve(root, current))).toString("base64");
    const png = await page.evaluate(async ({ before, after }) => {
        const load = async (data: string) => { const i = new Image(); i.src = `data:image/png;base64,${data}`; await i.decode(); return i; };
        const [a, b] = await Promise.all([load(before), load(after)]);
        const c = document.createElement("canvas");
        c.width = a.width;
        c.height = a.height;
        const x = c.getContext("2d")!;
        x.drawImage(a, 0, 0);
        const av = x.getImageData(0, 0, c.width, c.height);
        x.drawImage(b, 0, 0);
        const bv = x.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < bv.data.length; i += 4) {
            for (let j = 0; j < 3; j++)
                bv.data[i + j] = Math.abs(av.data[i + j]! - bv.data[i + j]!) * 3;
            bv.data[i + 3] = 255;
        }
        x.putImageData(bv, 0, 0);
        return c.toDataURL("image/png").split(",")[1]!;
    }, { before, after });
    await writeFile(resolve(root, `${prefix}-diff.png`), Buffer.from(png, "base64"));
}
async function slices(page: Page, prefix: string, selector: string, directory = root) {
    const pane = page.locator(selector);
    if (!await pane.isVisible())
        return { slices: 0, keyboardScroll: false };
    const focus = selector.includes("scenario") ? pane.locator("h2").first() : pane;
    await focus.focus();
    await pane.evaluate(e => e.scrollTop = 0);
    const before = await pane.evaluate(e => e.scrollTop);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(80);
    const after = await pane.evaluate(e => e.scrollTop);
    let count = 0;
    const extent = await pane.evaluate(e => ({ height: e.clientHeight, max: e.scrollHeight - e.clientHeight }));
    for (let top = 0; top <= extent.max + extent.height; top += Math.max(1, Math.floor(extent.height * 0.8))) {
        await pane.evaluate((e, top) => e.scrollTop = top, Math.min(top, extent.max));
        await page.screenshot({ path: resolve(directory, `${prefix}-slice-${count++}.png`) });
        if (top >= extent.max)
            break;
    }
    await pane.evaluate(e => e.scrollTop = 0);
    expect(after > before || extent.max === 0).toBe(true);
    return { slices: count, keyboardScroll: true, viewportHeight: extent.height };
}
for (const [width, height, forced] of matrix)
    test(`native modes and assertions ${width}x${height}${forced ? " forced" : ""}`, async ({ page }) => {
        test.setTimeout(90000);
        await mkdir(root, { recursive: true });
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme: "dark", forcedColors: forced ? "active" : "none" });
        const prefix = `${width}x${height}${forced ? "-forced" : ""}`, results: any = { viewport: { width, height }, theme: "dark", forcedColors: forced, states: {} };
        await ready(page, "");
        await expect(page.getByRole("button", { name: "Author COMMAND Item Update", exact: true })).toBeVisible();
        await page.screenshot({ path: resolve(root, `${prefix}-command-base.png`) });
        for (const mode of ["MERGE", "DISTINCT"]) {
            await ready(page, `&nativeMode=${mode}`);
            const button = page.getByRole("button", { name: `Author ${mode} Item Update`, exact: true });
            await expect(button).toBeVisible();
            await button.focus();
            await page.keyboard.press("Shift+Tab");
            await page.keyboard.press("Tab");
            await expect(button).toBeFocused();
            await page.screenshot({ path: resolve(root, `${prefix}-${mode}-label.png`) });
            await delta(page, `${prefix}-${mode}`, `${prefix}-command-base.png`, `${prefix}-${mode}-label.png`);
            await button.press("Enter");
            await expect(page.getByRole("region", { name: "Local Injection Draft", exact: true })).toBeVisible();
            await expect(page.getByText("Newly authored · no immutable Source", { exact: true })).toBeVisible();
            await page.screenshot({ path: resolve(root, `${prefix}-${mode}-author.png`) });
            results.states[mode] = { ...await checks(page), ...await slices(page, `${prefix}-${mode}-author`, ".workbench-react__local-scroll") };
        }
        await page.goto("/?scenario=local-injection-scenario-checkpoint-review&theme=dark");
        await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
        await focusScenarioMember(page, "Checkpoint 1", true);
        await page.screenshot({ path: resolve(root, `${prefix}-assertions-base.png`) });
        await ready(page, "&nativeMode=MERGE&nativeLimited=1");
        await page.evaluate(() => (window as any).__prepareAgentNativeAssertions());
        const scenario = page.getByRole("region", { name: "Local Injection Scenario", exact: true });
        await expect(scenario).toBeVisible();
        await focusScenarioMember(page, "Checkpoint 1", true);
        await expect(scenario).toContainText("Committed Local Evidence from Step native-step field value strictly equals null");
        await expect(scenario).toContainText("No captured Server Item Update for item topology-small-item during 100 ms active time");
        await page.screenshot({ path: resolve(root, `${prefix}-assertions-review.png`) });
        await delta(page, `${prefix}-assertions`, `${prefix}-assertions-base.png`, `${prefix}-assertions-review.png`);
        results.states.review = { ...await checks(page), ...await slices(page, `${prefix}-assertions-review`, ".workbench-react__scenario-steps") };
        await page.evaluate(() => (window as any).__stepAgentNativeAssertions());
        await expect.poll(() => page.evaluate(() => (window as any).__getWorkbenchScenarioSnapshot()?.run?.trace.length)).toBe(1);
        await page.evaluate(() => (window as any).__stepAgentNativeAssertions());
        await expect.poll(() => page.evaluate(() => (window as any).__getWorkbenchScenarioSnapshot()?.run?.trace[1]?.status)).toBe("inconclusive");
        await page.screenshot({ path: resolve(root, `${prefix}-assertions-inconclusive.png`) });
        results.states.inconclusive = { ...await checks(page), ...await slices(page, `${prefix}-assertions-inconclusive`, ".workbench-react__scenario-steps") };
        await writeFile(resolve(root, `${prefix}-checks.json`), JSON.stringify(results, null, 2));
    });

for (const [width, height, forced] of [[900, 700, false], [900, 320, true]] as const)
    test(`agent assertions back to edit ${width}x${height}${forced ? " forced" : ""}`, async ({ page }) => {
        const directory = resolve("test-results/mcp-agent-audit/native-assertion-edit");
        await mkdir(directory, { recursive: true });
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ colorScheme: "dark", forcedColors: forced ? "active" : "none" });
        await ready(page, "&nativeMode=MERGE&nativeLimited=1");
        await page.evaluate(() => (window as any).__prepareAgentNativeAssertions());
        const scenario = page.getByRole("region", { name: "Local Injection Scenario", exact: true });
        const assertions = () => page.evaluate(() => (window as any).__getWorkbenchScenarioSnapshot().scenario.members.filter((member: any) => member.kind === "checkpoint").map((checkpoint: any) => checkpoint.assertions));
        const before = await assertions();
        await scenario.getByRole("button", { name: "Edit Scenario", exact: true }).press("Enter");
        await focusScenarioMember(page, "Checkpoint 1", true);
        const select = scenario.getByRole("combobox", { name: /Assertion .* kind/ });
        await expect(select.nth(0)).toHaveValue("local-evidence-field-equals");
        await expect(select.nth(1)).toHaveValue("server-item-update-absent");
        await expect(select.nth(0)).toBeDisabled();
        await expect(select.nth(1)).toBeDisabled();
        await expect(scenario).toContainText("This agent-authored assertion is read-only here.");
        const terms = await scenario.locator(".workbench-react__scenario-assertion-authoring dl").allTextContents();
        expect(terms[0]).toContain("Earlier Stepnative-stepFieldvalueExpected primitive JSONnullWithin active msImmediate");
        expect(terms[1]).toContain("Item nametopology-small-itemItem position1Observation duration (active ms)100");
        const prefix = `${width}x${height}${forced ? "-forced" : ""}`;
        const results = { ...await checks(page), ...await slices(page, `${prefix}-edit`, ".workbench-react__scenario-steps", directory) };
        const add = scenario.getByRole("button", { name: "Add assertion", exact: true });
        await add.focus();
        await expect(add).toBeFocused();
        await expect(add).toBeInViewport();
        const remove = scenario.getByRole("button", { name: "Remove assertion 1", exact: true });
        await remove.focus();
        await expect(remove).toBeFocused();
        await expect(remove).toBeInViewport();
        expect(await assertions()).toEqual(before);
        await scenario.getByRole("button", { name: "Review Scenario", exact: true }).press("Enter");
        await focusScenarioMember(page, "Checkpoint 1", true);
        await expect(scenario).toContainText("Committed Local Evidence from Step native-step field value strictly equals null");
        await expect(scenario).toContainText("No captured Server Item Update for item topology-small-item during 100 ms active time");
        expect(await assertions()).toEqual(before);
        await page.screenshot({ path: resolve(directory, `${prefix}-returned-review.png`) });
        await writeFile(resolve(directory, `${prefix}-checks.json`), JSON.stringify({ ...results, exactAssertionsPreserved: true, replacementControlsKeyboardReachable: true }, null, 2));
    });
