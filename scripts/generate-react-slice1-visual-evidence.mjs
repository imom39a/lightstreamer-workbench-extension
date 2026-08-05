#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { Browser, Cache } from "@puppeteer/browsers";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const artifactRoot = resolve(projectRoot, "test-results/react-slice1-visual-qa");
const prototypePort = Number(process.env.LSEW_VISUAL_PROTOTYPE_PORT ?? 4191);
const reactPort = Number(process.env.LSEW_VISUAL_REACT_PORT ?? 4192);
const scenarios = [
  {
    id: "normal-selected-dark",
    viewport: { width: 900, height: 700 },
    frame: "normal",
    theme: "dark",
    prototypeState: "selected",
    reactScenario: "live-selected",
    disposition: "comparable"
  },
  {
    id: "compact-selected-light",
    viewport: { width: 563, height: 700 },
    frame: "compact",
    theme: "light",
    prototypeState: "selected",
    reactScenario: "live-selected",
    disposition: "comparable"
  },
  {
    id: "shallow-frozen-dark",
    viewport: { width: 900, height: 320 },
    frame: "shallow",
    theme: "dark",
    prototypeState: "frozen",
    reactScenario: "frozen-high-volume",
    disposition: "comparable"
  },
  {
    id: "wide-command-dark",
    viewport: { width: 1440, height: 900 },
    frame: "wide",
    theme: "dark",
    prototypeState: "command",
    reactScenario: "live-selected",
    disposition: "reference-only"
  }
];

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: node scripts/generate-react-slice1-visual-evidence.mjs [--print-matrix]

Generates inspectable base, changed, and diff PNGs for the React Slice 1
visual-QA packet. Base images come from the accepted integrated prototype;
changed images come from deterministic React scenarios. Diffs are truthful
reference deltas, not a pixel-parity acceptance gate.

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
  await Promise.all([
    mkdir(join(artifactRoot, "base"), { recursive: true }),
    mkdir(join(artifactRoot, "changed"), { recursive: true }),
    mkdir(join(artifactRoot, "diff"), { recursive: true })
  ]);

  children.push(
    await startServer({
      name: "accepted prototype",
      args: [
        resolve(projectRoot, "node_modules/vite/bin/vite.js"),
        "prototypes",
        "--host",
        "127.0.0.1",
        "--port",
        String(prototypePort),
        "--strictPort"
      ],
      readyUrl: `http://127.0.0.1:${prototypePort}/workbench-ui-10/`
    })
  );
  children.push(
    await startServer({
      name: "React scenario",
      args: [resolve(projectRoot, "scripts/react-ui-panel-server.mjs")],
      env: { LSEW_REACT_UI_PORT: String(reactPort) },
      readyUrl: `http://127.0.0.1:${reactPort}/index.html`
    })
  );

  const chromeExecutable = await resolveChromeExecutable();
  browser = await chromium.launch({ executablePath: chromeExecutable, headless: true });
  const results = [];

  for (const scenario of scenarios) {
    const basePath = join(artifactRoot, "base", `${scenario.id}.png`);
    const changedPath = join(artifactRoot, "changed", `${scenario.id}.png`);
    const diffPath = join(artifactRoot, "diff", `${scenario.id}.png`);
    const base = await capturePrototype(browser, scenario);
    const changed = await captureReact(browser, scenario);
    const diff = await createDiff(browser, base, changed, scenario.viewport);
    await Promise.all([
      writeFile(basePath, base),
      writeFile(changedPath, changed),
      writeFile(diffPath, diff.png)
    ]);
    results.push({
      ...matrixEntry(scenario),
      base: relative(projectRoot, basePath),
      changed: relative(projectRoot, changedPath),
      diff: relative(projectRoot, diffPath),
      changedPixels: diff.changedPixels,
      totalPixels: diff.totalPixels,
      changedRatio: diff.changedPixels / diff.totalPixels
    });
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    command: "node scripts/generate-react-slice1-visual-evidence.mjs",
    browser: await browser.version(),
    chromeExecutable,
    source: {
      base: "accepted prototypes/workbench-ui-10 variant A",
      changed: "deterministic React Diagnose scenario harness",
      diff: "absolute per-channel pixel delta; inspectable reference only"
    },
    durationMs: Date.now() - startedAt,
    scenarios: results
  };
  const manifestPath = join(artifactRoot, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.table(
    results.map((result) => ({
      scenario: result.id,
      viewport: `${result.viewport.width}x${result.viewport.height}`,
      theme: result.theme,
      disposition: result.disposition,
      delta: `${(result.changedRatio * 100).toFixed(1)}%`
    }))
  );
  console.log(`Visual evidence: ${manifestPath}`);
} finally {
  await browser?.close();
  await Promise.all(children.reverse().map(stopServer));
}

function publicMatrix() {
  return {
    artifactRoot: "test-results/react-slice1-visual-qa",
    scenarios: scenarios.map(matrixEntry)
  };
}

function matrixEntry(scenario) {
  return {
    id: scenario.id,
    viewport: scenario.viewport,
    theme: scenario.theme,
    prototypeState: scenario.prototypeState,
    reactScenario: scenario.reactScenario,
    disposition: scenario.disposition
  };
}

async function capturePrototype(runningBrowser, scenario) {
  const context = await runningBrowser.newContext({
    viewport: {
      width: scenario.viewport.width + 20,
      height: scenario.viewport.height + 20
    },
    colorScheme: scenario.theme
  });
  const page = await context.newPage();
  try {
    const query = new URLSearchParams({
      variant: "A",
      state: scenario.prototypeState,
      frame: scenario.frame,
      theme: scenario.theme,
      presentation: "1"
    });
    await page.goto(
      `http://127.0.0.1:${prototypePort}/workbench-ui-10/?${query}`,
      { waitUntil: "networkidle" }
    );
    const workbench = page.locator(".workbench");
    await workbench.waitFor({ state: "visible" });
    await page.evaluate(() => document.fonts.ready);
    return await workbench.screenshot({ animations: "disabled", caret: "hide" });
  } finally {
    await context.close();
  }
}

async function captureReact(runningBrowser, scenario) {
  const context = await runningBrowser.newContext({
    viewport: scenario.viewport,
    colorScheme: scenario.theme
  });
  const page = await context.newPage();
  try {
    const query = new URLSearchParams({
      scenario: scenario.reactScenario,
      theme: scenario.theme
    });
    await page.goto(`http://127.0.0.1:${reactPort}/?${query}`, { waitUntil: "networkidle" });
    await page.locator('html[data-react-scene-ready="true"]').waitFor();
    const workbench = page.locator(".workbench-react");
    await workbench.waitFor({ state: "visible" });
    await page.evaluate(() => document.fonts.ready);
    return await workbench.screenshot({ animations: "disabled", caret: "hide" });
  } finally {
    await context.close();
  }
}

async function createDiff(runningBrowser, base, changed, viewport) {
  const context = await runningBrowser.newContext({ viewport });
  const page = await context.newPage();
  try {
    const result = await page.evaluate(
      async ({ baseUrl, changedUrl, width, height }) => {
        const load = async (url) => {
          const image = new Image();
          image.src = url;
          await image.decode();
          return image;
        };
        const [baseImage, changedImage] = await Promise.all([load(baseUrl), load(changedUrl)]);
        if (
          baseImage.naturalWidth !== width ||
          baseImage.naturalHeight !== height ||
          changedImage.naturalWidth !== width ||
          changedImage.naturalHeight !== height
        ) {
          throw new Error(
            `Visual evidence dimensions differ from ${width}x${height}: base ${baseImage.naturalWidth}x${baseImage.naturalHeight}, changed ${changedImage.naturalWidth}x${changedImage.naturalHeight}`
          );
        }
        const source = document.createElement("canvas");
        const comparison = document.createElement("canvas");
        source.width = comparison.width = width;
        source.height = comparison.height = height;
        const sourceContext = source.getContext("2d", { willReadFrequently: true });
        const comparisonContext = comparison.getContext("2d", { willReadFrequently: true });
        if (!sourceContext || !comparisonContext) throw new Error("Canvas 2D is unavailable.");
        sourceContext.drawImage(baseImage, 0, 0);
        comparisonContext.drawImage(changedImage, 0, 0);
        const basePixels = sourceContext.getImageData(0, 0, width, height);
        const changedPixels = comparisonContext.getImageData(0, 0, width, height);
        const output = sourceContext.createImageData(width, height);
        let changedCount = 0;
        for (let offset = 0; offset < output.data.length; offset += 4) {
          const red = Math.abs(basePixels.data[offset] - changedPixels.data[offset]);
          const green = Math.abs(basePixels.data[offset + 1] - changedPixels.data[offset + 1]);
          const blue = Math.abs(basePixels.data[offset + 2] - changedPixels.data[offset + 2]);
          if (red + green + blue > 24) changedCount += 1;
          output.data[offset] = Math.min(255, red * 3);
          output.data[offset + 1] = Math.min(255, green * 3);
          output.data[offset + 2] = Math.min(255, blue * 3);
          output.data[offset + 3] = 255;
        }
        sourceContext.putImageData(output, 0, 0);
        return {
          png: source.toDataURL("image/png"),
          changedPixels: changedCount,
          totalPixels: width * height
        };
      },
      {
        baseUrl: `data:image/png;base64,${base.toString("base64")}`,
        changedUrl: `data:image/png;base64,${changed.toString("base64")}`,
        width: viewport.width,
        height: viewport.height
      }
    );
    return {
      png: Buffer.from(result.png.split(",", 2)[1], "base64"),
      changedPixels: result.changedPixels,
      totalPixels: result.totalPixels
    };
  } finally {
    await context.close();
  }
}

async function startServer({ name, args, env = {}, readyUrl }) {
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${name} server exited before readiness (${child.exitCode}).\n${output}`);
    }
    try {
      const response = await fetch(readyUrl);
      if (response.ok) return child;
    } catch {
      // The local server is still starting.
    }
    await delay(100);
  }
  child.kill("SIGTERM");
  throw new Error(`${name} server did not become ready at ${readyUrl}.\n${output}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  for (let attempt = 0; attempt < 20 && child.exitCode === null; attempt += 1) {
    await delay(50);
  }
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function resolveChromeExecutable() {
  const cacheDir = process.env.LSEW_BROWSER_CACHE_DIR?.trim() || resolve(projectRoot, ".cache/lsew-browsers");
  const installed = new Cache(cacheDir)
    .getInstalledBrowsers()
    .filter((entry) => entry.browser === Browser.CHROME)
    .sort((left, right) => right.buildId.localeCompare(left.buildId, undefined, { numeric: true }))
    .map((entry) => entry.executablePath);
  const candidates = [
    process.env.CHROME_PATH?.trim(),
    ...installed,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next local browser.
    }
  }
  throw new Error("Chrome was not found. Run fixture:browser:install or set CHROME_PATH.");
}
