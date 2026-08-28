import axe from "axe-core";
import { expect, test, type Page } from "@playwright/test";

type ActivityOpenOptions = Readonly<{
  viewport?: { width: number; height: number };
  theme?: "dark" | "light";
  forcedColors?: "active" | "none";
}>;

async function openIntegratedActivity(
  page: Page,
  {
    viewport = { width: 900, height: 700 },
    theme = "light",
    forcedColors,
  }: ActivityOpenOptions = {},
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({
    colorScheme: theme,
    ...(forcedColors ? { forcedColors } : {}),
  });
  await page.goto(`/?scenario=integrated-activity-main&theme=${theme}`);
  await expect(page.locator("html")).toHaveAttribute(
    "data-react-scene-ready",
    "true",
  );
  await expect(
    page
      .locator('[aria-label="Activity timeline"]')
      .locator('[aria-label="Elapsed time since first retained event"]')
      .last(),
  ).toContainText("+97.001s");
  await expect(
    page.locator('[aria-label="Activity timeline"]'),
  ).toHaveAttribute("aria-busy", "false");
}

async function expectNoSeriousAxeViolations(page: Page): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      resultTypes: ["violations"],
    });
    return result.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    );
  });
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

async function expectShellFits(page: Page): Promise<void> {
  const dimensions = await page
    .locator(".workbench-react")
    .evaluate((shell) => ({
      clientWidth: shell.clientWidth,
      scrollWidth: shell.scrollWidth,
      documentWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
    }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(dimensions.documentScrollWidth).toBeLessThanOrEqual(
    dimensions.documentWidth,
  );
}

test("Activity snapshot burst applies the exact canonical phase and range Filter", async ({
  page,
}) => {
  await openIntegratedActivity(page);

  const evidence = page.getByRole("region", { name: "Ordered Evidence" });
  const timeline = page.locator('[aria-label="Activity timeline"]');
  await expect(timeline).toBeVisible();
  await expect(timeline.getByLabel("Update source legend")).toContainText(
    "SERVER",
  );
  await expect(timeline.getByLabel("Update source legend")).toContainText(
    "LOCAL",
  );

  await timeline
    .getByRole("button", { name: /^Show snapshot burst .+ in Evidence$/ })
    .click();

  await expect(evidence).toContainText(/Before range\s*1,696/);
  await expect(evidence).toContainText(/In range\s*1,696/);
  await expect(
    page.getByText(/Filter:.*phase.*SNAPSHOT/i).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reset Filter" }),
  ).toBeVisible();
});

test("Activity keyboard range previews, cancels, and applies the canonical Filter", async ({
  page,
}) => {
  await openIntegratedActivity(page);

  const evidence = page.getByRole("region", { name: "Ordered Evidence" });
  const timeline = page.locator('[aria-label="Activity timeline"]');
  const range = timeline.getByRole("group", {
    name: "Select Activity time range",
  });
  await range.focus();
  await page.keyboard.press("Home");
  await expect(timeline).toContainText("Preview +0.0s–+0.001s");

  await page.keyboard.press("Escape");
  await expect(timeline).toContainText("All retained time");
  await expect(page.getByRole("button", { name: "Reset Filter" })).toHaveCount(
    0,
  );

  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(evidence).toContainText(/Before range\s*1,713/);
  await expect(evidence).toContainText(/In range\s*1/);
  await expect(
    page.getByRole("button", { name: "Reset Filter" }),
  ).toBeVisible();
});

test("Activity pointer range applies a bounded live-Evidence Filter", async ({
  page,
}) => {
  await openIntegratedActivity(page);

  const evidence = page.getByRole("region", { name: "Ordered Evidence" });
  const range = page
    .locator('[aria-label="Activity timeline"]')
    .getByRole("group", { name: "Select Activity time range" });
  const box = await range.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width * 0.72, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.88, box!.y + box!.height / 2);
  await page.mouse.up();

  await expect(evidence).toContainText(/Before range\s*1,713/);
  await expect(evidence).toContainText(/In range\s*8/);
  await expect(
    page.getByRole("button", { name: "Reset Filter" }),
  ).toBeVisible();
});

test("Frozen Activity keeps the selected Evidence row focused through passive Capture", async ({
  page,
}) => {
  await openIntegratedActivity(page);

  const selected = page.locator(
    '[data-evidence-id="activity-main-live-server-1"]',
  );
  await selected.focus();
  await expect(selected).toBeFocused();
  await expect(selected).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Freeze Evidence" }).click();
  await expect(page.getByText("View FROZEN", { exact: true })).toBeVisible();
  const followLive = page.getByRole("button", { name: "Follow Live" });
  await expect(followLive).toBeFocused();
  expect(
    await page.evaluate(() => window.__appendDeferredWorkbenchEvents()),
  ).toBe(1);

  await expect(selected).toHaveAttribute("aria-selected", "true");
  await expect(followLive).toBeFocused();
});

test("Activity keeps one shared SERVER and LOCAL track at compact and wide geometry", async ({
  page,
}) => {
  for (const scene of [
    { viewport: { width: 563, height: 700 }, theme: "dark" as const },
    { viewport: { width: 1440, height: 900 }, theme: "light" as const },
  ]) {
    await openIntegratedActivity(page, scene);
    const evidence = page.getByRole("region", { name: "Ordered Evidence" });
    const timeline = page.locator('[aria-label="Activity timeline"]');
    const range = timeline.getByRole("group", {
      name: "Select Activity time range",
    });

    await expect(timeline.getByLabel("Update source legend")).toContainText(
      "SERVER",
    );
    await expect(timeline.getByLabel("Update source legend")).toContainText(
      "LOCAL",
    );
    await expect(
      range.getByRole("img", { name: /SERVER Logical Updates/ }).first(),
    ).toBeVisible();
    await expect(
      range.getByRole("img", { name: /LOCAL Logical Updates/ }).first(),
    ).toBeVisible();
    await expect(page.getByRole("table", { name: /epoch/i })).toHaveCount(0);
    await expectShellFits(page);
    await expect(evidence).toContainText("Ordered Evidence");
  }
});

test("Activity remains bounded, accessible, and selection-preserving in shallow forced colors", async ({
  page,
}, testInfo) => {
  await openIntegratedActivity(page, {
    viewport: { width: 900, height: 320 },
    theme: "dark",
    forcedColors: "active",
  });

  const timeline = page.locator('[aria-label="Activity timeline"]');
  const range = timeline.getByRole("group", {
    name: "Select Activity time range",
  });
  await range.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");

  await expect(
    page.locator('[data-evidence-id="activity-main-live-server-1"]'),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "Evidence activity-main-live-server-1 remains selected in Context.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(timeline).toContainText("SERVER");
  await expect(timeline).toContainText("LOCAL");
  await expect(page.getByRole("table", { name: /epoch/i })).toHaveCount(0);

  const dimensions = await page
    .locator(".workbench-react")
    .evaluate((shell) => ({
      clientWidth: shell.clientWidth,
      scrollWidth: shell.scrollWidth,
    }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  await expectNoSeriousAxeViolations(page);

  const screenshotPath = testInfo.outputPath(
    "integrated-activity-shallow-forced-dark.png",
  );
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach("integrated-activity-shallow-forced-dark.png", {
    path: screenshotPath,
    contentType: "image/png",
  });
});
