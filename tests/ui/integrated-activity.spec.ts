import { mkdirSync } from "node:fs";

import axe from "axe-core";
import { expect, test, type Page } from "@playwright/test";

const evidenceRoot =
  process.env.LSEW_INTEGRATED_ACTIVITY_EVIDENCE_DIR ??
  "test-results/integrated-activity-qa/slice-02";

type ActivityOpenOptions = Readonly<{
  viewport?: { width: number; height: number };
  theme?: "dark" | "light";
  forcedColors?: "active" | "none";
  scenario?: string;
  settledElapsed?: string;
}>;

async function openIntegratedActivity(
  page: Page,
  {
    viewport = { width: 900, height: 700 },
    theme = "light",
    forcedColors,
    scenario = "integrated-activity-main",
    settledElapsed = "+97.001s",
  }: ActivityOpenOptions = {},
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({
    colorScheme: theme,
    ...(forcedColors ? { forcedColors } : {}),
  });
  await page.goto(`/?scenario=${scenario}&theme=${theme}`);
  await expect(page.locator("html")).toHaveAttribute(
    "data-react-scene-ready",
    "true",
  );
  await expect(
    page
      .locator('[aria-label="Activity timeline"]')
      .locator('[aria-label="Elapsed time since first retained event"]')
      .last(),
  ).toContainText(settledElapsed);
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

async function preserveActivityScreenshot(
  page: Page,
  name: string,
): Promise<void> {
  mkdirSync(evidenceRoot, { recursive: true });
  await page.locator(".workbench-react").screenshot({
    path: `${evidenceRoot}/${name}`,
    animations: "disabled",
    caret: "hide",
  });
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

test("Activity compact single Snapshot caption trigger applies SERVER, SNAPSHOT, and its exact range", async ({
  page,
}) => {
  await openIntegratedActivity(page, {
    viewport: { width: 563, height: 700 },
    scenario: "integrated-activity-single-snapshot",
    settledElapsed: "+99.001s",
  });

  const evidence = page.getByRole("region", { name: "Ordered Evidence" });
  const timeline = page.locator('[aria-label="Activity timeline"]');
  await expect(timeline).toContainText("1 snapshot updates");
  await timeline
    .getByRole("button", { name: /^Show snapshot burst .+ in Evidence$/ })
    .click();

  await expect(evidence).toContainText(/Before range\s*1/);
  await expect(evidence).toContainText(/In range\s*1/);
  await expect(
    page.getByText(
      /Filter:.*phase:\s*SNAPSHOT.*provenance:\s*SERVER.*Range \+0\.0s–\+0\.001s/i,
    ),
  ).toBeVisible();
  await expect(
    timeline.getByText("Range +0.0s–+0.001s", { exact: true }),
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
  await expect(evidence).toContainText(/Before range\s*1,714/);
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

  await expect(evidence).toContainText(/Before range\s*1,714/);
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
      range.getByRole("button", {
        name: /^Select LOCAL Item Update at .*; Evidence activity-main-local-1$/,
      }),
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
  await preserveActivityScreenshot(
    page,
    "shallow-forced-colors-dark.png",
  );
});

test("Activity source marker selects the original Local Evidence in Context", async ({
  page,
}) => {
  await openIntegratedActivity(page, { theme: "dark" });

  await page
    .getByRole("button", {
      name: /^Select LOCAL Item Update at .*; Evidence activity-main-local-1$/,
    })
    .click();

  await expect(
    page.getByRole("heading", {
      name: "activity-main-local-1 · Item Update",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Context" }),
  ).toBeVisible();
  await expect(
    page.locator('[data-evidence-id="activity-main-local-1"]'),
  ).toHaveAttribute("aria-selected", "true");
  await preserveActivityScreenshot(page, "normal-dark-local-source-context.png");
});

test("Activity compact Local source selection keeps Context closed", async ({
  page,
}) => {
  await openIntegratedActivity(page, {
    viewport: { width: 563, height: 700 },
  });

  await page
    .getByRole("button", {
      name: /^Select LOCAL Item Update at .*; Evidence activity-main-local-1$/,
    })
    .click();
  await expect(
    page.locator('[data-evidence-id="activity-main-local-1"]'),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("complementary", { name: "Context" }),
  ).toHaveCount(0);
});

test("Activity coincident markers expose each captured diagnostic through the pointer chooser", async ({
  page,
}) => {
  await openIntegratedActivity(page, {
    viewport: { width: 563, height: 700 },
  });

  const collision = page
    .getByRole("toolbar", { name: "Captured Activity events" })
    .getByRole("button", {
      name: /^\d+ captured Activity events; choose Evidence$/,
    })
    .last();
  await collision.click();

  const chooser = page.getByRole("dialog", {
    name: "Choose captured Activity event",
  });
  await expect(chooser).toBeVisible();
  await preserveActivityScreenshot(page, "compact-light-collision-chooser.png");
  await chooser
    .getByRole("button", {
      name: /^Inspect SERVER Lost updates at .*; Evidence activity-main-lost-updates$/,
    })
    .click();

  await expect(
    page.locator('[data-evidence-id="activity-main-lost-updates"]'),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: /lost updates/i })).toBeVisible();
});

test("Activity compact Session inspection reveals the off-window Evidence row and restores its focus on Back", async ({
  page,
}) => {
  await openIntegratedActivity(page, {
    viewport: { width: 563, height: 700 },
  });

  await page
    .getByRole("toolbar", { name: "Captured Activity events" })
    .getByRole("button", {
      name: /^\d+ captured Activity events; choose Evidence$/,
    })
    .first()
    .click();
  await page
    .getByRole("dialog", { name: "Choose captured Activity event" })
    .getByRole("button", {
      name: /^Inspect SERVER Session transition at .*; Evidence activity-main-session-established$/,
    })
    .click();
  const selected = page.locator(
    '[data-evidence-id="activity-main-session-established"]',
  );
  await expect(selected).toHaveAttribute("aria-selected", "true");
  const context = page.getByRole("complementary", { name: "Context" });
  await expect(context).toBeVisible();
  await context.getByRole("button", { name: "Back to Evidence" }).click();
  await expect(selected).toBeVisible();
  await expect(selected).toBeFocused();
});

test("Activity collision chooser supports keyboard selection and Escape focus restoration", async ({
  page,
}) => {
  await openIntegratedActivity(page);

  const collision = page
    .getByRole("toolbar", { name: "Captured Activity events" })
    .getByRole("button", {
      name: /^\d+ captured Activity events; choose Evidence$/,
    })
    .last();
  await collision.focus();
  await page.keyboard.press("Enter");

  const chooser = page.getByRole("dialog", {
    name: "Choose captured Activity event",
  });
  await expect(chooser).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(chooser).toHaveCount(0);
  await expect(collision).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(
    chooser.getByRole("button", {
      name: /^Inspect SERVER Lost updates at .*; Evidence activity-main-lost-updates$/,
    }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    chooser.getByRole("button", {
      name: /^Inspect SERVER Subscription error at .*; Evidence activity-main-subscription-error$/,
    }),
  ).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(
    page.locator('[data-evidence-id="activity-main-subscription-error"]'),
  ).toHaveAttribute("aria-selected", "true");
});
