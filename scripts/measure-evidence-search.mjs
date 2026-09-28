#!/usr/bin/env node

/** Focused search latency/correctness proof, not the full 100k retention activation gate. */
import { createServer } from "node:http";
import { access, appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Browser, Cache } from "@puppeteer/browsers";
import { chromium } from "playwright";
import { build } from "esbuild";
import { chromeTestArguments } from "./chrome-test-policy.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(root, process.env.LSEW_SEARCH_PERF_OUTPUT ?? "test-results/search-review/performance");
const cache = resolve(root, process.env.LSEW_BROWSER_CACHE_DIR ?? ".cache/lsew-browsers");
const samples = Number(process.env.LSEW_SEARCH_PERF_SAMPLES ?? "3");
const retainedCount = process.env.LSEW_SEARCH_PERF_RETAINED_COUNT === undefined ? undefined : Number(process.env.LSEW_SEARCH_PERF_RETAINED_COUNT);
const cpuProfile = process.env.LSEW_SEARCH_PERF_PROFILE === "1";
const diagnosticProfileThresholdMs = process.env.LSEW_SEARCH_PERF_PROFILE_SLOW_MS === undefined ? undefined : Number(process.env.LSEW_SEARCH_PERF_PROFILE_SLOW_MS);
const liveAppend = process.env.LSEW_SEARCH_PERF_LIVE_APPEND === "1";
const firstColdOperation = liveAppend ? "pre-append-broad-query" : "initial-broad-query";
const queryGate = process.env.LSEW_SEARCH_PERF_QUERY_GATE ? resolve(root, process.env.LSEW_SEARCH_PERF_QUERY_GATE) : null;
const timeoutMs = Number(process.env.LSEW_SEARCH_PERF_TIMEOUT_MS ?? "1800000");
const hostNote = process.env.LSEW_SEARCH_PERF_HOST_NOTE ?? "Host load was not controlled.";
const adapters = (process.env.LSEW_SEARCH_PERF_ADAPTERS ?? "indexeddb,memory").split(",");
if (!Number.isSafeInteger(samples) || samples < 1 || samples > 10) throw new Error("Search performance samples must be an integer from 1 to 10.");
if (diagnosticProfileThresholdMs !== undefined && (!Number.isFinite(diagnosticProfileThresholdMs) || diagnosticProfileThresholdMs <= 0)) throw new Error("Diagnostic profile threshold must be a positive finite number of milliseconds.");
if (retainedCount !== undefined && (!Number.isSafeInteger(retainedCount) || retainedCount < 2_000 || retainedCount % 2 !== 0 || retainedCount > 100_000)) throw new Error("Exploratory retained count must be an even integer from 2,000 to 100,000.");
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000) throw new Error("Search performance timeout must be a positive integer of at least 1,000 ms.");
if (adapters.length === 0 || adapters.some(adapter => !["indexeddb", "memory"].includes(adapter)) || new Set(adapters).size !== adapters.length) throw new Error("Search performance adapters must be indexeddb,memory or one of those adapters.");
const installed = new Cache(cache).getInstalledBrowsers().filter(browser => browser.browser === Browser.CHROME && browser.buildId.startsWith("151."))
  .sort((left, right) => right.buildId.localeCompare(left.buildId, undefined, { numeric: true }));
const executablePath = installed[0]?.executablePath;
if (!executablePath) throw new Error(`Chrome for Testing 151 is required in ${cache}; no system-browser fallback.`);
const temporary = await mkdtemp(join(tmpdir(), "lsew-search-performance-"));
const bundle = join(temporary, "harness.js");
const server = createServer(async (request, response) => {
  if (request.url === "/harness.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    response.end(await readFile(bundle));
  } else {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end('<!doctype html><html><head><meta charset="utf-8"><title>Evidence search performance</title></head><body><script type="module" src="/harness.js"></script></body></html>');
  }
});
let browser;
let bundleSha256;
let sourceAtBundle;
const results = [];
const diagnostics = [];
const started = new Date().toISOString();
try {
  await mkdir(output, { recursive: true });
  sourceAtBundle = {
    capturedAt: new Date().toISOString(),
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    workingTree: execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" }).trim()
  };
  await build({ absWorkingDir: root, entryPoints: [join(root, "benchmarks/evidence-search-performance-harness.ts")], outfile: bundle,
    bundle: true, format: "esm", platform: "browser", target: "chrome151", logLevel: "silent" });
  const bundledSource = await readFile(bundle);
  bundleSha256 = createHash("sha256").update(bundledSource).digest("hex");
  await writeFile(join(output, "compiled-harness.js"), bundledSource);
  await writeFile(join(output, "bundle-provenance.json"), `${JSON.stringify({ ...sourceAtBundle, bundleSha256 }, null, 2)}\n`);
  await new Promise((accept, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", accept); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Search performance server did not expose a TCP address.");
  browser = await chromium.launch({ executablePath, headless: true, args: chromeTestArguments({ headless: true, disableNativeOcclusion: true }) });
  for (const adapter of adapters) {
    const context = await browser.newContext();
    const page = await context.newPage();
    let gateCancelled = false;
    if (queryGate) {
      await page.exposeBinding("__evidenceSearchPerformanceBeforeQueries", async () => {
        console.log(`search-performance ${adapter}: waiting for query gate ${queryGate}`);
        while (!await access(queryGate).then(() => true, () => false)) {
          if (gateCancelled) throw new Error("Query gate cancelled after the browser context closed.");
          await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
        }
        console.log(`search-performance ${adapter}: query gate opened`);
      });
    }
    const profileSession = cpuProfile || diagnosticProfileThresholdMs !== undefined ? await context.newCDPSession(page) : null;
    let profileActive = false;
    let profileFilename = `${adapter}-cold-query.cpuprofile`;
    const stopProfile = async () => {
      if (!profileActive || !profileSession) return;
      const { profile } = await profileSession.send("Profiler.stop");
      profileActive = false;
      await writeFile(join(output, profileFilename), `${JSON.stringify(profile)}\n`);
    };
    if (profileSession) {
      await profileSession.send("Profiler.enable");
      await profileSession.send("Profiler.setSamplingInterval", { interval: 100 });
    }
    if (profileSession && cpuProfile) {
      await page.exposeBinding("__evidenceSearchPerformanceBeforeMeasure", async (_source, operation, sample) => {
        if (operation === firstColdOperation && sample === 1) {
          await profileSession.send("Profiler.start");
          profileActive = true;
        }
      });
      await page.exposeBinding("__evidenceSearchPerformanceAfterMeasure", async (_source, operation, sample) => {
        if (operation === firstColdOperation && sample === 1) await stopProfile();
      });
    }
    if (profileSession && diagnosticProfileThresholdMs !== undefined) {
      await page.exposeBinding("__evidenceSearchPerformanceBeforeDiagnosticProfile", async () => {
        profileFilename = `${adapter}-diagnostic-cold-query.cpuprofile`;
        await profileSession.send("Profiler.start");
        profileActive = true;
      });
      await page.exposeBinding("__evidenceSearchPerformanceAfterDiagnosticProfile", stopProfile);
    }
    const measurementsPath = join(output, `${adapter}-measurements.jsonl`);
    await writeFile(measurementsPath, "");
    let progressWrites = Promise.resolve();
    page.on("console", event => {
      const text = event.text();
      if (text.startsWith("search-performance-result ")) {
        const json = text.slice("search-performance-result ".length);
        progressWrites = progressWrites.then(() => appendFile(measurementsPath, `${json}\n`));
      } else if (text.startsWith("search-performance")) console.log(text);
    });
    page.on("pageerror", error => diagnostics.push({ adapter, error: String(error) }));
    try {
      await page.goto(`http://127.0.0.1:${address.port}/`);
      await page.waitForFunction(() => Boolean(globalThis.__evidenceSearchPerformance));
      const result = await page.evaluate(async ({ adapter, samples, timeoutMs, retainedCount, liveAppend, diagnosticProfileThresholdMs }) => {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`Adapter search proof exceeded ${timeoutMs} ms.`)), timeoutMs));
        return await Promise.race([globalThis.__evidenceSearchPerformance.run(adapter, samples, retainedCount, liveAppend, diagnosticProfileThresholdMs), timeout]);
      }, { adapter, samples, timeoutMs, retainedCount, liveAppend, diagnosticProfileThresholdMs });
      results.push(result);
      await progressWrites;
      await writeFile(join(output, `${adapter}.json`), `${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      await progressWrites;
      const partial = await page.evaluate(() => globalThis.__evidenceSearchPerformanceProgress).catch(() => null);
      if (partial) await writeFile(join(output, `${adapter}-partial.json`), `${JSON.stringify(partial, null, 2)}\n`);
      throw error;
    } finally { gateCancelled = true; await stopProfile().catch(() => {}); await context.close().catch(() => {}); }
  }
  if (diagnostics.length > 0) throw new Error("Search performance page reported uncaught browser errors.");
  const report = {
    verdict: "PASS", started, completed: new Date().toISOString(),
    runner: { browser: browser.version(), executablePath, headless: true, fakeIndexedDb: false, normalProductionLimits: true, cpuProfile, diagnosticProfileThresholdMs, queryGate, liveAppend,
      atProductionRetentionLimit: results.every(result => result.atProductionRetentionLimit),
      measurement: "Browser performance.now around production EventHistory.query; excludes seeding and UI render/debounce; one fresh isolated browser context per adapter; sequential query samples use one seeded retained set." },
    source: { ...sourceAtBundle, bundleSha256 },
    hostNote,
    workload: `${results.map(result => `${result.retainedCount.toLocaleString("en-US")} ${result.adapter} ${result.capacity.tier}`).join(" and ")} retained COMMAND Item Updates; 5,000 repeated keys, six fields, alternating keep/exclude category, broad token in every record, one unique late token; seed through production offer/settled in batches of 256. Search requests reveal 60 rows and hydrate only the current match. Continuation requests return seven records without payloads or reveal pages.`,
    results, diagnostics
  };
  await writeFile(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(join(output, "failure.json"), { force: true });
  const lines = ["# Evidence search performance", "", `Correctness: **${report.verdict}**. Chromium ${report.runner.browser}, headless, production adapters with native browser APIs.`, "", report.workload, "", report.runner.measurement, "", report.hostNote, "", `Samples per operation and adapter: ${samples}. No baseline threshold is implied by PASS; latency is reported separately.`, "", "| Adapter | Retained | Operation | Median ms | Min ms | Max ms |", "|---|---:|---|---:|---:|---:|"];
  for (const result of results) {
    const operations = new Map();
    for (const measurement of result.measurements) {
      if (!operations.has(measurement.operation)) operations.set(measurement.operation, []);
      operations.get(measurement.operation).push(measurement.elapsedMs);
    }
    for (const [operation, times] of operations) {
      times.sort((left, right) => left - right);
      const middle = Math.floor(times.length / 2);
      const median = times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2;
      lines.push(`| ${result.adapter} | ${result.retainedCount.toLocaleString("en-US")} | ${operation} | ${median.toFixed(1)} | ${times[0].toFixed(1)} | ${times.at(-1).toFixed(1)} |`);
    }
  }
  lines.push("", "First cold Find (after an ordinary one-row Evidence read, before any Find query):");
  for (const result of results) {
    const cold = result.measurements.find(measurement => measurement.operation === result.firstColdOperation && measurement.sample === 1);
    lines.push(`- ${result.adapter}: ${cold.elapsedMs.toFixed(1)} ms (${result.firstColdOperation}). ${result.liveAppend ? "The first query precedes the final ten live appends; the full-capacity initial query uses a new readpoint after that warmup." : "Later initial-query samples reuse the same retained set."}`);
  }
  lines.push("", "Assertions cover exact retention and full counts, late Next/Previous, neighbors after match 1,000, Filter-consistent reveal pages, bounded response arrays, and at most one full-payload hydration per query.", "", "This targeted proof does not replace the complete retention/capture activation matrix or browser UI visibility tests.", "");
  await writeFile(join(output, "README.md"), lines.join("\n"));
  console.log(`Search performance proof PASS: ${output}`);
} catch (error) {
  await writeFile(join(output, "failure.json"), `${JSON.stringify({ verdict: "FAIL", started, source: { ...sourceAtBundle, bundleSha256 }, error: String(error), results, diagnostics }, null, 2)}\n`).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolvePromise => server.close(resolvePromise));
  await rm(temporary, { recursive: true, force: true });
}
