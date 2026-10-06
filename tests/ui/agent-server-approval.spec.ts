import axe from "axe-core";
import { expect, test, type Page, type Locator } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { waitForVisualReadiness, warmVisualRenderer } from "./visual-readiness";

const matrix = [[563, 700, false], [900, 700, false], [900, 320, false], [1440, 900, false], [900, 320, true]] as const;
for (const [width, height, forced] of matrix) {
  test(`agent Server approval ${width}x${height}${forced ? " forced colors" : ""}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: "dark", forcedColors: forced ? "active" : "none" });
    const artifactDir = resolve("test-results/mcp-agent-audit/server-approval");
    await mkdir(artifactDir, { recursive: true });
    const prefix = `${width}x${height}${forced ? "-forced" : ""}`;
    await page.goto("/?scenario=server-injection-review&theme=dark");
    await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
    const humanSend = page.getByRole("button", { name: "Send Client Message once", exact: true });
    await expect(humanSend).toBeEnabled();
    await warmVisualRenderer(page, ".workbench-react");
    await humanSend.focus();
    await page.screenshot({ path: resolve(artifactDir, `${prefix}-base.png`) });
    await captureReviewArguments(page, resolve(artifactDir, `${prefix}-base-top.png`));
    await page.goto("/?scenario=server-injection-review&theme=dark&agentServer=1");
    await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
    const approve = page.getByRole("button", { name: "Approve exact Client Message for agent send", exact: true });
    await expect(approve).toBeEnabled();
    await expect(page.getByRole("button", { name: "Send Client Message once", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__serverInjectionExecutionCount())).toBe(0);
    const blocked = await page.evaluate(async () => { try { await (window as any).__agentServerCall("execute_server_injection"); return "sent"; } catch (error) { return String(error); } });
    expect(blocked).toContain("HUMAN_APPROVAL_REQUIRED");
    await captureReviewArguments(page, resolve(artifactDir, `${prefix}-review-top.png`));
    await approve.focus();
    await expect(approve).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(approve).toBeFocused();
    await page.screenshot({ path: resolve(artifactDir, `${prefix}-review.png`) });
    await pixelDiff(page, artifactDir, `${prefix}-base`, `${prefix}-review`, `${prefix}-diff`);
    await pixelDiff(page, artifactDir, `${prefix}-base-top`, `${prefix}-review-top`, `${prefix}-diff-top`);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Approved for one agent send", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => (window as any).__serverInjectionExecutionCount())).toBe(0);
    await writeFile(resolve(artifactDir, `${prefix}-geometry.json`), JSON.stringify(await page.evaluate(() => {
      const retry = document.querySelector(".workbench-react__server-actions div > span:last-child")!;
      const nodes = []; let node: Element | null = retry;
      while (node) { const rect = node.getBoundingClientRect(); nodes.push({ class: node.className, tag: node.tagName, rect: { top: rect.top, bottom: rect.bottom, height: rect.height }, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, scrollTop: node.scrollTop, overflow: getComputedStyle(node).overflow }); node = node.parentElement; }
      return nodes;
    }), null, 2));
    await waitForVisualReadiness(page, ".workbench-react");
    await entirelyInReviewBody(page.locator("[data-agent-approval-status]"));
    await entirelyInReviewBody(page.locator(".workbench-react__server-actions div > span").last());
    await waitForVisualReadiness(page, ".workbench-react");
    await page.screenshot({ path: resolve(artifactDir, `${prefix}-approved.png`) });
    // A focused disabled control is no longer keyboard reachable. Preserve a
    // visible, meaningful focus destination after the consequential click.
    expect(await page.evaluate(() => document.activeElement !== document.body && (document.activeElement as HTMLElement).getBoundingClientRect().width > 0)).toBe(true);
    await page.evaluate(axe.source);
    const violations = await page.evaluate(async () => (await (window as any).axe.run()).violations.filter((value: any) => value.impact === "serious" || value.impact === "critical"));
    expect(violations).toEqual([]);
    expect(await page.locator(".workbench-react").evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
    await page.evaluate(() => (window as any).__revokeAgentServerFixture());
    await expect(approve).toBeEnabled();
    await page.screenshot({ path: resolve(artifactDir, `${prefix}-revoked.png`) });
    const denied = await page.evaluate(async () => { try { await (window as any).__agentServerCall("execute_server_injection"); return "sent"; } catch (error) { return String(error); } });
    expect(denied).toContain("ACCESS_REVOKED");
    expect(await page.evaluate(() => (window as any).__serverInjectionExecutionCount())).toBe(0);
    await writeFile(resolve(artifactDir, `${prefix}-checks.json`), JSON.stringify({ viewport: { width, height }, theme: "dark", forcedColors: forced,
      axeSeriousCritical: violations, noSendBeforeApproval: true, humanClickDoesNotSend: true, revokePreventsSend: true, keyboard: "Shift+Tab/Tab exact approval, Enter approval, visible focus after click" }, null, 2));
  });
}

test("approved exact Server message executes once and remains recoverable", async ({ page }) => {
  await page.goto("/?scenario=server-injection-review&theme=dark&agentServer=1");
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await page.getByRole("button", { name: "Approve exact Client Message for agent send", exact: true }).click();
  const first = await page.evaluate(() => (window as any).__agentServerCall("execute_server_injection"));
  const repeated = await page.evaluate(() => (window as any).__agentServerCall("execute_server_injection"));
  expect(repeated).toEqual(first);
  expect(await page.evaluate(() => (window as any).__serverInjectionExecutionCount())).toBe(1);
  const receipt = await page.evaluate(() => (window as any).__agentServerCall("recover_server_injection"));
  expect(receipt).toMatchObject({ requestId: "browser-server-request", state: "complete" });
  await expect(page.getByRole("heading", { name: "Processed by Lightstreamer", exact: true })).toBeVisible();
});

async function entirelyInReviewBody(locator: Locator) {
  let last: unknown;
  try {
  await expect.poll(() => locator.evaluate(element => {
    const box = element.getBoundingClientRect(), body = element.closest(".workbench-react__server-body")!.getBoundingClientRect();
    const status = document.querySelector(".workbench-react__status")!.getBoundingClientRect();
    const unobscured = [box.top + 2, box.bottom - 2].every(y => element.contains(document.elementFromPoint(box.left + Math.min(8, box.width / 2), y)));
    return { visible: box.top >= body.top && box.bottom <= Math.min(body.bottom, status.top) && box.left >= body.left && box.right <= body.right && unobscured,
      element: element.tagName, top: box.top, bottom: box.bottom, bodyTop: body.top, bodyBottom: body.bottom, footerTop: status.top, unobscured,
      hits: [box.top + 2, box.bottom - 2].map(y => ({ tag: document.elementFromPoint(box.left + Math.min(8, box.width / 2), y)?.tagName, class: document.elementFromPoint(box.left + Math.min(8, box.width / 2), y)?.className })) };
  }).then(value => { last = value; return value; })).toMatchObject({ visible: true });
  } catch { throw new Error(`Review visibility: ${JSON.stringify(last)}`); }
}

async function captureReviewArguments(page: Page, path: string) {
  const body = page.locator(".workbench-react__server-body");
  const message = page.locator(".workbench-react__server-review > pre");
  await message.focus();
  // Physical wheel input proves the existing Review scroll owner exposes the
  // exact call before a human returns to its approval action.
  await waitForVisualReadiness(page, ".workbench-react");
  await body.evaluate(element => {
    // Chromium can reach the top before its compositor wheel animation ends.
    // Finish that human input before focusing the approval control; otherwise
    // residual wheel motion scrolls its newly expanded confirmation away.
    (element as HTMLElement & { wheelSettled?: Promise<void> }).wheelSettled = new Promise(resolve => {
      const complete = () => { clearTimeout(fallback); element.removeEventListener("scrollend", complete); resolve(); };
      const fallback = setTimeout(complete, 1000); // No scrollend when already at the upper boundary.
      element.addEventListener("scrollend", complete, { once: true });
    });
  });
  await body.hover(); await page.mouse.wheel(0, -2000);
  await body.evaluate(element => (element as HTMLElement & { wheelSettled?: Promise<void> }).wheelSettled);
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(0);
  await entirelyInReviewBody(message);
  await expect(page.getByRole("heading", { name: "Review exact sendMessage call", exact: true })).toBeVisible();
  await expect(message).not.toBeEmpty();
  await expect(page.locator(".workbench-react__server-review dl")).toContainText("Sequence");
  await warmVisualRenderer(page, ".workbench-react");
  await page.screenshot({ path });
}

async function pixelDiff(page: Page, directory: string, baseName: string, changedName: string, diffName: string) {
  const basePng = (await readFile(resolve(directory, `${baseName}.png`))).toString("base64");
  const changedPng = (await readFile(resolve(directory, `${changedName}.png`))).toString("base64");
  const diffPng = await page.evaluate(async ({ basePng, changedPng }) => {
    const load = async (png: string) => { const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode(); return image; };
    const [base, changed] = await Promise.all([load(basePng), load(changedPng)]);
    const canvas = document.createElement("canvas"); canvas.width = base.width; canvas.height = base.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(base, 0, 0); const before = context.getImageData(0, 0, canvas.width, canvas.height);
    context.drawImage(changed, 0, 0); const after = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let offset = 0; offset < after.data.length; offset += 4) {
      for (let channel = 0; channel < 3; channel++) after.data[offset + channel] = Math.abs(after.data[offset + channel]! - before.data[offset + channel]!) * 3;
      after.data[offset + 3] = 255;
    }
    context.putImageData(after, 0, 0); return canvas.toDataURL("image/png").split(",")[1]!;
  }, { basePng, changedPng });
  await writeFile(resolve(directory, `${diffName}.png`), Buffer.from(diffPng, "base64"));
}
