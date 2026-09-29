import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { expect, test } from "@playwright/test";

const outputRoot = resolve(import.meta.dirname, "../../site-dist");
const origin = "https://imom39a.github.io";
const basePath = "/lightstreamer-workbench-extension/";

test("published-origin privacy control stops and resumes website analytics", async ({ page }) => {
  const googleRequests: string[] = [];
  await page.setViewportSize({ width: 390, height: 844 });

  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && url.pathname.startsWith(basePath)) {
      const relative = url.pathname.slice(basePath.length);
      const output = relative.endsWith("/") || !relative ? `${relative}index.html` : relative;
      const file = resolve(outputRoot, output);
      const body = await readFile(file);
      const type = extname(file) === ".js" ? "text/javascript" :
        extname(file) === ".css" ? "text/css" :
        extname(file) === ".svg" ? "image/svg+xml" :
        extname(file) === ".png" ? "image/png" : "text/html";
      await route.fulfill({ status: 200, body, contentType: type });
      return;
    }
    if (url.hostname === "www.googletagmanager.com" || url.hostname === "www.google-analytics.com" || url.hostname.endsWith(".google-analytics.com")) {
      googleRequests.push(url.href);
      await route.fulfill({ status: 200, body: "", contentType: "text/javascript" });
      return;
    }
    await route.abort();
  });

  await page.goto(`${origin}${basePath}privacy/?token=private#website-analytics`);
  const toggle = page.getByRole("button", { name: "Turn off website analytics" });
  await expect(toggle).toBeVisible();
  await expect(page.locator("[data-site-analytics-status]")).toHaveText("Website analytics is on in this browser.");
  await expect.poll(() => googleRequests.filter((url) => url.includes("googletagmanager.com/gtag/js")).length).toBe(1);
  if (process.env.LSEW_SITE_QA_SCREENSHOT) {
    await toggle.scrollIntoViewIfNeeded();
    await page.screenshot({ path: process.env.LSEW_SITE_QA_SCREENSHOT });
  }

  await page.evaluate(() => { document.cookie = "lsew_site_ga=example; Path=/lightstreamer-workbench-extension/"; });
  await toggle.click();
  await expect(page.getByRole("button", { name: "Turn on website analytics" })).toBeVisible();
  await expect(page.locator("[data-site-analytics-status]")).toHaveText("Website analytics is off in this browser.");
  expect(await page.evaluate(() => document.cookie)).not.toContain("lsew_site_ga");

  await page.reload();
  await expect(page.getByRole("button", { name: "Turn on website analytics" })).toBeVisible();
  expect(googleRequests.filter((url) => url.includes("googletagmanager.com/gtag/js"))).toHaveLength(1);
  await page.getByRole("button", { name: "Turn on website analytics" }).click();
  await expect(page.getByRole("button", { name: "Turn off website analytics" })).toBeVisible();
  await expect.poll(() => googleRequests.filter((url) => url.includes("googletagmanager.com/gtag/js")).length).toBe(2);
});
