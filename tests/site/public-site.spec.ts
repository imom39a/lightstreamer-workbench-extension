import axe from "axe-core";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const routes = [
  "",
  "docs/",
  "docs/getting-started/",
  "docs/workspace/",
  "docs/evidence/",
  "docs/command-state/",
  "docs/local-injection/",
  "docs/export-and-privacy/",
  "docs/troubleshooting/",
  "docs/faq/",
  "privacy/",
  "security/",
  "support/",
  "releases/",
  "roadmap/"
] as const;

const browserDiagnostics = new WeakMap<Page, string[]>();

declare global {
  interface Window { axe: typeof axe; }
}

test.beforeEach(async ({ page }) => {
  const diagnostics: string[] = [];
  browserDiagnostics.set(page, diagnostics);
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      diagnostics.push(`[console:${message.type()}] ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`[pageerror] ${error.message}`));
});

test.afterEach(async ({ page }, testInfo) => {
  const diagnostics = browserDiagnostics.get(page) ?? [];
  await testInfo.attach("browser-diagnostics.log", {
    body: diagnostics.join("\n"),
    contentType: "text/plain"
  });
  expect(diagnostics, diagnostics.join("\n")).toEqual([]);
});

test("every stable public route is isolated, canonical, and navigable", async ({ page }) => {
  for (const route of routes) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expect(page.locator("h1"), route).toHaveCount(1);
    await expect(page.locator("header.site-header"), route).toBeVisible();
    await expect(page.locator("footer.site-footer"), route).toBeVisible();
    await expect(page.locator('link[rel="canonical"]'), route).toHaveAttribute(
      "href",
      new RegExp(`^https://imom39a\\.github\\.io/lightstreamer-workbench-extension/${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
    );
    await expect(page.locator("script"), route).toHaveCount(0);
    await expect(page.locator('a[href*="/blob/main/PRIVACY.md"], a[href*="/blob/main/SECURITY.md"], a[href*="/blob/main/README.md"], a[href*="/blob/main/RELEASE.md"]'), route).toHaveCount(0);
    await expect(page.locator("body"), route).not.toContainText(/coming soon|prelaunch|preview documentation|0\.1\.5/i);
  }
});

test("desktop home tells the unified 2.0 story without overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("");

  await expect(page.getByRole("heading", { name: "Debug Lightstreamer where it runs." })).toBeVisible();
  await expect(page.getByText("Workbench 2.0 is available.")).toBeVisible();
  await expect(page.getByRole("img", { name: /Runtime Scope, Ordered Evidence/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Scope, Evidence, and Context stay together." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Client Messages and Server Injection" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Read the 2.0 docs" })).toHaveAttribute(
    "href",
    "/lightstreamer-workbench-extension/docs/"
  );
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScreenshot(page, testInfo, "desktop-home");
});

test("mobile home and documentation keep navigation and calls to action usable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("");

  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add Workbench 2.0" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Debug Lightstreamer where it runs." })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("link", { name: "Docs", exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/$/);
  await expect(page.getByRole("heading", { name: "Documentation" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Documentation" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScreenshot(page, testInfo, "mobile-docs");
});

test("customer policy and support routes stay first-party", async ({ page }) => {
  await page.goto("support/");
  await expect(page.getByRole("heading", { name: "Support" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Security policy" })).toHaveAttribute(
    "href",
    "/lightstreamer-workbench-extension/security/"
  );

  await page.goto("privacy/");
  await expect(page.getByRole("heading", { name: "Privacy policy" })).toBeVisible();
  await expect(page.getByText("Current Chrome Web Store release:")).toBeVisible();
  await expect(page.getByText("Public website:")).toBeVisible();
  await expect(page.locator('a[href*="PRIVACY.md"], a[href*="SECURITY.md"]')).toHaveCount(0);
});

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectNoSeriousAxeViolations(page: Page, testInfo: TestInfo): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, { resultTypes: ["violations"] });
    return result.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.map((node) => node.html)
      }));
  });
  await testInfo.attach("axe-violations.json", {
    body: JSON.stringify(violations, null, 2),
    contentType: "application/json"
  });
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(`${name}.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png"
  });
}
