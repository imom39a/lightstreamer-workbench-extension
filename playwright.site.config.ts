import { constants } from "node:fs";
import { accessSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Browser, Cache } from "@puppeteer/browsers";
import { defineConfig } from "@playwright/test";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const chromeExecutable = resolveChromeExecutable();

export default defineConfig({
  testDir: "./tests/site",
  testMatch: "*.spec.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  outputDir: "test-results/site",
  reporter: [["list"], ["html", { outputFolder: "test-results/site-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4181/lightstreamer-workbench-extension/",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    timezoneId: "America/New_York",
    deviceScaleFactor: 1,
    ...(chromeExecutable ? { launchOptions: { executablePath: chromeExecutable } } : {})
  },
  webServer: {
    command: "npm run site:serve",
    url: "http://127.0.0.1:4181/lightstreamer-workbench-extension/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  }
});

function resolveChromeExecutable(): string | undefined {
  const configured = process.env.CHROME_PATH?.trim();
  const cacheDir =
    process.env.LSEW_BROWSER_CACHE_DIR?.trim() || join(projectRoot, ".cache", "lsew-browsers");
  const installed = new Cache(cacheDir)
    .getInstalledBrowsers()
    .filter((entry) => entry.browser === Browser.CHROME)
    .sort((left, right) => right.buildId.localeCompare(left.buildId, undefined, { numeric: true }))
    .map((entry) => entry.executablePath);
  const candidates = [
    configured,
    ...installed,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}
