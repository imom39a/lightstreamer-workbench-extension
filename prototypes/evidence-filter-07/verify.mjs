import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = new URL("./", import.meta.url);
const REVIEW = new URL("./review/", ROOT);
const APP_URL = "http://127.0.0.1:4181/evidence-filter-07/?frame=normal&theme=dark&scenario=primary";
const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEPENDENCY_ROOT = process.env.WORKBENCH_DEPENDENCY_ROOT ?? PACKAGE_ROOT;
const dependencyRequire = createRequire(join(DEPENDENCY_ROOT, "package.json"));
const playwrightModule = await import(pathToFileURL(dependencyRequire.resolve("@playwright/test")));
const chromium = playwrightModule.chromium ?? playwrightModule.default?.chromium;
const AXE = dependencyRequire.resolve("axe-core/axe.min.js");
const GEOMETRY = Object.freeze({ compact: [563, 700], normal: [900, 700], shallow: [900, 320], wide: [1440, 900] });

await mkdir(REVIEW, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.WORKBENCH_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.WORKBENCH_CHROMIUM_EXECUTABLE }
    : {})
});
const page = await browser.newPage({ viewport: { width: 1640, height: 1120 }, deviceScaleFactor: 1 });
const report = { checks: [], benchmarks: [], semanticEdgeProbes: null, axe: [], screenshots: [], pageErrors: [], consoleErrors: [], failure: null };
page.on("pageerror", (error) => report.pageErrors.push(String(error)));
page.on("console", (message) => { if (message.type() === "error") report.consoleErrors.push(message.text()); });

async function state() {
  return page.evaluate(() => window.__evidenceFilterPrototype.state());
}

async function scenario(name) {
  await page.evaluate((value) => window.__evidenceFilterPrototype.scenario(value), name);
}

async function action(name) {
  await page.evaluate((value) => window.__evidenceFilterPrototype.action(value), name);
}

async function check(name, assertion) {
  await assertion();
  report.checks.push(name);
}

async function setFrameTheme(frame, theme) {
  await page.locator('[data-control="frame"]').selectOption(frame);
  await page.locator('[data-control="theme"]').selectOption(theme);
  await page.waitForFunction(([expectedFrame, expectedTheme]) => {
    const current = window.__evidenceFilterPrototype.state();
    return current.frame === expectedFrame && current.theme === expectedTheme;
  }, [frame, theme]);
}

async function screenshot(name) {
  const file = new URL(`./${name}.png`, REVIEW);
  await page.locator(".prototype-frame").screenshot({ path: file.pathname, animations: "disabled" });
  report.screenshots.push(`review/${name}.png`);
}

async function axe(label) {
  const result = await page.evaluate(async () => window.axe.run(document.querySelector(".workbench"), {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    resultTypes: ["violations"]
  }));
  const blocking = result.violations.filter((entry) => ["serious", "critical"].includes(entry.impact));
  report.axe.push({ label, blocking: blocking.map((entry) => ({ id: entry.id, impact: entry.impact, nodes: entry.nodes.length })) });
  assert.deepEqual(blocking, [], `${label} has serious/critical axe violations`);
}

function invariantSlice(current) {
  return {
    scope: current.scope,
    filter: current.filter,
    selected: current.selected,
    focused: current.focused,
    context: current.context,
    find: current.find,
    captureOperation: current.captureOperation,
    coverage: current.coverage,
    view: current.view,
    frozenBoundary: current.frozenBoundary,
    newerMatching: current.newerMatching,
    composer: current.composer
  };
}

try {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__evidenceFilterPrototype));
  await page.evaluate(() => window.__evidenceFilterPrototype.ready);
  await page.waitForFunction(() => window.__evidenceFilterPrototype.state().parity.length === 14);
  await page.addScriptTag({ content: await readFile(AXE, "utf8") });

  await check("Initial 10,000-Evidence snapshot is coherent and bounded", async () => {
    const current = await state();
    assert.equal(current.snapshot.readPoint.committedBoundary.sequence, 10_000);
    assert.deepEqual(current.snapshot.totals, { matching: 10_000, inScope: 10_000 });
    assert.equal(current.snapshot.page.evidence.length, 60);
    assert.equal(current.snapshotTelemetry.requestedDiscoveryCount, 0);
    assert.equal(current.snapshotTelemetry.maximumFacetPage, 0);
    assert.equal(current.snapshotTelemetry.plan, "INDEXED_COMPOSITE");
    assert.ok(current.snapshotTelemetry.hydratedPayloadCount <= 61);
    assert.ok(current.snapshotTelemetry.enumeratedProjectionCount < 1_000);
    assert.equal(current.snapshotTelemetry.enumeratedFacetValueCount, 0);
    assert.equal(await page.locator(".evidence-row").count(), 60);
    assert.match(await page.locator(".filter-summary").textContent(), /60 shown · 10,000 matching · 10,000 in Scope/);
  });

  await check("Find shares the atomic boundary without changing Filter totals", async () => {
    const current = await state();
    assert.equal(current.snapshot.find.text, "state mismatch");
    assert.equal(current.snapshot.find.total, 420);
    assert.equal(current.snapshot.find.currentEventId, current.find.current);
    assert.deepEqual(current.snapshot.totals, { matching: 10_000, inScope: 10_000 });
    const before = current.snapshot.find;
    await action("find-next");
    const after = await state();
    assert.equal(after.find.current, before.nextEventId);
    assert.equal(after.snapshot.readPoint.committedBoundary.sequence, 10_000);
    assert.deepEqual(after.snapshot.totals, current.snapshot.totals);
  });

  await check("Memory and IndexedDB return fourteen exact public semantic snapshots", async () => {
    const current = await state();
    assert.equal(current.parity.length, 14);
    assert.ok(current.parity.every((entry) => entry.equal));
    assert.ok(current.parity.every((entry) => entry.comparison === "DEEP_PUBLIC_SNAPSHOT"));
    assert.ok(current.parity.every((entry) => entry.difference === null));
    assert.ok(current.parity.some((entry) => entry.name === "Find at same read point"));
    assert.ok(current.parity.some((entry) => entry.name === "Structured posting path"));
    assert.ok(current.parity.some((entry) => entry.name === "Counterfactual self-facet"));
    assert.ok(current.parity.some((entry) => entry.name === "Active zero pinned"));
    assert.ok(current.parity.some((entry) => entry.name === "Around interval isolation"));
    assert.ok(current.parity.some((entry) => entry.name === "Find nearest surviving match"));
  });

  report.semanticEdgeProbes = await page.evaluate(() => window.__evidenceFilterPrototype.semanticEdgeProbes());
  await check("Pinned active values stay separate from concrete search totals and base-zero state", async () => {
    const zero = report.semanticEdgeProbes.activeZeroSearch.indexeddb.discoveries[0];
    assert.equal(zero.distinctTotal, 1);
    assert.equal(zero.values[0].pinned, true);
    assert.equal(zero.values[0].count, 0);
    assert.match(zero.values[0].value.identity, /order-missing-404/);
    assert.equal(zero.values[1].value.label, "order-03842");
    const concrete = report.semanticEdgeProbes.activeConcreteOutsideSearch.indexeddb.discoveries[0];
    assert.equal(concrete.distinctTotal, 1);
    assert.equal(concrete.values[0].pinned, true);
    assert.equal(concrete.values[0].value.label, "order-03842");
    assert.equal(concrete.values[1].value.label, "order-00001");
    const baseZero = report.semanticEdgeProbes.baseZeroWithPinned.indexeddb.discoveries[0];
    assert.equal(baseZero.state, "BASE_ZERO");
    assert.equal(baseZero.baseEvidenceCount, 0);
    assert.equal(baseZero.distinctTotal, 0);
    assert.equal(baseZero.values[0].pinned, true);
    assert.deepEqual(report.semanticEdgeProbes.activeZeroSearch.memory, report.semanticEdgeProbes.activeZeroSearch.indexeddb);
    assert.deepEqual(report.semanticEdgeProbes.baseZeroWithPinned.memory, report.semanticEdgeProbes.baseZeroWithPinned.indexeddb);
  });

  await check("Around is half-open and cannot cross History Intervals", async () => {
    const probe = report.semanticEdgeProbes.wrongIntervalAround.indexeddb;
    assert.equal(probe.totals.matching, 0);
    assert.deepEqual(probe.lookup.blockingCriteria, ["around-evidence"]);
    assert.equal(probe.lookup.nearestMatchingEventId, null);
    assert.deepEqual(report.semanticEdgeProbes.wrongIntervalAround.memory, probe);
  });

  report.benchmarks = await page.evaluate(() => window.__evidenceFilterPrototype.benchmark(12));
  await check("All representative p95 query paths remain within accepted budgets", async () => {
    assert.equal(report.benchmarks.length, 8);
    assert.ok(report.benchmarks.every((entry) => entry.withinBudget), JSON.stringify(report.benchmarks));
  });

  await check("Composer draft and Cancel do not mutate applied Filter or query generation", async () => {
    await scenario("primary");
    const before = await state();
    await page.locator('.operating [data-action="open-filter"]').click();
    await page.locator("#filter-text").fill("state update");
    const staged = await state();
    assert.equal(staged.composer.draft.text, "state update");
    assert.deepEqual(staged.filter, before.filter);
    assert.equal(staged.queryGeneration, before.queryGeneration);
    await page.locator('.composer [data-action="cancel-filter"]').click();
    await page.waitForFunction(() => {
      const current = window.__evidenceFilterPrototype.state();
      return !current.composer.open && current.activeElement === "filter-trigger";
    });
    const cancelled = await state();
    assert.deepEqual(cancelled.filter, before.filter);
    assert.equal(cancelled.queryGeneration, before.queryGeneration);
    assert.equal(cancelled.activeElement, "filter-trigger");
  });

  await check("Apply sends one expected-revision mutation and publishes one new snapshot", async () => {
    const before = await state();
    await page.locator('.operating [data-action="open-filter"]').click();
    await page.locator("#filter-text").fill("state update");
    await page.locator('.composer [data-action="apply-filter"]').click();
    await page.waitForFunction((generation) => {
      const current = window.__evidenceFilterPrototype.state();
      return current.queryGeneration > generation && current.publishedQueryGeneration === current.queryGeneration;
    }, before.queryGeneration);
    const applied = await state();
    assert.equal(applied.filter.revision, before.filter.revision + 1);
    assert.equal(applied.filter.text, "state update");
    assert.equal(applied.queryGeneration, before.queryGeneration + 1);
    assert.ok(applied.snapshot.totals.matching < applied.snapshot.totals.inScope);
  });

  await check("A stale investigation revision refuses the entire draft and preserves recovery", async () => {
    await scenario("primary");
    await page.locator('.operating [data-action="open-filter"]').click();
    await page.locator("#filter-text").fill("state update");
    await action("include-item");
    const advanced = await state();
    assert.ok(advanced.composer.open);
    await page.locator('.composer [data-action="apply-filter"]').click();
    const refused = await state();
    assert.ok(refused.composer.open);
    assert.equal(refused.composer.draft.text, "state update");
    assert.equal(refused.filter.text, "");
    assert.equal(refused.filter.facets.item.include.length, 1);
    await action("cancel-filter");
  });

  await check("Exact high-cardinality discovery returns page 37 of 3,842 without unbounded UI", async () => {
    await scenario("high");
    const current = await state();
    const discovery = current.snapshot.discoveries[0];
    assert.equal(discovery.state, "AVAILABLE");
    assert.equal(discovery.distinctTotal, 3_842);
    assert.equal(discovery.values.length, 50);
    assert.equal(discovery.nextOffset, 1_850);
    assert.equal(current.snapshotTelemetry.maximumFacetPage, 50);
    assert.equal(current.snapshotTelemetry.plan, "INDEXED_COMPOSITE");
    assert.ok(current.snapshotTelemetry.hydratedPayloadCount <= 61);
    assert.equal(current.snapshotTelemetry.enumeratedFacetValueCount, 3_842);
    assert.equal(await page.locator(".value-row").count(), 50);
    assert.match(await page.locator(".facet-status").textContent(), /1,801–1,850 of 3,842 exact values/);
  });

  await check("Exact value search is global rather than local-page-only", async () => {
    await page.locator("#value-search").fill("order-03842");
    await page.waitForFunction(() => window.__evidenceFilterPrototype.state().snapshot.discoveries[0]?.distinctTotal === 1);
    const current = await state();
    assert.equal(current.snapshot.discoveries[0].values.length, 1);
    assert.match(await page.locator(".value-row").textContent(), /order-03842/);
  });

  await check("Same-facet staged includes remain additive OR values", async () => {
    await scenario("high");
    const includeButtons = page.locator('.value-row [data-action="stage-polarity"][data-polarity="include"]');
    await includeButtons.nth(0).click();
    await includeButtons.nth(1).click();
    await page.locator('[data-action="accept-values"]').click();
    await page.waitForFunction(() => !window.__evidenceFilterPrototype.state().composer.explorerOpen);
    await page.locator('.composer [data-action="apply-filter"]').click();
    await page.waitForFunction(() => {
      const current = window.__evidenceFilterPrototype.state();
      return !current.composer.open && current.publishedQueryGeneration === current.queryGeneration;
    });
    const current = await state();
    assert.equal(current.filter.facets.key.include.length, 2);
    assert.ok(current.snapshot.totals.matching >= 2);
  });

  await check("An active unobserved value is pinned at exact zero", async () => {
    await scenario("empty");
    await action("open-filter");
    await action("add-criterion");
    await action("open-explorer");
    const current = await state();
    const pinned = current.snapshot.discoveries[0].values.find((entry) => entry.pinned);
    assert.ok(pinned);
    assert.equal(pinned.count, 0);
    assert.match(pinned.value.identity, /order-missing-404/);
  });

  await check("Primary Include → Exclude → Reveal removes only exact blockers", async () => {
    await scenario("primary");
    await action("include-item");
    await action("exclude-local");
    const hidden = await state();
    assert.equal(hidden.snapshot.lookup.state, "RETAINED");
    assert.equal(hidden.snapshot.lookup.matchesFilter, false);
    assert.ok(hidden.snapshot.lookup.blockingCriteria.some((entry) => entry.includes("provenance:exclude")));
    assert.equal(hidden.filter.facets.item.include.length, 1);
    assert.ok(hidden.snapshot.totals.matching < hidden.snapshot.totals.inScope);
    await action("reveal-selected");
    const revealed = await state();
    assert.equal(revealed.snapshot.lookup.matchesFilter, true);
    assert.equal(revealed.filter.facets.item.include.length, 1);
    assert.equal(revealed.filter.facets.provenance, undefined);
  });

  await check("Reveal removes an exact unsupported blocker rather than ignoring it", async () => {
    await scenario("unsupported");
    const blocked = await state();
    assert.deepEqual(blocked.snapshot.lookup.blockingCriteria, ["future:diagnostic-severity:v9"]);
    await action("reveal-selected");
    const revealed = await state();
    assert.equal(revealed.filter.unsupported.length, 0);
    assert.equal(revealed.snapshot.evaluation, "COMPLETE");
    assert.equal(revealed.snapshot.lookup.matchesFilter, true);
  });

  await check("Reset changes only Filter and preserves every independent investigation axis", async () => {
    await scenario("primary");
    await action("include-item");
    const before = await state();
    await action("reset-filter");
    const reset = await state();
    assert.equal(reset.filter.text, "");
    assert.deepEqual(reset.filter.facets, {});
    assert.equal(reset.scope.kind, before.scope.kind);
    assert.equal(reset.selected, before.selected);
    assert.deepEqual(reset.find, before.find);
    assert.equal(reset.focused, before.focused);
    assert.equal(reset.context, before.context);
    assert.equal(reset.captureOperation, before.captureOperation);
    assert.equal(reset.coverage, before.coverage);
    assert.equal(reset.view, before.view);
    assert.equal(reset.frozenBoundary, before.frozenBoundary);
    assert.equal(reset.newerMatching, before.newerMatching);
  });

  for (const name of ["empty", "contradiction", "scopeConflict"]) {
    await check(`${name} remains a truthful zero-result state`, async () => {
      await scenario(name);
      const current = await state();
      assert.equal(current.snapshot.totals.matching, 0);
      assert.ok(current.snapshot.totals.inScope > 0);
      assert.equal(current.snapshot.evaluation, "COMPLETE");
    });
  }

  await check("Discovery failure cannot blank the ledger or exact totals", async () => {
    await scenario("unavailable");
    const current = await state();
    assert.equal(current.snapshot.discoveries[0].state, "UNAVAILABLE");
    assert.equal(current.snapshot.page.evidence.length, 60);
    assert.deepEqual(current.snapshot.totals, { matching: 10_000, inScope: 10_000 });
    assert.match(await page.locator(".facet-status").textContent(), /Base unavailable/);
  });

  await check("Coverage and storage fallback remain independent semantic axes", async () => {
    await scenario("limited");
    const limited = await state();
    assert.equal(limited.coverage, "LIMITED");
    assert.equal(limited.history.storage, "indexeddb");
    assert.equal(limited.history.capacityTier, "NORMAL");
    assert.equal(limited.snapshot.totals.inScope, 10_000);
    await scenario("fallback");
    const fallback = await state();
    assert.equal(fallback.coverage, "USEFUL");
    assert.equal(fallback.history.storage, "memory");
    assert.equal(fallback.history.capacityTier, "LOWER");
    assert.equal(fallback.snapshot.totals.inScope, 5_000);
  });

  await check("Retired typed identity remains filterable while retained", async () => {
    await scenario("retired");
    const current = await state();
    assert.equal(current.snapshot.lookup.state, "RETAINED");
    assert.equal(current.snapshot.lookup.matchesFilter, true);
    assert.ok(current.snapshot.totals.matching > 0);
    assert.match(await page.locator(".condition").textContent(), /Subscription retired/);
  });

  await check("Clear invalidates the old read point, removes Around, and preserves ordinary Criteria", async () => {
    await action("walk-add-around");
    const before = await state();
    assert.ok(before.filter.around);
    assert.equal(before.filter.facets.mode.include.length, 1);
    await action("clear-history");
    const cleared = await state();
    assert.equal(cleared.history.intervalId, "H8");
    assert.equal(cleared.snapshot.readPoint.committedBoundary, null);
    assert.equal(cleared.snapshot.totals.inScope, 0);
    assert.equal(cleared.filter.around, null);
    assert.equal(cleared.filter.facets.mode.include.length, 1);
    assert.equal(cleared.restorationBarrier, 1);
    assert.equal(cleared.investigationRevision, before.investigationRevision + 1);
    assert.equal(cleared.frozenBoundary, null);
    assert.equal(cleared.snapshot.lookup.state, "NOT_RETAINED");
    assert.equal(await page.locator('[data-action="around-evidence"]').count(), 0);
    await action("walk-query-old-point");
    assert.equal((await state()).oldReadPointProbe, "memory:HISTORY_READ_POINT_UNAVAILABLE · indexeddb:HISTORY_READ_POINT_UNAVAILABLE");
  });

  await check("Terminal History exposes one final exact boundary and no fictitious newer count", async () => {
    await scenario("terminal");
    const current = await state();
    assert.equal(current.history.terminal, true);
    assert.equal(current.captureOperation, "STOPPED");
    assert.equal(current.coverage, "LIMITED");
    assert.equal(current.snapshot.readPoint.terminal, true);
    assert.equal(current.snapshot.readPoint.terminalReason, "CAPACITY_LIMIT_REACHED");
    assert.equal(current.snapshot.readPoint.committedBoundary.sequence, 10_000);
    assert.equal(current.newerMatching, 0);
    await action("clear-history");
    const refused = await state();
    assert.equal(refused.history.intervalId, "H7");
    assert.equal(refused.history.terminal, true);
    assert.equal(refused.captureOperation, "STOPPED");
  });

  await check("Unsupported Criterion is preserved and fails closed", async () => {
    await scenario("unsupported");
    const current = await state();
    assert.equal(current.snapshot.evaluation, "UNSUPPORTED_FILTER");
    assert.equal(current.snapshot.totals.matching, 0);
    assert.equal(current.filter.unsupported.length, 1);
  });

  await check("Passive Capture advances Live while a Frozen read point remains inert", async () => {
    await scenario("live");
    const initial = await state();
    assert.equal(initial.snapshot.readPoint.committedBoundary.sequence, 9_998);
    await action("toggle-view");
    const frozen = await state();
    assert.equal(frozen.view, "FROZEN");
    const invariant = invariantSlice(frozen);
    await action("advance-capture");
    const advanced = await state();
    assert.equal(advanced.history.committedBoundary, 10_000);
    assert.equal(advanced.snapshot.readPoint.committedBoundary.sequence, 9_998);
    assert.equal(advanced.newerMatching, 2);
    assert.deepEqual({ ...invariantSlice(advanced), newerMatching: invariant.newerMatching }, invariant);
    await action("toggle-view");
    const live = await state();
    assert.equal(live.view, "LIVE");
    assert.equal(live.snapshot.readPoint.committedBoundary.sequence, 10_000);
    assert.equal(live.newerMatching, 0);

    await scenario("live");
    await action("include-item");
    await action("toggle-view");
    await action("advance-capture");
    const filtered = await state();
    assert.equal(filtered.newerMatching, 0);
  });

  await check("Nested Escape restores exact focus without introducing a shortcut scheme", async () => {
    await scenario("high");
    await page.locator("#value-search").focus();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => {
      const current = window.__evidenceFilterPrototype.state();
      return !current.composer.explorerOpen && current.publishedQueryGeneration === current.queryGeneration && current.activeElement === "choose-values";
    });
    assert.equal((await state()).activeElement, "choose-values");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => {
      const current = window.__evidenceFilterPrototype.state();
      return !current.composer.addStep && current.activeElement === "add-criterion";
    });
    assert.equal((await state()).activeElement, "add-criterion");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => {
      const current = window.__evidenceFilterPrototype.state();
      return !current.composer.open && current.activeElement === "filter-trigger";
    });
    assert.equal((await state()).activeElement, "filter-trigger");
  });

  await scenario("primary");
  const geometryInvariant = invariantSlice(await state());
  const geometryGeneration = (await state()).queryGeneration;
  for (const frame of Object.keys(GEOMETRY)) {
    for (const theme of ["dark", "light"]) {
      await setFrameTheme(frame, theme);
      await check(`${frame} ${theme} geometry preserves investigation state`, async () => {
        const box = await page.locator(".prototype-frame").boundingBox();
        assert.equal(Math.round(box.width), GEOMETRY[frame][0]);
        assert.equal(Math.round(box.height), GEOMETRY[frame][1]);
        const current = await state();
        assert.deepEqual(invariantSlice(current), geometryInvariant);
        assert.equal(current.queryGeneration, geometryGeneration);
      });
      await axe(`${frame}-${theme}`);
      await screenshot(`matrix-${frame}-${theme}`);
    }
  }

  await setFrameTheme("compact", "light");
  await scenario("high");
  await screenshot("state-high-cardinality-compact-light");
  await setFrameTheme("wide", "dark");
  await scenario("unavailable");
  await screenshot("state-discovery-unavailable-wide-dark");
  await setFrameTheme("normal", "light");
  await scenario("hidden");
  await screenshot("state-hidden-selection-normal-light");
  await setFrameTheme("wide", "dark");
  await scenario("limited");
  await screenshot("state-limited-coverage-wide-dark");
  await setFrameTheme("shallow", "light");
  await scenario("terminal");
  await screenshot("state-terminal-shallow-light");

  await page.emulateMedia({ forcedColors: "active" });
  await setFrameTheme("normal", "dark");
  await scenario("primary");
  await axe("forced-colors-normal");
  await screenshot("forced-colors-normal");
  await page.emulateMedia({ forcedColors: "none" });

  await check("No browser exceptions or console errors occurred", async () => {
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.consoleErrors, []);
  });
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  await writeFile(new URL("./verification.json", REVIEW), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
}

console.log(JSON.stringify({ checks: report.checks.length, screenshots: report.screenshots.length, axeRuns: report.axe.length, benchmarks: report.benchmarks }, null, 2));
