import { constants } from "node:fs";
import { accessSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const chromeExecutable = [
  process.env.CHROME_PATH?.trim(),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
].find((candidate): candidate is string => {
  if (!candidate) return false;
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
});

export default defineConfig({
  testDir: ".",
  testMatch: "react-diagnose.spec.ts",
  timeout: 30_000,
  workers: 1,
  outputDir: "../../test-results/react-diagnose",
  reporter: [["list"], ["html", { outputFolder: "../../test-results/react-diagnose-report", open: "never" }]],
  use: {
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    timezoneId: "America/New_York",
    deviceScaleFactor: 1,
    ...(chromeExecutable ? { launchOptions: { executablePath: chromeExecutable } } : {})
  },
  webServer: {
    command: "node ../../scripts/react-ui-panel-server.mjs",
    url: "http://127.0.0.1:4180/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
