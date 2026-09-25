import { expect, test } from "@playwright/test";
import axe from "axe-core";

for (const [name, width, height] of [["compact", 563, 700], ["normal", 900, 700], ["shallow", 900, 320], ["wide", 1440, 900]] as const) {
  for (const theme of ["dark", "light"] as const) {
    test(`Agent access is deliberate, reachable and revocable: ${name} ${theme}`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`/?scenario=live-selected&theme=${theme}&agent=ready`);
      await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
      await page.getByRole("button", { name: "More actions" }).click();
      const summary = page.locator("summary").filter({ hasText: "Agent access" });
      await summary.focus(); await page.keyboard.press("Enter");
      const access = summary.locator("..");
      await expect(access).toContainText("shared with your agent and its model provider");
      const permissions = access.getByRole("combobox", { name: "Agent permissions" });
      await expect(permissions).toHaveValue("read");
      const transport = access.getByRole("combobox", { name: "Agent connection" });
      await expect(transport).toHaveValue("portable");
      await expect(access.getByLabel("Companion pairing code")).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`agent-${name}-${theme}-off.png`) });
      await summary.focus();
      await page.keyboard.press("Tab"); await expect(transport).toBeFocused();
      await page.keyboard.press("Tab"); await expect(access.locator("summary").filter({ hasText: "Connection options" })).toBeFocused();
      await page.keyboard.press("Tab"); await expect(permissions).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(access.getByRole("button", { name: "Connect agent" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(access.getByLabel("Connection comparison code")).toHaveText("1234 5678");
      await expect(access.getByRole("status")).toContainText("No access");
      const approve = access.getByRole("button", { name: "Approve connection", exact: true });
      await expect(approve).toBeFocused();
      expect(await approve.evaluate(element => {
        const box = element.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width / 2, box.bottom - 1) === element;
      })).toBe(true);
      await page.screenshot({ path: info.outputPath(`agent-${name}-${theme}-approve.png`) });
      await page.keyboard.press("Tab"); await expect(access.getByRole("button", { name: "Cancel connection" })).toBeFocused();
      await page.keyboard.press("Shift+Tab"); await expect(approve).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(access.getByRole("button", { name: "Waiting for agent" })).toBeDisabled();
      await expect(access.getByRole("status")).toContainText("No access yet");
      await expect(access.getByRole("status")).toContainText("inspection only");
      await expect(permissions).toBeDisabled();
      await expect(transport).toBeDisabled();
      await access.getByRole("button", { name: "Disconnect agent" }).click();
      await permissions.selectOption("local");
      await access.getByRole("button", { name: "Connect agent" }).click();
      await access.getByRole("button", { name: "Approve connection", exact: true }).click();
      await expect(access.getByRole("status")).toContainText("Local Injection allowed");
      await access.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`agent-${name}-${theme}.png`) });
      await page.addScriptTag({ content: axe.source });
      const violations = await page.evaluate(async () => (await window.axe.run()).violations.filter(entry => ["serious", "critical"].includes(entry.impact ?? "")));
      expect(violations).toEqual([]);
      await page.emulateMedia({ forcedColors: "active" });
      const environment = await page.evaluate(() => ({ forcedColors: matchMedia("(forced-colors: active)").matches, lightEnvironment: matchMedia("(prefers-color-scheme: light)").matches, panelTheme: document.querySelector(".workbench-react")?.getAttribute("data-theme") }));
      expect(environment.forcedColors).toBe(true);
      await info.attach("agent-environment.json", { body: JSON.stringify(environment), contentType: "application/json" });
      await access.getByRole("button", { name: "Disconnect agent" }).focus();
      await page.keyboard.press("Enter");
      await expect(summary).toContainText("Off");
      await page.screenshot({ path: info.outputPath(`agent-${name}-${theme}-forced.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}

test("Missing companion keeps permission off and exposes recovery", async ({ page }, info) => {
  await page.goto("/?scenario=live-selected&agent=error");
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.locator("summary").filter({ hasText: "Agent access" }).click();
  await page.getByRole("button", { name: "Connect agent" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Companion unavailable" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Agent permissions" })).toBeEnabled();
  await page.screenshot({ path: info.outputPath("agent-error.png") });
});

test("Cancelling a displayed comparison code leaves access off", async ({ page }) => {
  await page.goto("/?scenario=live-selected&agent=ready");
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await page.getByRole("button", { name: "More actions" }).click();
  const summary = page.locator("summary").filter({ hasText: "Agent access" }); await summary.click();
  await page.getByRole("button", { name: "Connect agent" }).click();
  await expect(page.getByLabel("Connection comparison code")).toBeVisible();
  await page.getByRole("button", { name: "Cancel connection" }).click();
  await expect(summary).toContainText("Off");
  await expect(page.getByLabel("Connection comparison code")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect agent" })).toBeEnabled();
});

test("Native connection remains correctly identified after leaving and reopening Agent access", async ({ page }) => {
  await page.goto("/?scenario=live-selected&agent=ready");
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.locator("summary").filter({ hasText: "Agent access" }).click();
  await page.getByRole("combobox", { name: "Agent connection" }).selectOption("native");
  await page.getByRole("combobox", { name: "Agent permissions" }).selectOption("local");
  await expect(page.getByLabel("Companion pairing code")).toHaveCount(0);
  await page.getByRole("button", { name: "Connect agent" }).click();
  await page.getByRole("button", { name: "Back to prior investigation" }).click();
  await page.getByRole("button", { name: "More actions" }).click();
  const summary = page.locator("summary").filter({ hasText: "Agent access" });
  if (!await summary.locator("..").evaluate(element => element.hasAttribute("open"))) await summary.click();
  await expect(page.getByRole("combobox", { name: "Agent connection" })).toHaveValue("native");
  await expect(page.getByRole("combobox", { name: "Agent permissions" })).toHaveValue("local");
  await expect(page.getByLabel("Companion pairing code")).toHaveCount(0);
  await page.getByRole("button", { name: "Disconnect agent" }).click();
});
