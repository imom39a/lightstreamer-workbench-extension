import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";

async function openInstructions(page: Page) {
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  const summary = page.locator("summary").filter({ hasText: "Agent setup instructions" });
  await summary.focus(); await page.keyboard.press("Enter");
  return summary.locator("..");
}

async function accessible(page: Page) {
  await page.addScriptTag({ content: axe.source });
  expect(await page.evaluate(async () => (await window.axe.run()).violations.filter(entry => ["serious", "critical"].includes(entry.impact ?? "")))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [700, 800, 846]) {
  test(`Header controls remain reachable at dock transition width ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/?scenario=live-selected&agent=ready");
    await expect(page.getByRole("button", { name: "Agent access On", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`agent-transition-${width}.png`) });
    expect(await page.locator(".workbench-react__operating").evaluate(header => [...header.querySelectorAll("button, strong, span")].filter(element => !element.closest("button:disabled")).every(element => {
      const b = element.getBoundingClientRect();
      return b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight &&
        [b.left + 2, b.left + b.width / 2, b.right - 2].every(x => element.contains(document.elementFromPoint(x, b.top + b.height / 2)));
    }))).toBe(true);
    const toggle = page.getByRole("button", { name: "Agent access On", exact: true });
    await toggle.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Agent access Off", exact: true })).toBeFocused();
  });
}

for (const [name, width, height] of [["compact", 563, 700], ["normal", 900, 700], ["shallow", 900, 320], ["wide", 1440, 900]] as const) {
  for (const theme of ["dark", "light"] as const) {
    test(`Automatic agent header: ${name} ${theme}`, async ({ page }, info) => {
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      await page.setViewportSize({ width, height }); await page.emulateMedia({ colorScheme: theme });
      await page.goto(`/?scenario=live-selected&theme=${theme}&agent=ready`);
      await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
      const toggle = page.getByRole("button", { name: "Agent access On", exact: true });
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "Connect agent", exact: true })).toHaveCount(0);
      const header = page.locator(".workbench-react__operating");
      expect(await header.evaluate(element => {
        const view = element.querySelector(".workbench-react__operating-view")!;
        const toggle = element.querySelector(".workbench-react__agent-access")!;
        const a = view.getBoundingClientRect(), b = toggle.getBoundingClientRect();
        return view.nextElementSibling === toggle && b.left >= a.right && b.right <= innerWidth && Math.abs(a.top + a.height / 2 - b.top - b.height / 2) < 2;
      })).toBe(true);
      await toggle.focus();
      expect(await toggle.evaluate(element => { const b = element.getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) === element; })).toBe(true);
      await page.screenshot({ path: info.outputPath(`agent-${name}-${theme}-header.png`) });
      await page.keyboard.press("Enter");
      const off = page.getByRole("button", { name: "Agent access Off", exact: true });
      await expect(off).toHaveAttribute("aria-pressed", "false"); await expect(off).toBeFocused();
      await page.keyboard.press("Space"); await expect(toggle).toBeFocused();
      const instructions = await openInstructions(page);
      await expect(instructions.getByRole("status")).toContainText("inspection and Local Injection allowed");
      await expect(instructions.getByRole("combobox")).toHaveCount(0);
      await expect(instructions.getByText("Advanced connection settings", { exact: true })).toBeVisible();
      await expect(instructions).toContainText("Any local process can inspect or inject");
      await page.screenshot({ path: info.outputPath(`agent-${name}-${theme}-instructions.png`) });
      await accessible(page);
      await page.getByRole("button", { name: "Back to prior investigation" }).click();
      await page.emulateMedia({ forcedColors: "active" });
      await toggle.focus(); await page.keyboard.press("Enter");
      await expect(off).toBeFocused();
      await page.screenshot({ path: info.outputPath(`agent-${name}-${theme}-forced.png`) });
      expect(errors).toEqual([]);
    });

    test(`Optional authenticated settings: ${name} ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height }); await page.emulateMedia({ colorScheme: theme });
      await page.goto(`/?scenario=live-selected&theme=${theme}&agent=ready`);
      const access = await openInstructions(page);
      await access.locator("summary").filter({ hasText: "Advanced connection settings" }).click();
      await access.getByLabel("Require authentication").check();
      await access.getByRole("combobox", { name: "Agent permissions" }).selectOption("read");
      const apply = access.getByRole("button", { name: "Apply connection settings" });
      await apply.focus(); await page.keyboard.press("Enter");
      await expect(access.getByLabel("Connection comparison code")).toHaveText("1234 5678");
      const approve = access.getByRole("button", { name: "Approve connection", exact: true });
      await expect(approve).toBeFocused();
      expect(await approve.evaluate(element => { const b = element.getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.bottom - 1) === element; })).toBe(true);
      await page.screenshot({ path: info.outputPath(`agent-${name}-${theme}-approve.png`) });
      await page.keyboard.press("Tab"); await expect(access.getByRole("button", { name: "Cancel connection" })).toBeFocused();
      await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Enter");
      await expect(access.getByRole("button", { name: "Waiting for agent" })).toBeDisabled();
      await expect(access.getByRole("status")).toContainText("inspection only");
      await expect(apply).toBeFocused();
      await accessible(page);
      await page.getByRole("button", { name: "Back to prior investigation" }).click();
      const restored = await openInstructions(page);
      await restored.locator("summary").filter({ hasText: "Advanced connection settings" }).click();
      await expect(restored.getByLabel("Require authentication")).toBeChecked();
      await expect(restored.getByRole("combobox", { name: "Agent permissions" })).toHaveValue("read");
      await page.getByRole("button", { name: "Agent access On", exact: true }).click();
      await expect(page.getByRole("button", { name: "Agent access Off", exact: true })).toBeVisible();
    });
  }
}

test("Missing companion waits automatically and the header can turn retries off", async ({ page }, info) => {
  await page.goto("/?scenario=live-selected&agent=error");
  await expect(page.getByRole("button", { name: "Agent access On", exact: true })).toBeVisible();
  const access = await openInstructions(page);
  await expect(access.getByRole("status")).toContainText("Connection retries automatically");
  await page.screenshot({ path: info.outputPath("agent-waiting.png") });
  await page.getByRole("button", { name: "Agent access On", exact: true }).click();
  await expect(access.getByRole("status")).toContainText("Agent access is off");
});

test("Cancelling optional authentication leaves access off", async ({ page }) => {
  await page.goto("/?scenario=live-selected&agent=ready");
  const access = await openInstructions(page);
  await access.locator("summary").filter({ hasText: "Advanced connection settings" }).click();
  await access.getByLabel("Require authentication").check();
  await access.getByRole("button", { name: "Apply connection settings" }).click();
  await access.getByRole("button", { name: "Cancel connection" }).click();
  await expect(page.getByRole("button", { name: "Agent access Off", exact: true })).toBeVisible();
  await expect(access.getByLabel("Connection comparison code")).toHaveCount(0);
});

test("Advanced native and port settings survive reopening instructions", async ({ page }) => {
  await page.goto("/?scenario=live-selected&agent=ready");
  for (const transport of ["portable", "native"]) {
    const access = await openInstructions(page);
    await access.locator("summary").filter({ hasText: "Advanced connection settings" }).click();
    await access.getByRole("combobox", { name: "Agent transport" }).selectOption(transport);
    if (transport === "portable") await access.getByLabel("Companion port").fill("24818");
    await access.getByRole("button", { name: "Apply connection settings" }).click();
    await expect(access.getByRole("status")).toContainText("Connected");
    await page.getByRole("button", { name: "Back to prior investigation" }).click();
    const restored = await openInstructions(page);
    await restored.locator("summary").filter({ hasText: "Advanced connection settings" }).click();
    await expect(restored.getByRole("combobox", { name: "Agent transport" })).toHaveValue(transport);
    if (transport === "portable") await expect(restored.getByLabel("Companion port")).toHaveValue("24818");
    await page.getByRole("button", { name: "Back to prior investigation" }).click();
  }
});
