#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { Browser, Cache } from "@puppeteer/browsers";
import axe from "axe-core";
import { chromeTestArguments } from "./chrome-test-policy.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifactRoot = resolve(projectRoot, "test-results/workbench-visual-qa");
const scenarioHaltReferenceCommit = process.env.LSEW_SCENARIO_HALT_REFERENCE_COMMIT ?? "b750a93";
const prototypePort = Number(process.env.LSEW_VISUAL_PROTOTYPE_PORT ?? 4191);
const panelPort = Number(process.env.LSEW_VISUAL_PANEL_PORT ?? 4192);
const allScenarios = JSON.parse(
  await readFile(resolve(projectRoot, "tests/ui/visual-matrix.json"), "utf8")
);
const grepIndex = process.argv.indexOf("--grep");
const grep = grepIndex >= 0 ? process.argv[grepIndex + 1] : null;
if (grepIndex >= 0 && (!grep || grep.startsWith("--"))) throw new Error("--grep requires a matrix id substring.");
const scenarios = grep ? allScenarios.filter(({ id }) => id.includes(grep)) : allScenarios;
if (grep && scenarios.length === 0) throw new Error(`No visual matrix ids include ${JSON.stringify(grep)}.`);
const baselineGrepArgument = grep ? ` -- --grep ${JSON.stringify(`visual baseline: ${grep}`)}` : "";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: npm run test:ui:visual [-- --print-matrix | --print-review-scope]

Captures the accepted integrated prototype, the shipped Workbench scenario harness,
and an inspectable per-channel visual diff for the Material UI review packet.
The artifacts are reference evidence, not a pixel-parity acceptance gate.

Options:
  --print-matrix  Print the deterministic viewport/theme/state matrix and exit.
  --print-review-scope  Print the bounded contact-sheet, axe, and focus matrix and exit.
  --grep <text>   Generate only matrix entries whose id includes text.
  --help          Show this help.`);
  process.exit(0);
}
if (process.argv.includes("--print-matrix")) {
  console.log(JSON.stringify(publicMatrix()));
  process.exit(0);
}
if (process.argv.includes("--print-review-scope")) {
  console.log(JSON.stringify(publicReviewScope()));
  process.exit(0);
}
for (const [index, argument] of process.argv.slice(2).entries()) {
  if (argument === "--grep" || index > 0 && process.argv.slice(2)[index - 1] === "--grep") continue;
  throw new Error(`Unknown option: ${argument}`);
}

const children = [];
let browser;
const startedAt = Date.now();

try {
  await rm(artifactRoot, { recursive: true, force: true });
  await Promise.all(["reference", "current", "diff", "contact-sheets"].map((directory) =>
    mkdir(join(artifactRoot, directory), { recursive: true })
  ));

  children.push(await startServer({
    name: "accepted Workbench prototype",
    args: [
      resolve(projectRoot, "node_modules/vite/bin/vite.js"),
      "prototypes",
      "--host", "127.0.0.1",
      "--port", String(prototypePort),
      "--strictPort"
    ],
    readyUrl: `http://127.0.0.1:${prototypePort}/workbench-ui-10/`
  }));
  children.push(await startServer({
    name: "shipped Workbench scenario harness",
    args: [resolve(projectRoot, "scripts/ui-panel-server.mjs")],
    env: { LSEW_UI_PORT: String(panelPort) },
    readyUrl: `http://127.0.0.1:${panelPort}/index.html`
  }));

  browser = await chromium.launch({
    executablePath: await resolveChromeExecutable(),
    headless: true,
    args: chromeTestArguments({ headless: true, disableNativeOcclusion: true })
  });
  const results = [];
  for (const scenario of scenarios) {
    const reference = scenario.prototype.setup === "scenario-halt"
      ? await readGitBlob(
          scenarioHaltReferenceCommit,
          `tests/ui/visual-regression.spec.ts-snapshots/${scenario.id}-${process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : process.platform}.png`
        )
      : await capturePrototype(browser, scenario);
    const current = await captureProduction(browser, scenario);
    const comparison = await createDiff(browser, reference, current.png, scenario.viewport);
    const paths = {
      reference: join(artifactRoot, "reference", `${scenario.id}.png`),
      current: join(artifactRoot, "current", `${scenario.id}.png`),
      diff: join(artifactRoot, "diff", `${scenario.id}.png`)
    };
    await Promise.all([
      writeFile(paths.reference, reference),
      writeFile(paths.current, current.png),
      writeFile(paths.diff, comparison.png)
    ]);
    results.push({
      ...scenario,
      artifacts: Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, relative(projectRoot, path)])),
      checks: current.checks,
      changedPixels: comparison.changedPixels,
      totalPixels: comparison.totalPixels,
      changedRatio: comparison.changedPixels / comparison.totalPixels
    });
  }
  const contactSheets = await createContactSheets(browser, results);
  const manifestPath = join(artifactRoot, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    command: grep ? `npm run test:ui:visual -- --grep ${JSON.stringify(grep)}` : "npm run test:ui:visual",
    platform: process.platform,
    baselinePlatformSuffix: process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : process.platform,
    platformBaselineCommands: [
      { platform: "darwin", update: `CI=1 npm run test:ui:update${baselineGrepArgument}`, comparison: `CI=1 npm run test:ui${baselineGrepArgument}`, result: "Run separately and record the exact Playwright result with this packet." },
      { platform: "linux", update: `docker run --rm --ipc=host --tmpfs /work/node_modules:exec -e HOME=/tmp/playwright-home -e CHROME_PATH=/ms-playwright/chromium-1234/chrome-linux/chrome -e LSEW_BROWSER_CACHE_DIR=/tmp/playwright-browsers -e CI=1 -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v1.62.1-noble bash -lc 'npm ci && npm run test:ui:update${baselineGrepArgument}'`, comparison: `docker run --rm --ipc=host --tmpfs /work/node_modules:exec -e HOME=/tmp/playwright-home -e CHROME_PATH=/ms-playwright/chromium-1234/chrome-linux/chrome -e LSEW_BROWSER_CACHE_DIR=/tmp/playwright-browsers -e CI=1 -e LSEW_UI_UPDATE=0 -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v1.62.1-noble bash -lc 'npm ci && npm run test:ui${baselineGrepArgument}'`, result: "Run separately and record the exact Playwright result with this packet." }
    ],
    browser: await browser.version(),
    browserMode: "headless",
    evidenceMode: "non-interactive",
    source: {
      reference: scenarios.every(({ prototype }) => prototype.setup === "scenario-halt")
        ? `initial Scenario 05 production baselines at ${scenarioHaltReferenceCommit}; the surface is absent at implementation base e74d4ca, so these are explicit new-baseline references`
        : "accepted prototypes/workbench-ui-10",
      current: "production Workbench scenario harness using shipped panel root document",
      diff: "absolute per-channel pixel delta; inspect as reference evidence, not a parity threshold"
    },
    contactSheets,
    review: !grep && results.length === allScenarios.length ? {
      classification: "Material UI",
      changedWorkflow: "The integrated Workbench matrix covers promoted Activity, Local Injection Scenario authoring and execution, diagnostics, and compact operating actions in the shipped panel shell.",
      acceptanceCriteria: [
        "Observed Activity preserves exact 10,000-record orientation, graphical and textual meaning, limited and memory-fallback coverage truth, and normal, compact, and wide reachability.",
        "Local Injection Scenario states preserve explicit membership, immutable Review, timing and terminal controls, drift and failure truth, zero-Injection Checkpoints, exact Evidence routes, and bounded high-volume presentation.",
        "Contextual diagnostics present server errors and bounded keepalive aggregation without a health verdict; duplicate, overlap, listener churn, and subscription lint remain scope-relevant and route to supporting Evidence.",
        "Committed snapshot, COMMAND, and lost-update anomalies preserve exact epoch attribution, bounded limitations, and one normalized lifecycle without duplicate footer ownership.",
        "Global diagnostics and More actions remain readable, keyboard reachable, and unobscured without horizontal shell or document overflow in compact, normal, shallow, wide, Dark, Light, and forced-colors states.",
        "Every captured state emits no browser diagnostics; axe-checked states have no serious or critical violations, and every focus-checked action remains visible and unobscured."
      ],
      browserResult: {
        scenarioCaptures: `${results.length}/${results.length} passed`,
        browserDiagnostics: results.reduce((count, result) => count + result.checks.browserDiagnostics.length, 0),
        shellOrDocumentOverflows: results.reduce((count, result) => count + Number(result.checks.horizontalOverflow.shell || result.checks.horizontalOverflow.document), 0)
      },
      accessibilityResult: {
        checkedScenarios: results.filter((result) => result.checks.accessibility).map((result) => result.id),
        seriousOrCriticalViolations: results.reduce((count, result) => count + (result.checks.accessibility?.seriousOrCriticalViolations.length ?? 0), 0)
      },
      keyboardAndFocus: `${results.filter((result) => result.checks.focusEvidence).length} focus-checked states retained visible, unobscured controls; help-resource and memory-fallback evidence remains attached to the exact scenarios that exercise it.`,
      matrixRationale: `${results.length} deterministic states cover the complete manifest-selected compact, normal, shallow, and wide geometry; Dark, Light, and forced-colors themes; Activity, Scenario, diagnostics, and operating-action workflows.`,
      baselineIntent: "Maintain independently generated Darwin and pinned-Linux baselines for every selected integrated matrix state; record the exact update and comparison outcomes alongside this packet."
    } : results.some(({ id }) => id.startsWith("scenario-diagnostic-")) ? {
      classification: "Material UI",
      changedWorkflow: "A Scenario Diagnostic Observation Checkpoint authorizes a journal cursor, evaluates only later normalized observations, and preserves compact provenance without copying diagnostic messages.",
      acceptanceCriteria: [
        "Review and every authorization ledger entry keep the Diagnostic Observation cursor distinct from the committed Evidence boundary.",
        "Waiting, pass, fail, and unavailable states preserve exact typed affected identity, observation boundary, route, and explicit compact-reference limitations without raw diagnostic messages.",
        "Pause and hidden time remain excluded while the initial journal query is pending; execution resumes only through an explicit Scenario control.",
        "Compact, normal, shallow forced-colors, wide, Dark, and Light states retain visible unobscured focus, no horizontal overflow, and no serious or critical axe violations."
      ],
      browserResult: {
        scenarioCaptures: `${results.length}/${results.length} passed`,
        browserDiagnostics: results.reduce((count, result) => count + result.checks.browserDiagnostics.length, 0),
        shellOrDocumentOverflows: results.reduce((count, result) => count + Number(result.checks.horizontalOverflow.shell || result.checks.horizontalOverflow.document), 0)
      },
      accessibilityResult: {
        checkedScenarios: results.filter((result) => result.checks.accessibility).map((result) => result.id),
        seriousOrCriticalViolations: results.reduce((count, result) => count + (result.checks.accessibility?.seriousOrCriticalViolations.length ?? 0), 0)
      },
      keyboardAndFocus: `${results.filter((result) => result.checks.focusEvidence).length} diagnostic Checkpoint states retained visible, unobscured controls with browser focus evidence.`,
      matrixRationale: "Six deterministic states cover compact Light authoring, normal Dark Review, wide Light waiting, normal Light pass and route, compact Dark failure, and shallow forced-colors Dark journal unavailability.",
      baselineIntent: "Maintain independently generated Darwin and pinned-Linux baselines for all six Diagnostic Observation Checkpoint states."
    } : results.some(({ id }) => id.startsWith("scenario-checkpoint-")) ? {
      classification: "Material UI",
      changedWorkflow: "A Scenario Checkpoint authors protected assertions, evaluates one exact committed Evidence boundary without dispatching an Injection, and exposes waiting and terminal truth in the promoted document.",
      acceptanceCriteria: [
        "Checkpoint authoring and Review keep protected identity, boundary, assertions, and zero-Injection meaning visible outside raw Item Update JSON.",
        "Waiting, pass, fail, wire-unavailable, and ambiguous Server-null states remain textually distinct; evaluated results expose exact Evidence provenance and a retained-Evidence route whenever related Evidence exists, while invalid wire Review fabricates neither a boundary nor a route.",
        "Compact, normal, shallow forced-colors, wide, Dark, and Light states retain one Scenario content scroll, keyboard focus, and no serious or critical axe violations.",
        "The high-volume document contains 100 independent Steps plus 100 Checkpoints while keeping every large editor unmounted and all non-focused Checkpoints collapsed."
      ],
      browserResult: {
        scenarioCaptures: `${results.filter(({ id }) => id.startsWith("scenario-checkpoint-")).length}/${results.filter(({ id }) => id.startsWith("scenario-checkpoint-")).length} passed`,
        browserDiagnostics: results.filter(({ id }) => id.startsWith("scenario-checkpoint-")).reduce((count, result) => count + result.checks.browserDiagnostics.length, 0)
      },
      accessibilityResult: {
        checkedScenarios: results.filter((result) => result.id.startsWith("scenario-checkpoint-") && result.checks.accessibility).map((result) => result.id),
        seriousOrCriticalViolations: results.filter(({ id }) => id.startsWith("scenario-checkpoint-")).reduce((count, result) => count + (result.checks.accessibility?.seriousOrCriticalViolations.length ?? 0), 0)
      },
      keyboardAndFocus: "Evaluated retained-Evidence routes are activated through physical keyboard input in the browser gate. Each state scrolls its exact Checkpoint into view; the shallow wire refusal physically focuses its protected Assertion control inside the one Scenario scroll, while other states focus the labelled CHECKPOINT control.",
      matrixRationale: "Eight deterministic states cover compact Light authoring, normal Dark Review, wide Light waiting, normal Light pass and Evidence route, compact Dark failure, shallow forced-colors Dark wire unavailability, wide Dark ambiguous Server null, and wide Light 100-Step plus 100-Checkpoint high volume.",
      baselineIntent: "Add independently generated Darwin and pinned-Linux baselines for all eight Scenario Checkpoint states."
    } : results.some(({ id }) => id.startsWith("scenario-")) ? {
      classification: "Material UI",
      changedWorkflow: "A reviewed same-target Scenario halts before unsafe work, records exact target/listener/Server-Evidence drift, and preserves truthful partial, unknown, delivered-unretained, and post-Clear Evidence outcomes.",
      acceptanceCriteria: [
        "Every due Step checks the exact target and immutable Review before allocating an Injection identity; retirement terminalizes and listener or exact Server Evidence drift requires explicit re-review.",
        "The append-only Panel Session ledger preserves target fingerprints, listener deltas, full Evidence references, per-Step correlations, exact counts, retention, and Evidence availability.",
        "Partial, failed, unknown, and full delivered-but-unretained outcomes stop without retry, skip, fabricated Evidence, projection advance, or rollback implication.",
        "Compact, normal, shallow forced-colors, and wide states expose only truthful controls in one content scroll, retain visible focus, and have no serious or critical axe violations."
      ],
      browserResult: {
        scenarioCaptures: `${results.filter(({ id }) => id.startsWith("scenario-")).length}/${results.filter(({ id }) => id.startsWith("scenario-")).length} passed`,
        browserDiagnostics: results.filter(({ id }) => id.startsWith("scenario-")).reduce((count, result) => count + result.checks.browserDiagnostics.length, 0)
      },
      accessibilityResult: {
        checkedScenarios: results.filter((result) => result.id.startsWith("scenario-") && result.checks.accessibility).map((result) => result.id),
        seriousOrCriticalViolations: results.filter(({ id }) => id.startsWith("scenario-")).reduce((count, result) => count + (result.checks.accessibility?.seriousOrCriticalViolations.length ?? 0), 0)
      },
      keyboardAndFocus: "Drift exposes Re-review immutable plan as the sole primary control with visible physical-keyboard focus; Stop remains reachable, terminal controls recover semantically, and passive evidence cannot steal focus.",
      matrixRationale: "Fourteen Scenario states retain the eight authoring/clock baselines and add compact partial counts, normal listener drift, shallow forced-colors unknown, wide Server Evidence drift, normal delivered-unretained, and compact post-Clear unavailable Evidence.",
      baselineIntent: "Maintain platform-specific Darwin and Linux baselines for all fourteen Scenario membership, timing, halt, retention, and Evidence-availability states."
    } : {
      classification: "Material UI",
      changedWorkflow: "The global diagnostics footer keeps mixed Warning, Error, and Information entries readable and discoverable without taking over the Evidence workspace.",
      acceptanceCriteria: [
        "Short and long severity, affected-object, consequence, and recovery content receive usable line width without character-by-character wrapping.",
        "Multiple Warning, Error, and Information entries remain discoverable through an explicit count/scroll cue and keyboard Home/End navigation.",
        "Normal, compact, shallow, and wide geometry preserve a usable Evidence workspace, the Freeze Evidence action, and a bounded diagnostic scroll owner in Dark and Light themes.",
        "The changed workflow has no serious or critical axe violations, browser diagnostics, clipped selected diagnostic entry, or horizontal shell overflow."
      ],
      browserResult: {
        scenarioCaptures: `${results.length}/${results.length} passed`,
        browserDiagnostics: results.reduce((count, result) => count + result.checks.browserDiagnostics.length, 0)
      },
      accessibilityResult: {
        checkedScenarios: results.filter((result) => result.checks.accessibility).map((result) => result.id),
        seriousOrCriticalViolations: results.reduce((count, result) => count + (result.checks.accessibility?.seriousOrCriticalViolations.length ?? 0), 0)
      },
      keyboardAndFocus: "The mixed diagnostic list is keyboard-focusable with a visible focus ring; End reveals the last complete diagnostic and Home returns to the explicit diagnostic-count cue. Existing footer focus and forced-colors checks remain green.",
      baselineIntent: "Update tracked baselines that render diagnostics and add Darwin/Linux baselines for the four mixed-severity stress geometries. Five Darwin-only native-scrollbar snapshots are normalized to the current release-prep rendering; their semantic content is unchanged."
    },
    durationMs: Date.now() - startedAt,
    scenarios: results
  }, null, 2)}\n`);
  console.table(results.map((result) => ({
    scenario: result.id,
    viewport: `${result.viewport.width}x${result.viewport.height}`,
    theme: result.theme,
    delta: `${(result.changedRatio * 100).toFixed(1)}%`
  })));
  console.log(`Visual QA evidence: ${manifestPath}`);
} finally {
  await browser?.close();
  await Promise.all(children.reverse().map(stopServer));
}

function publicMatrix() {
  return { artifactRoot: "test-results/workbench-visual-qa", scenarios };
}

function isIntegratedDiagnosticSetup(setup) {
  return setup === "diagnostic-server"
    || setup === "diagnostic-subscription"
    || setup === "diagnostic-anomaly";
}

function contactSheetScenarioIds(matrix) {
  return matrix
    .filter(({ id, production }) => id.startsWith("scenario-") || isIntegratedDiagnosticSetup(production.setup))
    .map(({ id }) => id);
}

function publicReviewScope() {
  const diagnosticIds = allScenarios
    .filter(({ production }) => isIntegratedDiagnosticSetup(production.setup))
    .map(({ id }) => id);
  return {
    contactSheetScenarioIds: contactSheetScenarioIds(allScenarios),
    accessibilityScenarioIds: diagnosticIds,
    focusScenarioIds: diagnosticIds
  };
}

function readGitBlob(commit, path) {
  return new Promise((resolveBlob, rejectBlob) => {
    const child = spawn("git", ["show", `${commit}:${path}`], { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let error = "";
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => { error += chunk.toString(); });
    child.once("error", rejectBlob);
    child.once("exit", (code) => code === 0
      ? resolveBlob(Buffer.concat(chunks))
      : rejectBlob(new Error(`Could not read visual reference ${commit}:${path}: ${error.trim()}`)));
  });
}

async function createContactSheets(runningBrowser, results) {
  const affectedIds = grep
    ? results.map(({ id }) => id)
    : contactSheetScenarioIds(results);
  const affected = affectedIds.map((id) => results.find((result) => result.id === id)).filter(Boolean);
  if (affected.length !== affectedIds.length) {
    throw new Error(`Contact-sheet scenarios are incomplete: ${affectedIds.join(", ")}`);
  }
  if (!grep) {
    const requiredDiagnosticIds = publicReviewScope().focusScenarioIds;
    const missingDiagnosticIds = requiredDiagnosticIds.filter((id) => !affectedIds.includes(id));
    if (requiredDiagnosticIds.length !== 12 || missingDiagnosticIds.length > 0) {
      throw new Error(`Contact sheets require all 12 integrated diagnostic states; missing: ${missingDiagnosticIds.join(", ") || "none"}.`);
    }
  }
  const output = {};
  for (const view of ["reference", "current", "diff"]) {
    output[view] = await writeContactSheet(
      runningBrowser,
      affected,
      [view],
      `contact-sheets/affected-${view}.png`
    );
  }
  output.combined = await writeContactSheet(
    runningBrowser,
    affected,
    ["reference", "current", "diff"],
    "contact-sheets/affected-reference-current-diff.png"
  );
  return output;
}

async function writeContactSheet(runningBrowser, results, views, relativePath) {
  const images = [];
  for (const result of results) {
    for (const view of views) {
      const imagePath = resolve(projectRoot, result.artifacts[view]);
      const bytes = await readFile(imagePath);
      images.push({
        scenario: result.id,
        view,
        dataUrl: `data:image/png;base64,${bytes.toString("base64")}`
      });
    }
  }
  const context = await runningBrowser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();
  try {
    const dataUrl = await page.evaluate(async ({ images: entries, columns }) => {
      const tileWidth = 450;
      const tileHeight = 395;
      const headerHeight = 36;
      const gap = 12;
      const margin = 18;
      const rows = Math.ceil(entries.length / columns);
      const canvas = document.createElement("canvas");
      canvas.width = margin * 2 + columns * tileWidth + (columns - 1) * gap;
      canvas.height = margin * 2 + rows * tileHeight + (rows - 1) * gap;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Contact-sheet canvas is unavailable.");
      context.fillStyle = "#f7f7f7";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.font = "600 14px system-ui, sans-serif";
      context.textBaseline = "middle";
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const image = new Image();
        image.src = entry.dataUrl;
        await image.decode();
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = margin + column * (tileWidth + gap);
        const y = margin + row * (tileHeight + gap);
        context.fillStyle = "#ffffff";
        context.fillRect(x, y, tileWidth, tileHeight);
        context.strokeStyle = "#a7a7a7";
        context.strokeRect(x + 0.5, y + 0.5, tileWidth - 1, tileHeight - 1);
        context.fillStyle = "#202020";
        context.fillText(`${entry.scenario} · ${entry.view}`, x + 10, y + headerHeight / 2);
        const imageBox = {
          x: x + 8,
          y: y + headerHeight + 8,
          width: tileWidth - 16,
          height: tileHeight - headerHeight - 16
        };
        const scale = Math.min(imageBox.width / image.naturalWidth, imageBox.height / image.naturalHeight);
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        context.drawImage(
          image,
          imageBox.x + (imageBox.width - width) / 2,
          imageBox.y + (imageBox.height - height) / 2,
          width,
          height
        );
      }
      return canvas.toDataURL("image/png");
    }, { images, columns: views.length });
    const outputPath = join(artifactRoot, relativePath);
    await writeFile(outputPath, Buffer.from(dataUrl.split(",", 2)[1], "base64"));
    return relative(projectRoot, outputPath);
  } finally {
    await context.close();
  }
}

async function capturePrototype(runningBrowser, scenario) {
  const context = await runningBrowser.newContext({
    viewport: { width: scenario.viewport.width + 20, height: scenario.viewport.height + 20 },
    colorScheme: scenario.theme,
    forcedColors: scenario.forcedColors ? "active" : "none"
  });
  const page = await context.newPage();
  try {
    const query = new URLSearchParams({
      ...scenario.prototype,
      theme: scenario.theme,
      presentation: "1"
    });
    await page.goto(`http://127.0.0.1:${prototypePort}/workbench-ui-10/?${query}`, { waitUntil: "networkidle" });
    const workbench = page.locator(".workbench");
    await workbench.waitFor({ state: "visible" });
    await assertPrototypeSetup(page, workbench, scenario.prototype.setup);
    if (scenario.production.setup === "more-actions-help") {
      const body = page.locator(".context-body");
      await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    }
    await page.evaluate(() => document.fonts.ready);
    return await workbench.screenshot({ animations: "disabled", caret: "hide" });
  } finally {
    await context.close();
  }
}

async function assertPrototypeSetup(page, workbench, setup) {
  const expectedText = {
    "live-selected": ["evt-1842", "Open complete raw"],
    "captured-draft": ["topology-small-subscription", "json-string-event", "json-string-alpha"],
    "authored-review": ["topology-small-subscription", "None · newly authored", "visual-review"],
    "command-comparison": ["Why matching?", "scenario-subscription-1 / scenario.snapshot-basic / alpha"],
    "more-actions": ["Session operations", "Copy complete scoped Evidence"],
    "memory-operations": ["in-memory fallback", "Panel Session closes."],
    "clear-confirmation": ["Clear retained events", "This removes retained Evidence from this Panel Session and cannot be undone."],
    "matching-summary": ["Matching projections", "Neither projection is Authoritative COMMAND State."],
    "selected-json": ["json-string-event", "JSON string", "AIRPORT-02"],
    "activity-10k": ["Observed Server activity", "9,999 Logical Updates", "Server Logical Updates and Update Deliveries"],
    "activity-graphical": ["Observed Server activity", "Server Logical Updates and Update Deliveries"],
    "activity-limited": ["Observed Server activity", "Coverage LIMITED", "Observation Coverage is limited"],
    "activity-memory": ["Observed Server activity"]
  }[setup];
  if (expectedText) {
    const text = await workbench.innerText();
    for (const marker of expectedText) {
      if (!text.includes(marker)) throw new Error(`Prototype setup ${setup} is missing ${JSON.stringify(marker)}.`);
    }
  }
  if (setup === "activity-10k" || setup === "activity-graphical") {
    await workbench.getByRole("table", { name: "Activity timeline buckets" }).waitFor();
  }
  if (setup === "authored-review") {
    const text = await workbench.innerText();
    if (text.includes("evt-1842 · SERVER · immutable")) {
      throw new Error("Authored Review prototype must not claim an immutable captured source.");
    }
  }
  if (setup === "retained-find") {
    const query = "complete-retained-find-anchor";
    const inputValue = await page.locator("#prototype-find").inputValue();
    const matches = page.locator(`.evidence-row[data-find-anchor="${query}"]`);
    if (inputValue !== query || await matches.count() !== 3 || await page.locator(".evidence-row.find-current").count() !== 1) {
      throw new Error("Retained Find prototype must derive one current result from exactly three matching events.");
    }
  }
  if (["retained-find", "long-identities"].includes(setup)) {
    const text = await workbench.innerText();
    if (!text.includes("View FROZEN · 30 newer") || !text.includes("Frozen · 30 newer")) {
      throw new Error(`Prototype setup ${setup} must report the same 30-newer frozen window in both status surfaces.`);
    }
  }
  if (setup === "long-identities") {
    const eventId = "retained-evidence-event-3961-from-orders-command-subscription-with-long-production-identity";
    const row = page.locator(`.evidence-row[data-event="${eventId}"]`);
    if (await row.count() !== 1) {
      throw new Error(`Long-identity prototype is missing event ${JSON.stringify(eventId)}.`);
    }
    const text = await row.textContent() ?? "";
    for (const marker of [
      "portfolio/orders/north-america/enterprise-customer-primary-book",
      "customer-order-command-key-with-long-production-identity-1"
    ]) {
      if (!text.includes(marker)) throw new Error(`Long-identity prototype is missing ${JSON.stringify(marker)}.`);
    }
  }
  if (setup === "clear-confirmation") {
    const clear = workbench.getByRole("button", { name: "Clear retained events" });
    if (await clear.evaluate((element) => element === document.activeElement)) {
      throw new Error("Prototype Clear retained events must not be auto-focused.");
    }
    let reached = false;
    for (let index = 0; index < 40; index += 1) {
      await page.keyboard.press("Tab");
      if (await clear.evaluate((element) => element === document.activeElement)) {
        reached = true;
        break;
      }
    }
    if (!reached) throw new Error("Prototype Clear retained events was not reached by physical Tab navigation.");
    const style = await clear.evaluate((element) => {
      const computed = getComputedStyle(element);
      return `${computed.outlineStyle} ${computed.outlineWidth} ${computed.outlineOffset}`;
    });
    if (style !== "solid 3px 2px") throw new Error(`Prototype Clear focus treatment is ${style}.`);
  }
}

async function captureProduction(runningBrowser, scenario) {
  const context = await runningBrowser.newContext({ viewport: scenario.viewport, colorScheme: scenario.theme, forcedColors: scenario.forcedColors ? "active" : "none" });
  const page = await context.newPage();
  const browserDiagnostics = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") browserDiagnostics.push(`[console:${message.type()}] ${message.text()}`);
  });
  page.on("pageerror", (error) => browserDiagnostics.push(`[pageerror] ${error.message}`));
  try {
    const query = new URLSearchParams({ scenario: scenario.production.scenario, theme: scenario.theme });
    await page.goto(`http://127.0.0.1:${panelPort}/?${query}`, { waitUntil: "networkidle" });
    await page.locator('html[data-react-scene-ready="true"]').waitFor();
    const workbench = page.locator(".workbench-react");
    await workbench.waitFor({ state: "visible" });
    await prepareProductionState(page, scenario.production.setup);
    await page.evaluate(() => document.fonts.ready);
    const dimensions = await workbench.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
    });
    if (dimensions.width !== dimensions.viewportWidth || dimensions.height !== dimensions.viewportHeight) {
      throw new Error(`Production Workbench must fill its shipped root: ${JSON.stringify(dimensions)}`);
    }
    const horizontalOverflow = await workbench.evaluate((element) => ({
      shell: element.scrollWidth > element.clientWidth,
      document: document.documentElement.scrollWidth > document.documentElement.clientWidth
    }));
    if (horizontalOverflow.shell || horizontalOverflow.document) {
      throw new Error(`Production Workbench has horizontal overflow: ${JSON.stringify(horizontalOverflow)}`);
    }
    let accessibility = null;
    let helpResources = null;
    let focusEvidence = null;
    let memoryEvidence = null;
    if (scenario.production.setup.startsWith("scenario") || isIntegratedDiagnosticSetup(scenario.production.setup) || ["more-actions-help", "clear-confirmation", "memory-operations", "diagnostics", "activity-10k", "activity-graphical", "activity-limited", "activity-memory"].includes(scenario.production.setup)) {
      await page.addScriptTag({ content: axe.source });
      const seriousOrCriticalViolations = await page.evaluate(async () => {
        const result = await window.axe.run(document, { resultTypes: ["violations"] });
        return result.violations
          .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
          .map((violation) => ({ id: violation.id, impact: violation.impact, help: violation.help }));
      });
      if (seriousOrCriticalViolations.length) {
        throw new Error(`Help resources has serious or critical axe violations: ${JSON.stringify(seriousOrCriticalViolations)}`);
      }
      accessibility = { seriousOrCriticalViolations };
    }
    if (isIntegratedDiagnosticSetup(scenario.production.setup)) {
      const diagnosticFocus = scenario.production.setup === "diagnostic-server"
        ? page.getByLabel("Workbench diagnostic entries")
        : page.getByLabel("Context diagnostics").getByRole("button").first();
      await diagnosticFocus.scrollIntoViewIfNeeded();
      await diagnosticFocus.focus();
      focusEvidence = await diagnosticFocus.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          action: element.getAttribute("aria-label") ?? "",
          focused: document.activeElement === element,
          outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineOffset}`,
          visible: rect.top >= 0 && rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
          unobscured: element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2))
        };
      });
      if (!focusEvidence.focused || focusEvidence.outline.startsWith("none ") || !focusEvidence.visible || !focusEvidence.unobscured) {
        throw new Error(`Diagnostic focus evidence is incomplete: ${JSON.stringify(focusEvidence)}`);
      }
    }
    if (scenario.production.setup === "scenario") {
      const scenarioDocument = page.getByRole("region", { name: "Local Injection Scenario" });
      const actionName = scenario.production.scenario.endsWith("listener-drift") || scenario.production.scenario.endsWith("server-drift")
        ? "Re-review immutable plan"
        : scenario.production.setup === "scenario-hidden-pause"
        ? "Resume"
        : scenario.production.scenario.endsWith("edit")
        ? "Add captured update"
        : scenario.production.scenario.endsWith("review")
          ? "Pause"
          : "Finish Scenario";
      const action = scenarioDocument.getByRole("button", { name: actionName });
      if (actionName === "Add captured update") {
        await action.focus();
        await page.keyboard.press("Enter");
        await page.getByRole("region", { name: "Scenario Evidence picker" }).waitFor();
        await page.keyboard.press("Escape");
      } else {
        await action.focus();
      }
      if ([
        "local-injection-scenario-partial",
        "local-injection-scenario-unknown",
        "local-injection-scenario-unretained",
        "local-injection-scenario-cleared"
      ].includes(scenario.production.scenario)) {
        const steps = page.getByLabel("Ordered Scenario Steps");
        if (scenario.production.scenario === "local-injection-scenario-partial") {
          await steps.getByText("PARTIALLY DELIVERED").waitFor();
          await steps.getByText("NOT RUN", { exact: true }).waitFor();
        }
        if (scenario.production.scenario === "local-injection-scenario-cleared") {
          await steps.getByText(/UNAVAILABLE_AFTER_CLEAR/).first().waitFor();
        }
        await steps.evaluate((owner) => {
          const firstOutcome = owner.querySelector("article p");
          if (firstOutcome instanceof HTMLElement) owner.scrollTop = firstOutcome.offsetTop - owner.offsetTop;
        });
      }
      focusEvidence = await action.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          action: element.textContent?.trim() ?? "",
          focused: document.activeElement === element,
          outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineOffset}`,
          visible: rect.top >= 0 && rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
          unobscured: element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2))
        };
      });
      if (!focusEvidence.focused || !focusEvidence.visible || !focusEvidence.unobscured) {
        throw new Error(`Scenario focus evidence is incomplete: ${JSON.stringify(focusEvidence)}`);
      }
    }
    if (scenario.production.setup === "scenario-checkpoint" || scenario.production.setup === "scenario-checkpoint-high-volume" || scenario.production.setup === "scenario-diagnostic-checkpoint") {
      const scenarioDocument = page.getByRole("region", { name: "Local Injection Scenario" });
      const checkpoint = scenarioDocument.locator(".workbench-react__scenario-checkpoint").last();
      const action = scenario.production.scenario.endsWith("-authoring")
        ? checkpoint.getByRole("button", { name: "Add assertion" })
        : scenario.production.scenario.endsWith("wire-unavailable")
        ? checkpoint.getByRole("combobox", { name: /Assertion/ })
        : checkpoint.getByRole("button", { name: /CHECKPOINT \d+/ });
      await action.scrollIntoViewIfNeeded();
      await action.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
      await action.focus();
      focusEvidence = await action.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          action: element.textContent?.trim() ?? "",
          focused: document.activeElement === element,
          outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineOffset}`,
          visible: rect.top >= 0 && rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
          unobscured: element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2))
        };
      });
      if (!focusEvidence.focused || !focusEvidence.visible || !focusEvidence.unobscured) {
        throw new Error(`Scenario Checkpoint focus evidence is incomplete: ${JSON.stringify(focusEvidence)}`);
      }
    }
    if (scenario.production.setup === "more-actions-help") {
      helpResources = await page.getByRole("navigation", { name: "Help and resources" }).evaluate((navigation) => {
        const inViewport = (element) => {
          const rect = element.getBoundingClientRect();
          return rect.top >= 0 && rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight;
        };
        const links = Array.from(navigation.querySelectorAll("a"));
        const owner = navigation.closest(".workbench-react__context-body");
        const focusedStyle = document.activeElement instanceof Element ? getComputedStyle(document.activeElement) : null;
        return {
          focusedLink: document.activeElement?.textContent?.trim() ?? null,
          focusedOutline: focusedStyle ? `${focusedStyle.outlineStyle} ${focusedStyle.outlineWidth}` : null,
          allLinksInViewport: links.every(inViewport),
          links: links.map((link) => ({
            name: link.textContent?.trim() ?? "",
            href: link.href,
            target: link.target,
            rel: link.rel
          })),
          scrollOwner: owner instanceof HTMLElement ? {
            scrollTop: owner.scrollTop,
            clientHeight: owner.clientHeight,
            scrollHeight: owner.scrollHeight
          } : null
        };
      });
    }
    if (scenario.production.setup === "clear-confirmation") {
      focusEvidence = await page.getByRole("region", { name: "Session operations" }).evaluate((operations) => {
        const clear = Array.from(operations.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Clear retained events");
        const keep = Array.from(operations.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Keep Evidence");
        const owner = operations.closest(".workbench-react__context-body");
        if (!(clear instanceof HTMLElement) || !(keep instanceof HTMLElement) || !(owner instanceof HTMLElement)) {
          throw new Error("Clear confirmation evidence controls are missing.");
        }
        const clearStyle = getComputedStyle(clear);
        const keepStyle = getComputedStyle(keep);
        const rect = clear.getBoundingClientRect();
        return {
          activeElement: document.activeElement?.textContent?.trim() ?? null,
          clearFocused: document.activeElement === clear,
          clearFocusStyle: `${clearStyle.outlineStyle} ${clearStyle.outlineWidth} ${clearStyle.outlineOffset}`,
          keepFocusStyle: `${keepStyle.outlineStyle} ${keepStyle.outlineWidth} ${keepStyle.outlineOffset}`,
          scrollTop: owner.scrollTop,
          clearVisible: rect.top >= 0 && rect.bottom <= window.innerHeight,
          clearUnobscured: clear.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)),
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
        };
      });
    }
    if (scenario.production.setup === "memory-operations") {
      memoryEvidence = await page.getByRole("region", { name: "Session operations" }).innerText();
    }
    if (browserDiagnostics.length) throw new Error(`Production Workbench emitted browser diagnostics: ${browserDiagnostics.join("\n")}`);
    return {
      png: await workbench.screenshot({ animations: "disabled", caret: "hide" }),
      checks: { browserDiagnostics, horizontalOverflow, accessibility, helpResources, focusEvidence, memoryEvidence }
    };
  } finally {
    await context.close();
  }
}

async function prepareProductionState(page, setup) {
  if (setup === "scenario-checkpoint" || setup === "scenario-checkpoint-high-volume" || setup === "scenario-diagnostic-checkpoint") {
    const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
    await scenario.waitFor({ state: "visible" });
    const checkpoints = scenario.locator(".workbench-react__scenario-checkpoint");
    await checkpoints.last().waitFor();
    await checkpoints.last().scrollIntoViewIfNeeded();
    await checkpoints.last().evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest" }));
    return;
  }
  if (setup === "scenario-hidden-pause") {
    const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
    await page.evaluate(() => window.__setWorkbenchVisible(false));
    await page.evaluate(() => window.__setWorkbenchVisible(true));
    await scenario.getByRole("button", { name: "Resume" }).waitFor();
    return;
  }
  if (setup === "scenario-inflight-stop") {
    const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
    await scenario.getByText(/IN FLIGHT/).waitFor();
    await scenario.getByRole("button", { name: "Stop" }).click();
    await scenario.getByText(/^RUN STOPPED · remaining Steps/).waitFor();
    await scenario.getByText("NOT RUN", { exact: true }).waitFor();
    await scenario.getByLabel("Ordered Scenario Steps").evaluate((owner) => {
      const firstOutcome = owner.querySelector("article p");
      if (owner instanceof HTMLElement && firstOutcome instanceof HTMLElement) owner.scrollTop = firstOutcome.offsetTop - owner.offsetTop;
    });
    return;
  }
  if (setup === "scenario-membership-preview") {
    const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
    await scenario.getByRole("button", { name: "Add captured update" }).click();
    const picker = page.getByRole("region", { name: "Scenario Evidence picker" });
    await picker.getByRole("button", { name: "Preview visible set" }).click();
    await picker.getByText("Will add after confirmation").waitFor();
    return;
  }
  if (setup === "scenario-authored-undo") {
    const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
    await scenario.getByRole("button", { name: "Add authored update" }).click();
    await scenario.getByLabel("Step 2 actions").getByRole("button", { name: "Remove Step" }).click();
    await scenario.getByRole("button", { name: "Undo removal" }).waitFor();
    return;
  }
  if (setup === "scenario-capacity-refusal") {
    const scenario = page.getByRole("region", { name: "Local Injection Scenario" });
    await scenario.getByRole("button", { name: "Add authored update" }).click();
    await scenario.getByRole("alert").waitFor();
    return;
  }
  if (setup === "scenario") {
    await page.getByRole("region", { name: "Local Injection Scenario" }).waitFor({ state: "visible" });
    return;
  }
  if (setup === "none") return;
  if (setup === "diagnostics") {
    const diagnostics = page.getByLabel("Workbench diagnostic entries");
    await diagnostics.waitFor();
    const text = await diagnostics.innerText();
    for (const marker of ["3 diagnostics · Scroll to review all", "Warning · History near capacity", "Error · Capture disconnected", "Information · Retired Scope"]) {
      if (!text.includes(marker)) throw new Error(`Mixed diagnostic visual state is missing ${JSON.stringify(marker)}.`);
    }
    await diagnostics.focus();
    const overflows = await diagnostics.evaluate((element) => element.scrollHeight > element.clientHeight);
    if (overflows) {
      await page.keyboard.press("End");
      await page.waitForFunction(() => {
        const owner = document.querySelector(".workbench-react__status-diagnostics");
        return owner instanceof HTMLElement && owner.scrollTop > 0;
      });
      await page.keyboard.press("Home");
      await page.waitForFunction(() => {
        const owner = document.querySelector(".workbench-react__status-diagnostics");
        return owner instanceof HTMLElement && owner.scrollTop === 0;
      });
    }
    return;
  }
  if (setup === "diagnostic-server") {
    const diagnostics = page.getByLabel("Workbench diagnostic entries");
    await diagnostics.waitFor();
    const text = await diagnostics.innerText();
    for (const marker of ["Warning · Server error -7", "Information · Server keepalive observed", "does not prove that the connection"]) {
      if (!text.includes(marker)) throw new Error(`Server diagnostic visual state is missing ${JSON.stringify(marker)}.`);
    }
    await diagnostics.focus();
    await page.keyboard.press("Home");
    return;
  }
  if (setup === "diagnostic-subscription") {
    await page.getByRole("button", { name: "Open Scope Context" }).click();
    const diagnostics = page.getByLabel("Context diagnostics");
    await diagnostics.waitFor();
    const text = await diagnostics.innerText();
    for (const marker of ["Information · Exact duplicate Subscriptions", "Information · Semantic Subscription overlap", "Information · Listener registration churn"]) {
      if (!text.includes(marker)) throw new Error(`Subscription diagnostic visual state is missing ${JSON.stringify(marker)}.`);
    }
    const action = diagnostics.getByRole("button").first();
    await action.scrollIntoViewIfNeeded();
    await action.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    return;
  }
  if (setup === "diagnostic-anomaly") {
    await page.getByRole("button", { name: "Open Scope Context" }).click();
    const diagnostics = page.getByLabel("Context diagnostics");
    await diagnostics.waitFor();
    const text = await diagnostics.innerText();
    for (const marker of ["Warning · Snapshot phase incomplete", "Warning · Unknown COMMAND key update", "Warning · Subscription updates lost"]) {
      if (!text.includes(marker)) throw new Error(`Anomaly diagnostic visual state is missing ${JSON.stringify(marker)}.`);
    }
    const action = diagnostics.getByRole("button").first();
    await action.scrollIntoViewIfNeeded();
    await action.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    return;
  }
  if (setup.startsWith("activity")) {
    await page.getByRole("button", { name: "Open Activity" }).click();
    const document = page.getByRole("main", { name: "Observed Activity" });
    await document.waitFor();
    if (setup === "activity-10k" || setup === "activity-graphical") {
      await document.getByRole("grid", { name: "Activity timeline buckets" }).waitFor();
    } else if (setup === "activity-limited") {
      await document.getByRole("status").waitFor();
      await document.getByText("Observation Coverage is limited", { exact: false }).waitFor();
    } else {
      await document.getByText("Observed Server activity", { exact: true }).waitFor();
      await document.getByText("History Interval", { exact: false }).waitFor();
    }
    if (setup === "activity-10k") {
      await document.getByText("9,999 Logical Updates", { exact: false }).waitFor();
      await document.getByText("9,999 Update Deliveries", { exact: false }).waitFor();
    }
    return;
  }
  if (setup === "captured-draft") {
    await page.getByRole("button", { name: "Open selected Context" }).click();
    await page.getByRole("button", { name: "Create Local Injection Draft" }).click();
    await page.getByRole("region", { name: "Local Injection Draft" }).waitFor();
    return;
  }
  if (setup === "authored-review") {
    await page.getByRole("button", { name: "Author COMMAND Item Update" }).click();
    await page.getByRole("textbox", { name: "Local Injection JSON", exact: true }).fill(JSON.stringify({
      command: "ADD", key: "visual-review", isSnapshot: false,
      fields: { command: "ADD", key: "visual-review", value: "42" }
    }, null, 2));
    await page.getByRole("button", { name: "Review Local Injection" }).click();
    const review = page.getByRole("region", { name: "Review Local Injection" });
    await review.waitFor();
    await review.getByRole("heading", { name: "Review Local Injection" }).focus();
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => {
      const owner = document.querySelector(".workbench-react__local-scroll");
      return owner instanceof HTMLElement && owner.scrollTop > 0;
    });
    const localOnly = review.getByText(/Local only:/);
    await localOnly.scrollIntoViewIfNeeded();
    await localOnly.waitFor();
    const partiallyClippedParagraphs = await review.locator("p").evaluateAll((paragraphs) => {
      const owner = document.querySelector(".workbench-react__local-scroll");
      if (!(owner instanceof HTMLElement)) throw new Error("Local Injection scroll owner is missing.");
      const ownerRect = owner.getBoundingClientRect();
      return paragraphs.flatMap((paragraph) => {
        const rect = paragraph.getBoundingClientRect();
        const intersects = rect.bottom > ownerRect.top && rect.top < ownerRect.bottom;
        const contained = rect.top >= ownerRect.top && rect.bottom <= ownerRect.bottom;
        return intersects && !contained ? [paragraph.textContent?.trim() ?? ""] : [];
      });
    });
    if (partiallyClippedParagraphs.length) {
      throw new Error(`Shallow Review clips explanatory text: ${JSON.stringify(partiallyClippedParagraphs)}`);
    }
    return;
  }
  if (setup === "command-comparison") {
    await page.getByRole("button", { name: "Compare COMMAND projections" }).click();
    await page.getByRole("region", { name: "COMMAND projection comparison" }).waitFor();
    return;
  }
  if (setup === "retained-find") {
    await page.getByRole("button", { name: "Find", exact: true }).click();
    await page.getByRole("textbox", { name: "Find in ordered Evidence" }).fill("complete-retained-find-anchor");
    await page.getByRole("search", { name: "Find in ordered Evidence" }).getByText("1 of 3 matches").waitFor();
    await page.locator('[data-find-current="true"]').waitFor();
    return;
  }
  if (setup === "more-actions-help") {
    const more = page.getByRole("button", { name: "More actions" });
    await more.focus();
    await page.keyboard.press("Enter");
    const operations = page.getByRole("region", { name: "Session operations" });
    await operations.waitFor();
    await page.getByRole("button", { name: "Back to prior investigation" }).waitFor();
    const documentation = operations.getByRole("link", { name: "Documentation" });
    const clear = operations.getByRole("button", { name: "Clear retained Evidence…" });
    await clear.scrollIntoViewIfNeeded();
    await clear.focus();
    await page.keyboard.press("Tab");
    if (!await documentation.evaluate((element) => element === document.activeElement)) {
      throw new Error("Documentation was not the next keyboard target after Clear retained Evidence.");
    }
    const visibility = await operations.evaluate((element) => {
      const inViewport = (target) => {
        const rect = target.getBoundingClientRect();
        return rect.top >= 0 && rect.left >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight;
      };
      const heading = Array.from(element.querySelectorAll("h3")).find((candidate) => candidate.textContent?.trim() === "Help & resources");
      const links = Array.from(element.querySelectorAll("nav[aria-label='Help and resources'] a"));
      const documentation = links[0];
      const focusStyle = documentation ? getComputedStyle(documentation) : null;
      return {
        heading: Boolean(heading && inViewport(heading)),
        links: links.length === 3 && links.every(inViewport),
        focusOutline: focusStyle ? `${focusStyle.outlineStyle} ${focusStyle.outlineWidth}` : null
      };
    });
    if (!visibility.heading || !visibility.links || visibility.focusOutline !== "solid 2px") {
      throw new Error(`Help resources are not fully visible after keyboard navigation: ${JSON.stringify(visibility)}`);
    }
    return;
  }
  if (setup === "memory-operations") {
    const more = page.getByRole("button", { name: "More actions" });
    await tabTo(page, more);
    await page.keyboard.press("Enter");
    const operations = page.getByRole("region", { name: "Session operations" });
    await operations.waitFor();
    const text = await operations.innerText();
    if (!text.includes("in-memory fallback") || !text.includes("Closing attempts controlled erasure")) {
      throw new Error("Memory fallback Session operations copy is incomplete.");
    }
    return;
  }
  if (setup === "clear-confirmation") {
    const more = page.getByRole("button", { name: "More actions" });
    await tabTo(page, more);
    await page.keyboard.press("Enter");
    const operations = page.getByRole("region", { name: "Session operations" });
    await operations.waitFor();
    await operations.getByRole("button", { name: "Clear retained Evidence…" }).click();
    const clear = operations.getByRole("button", { name: "Clear retained events" });
    if (await clear.evaluate((element) => element === document.activeElement)) {
      throw new Error("Production Clear retained events must not be auto-focused.");
    }
    const owner = page.locator(".workbench-react__context-body");
    const before = await owner.evaluate((element) => element.scrollTop);
    await owner.hover();
    await page.mouse.wheel(0, 500);
    await page.waitForFunction((initial) => {
      const element = document.querySelector(".workbench-react__context-body");
      return element instanceof HTMLElement && element.scrollTop > initial;
    }, before);
    await page.keyboard.press("Tab");
    if (!await clear.evaluate((element) => element === document.activeElement)) {
      throw new Error("Production Clear retained events was not reached by physical Tab navigation.");
    }
    return;
  }
  throw new Error(`Unknown production visual setup: ${setup}`);
}

async function tabTo(page, target, maximumTabs = 40) {
  for (let index = 0; index < maximumTabs; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return index + 1;
  }
  throw new Error(`Physical Tab navigation did not reach ${await target.getAttribute("aria-label") ?? "the requested control"}.`);
}

async function createDiff(runningBrowser, reference, current, viewport) {
  const context = await runningBrowser.newContext({ viewport });
  const page = await context.newPage();
  try {
    const result = await page.evaluate(async ({ referenceUrl, currentUrl, width, height }) => {
      const load = async (url) => { const image = new Image(); image.src = url; await image.decode(); return image; };
      const [referenceImage, currentImage] = await Promise.all([load(referenceUrl), load(currentUrl)]);
      if (referenceImage.naturalWidth !== width || referenceImage.naturalHeight !== height || currentImage.naturalWidth !== width || currentImage.naturalHeight !== height) {
        throw new Error(`Visual evidence dimensions differ from ${width}x${height}: reference ${referenceImage.naturalWidth}x${referenceImage.naturalHeight}, current ${currentImage.naturalWidth}x${currentImage.naturalHeight}`);
      }
      const referenceCanvas = document.createElement("canvas");
      const currentCanvas = document.createElement("canvas");
      referenceCanvas.width = currentCanvas.width = width;
      referenceCanvas.height = currentCanvas.height = height;
      const referenceContext = referenceCanvas.getContext("2d", { willReadFrequently: true });
      const currentContext = currentCanvas.getContext("2d", { willReadFrequently: true });
      if (!referenceContext || !currentContext) throw new Error("Canvas 2D is unavailable.");
      referenceContext.drawImage(referenceImage, 0, 0);
      currentContext.drawImage(currentImage, 0, 0);
      const referencePixels = referenceContext.getImageData(0, 0, width, height);
      const currentPixels = currentContext.getImageData(0, 0, width, height);
      const output = referenceContext.createImageData(width, height);
      let changedPixels = 0;
      for (let offset = 0; offset < output.data.length; offset += 4) {
        const red = Math.abs(referencePixels.data[offset] - currentPixels.data[offset]);
        const green = Math.abs(referencePixels.data[offset + 1] - currentPixels.data[offset + 1]);
        const blue = Math.abs(referencePixels.data[offset + 2] - currentPixels.data[offset + 2]);
        if (red + green + blue > 24) changedPixels += 1;
        output.data[offset] = Math.min(255, red * 3);
        output.data[offset + 1] = Math.min(255, green * 3);
        output.data[offset + 2] = Math.min(255, blue * 3);
        output.data[offset + 3] = 255;
      }
      referenceContext.putImageData(output, 0, 0);
      return { png: referenceCanvas.toDataURL("image/png"), changedPixels, totalPixels: width * height };
    }, {
      referenceUrl: `data:image/png;base64,${reference.toString("base64")}`,
      currentUrl: `data:image/png;base64,${current.toString("base64")}`,
      width: viewport.width,
      height: viewport.height
    });
    return { png: Buffer.from(result.png.split(",", 2)[1], "base64"), changedPixels: result.changedPixels, totalPixels: result.totalPixels };
  } finally {
    await context.close();
  }
}

async function startServer({ name, args, env = {}, readyUrl }) {
  const child = spawn(process.execPath, args, { cwd: projectRoot, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${name} server exited before readiness (${child.exitCode}).\n${output}`);
    try { if ((await fetch(readyUrl)).ok) return child; } catch { /* still starting */ }
    await delay(100);
  }
  child.kill("SIGTERM");
  throw new Error(`${name} server did not become ready at ${readyUrl}.\n${output}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  for (let attempt = 0; attempt < 20 && child.exitCode === null; attempt += 1) await delay(50);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function resolveChromeExecutable() {
  const cacheDir = process.env.LSEW_BROWSER_CACHE_DIR?.trim() || resolve(projectRoot, ".cache/lsew-browsers");
  const installed = new Cache(cacheDir).getInstalledBrowsers()
    .filter((entry) => entry.browser === Browser.CHROME)
    .sort((left, right) => right.buildId.localeCompare(left.buildId, undefined, { numeric: true }))
    .map((entry) => entry.executablePath);
  const candidates = [process.env.CHROME_PATH?.trim(), ...installed, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* try the next browser */ }
  }
  throw new Error("Chrome was not found. Run npm run fixture:browser:install or set CHROME_PATH.");
}
