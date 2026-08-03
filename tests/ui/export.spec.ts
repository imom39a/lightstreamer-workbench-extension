import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 563, height: 137 } });

test("export-open downloads privacy-safe JSON and an offline searchable HTML report", async ({
  page,
  context
}) => {
  await page.addInitScript(() => {
    const pageWindow = window as Window & { __lsewLastBlobType?: string };
    const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob) => {
      pageWindow.__lsewLastBlobType = blob.type;
      return originalCreateObjectUrl(blob);
    };
  });
  await page.goto("/index.html?scenario=export-open");
  await expect(page.locator("html")).toHaveAttribute("data-scene-ready", "true");

  const exportPanel = page.locator(".topology-export-panel");
  await expect(exportPanel).toBeVisible();
  const bounds = await exportPanel.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds) {
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(563);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(137);
  }

  await page.locator(".topology-export-advanced-toggle").click();
  await page
    .locator('.topology-export-categories input[data-category="item-names"]')
    .check();

  const jsonDownloadPromise = page.waitForEvent("download");
  await page.locator(".topology-export-json").click();
  const jsonDownload = await jsonDownloadPromise;
  const jsonContent = await readFile((await jsonDownload.path()) ?? "", "utf8");
  expect(
    await page.evaluate(
      () => (window as Window & { __lsewLastBlobType?: string }).__lsewLastBlobType
    )
  ).toBe("application/json");
  const json = JSON.parse(jsonContent) as {
    privacy: { credentialsExcluded: boolean; redactedCategories: string[] };
    diagnostics: readonly unknown[];
  };

  expect(jsonDownload.suggestedFilename()).toMatch(/\.json$/);
  expect(json.privacy).toMatchObject({
    credentialsExcluded: true,
    redactedCategories: ["item-names"]
  });
  expect(jsonContent).toContain("[REDACTED:item-names]");
  expect(jsonContent).not.toContain("topology-small-item");
  expect(jsonContent).not.toContain("user:password");
  expect(jsonContent).not.toContain("secret-token");
  expect(json.diagnostics).toEqual(expect.any(Array));

  const htmlDownloadPromise = page.waitForEvent("download");
  await page.locator(".topology-export-html").click();
  const htmlDownload = await htmlDownloadPromise;
  const htmlPath = (await htmlDownload.path()) ?? "";
  const htmlContent = await readFile(htmlPath, "utf8");
  expect(
    await page.evaluate(
      () => (window as Window & { __lsewLastBlobType?: string }).__lsewLastBlobType
    )
  ).toBe("text/html");
  expect(htmlDownload.suggestedFilename()).toMatch(/\.html$/);
  expect(htmlContent).toContain("Content-Security-Policy");
  expect(htmlContent).not.toMatch(/(?:src|href)=["']https?:/i);
  expect(htmlContent).not.toContain("user:password");
  expect(htmlContent).not.toContain("secret-token");

  const report = await context.newPage();
  await context.setOffline(true);
  await report.setContent(htmlContent, { waitUntil: "domcontentloaded" });
  await expect(report.locator("#topology-search")).toBeVisible();
  await expect(report.locator("#diagnostics-heading")).toContainText(
    `Diagnostics (${json.diagnostics.length})`
  );
  await report.locator("#topology-search").fill("topology-small-subscription");
  await expect(report.locator("#topology-tree")).toContainText("topology-small-subscription");
  const firstSection = report.locator("#topology-tree details").first();
  await firstSection.locator(":scope > summary").click();
  await expect(firstSection).not.toHaveAttribute("open");
  await report.close();
});
