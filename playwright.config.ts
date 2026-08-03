import { constants } from "node:fs";
import { accessSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Browser, Cache } from "@puppeteer/browsers";
import { defineConfig } from "@playwright/test";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const selectedTheme = parseTheme(process.env.LSEW_UI_THEME ?? "auto");
const viewport = parseViewport(process.env.LSEW_UI_VIEWPORT ?? "1280x800");
const chromeExecutable = resolveChromeExecutable();

export default defineConfig({
  testDir: "./tests/ui",
  testMatch: /\.spec\.ts$/,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide"
    }
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  outputDir: "test-results/ui",
  snapshotPathTemplate: "{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}",
  updateSnapshots: process.env.LSEW_UI_UPDATE === "1" ? "all" : "none",
  reporter: [["list"], ["html", { outputFolder: "test-results/ui-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    colorScheme: selectedTheme === "auto" ? null : selectedTheme,
    headless: process.env.LSEW_UI_HEADLESS !== "false",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    viewport,
    ...(chromeExecutable
      ? { launchOptions: { executablePath: chromeExecutable } }
      : {})
  },
  webServer: {
    command: "node scripts/ui-panel-server.mjs",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});

function parseTheme(value: string): "auto" | "dark" | "light" {
  if (value === "auto" || value === "dark" || value === "light") {
    return value;
  }
  throw new Error(`Unsupported UI theme ${JSON.stringify(value)}. Use auto, dark, or light.`);
}

function parseViewport(value: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/.exec(value);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!match || width < 320 || height < 240) {
    throw new Error(`Unsupported UI viewport ${JSON.stringify(value)}. Use WIDTHxHEIGHT.`);
  }
  return { width, height };
}

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
