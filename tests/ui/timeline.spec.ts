import { expect, test, type Page } from "@playwright/test";

async function waitForStream(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-stream-ready", "true");
}

async function openTimelineScenario(
  page: Page,
  scenario: "timeline-live" | "timeline-frozen",
  storage: "memory" | "indexeddb"
): Promise<void> {
  await page.goto(`/index.html?scenario=${scenario}&storage=${storage}`);
  await expect(page.locator("html")).toHaveAttribute("data-scene-ready", "true");
  await expect(page.locator(".event-row").first()).toBeVisible();
}

for (const storage of ["memory", "indexeddb"] as const) {
  test(`timeline-live follows a sustained ${storage} Capture stream`, async ({ page }) => {
    await openTimelineScenario(page, "timeline-live", storage);

    await page.locator(".search-input").fill("timeline-match");
    const sampledSequences = await page.evaluate(async () => {
      const values: string[] = [];
      const deadline = Date.now() + 1_500;
      while (Date.now() < deadline) {
        const sequence = document.documentElement.dataset.streamSequence;
        if (sequence && values.at(-1) !== sequence) {
          values.push(sequence);
        }
        if (document.documentElement.dataset.streamReady === "true") {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return values;
    });

    await waitForStream(page);
    expect(sampledSequences.length).toBeGreaterThanOrEqual(3);
    expect(await page.locator(".timeline-display-badge").textContent()).toBe("Live");
    expect(await page.locator(".event-row").count()).toBe(60);
    const renderedTimes = await page.locator(".event-time").evaluateAll((cells) =>
      cells.map((cell) => cell.textContent ?? "")
    );
    expect(renderedTimes).toEqual([...renderedTimes].sort());
    await expect(page.locator(".event-time").last()).toHaveText("18:40:00.189");
    await expect(page.locator(".event-item").last()).toHaveText("timeline-match");
  });

  test(`timeline-frozen preserves its historical ${storage} window and follows live`, async ({
    page
  }) => {
    await openTimelineScenario(page, "timeline-frozen", storage);

    await page.locator(".search-input").fill("timeline-match");
    await expect(page.locator(".event-row").first()).toBeVisible();
    await page.locator(".event-row").first().click();
    const frozenIds = await page.locator(".event-row").evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-event-id"))
    );
    await page.locator(".timeline-display-state button", { hasText: "Freeze view" }).click();

    await waitForStream(page);
    await expect(page.locator(".timeline-display-badge")).toHaveText("Frozen");
    const newerSummary = await page.locator(".timeline-display-summary").textContent();
    expect(newerSummary).toContain("60 newer");
    expect(
      await page.locator(".event-row").evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-event-id"))
      )
    ).toEqual(frozenIds);
    await expect(page.locator(".selected-event-id")).toHaveText(frozenIds[0] ?? "");

    await page.locator(".timeline-display-state button", { hasText: "Follow live" }).click();
    await expect(page.locator(".timeline-display-badge")).toHaveText("Live");
    await expect(page.locator(".timeline-display-summary")).not.toContainText("newer");
    await expect(page.locator(".event-item").last()).toHaveText("timeline-match");
  });
}
