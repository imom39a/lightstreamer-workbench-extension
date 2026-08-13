import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createPlaywrightLaunchOptions } from "../scripts/chrome-launch-args.mjs";

const projectRoot = process.cwd();
const configSources = [
  readFileSync(join(projectRoot, "playwright.config.ts"), "utf8"),
  readFileSync(join(projectRoot, "playwright.site.config.ts"), "utf8")
];

const REQUIRED_FLAGS = [
  "--use-mock-keychain",
  "--password-store=basic",
  "--disable-sync",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-signin-promo"
];

function expectUnattendedLaunch(options: { args?: string[]; executablePath?: string }): void {
  expect(options.args).toEqual(expect.arrayContaining(REQUIRED_FLAGS));
  expect(options.args?.some((argument) => argument.startsWith("--disable-features=") && argument.includes("PasswordManagerOnboarding"))).toBe(true);
  expect(options.args?.some((argument) => argument.startsWith("--disable-features=") && argument.includes("ProfilePickerOnboarding"))).toBe(true);
  expect(options.args?.some((argument) => argument.startsWith("--user-data-dir="))).toBe(false);
  expect(options).not.toHaveProperty("userDataDir");
}

describe("Playwright unattended Chrome launch policy", () => {
  it("keeps the central flags and Playwright-owned fresh profile when no executable resolves", () => {
    expectUnattendedLaunch(createPlaywrightLaunchOptions(undefined));
  });

  it("keeps the same policy when an explicit executable is selected", () => {
    const panel = createPlaywrightLaunchOptions("/explicit/chrome");
    const site = createPlaywrightLaunchOptions("/explicit/chrome");
    expectUnattendedLaunch(panel);
    expectUnattendedLaunch(site);
    expect(panel.executablePath).toBe("/explicit/chrome");
    expect(site.executablePath).toBe("/explicit/chrome");
  });

  it("installs launch options in both shipped configs", () => {
    for (const source of configSources) {
      expect(source).toContain("launchOptions: createPlaywrightLaunchOptions(chromeExecutable)");
      expect(source).not.toMatch(/\.\.\.\(chromeExecutable\s*\?/u);
      expect(source).toContain("Playwright owns the fresh temporary profile");
      expect(source).not.toContain("--user-data-dir=");
    }
  });
});
