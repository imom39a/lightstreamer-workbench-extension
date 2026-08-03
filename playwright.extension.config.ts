import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/extension-ui",
  testMatch: /\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  outputDir: "test-results/extension-ui",
  reporter: [
    ["list"],
    ["html", { outputFolder: "test-results/extension-ui-report", open: "never" }]
  ]
});
