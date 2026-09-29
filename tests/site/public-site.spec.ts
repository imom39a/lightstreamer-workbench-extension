import axe from "axe-core";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const routes = [
  "",
  "docs/",
  "docs/developer-guide/",
  "docs/getting-started/",
  "docs/agent-access/",
  "docs/workspace/",
  "docs/evidence/",
  "docs/command-state/",
  "docs/local-injection/",
  "docs/server-injection/",
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
    await expect(page.locator("script[src]"), route).toHaveCount(1);
    await expect(page.locator("script[src]")).toHaveAttribute("src", "/lightstreamer-workbench-extension/assets/site-analytics.js");
    await expect(page.locator('a[href*="/blob/main/PRIVACY.md"], a[href*="/blob/main/SECURITY.md"], a[href*="/blob/main/README.md"], a[href*="/blob/main/RELEASE.md"]'), route).toHaveCount(0);
    await expect(page.locator("body"), route).not.toContainText(/coming soon|prelaunch|preview documentation|0\.1\.5/i);
  }
});

test("desktop home is a documentation overview with real task routes", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("");

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Lightstreamer Workbench", exact: true })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Start with a live page" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Read the workspace" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Choose a task" })).toBeVisible();
  await expect(main.getByRole("img", { name: /Runtime Scope.*Ordered Evidence.*Context/ })).toBeVisible();
  await expect(main.locator("figcaption")).toContainText("Runtime Scope");
  await expect(main.locator("figcaption")).toContainText("Ordered Evidence");
  await expect(main.locator("figcaption")).toContainText("Context");
  expect((await main.innerText()).trim().split(/\s+/).length).toBeLessThanOrEqual(250);
  await expect(main.getByRole("img")).toHaveCount(1);
  await expect(main.getByRole("link", { name: /Install Workbench from the Chrome Web Store/ })).toHaveCount(1);
  await expect(main.locator('.a-task-list a[href="/lightstreamer-workbench-extension/docs/developer-guide/"]')).toContainText("Inspect activity");
  await expect(main.locator('.a-task-list a[href="/lightstreamer-workbench-extension/docs/local-injection/"]')).toContainText("Test an Item Update");
  await expect(main.locator('.a-task-list a[href="/lightstreamer-workbench-extension/docs/server-injection/"]')).toContainText("Send a Client Message");
  await expect(main.locator('.a-task-list a[href="/lightstreamer-workbench-extension/docs/agent-access/"]')).toContainText("Connect an agent");
  await expect(main).not.toContainText("Debug Lightstreamer in Chrome DevTools.");
  await expect(page.getByRole("navigation", { name: "Guides" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScreenshot(page, testInfo, "desktop-home");
});

test("mobile home opens the guide navigation and keeps the article readable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("");

  await expect(page.getByRole("heading", { name: "Lightstreamer Workbench", exact: true })).toBeVisible();
  await expect(page.getByText("Browse documentation")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByText("Browse documentation").click();
  const mobileNavigation = page.getByRole("navigation", { name: "Mobile documentation navigation" });
  await expect(mobileNavigation).toBeVisible();
  await mobileNavigation.getByRole("link", { name: "Inspect activity", exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/developer-guide\/$/);
  await expect(page.getByRole("heading", { name: "Inspect activity", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Keyboard essentials" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScreenshot(page, testInfo, "mobile-docs");
});

test("Inspect activity is a procedure with keyboard help", async ({ page }) => {
  await page.goto("docs/developer-guide/");
  await expect(page.getByRole("heading", { name: "Inspect Lightstreamer activity" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Keyboard essentials" })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("Choose a task");
  expect((await page.locator(".article-content").innerText()).trim().split(/\s+/).length).toBeLessThanOrEqual(300);
  await expectNoHorizontalOverflow(page);
});

test("documentation directory links to all task procedures", async ({ page }) => {
  await page.goto("docs/");
  const main = page.getByRole("main");
  for (const route of ["getting-started", "developer-guide", "local-injection", "server-injection", "agent-access", "evidence", "command-state", "troubleshooting"]) {
    await expect(main.locator(`a[href="/lightstreamer-workbench-extension/docs/${route}/"]`)).toHaveCount(1);
  }
  await expectNoHorizontalOverflow(page);
});

test("Agent access gives one current cross-platform setup and a concise trust boundary", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("docs/agent-access/");
  await expect(page.getByRole("heading", { name: "Agent access" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Set up MCP" })).toBeVisible();
  await expect(page.getByText("npx --yes lightstreamer-workbench-agent@latest setup", { exact: true })).toBeVisible();
  await expect(page.getByText("npx.cmd --yes lightstreamer-workbench-agent@latest setup", { exact: true })).toBeVisible();
  await expect(page.getByText("skills/lightstreamer-workbench/SKILL.md")).toBeVisible();
  const article = page.locator(".article-content");
  await expect(article).toContainText("Authentication is off");
  await expect(article).toContainText("Do not repeat an Injection with an unknown result");
  await expect(article).not.toContainText(/until.*publish|after.*publication|not.*published|not available from the npm registry/i);
  expect((await article.innerText()).trim().split(/\s+/).length).toBeLessThanOrEqual(750);
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScreenshot(page, testInfo, "agent-access-desktop");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Agent access" })).toBeVisible();
  const commandBlock = page.locator("pre").first();
  await commandBlock.focus();
  await expect(commandBlock).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => commandBlock.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxeViolations(page, testInfo);
  await attachScreenshot(page, testInfo, "agent-access-mobile");
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
  await expect(page.getByText("Chrome Web Store builds:")).toBeVisible();
  await expect(page.getByText("Public website:")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Website analytics" })).toBeVisible();
  await expect(page.locator("[data-site-analytics-toggle]")).toBeHidden();
  await expect(page.locator("[data-site-analytics-status]")).toHaveText("Website analytics runs only on the published site.");
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
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const viewportHeight = page.viewportSize()?.height ?? 900;
  for (let offset = 0; offset < pageHeight; offset += Math.max(320, viewportHeight - 120)) {
    await page.evaluate((top) => window.scrollTo({ top }), offset);
    await page.waitForTimeout(40);
  }
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.waitForFunction(() =>
    [...document.images].every((candidate) => candidate.complete && candidate.naturalWidth > 0)
  );
  await testInfo.attach(`${name}.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png"
  });
}
