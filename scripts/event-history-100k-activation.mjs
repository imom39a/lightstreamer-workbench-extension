#!/usr/bin/env node

/**
 * Visible Chrome for Testing 151 gate for the production 100k normal tier.
 * This is deliberately separate from the historical 1k/1,692 timing baseline:
 * every cell gets a fresh temporary profile and identity evidence is bounded.
 */
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { Browser, Cache } from "@puppeteer/browsers";
import { chromium } from "playwright";
import { build } from "esbuild";
import { chromeTestArguments } from "./chrome-test-policy.mjs";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDir = resolve(rootDir, process.env.LSEW_HISTORY_100K_OUTPUT ?? "test-results/history-100k-07");
const outputPath = join(outputDir, "activation.json");
const markdownPath = join(outputDir, "activation.md");
const samples = Number(process.env.LSEW_HISTORY_100K_SAMPLES ?? "3");
const workloadNames = (process.env.LSEW_HISTORY_100K_WORKLOADS ?? "small-lifecycle,ordinary-item-update,large-json-rich,representative-50-40-10")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (process.env.LSEW_BROWSER_HEADLESS !== "false" || process.env.LSEW_UI_HEADLESS !== "false") {
  throw new Error("100k activation requires LSEW_BROWSER_HEADLESS=false and LSEW_UI_HEADLESS=false.");
}
if (!Number.isSafeInteger(samples) || samples < 3) throw new Error("100k activation requires at least three independent samples.");
if (workloadNames.length !== 4) throw new Error("100k activation requires all four workload shapes.");

const cacheDir = resolve(rootDir, process.env.LSEW_BROWSER_CACHE_DIR ?? ".cache/lsew-browsers");
const chromeExecutable = resolvePinnedChrome(cacheDir);
const extensionPath = resolve(rootDir, "dist");
await access(extensionPath, constants.R_OK).catch(() => {
  throw new Error("100k activation requires the production extension build at dist/extension; run npm run build first.");
});
const temporaryRoot = await mkdtemp(join(tmpdir(), "lsew-history-100k-07-"));
const bundlePath = join(temporaryRoot, "activation-harness.js");
const server = createServer(async (request, response) => {
  if (request.url === "/activation-harness.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    response.end(await readFile(bundlePath));
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end("<!doctype html><html><head><meta charset=\"utf-8\"><title>History 100k activation</title></head><body><div id=\"app\"></div><script type=\"module\" src=\"/activation-harness.js\"></script></body></html>");
});

let address;
try {
  await build({
    absWorkingDir: rootDir,
    entryPoints: [resolve(rootDir, "benchmarks/event-history-100k-activation-harness.ts")],
    outfile: bundlePath,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome151",
    sourcemap: false,
    logLevel: "silent"
  });
  await mkdir(outputDir, { recursive: true });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  address = server.address();
  if (!address || typeof address === "string") throw new Error("Activation server did not expose a TCP address.");

  const cells = [];
  const profiles = [];
  const diagnostics = [];
  for (const workload of workloadNames) {
    for (let sample = 1; sample <= samples; sample += 1) {
      const profile = await mkdtemp(join(temporaryRoot, `profile-${workload}-${sample}-`));
      profiles.push({ workload, sample, profile, isolated: true });
      let context;
      try {
        context = await chromium.launchPersistentContext(profile, {
          executablePath: chromeExecutable,
          headless: false,
          viewport: { width: 900, height: 700 },
          colorScheme: sample % 2 === 0 ? "light" : "dark",
          args: chromeTestArguments({
            headless: false,
            disableNativeOcclusion: true,
              activateOnLaunch: process.platform === "darwin",
              exposeGc: true,
            additional: [
              "--remote-debugging-port=0",
              `--disable-extensions-except=${extensionPath}`,
              `--load-extension=${extensionPath}`
            ]
          })
        });
        const page = context.pages()[0] ?? await context.newPage();
        page.setDefaultTimeout(1_800_000);
        page.on("console", (message) => {
          if (message.type() === "warning" || message.type() === "error") diagnostics.push(`${workload}/${sample}: console ${message.type()}: ${message.text()}`);
        });
        page.on("pageerror", (error) => diagnostics.push(`${workload}/${sample}: pageerror: ${error.message}`));
        await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "load" });
        await page.waitForFunction(() => Boolean(window.__LSEW_HISTORY_100K_ACTIVATION__));
        const cell = await page.evaluate(async ({ workload: selectedWorkload, sample: selectedSample }) => {
          return window.__LSEW_HISTORY_100K_ACTIVATION__?.run(selectedWorkload, selectedSample);
        }, { workload, sample });
        if (!cell) throw new Error("100k activation harness did not return a cell.");
        const screenshotPath = join(outputDir, `${workload}-${sample}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        cells.push({ ...cell, screenshot: screenshotPath });
      } finally {
        await context?.close();
        await rm(profile, { recursive: true, force: true });
      }
    }
  }

  const failures = [];
  for (const cell of cells) {
    for (const [name, value] of Object.entries(cell.correctness)) {
      if (value !== true) failures.push(`${cell.workload}/${cell.sample} correctness ${name} failed`);
    }
    if (cell.workload === "large-json-rich") {
      if (cell.acceptedCount >= 100_000) failures.push(`${cell.workload}/${cell.sample} did not refuse below 100,000.`);
      if (cell.canonicalLogicalBytes >= 256 * 1_048_576) failures.push(`${cell.workload}/${cell.sample} exceeded canonical 256 MiB envelope.`);
    } else if (cell.acceptedCount !== 100_000) {
      failures.push(`${cell.workload}/${cell.sample} accepted ${cell.acceptedCount}, expected 100,000.`);
    }
  }
  if (diagnostics.length > 0) failures.push(...diagnostics);
  if (cells.length !== workloadNames.length * samples) failures.push(`Expected ${workloadNames.length * samples} cells, received ${cells.length}.`);
  if (cells.some((cell) => !cell.pressure.reachedNearLimit)) failures.push("At least one cell did not publish NEAR_LIMIT at the 80% retained threshold.");

  const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" }).trim();
  const sourceDirty = execFileSync("git", ["status", "--porcelain"], { cwd: rootDir, encoding: "utf8" }).trim().length > 0;
  if (sourceDirty) failures.push("Source worktree is dirty; activation evidence must be captured from the committed integration SHA.");

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    verdict: failures.length === 0 ? "PASS" : "FAIL",
    runner: {
      kind: "real-chrome",
      headless: false,
      fakeIndexedDbUsed: false,
      product: await browserProduct(chromeExecutable),
      chromeMajor: 151,
      policyFlags: chromeTestArguments({ headless: false, additional: ["--remote-debugging-port=0"] }),
      profileIsolation: profiles.map(({ workload, sample, isolated }) => ({ workload, sample, isolated, freshTemporaryProfile: true }))
    },
    source: {
      revision: sourceRevision,
      dirty: sourceDirty
    },
    contract: {
      normal: { maxRetainedCount: 100_000, maxRetainedBytes: 256 * 1_048_576, retainedWarningCount: 80_000, retainedWarningBytes: Math.ceil(256 * 1_048_576 * 0.8) },
      lower: { maxRetainedCount: 5_000, maxRetainedBytes: 32 * 1_048_576, retainedWarningCount: 4_000, retainedWarningBytes: Math.ceil(32 * 1_048_576 * 0.8) },
      pending: { warningBytes: 16 * 1_048_576, stopBytes: 32 * 1_048_576, normalAgeMs: 30_000, lowerAgeMs: 5_000 },
      canonicalLogicalBytesIsQuotaReservation: false,
      physicalIndexedDbUsageIsQuotaReservation: false,
      quotaBytesIsReservation: false,
      noUnlimitedStoragePermission: true
    },
    cells,
    failures
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(markdownPath, renderMarkdown(report));
  console.log(JSON.stringify({ verdict: report.verdict, outputPath, markdownPath, cellCount: cells.length, failures }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
} finally {
  if (server.listening) await new Promise((resolvePromise) => server.close(() => resolvePromise()));
  await rm(temporaryRoot, { recursive: true, force: true });
}

function resolvePinnedChrome(directory) {
  const installed = new Cache(directory)
    .getInstalledBrowsers()
    .filter((entry) => entry.browser === Browser.CHROME && String(entry.buildId).startsWith("151."))
    .sort((left, right) => right.buildId.localeCompare(left.buildId, undefined, { numeric: true }));
  const executable = installed[0]?.executablePath;
  if (!executable) throw new Error(`Pinned Chrome for Testing 151 is missing from ${directory}; refusing system-Chrome fallback.`);
  return executable;
}

async function browserProduct(executable) {
  const profile = await mkdtemp(join(tmpdir(), "lsew-history-100k-product-"));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: executable,
    headless: false,
    args: chromeTestArguments({ headless: false, additional: ["--remote-debugging-port=0"] })
  });
  try {
    return await context.browser()?.version();
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
}

function renderMarkdown(report) {
  const lines = [
    "# History 100k activation proof",
    "",
    `Verdict: **${report.verdict}**`,
    `Chrome: **${report.runner.product}**; visible: **${!report.runner.headless}**; fake IndexedDB: **${report.runner.fakeIndexedDbUsed}**`,
    `Profiles: **${report.runner.profileIsolation.length}** fresh temporary profiles; no profile reuse`,
    "",
    "Canonical logical bytes are recorded separately from physical origin usage and quota estimates; none is treated as a reservation.",
    "",
    "| Workload | Sample | Accepted | Retained | Canonical bytes | Physical usage Δ | Quota estimate | Terminal | First missing | Near limit |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |",
    ...report.cells.map((cell) => `| ${cell.workload} | ${cell.sample} | ${cell.acceptedCount.toLocaleString()} | ${cell.retainedCount.toLocaleString()} | ${cell.canonicalLogicalBytes.toLocaleString()} | ${cell.physicalIndexedDbUsageDeltaBytes ?? "not measured"} | ${cell.quotaBytes ?? "not measured"} | ${cell.terminal.reason ?? "none"} | ${cell.terminal.firstMissingEventId ?? "none"} | ${cell.pressure.reachedNearLimit} |`),
    "",
    "Identity evidence is bounded to count, rolling digest, endpoints, and seven deterministic samples; no 100,000-element payload or identity collection is retained.",
    "",
    "## Failures",
    "",
    ...(report.failures.length === 0 ? ["None."] : report.failures.map((failure) => `- ${failure}`))
  ];
  return `${lines.join("\n")}\n`;
}
