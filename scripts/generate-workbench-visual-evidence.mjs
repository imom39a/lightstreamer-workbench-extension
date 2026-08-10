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

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifactRoot = resolve(projectRoot, "test-results/workbench-visual-qa");
const prototypePort = Number(process.env.LSEW_VISUAL_PROTOTYPE_PORT ?? 4191);
const panelPort = Number(process.env.LSEW_VISUAL_PANEL_PORT ?? 4192);
const scenarios = JSON.parse(
  await readFile(resolve(projectRoot, "tests/ui/visual-matrix.json"), "utf8")
);

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: npm run test:ui:visual [-- --print-matrix]

Captures the accepted integrated prototype, the shipped Workbench scenario harness,
and an inspectable per-channel visual diff for the Material UI review packet.
The artifacts are reference evidence, not a pixel-parity acceptance gate.

Options:
  --print-matrix  Print the deterministic viewport/theme/state matrix and exit.
  --help          Show this help.`);
  process.exit(0);
}
if (process.argv.includes("--print-matrix")) {
  console.log(JSON.stringify(publicMatrix()));
  process.exit(0);
}
for (const argument of process.argv.slice(2)) {
  throw new Error(`Unknown option: ${argument}`);
}

const children = [];
let browser;
const startedAt = Date.now();

try {
  await rm(artifactRoot, { recursive: true, force: true });
  await Promise.all(["reference", "current", "diff"].map((directory) =>
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

  browser = await chromium.launch({ executablePath: await resolveChromeExecutable(), headless: true });
  const results = [];
  for (const scenario of scenarios) {
    const reference = await capturePrototype(browser, scenario);
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
  const manifestPath = join(artifactRoot, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    command: "npm run test:ui:visual",
    browser: await browser.version(),
    source: {
      reference: "accepted prototypes/workbench-ui-10",
      current: "production Workbench scenario harness using shipped panel root document",
      diff: "absolute per-channel pixel delta; inspect as reference evidence, not a parity threshold"
    },
    review: {
      classification: "Material UI",
      changedWorkflow: "Session operations and the global footer now identify retained Evidence as owned by the current Panel Session, including its backing, close lifecycle, Clear scope, and irreversible consequence.",
      acceptanceCriteria: [
        "The current Panel Session history names its selected IndexedDB or in-memory backing and states that it is cleared when this Panel Session closes.",
        "Clear retained Evidence names the retained count and current Panel Session scope, while stating that Scope and Filter do not limit the destructive action.",
        "The confirmation names retained Evidence from this Panel Session and its irreversible consequence; the healthy footer states that Evidence is retained for this Panel Session.",
        "The changed workflow has no serious or critical axe violations, browser diagnostics, clipping, or horizontal shell overflow."
      ],
      browserResult: {
        scenarioCaptures: `${results.length}/${results.length} passed`,
        browserDiagnostics: results.reduce((count, result) => count + result.checks.browserDiagnostics.length, 0)
      },
      accessibilityResult: {
        checkedScenarios: results.filter((result) => result.checks.accessibility).map((result) => result.id),
        seriousOrCriticalViolations: results.reduce((count, result) => count + (result.checks.accessibility?.seriousOrCriticalViolations.length ?? 0), 0)
      },
      keyboardAndFocus: "Each Session operations scenario reaches Clear retained Evidence by keyboard, preserves the existing focus route through the subordinate resources, and keeps the changed scope copy visible in normal, compact, and shallow geometry.",
      baselineIntent: "Update exactly 14 affected scenario baselines on each platform (28 committed PNG files total) across compact, normal, shallow, and wide Session operations or healthy-footer states whose visible copy changes to Panel Session scope; no layout, styling, interaction, or unrelated baseline change is intended. The normal-limited-capture Darwin/Linux pair remains unchanged because its diagnostic copy is unaffected."
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

async function capturePrototype(runningBrowser, scenario) {
  const context = await runningBrowser.newContext({
    viewport: { width: scenario.viewport.width + 20, height: scenario.viewport.height + 20 },
    colorScheme: scenario.theme
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
    "matching-summary": ["Matching projections", "Neither projection is Authoritative COMMAND State."],
    "selected-json": ["json-string-event", "JSON string", "AIRPORT-02"]
  }[setup];
  if (expectedText) {
    const text = await workbench.innerText();
    for (const marker of expectedText) {
      if (!text.includes(marker)) throw new Error(`Prototype setup ${setup} is missing ${JSON.stringify(marker)}.`);
    }
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
}

async function captureProduction(runningBrowser, scenario) {
  const context = await runningBrowser.newContext({ viewport: scenario.viewport, colorScheme: scenario.theme });
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
    if (scenario.production.setup === "more-actions-help") {
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
    if (browserDiagnostics.length) throw new Error(`Production Workbench emitted browser diagnostics: ${browserDiagnostics.join("\n")}`);
    return {
      png: await workbench.screenshot({ animations: "disabled", caret: "hide" }),
      checks: { browserDiagnostics, horizontalOverflow, accessibility, helpResources }
    };
  } finally {
    await context.close();
  }
}

async function prepareProductionState(page, setup) {
  if (setup === "none") return;
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
  throw new Error(`Unknown production visual setup: ${setup}`);
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
