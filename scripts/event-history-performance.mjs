#!/usr/bin/env node

/** Real-Chrome Event History evidence runner. fake-indexeddb is deliberately not used here. */
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Browser, Cache } from "@puppeteer/browsers";
import { build } from "esbuild";
import WebSocket from "ws";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(rootDir, process.env.LSEW_EVENT_HISTORY_PERF_OUTPUT ?? "test-results/event-history-performance.json");
const markdownPath = outputPath.replace(/\.json$/u, ".md");
const overrides = envConfig();
const heapSampleCount = positive(process.env.LSEW_EVENT_HISTORY_HEAP_SAMPLE_COUNT ?? "10000", "LSEW_EVENT_HISTORY_HEAP_SAMPLE_COUNT");

async function main() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "lsew-event-history-performance-"));
  const site = join(temporaryRoot, "site");
  const profile = join(temporaryRoot, "profile");
  let server;
  let chrome;
  let cdp;
  try {
    await mkdir(site, { recursive: true });
    await build({ entryPoints: [join(rootDir, "benchmarks/event-history-performance-harness.ts")], outfile: join(site, "harness.js"), bundle: true, format: "esm", platform: "browser", target: "chrome114", logLevel: "silent" });
    await writeFile(join(site, "index.html"), '<!doctype html><meta charset="utf-8"><title>Event History performance</title><script type="module" src="/harness.js"></script>');
    server = await serve(site);
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/`;
    const executable = await chromeExecutable();
    chrome = spawn(executable, ["--headless=new", "--no-sandbox", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, url], { cwd: rootDir, stdio: "ignore" });
    const debugPort = await debuggingPort(profile, chrome);
    cdp = await connect(await pageTarget(debugPort, url));
    const environment = await cdp.request("Browser.getVersion");
    await waitForHarness(cdp);
    const origin = new URL(url).origin;
    const baselineHeap = await gcHeap(cdp);
    const storageBefore = await storageUsage(cdp, origin);
    const result = await evaluate(cdp, `window.__LSEW_EVENT_HISTORY_PERFORMANCE__.run(${JSON.stringify(overrides)})`, 300_000);
    const invalid = result.workloads.filter((workload) =>
      !workload.correctness.retainedMatchesAccepted ||
      !workload.correctness.publicationMatchesAccepted ||
      !workload.correctness.retainedInOrder ||
      !workload.correctness.publicationInOrder
    );
    if (invalid.length > 0) throw new Error(`Event History workload correctness failed: ${invalid.map((workload) => `${workload.adapter}/${workload.workload}/${workload.shape}`).join(", ")}`);
    const storageAfterWorkloads = await storageUsage(cdp, origin);

    const heapSamples = [];
    for (const adapter of ["indexeddb", "memory"]) {
      const adapterBaseline = await gcHeap(cdp);
      const session = await evaluate(cdp, `window.__LSEW_EVENT_HISTORY_PERFORMANCE__.prepareRetainedHeapSample(${JSON.stringify(adapter)}, ${heapSampleCount})`, 300_000);
      const retained = await gcHeap(cdp);
      const originUsageWhileRetained = await storageUsage(cdp, origin);
      await evaluate(cdp, "window.__LSEW_EVENT_HISTORY_PERFORMANCE__.releaseRetainedHeapSample()", 30_000);
      const released = await gcHeap(cdp);
      heapSamples.push({
        adapter,
        eventCount: heapSampleCount,
        baselineUsedSizeBytes: adapterBaseline.usedSize,
        retainedUsedSizeBytes: retained.usedSize,
        deltaFromAdapterBaselineBytes: retained.usedSize - adapterBaseline.usedSize,
        releasedUsedSizeBytes: released.usedSize,
        originUsageWhileRetained,
        session
      });
    }
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      runner: { kind: "real-chrome", fakeIndexedDbUsed: false, chrome: environment.product, userAgent: environment.userAgent, jsVersion: environment.jsVersion },
      configuration: {
        ...result.config,
        issue16FixtureEvents: result.anchors.issue16TotalEvents,
        usesIssue16ImmediateBurst:
          result.config.burstCount === result.anchors.issue16TotalEvents &&
          result.config.eventsPerBurst === result.anchors.issue16TotalEvents,
        responsivenessCriterion: "Storage-harness long tasks over 50 ms are a review trigger; this does not measure panel rendering responsiveness."
      },
      shapeFacts: result.shapeFacts,
      result,
      heap: { method: "CDP HeapProfiler.collectGarbage + Runtime.getHeapUsage", initialBaselineUsedSizeBytes: baselineHeap.usedSize, samples: heapSamples, exclusions: "JS heap only; excludes browser-process memory, IndexedDB disk files, DevTools panel rendering, and extension IPC." },
      storage: { method: "CDP Storage.getUsageAndQuota for the local harness origin", before: storageBefore, afterWorkloads: storageAfterWorkloads, limitation: "Origin usage is a whole-profile observation. Chrome may account for deleted session databases after deleteDatabase completes, so it is not a per-workload or checkpoint disk-footprint measurement." },
      limitations: ["commitToHistoryPublication measures append intake to EventHistory subscriber publication; it is not panel DOM visibility or paint.", "Each IndexedDB operation persists an envelope, metadata record, and one record per search token; shape facts expose this write amplification.", "The existing Vitest fake-indexeddb benchmark remains a synthetic adapter check and is not compared with these Chrome figures.", "No memory breakpoint is inferred. If no >50 ms storage-harness long task occurs, the maximum tested retained session is reported rather than a claimed limit.", "Workloads use isolated Event History instances and IndexedDB session names but share one warmed Chrome page; compare adapters as same-run evidence, not cold-start samples.", "Origin-usage samples may include Chrome's delayed accounting for deleted session databases and are not attributed to one adapter or checkpoint."]
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(markdownPath, markdown(report));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    cdp?.close();
    if (chrome) await terminateChild(chrome);
    if (server) await new Promise((done) => server.close(done));
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function markdown(report) {
  const workloads = report.result.workloads;
  const longTasks = workloads.filter((entry) => entry.longTasksOver50Ms > 0);
  const retainedLongTasks = report.heap.samples.filter((entry) => entry.session.longTasksOver50Ms > 0);
  const maxRetained = Math.max(...workloads.map((entry) => entry.retained));
  const idbSustainedLarge = workload(report, "indexeddb", "sustained", "large-json-rich");
  const idbBurstLarge = workload(report, "indexeddb", "burst", "large-json-rich");
  const memorySustainedLarge = workload(report, "memory", "sustained", "large-json-rich");
  const indexedRetained = report.heap.samples.find((sample) => sample.adapter === "indexeddb");
  const memoryRetained = report.heap.samples.find((sample) => sample.adapter === "memory");
  const rows = workloads.map((entry) => [
    entry.adapter,
    entry.workload,
    entry.shape,
    entry.retained,
    fixed(entry.offeredEventsPerSecond),
    fixed(entry.commitToHistoryPublicationLatencyMs.p95Ms),
    fixed(entry.maxOldestPendingAgeMs),
    entry.maxPendingBytes,
    fixed(entry.queryBehindBacklogMs),
    fixed(entry.queryLatencyMs.fullText.p95Ms),
    entry.transactionBatching.writeTransactions,
    entry.longTasksOver50Ms
  ].join(" | ")).join("\n");
  const heapRows = report.heap.samples.map((sample) =>
    `- ${sample.adapter}: ${sample.eventCount} mixed events, signed JS-heap delta ${sample.deltaFromAdapterBaselineBytes} bytes from its pre-sample baseline; append ${fixed(sample.session.appendElapsedMs)} ms; ${sample.session.longTasksOver50Ms} Long Task(s); Find p95 ${fixed(sample.session.queryLatencyMs.fullText.p95Ms)} ms; full-history p95 ${fixed(sample.session.queryLatencyMs.fullHistory.p95Ms)} ms.`
  ).join("\n");
  const responsiveness = [...longTasks, ...retainedLongTasks];
  return `# Event History workload evidence\n\nReal-Chrome harness run: ${report.runner.chrome}. The existing \`benchmark:event-history\` fake-indexeddb Vitest benchmark is intentionally excluded from this report.\n\n## Interpretation\n\n- Shapes: ${report.shapeFacts.map((shape) => `${shape.id} (${shape.persistedJsonBytes} UTF-8 bytes, ${shape.indexedDbWritesPerEvent} indexed writes/event)`).join("; ")}\n- Workloads: ${workloads.length}; maximum retained session tested: ${Math.max(maxRetained, ...report.heap.samples.map((sample) => sample.eventCount))} events.\n- At 50 offered events/sec, large JSON IndexedDB publication p95 was ${fixed(idbSustainedLarge.commitToHistoryPublicationLatencyMs.p95Ms)} ms with ${fixed(idbSustainedLarge.maxOldestPendingAgeMs)} ms maximum pending age.\n- The 1,692-event immediate large JSON burst reached ${fixed(idbBurstLarge.commitToHistoryPublicationLatencyMs.p95Ms)} ms publication p95, ${idbBurstLarge.maxPendingBytes} peak pending bytes, and ${idbBurstLarge.transactionBatching.writeTransactions} write transactions.\n- At ${memorySustainedLarge.retained} retained large JSON events, memory Find p95 was ${fixed(memorySustainedLarge.queryLatencyMs.fullText.p95Ms)} ms and the measured window recorded ${memorySustainedLarge.longTasksOver50Ms} Long Task(s). At ${memoryRetained.eventCount} mixed events, memory used a signed ${memoryRetained.deltaFromAdapterBaselineBytes}-byte JS-heap delta and Find p95 was ${fixed(memoryRetained.session.queryLatencyMs.fullText.p95Ms)} ms.\n- The ${indexedRetained.eventCount}-event IndexedDB checkpoint took ${fixed(indexedRetained.session.appendElapsedMs)} ms to append and had Find p95 ${fixed(indexedRetained.session.queryLatencyMs.fullText.p95Ms)} ms.\n- Storage-harness long tasks >50 ms: ${responsiveness.length === 0 ? `not observed through ${Math.max(...report.heap.samples.map((sample) => sample.eventCount))} retained mixed events` : `${responsiveness.length} workload or retained-session sample(s) observed one or more`}. This is not a panel responsiveness claim.\n- \`commitToHistoryPublication\` ends at EventHistory subscriber publication, not DOM visibility or paint. A query queued behind pending appends is reported separately from settled query samples.\n- The run proved accepted, published, retained, and fully ordered IDs for every workload before writing this report.\n\n## Workload facts\n\nAdapter | Workload | Shape | Retained | Offered events/s | Publication p95 ms | Oldest pending ms | Peak pending bytes | Query behind backlog ms | Find p95 ms | Write tx | Long tasks\n--- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---:\n${rows}\n\n## Retained session and JS heap\n\n${heapRows}\n\nA small negative IndexedDB JS-heap delta can occur after GC because retained envelopes live in IndexedDB rather than the page heap; treat it as measurement noise, not negative usage. JS heap excludes browser-process memory, IndexedDB disk files, DevTools panel rendering, and extension IPC. Origin-usage samples are whole-profile observations and may include Chrome's delayed accounting for deleted session databases; do not attribute them to one adapter or checkpoint. The JSON companion records raw timing samples, transaction distributions, environment details, and all limitations.\n`;
}

function fixed(value) { return Number(value).toFixed(2); }
function workload(report, adapter, kind, shape) { const match = report.result.workloads.find((entry) => entry.adapter === adapter && entry.workload === kind && entry.shape === shape); if (!match) throw new Error(`Missing workload ${adapter}/${kind}/${shape}.`); return match; }

function envConfig() {
  const mapping = { LSEW_EVENT_HISTORY_SUSTAINED_COUNT: "sustainedCount", LSEW_EVENT_HISTORY_SUSTAINED_RATE: "sustainedEventsPerSecond", LSEW_EVENT_HISTORY_BURST_COUNT: "burstCount", LSEW_EVENT_HISTORY_BATCH_SIZE: "batchSize" };
  return Object.fromEntries(Object.entries(mapping).flatMap(([env, key]) => {
    const raw = process.env[env];
    return raw ? [[key, positive(raw, env)]] : [];
  }));
}

function positive(raw, name) { const value = Number(raw); if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`); return value; }
async function serve(directory) { const server = createServer(async (request, response) => { try { const name = new URL(request.url ?? "/", "http://localhost").pathname === "/" ? "index.html" : "harness.js"; response.writeHead(200, { "content-type": name.endsWith("js") ? "text/javascript" : "text/html", "cache-control": "no-store" }); response.end(await readFile(join(directory, name))); } catch { response.writeHead(404).end(); } }); await new Promise((resolvePromise, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolvePromise); }); return server; }
async function chromeExecutable() { const cache = process.env.LSEW_BROWSER_CACHE_DIR ?? join(rootDir, ".cache/lsew-browsers"); const cached = new Cache(cache).getInstalledBrowsers().filter((entry) => entry.browser === Browser.CHROME).map((entry) => entry.executablePath); const candidates = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", ...cached, ...(process.env.PATH ?? "").split(delimiter).flatMap((dir) => [join(dir, "google-chrome"), join(dir, "chromium")])].filter(Boolean); for (const candidate of candidates) try { await access(candidate); return candidate; } catch {} throw new Error("Chrome not found; set CHROME_PATH or run npm run fixture:browser:install."); }
async function debuggingPort(profile, child) { for (let tries = 0; tries < 150; tries += 1) { if (child.exitCode !== null) throw new Error("Chrome exited before CDP was ready."); try { const [port] = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).trim().split(/\r?\n/u); return Number(port); } catch {} await delay(100); } throw new Error("Timed out waiting for Chrome CDP."); }
async function pageTarget(port, expected) { for (let tries = 0; tries < 150; tries += 1) { const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const target = targets.find((entry) => entry.type === "page" && entry.url.startsWith(expected)); if (target) return target.webSocketDebuggerUrl; await delay(100); } throw new Error("Timed out waiting for performance page."); }
class Cdp { constructor(socket) { this.socket = socket; this.id = 0; this.pending = new Map(); socket.addEventListener("message", (event) => { const message = JSON.parse(String(event.data)); const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result); }); } request(method, params = {}) { const id = ++this.id; return new Promise((resolvePromise, reject) => { this.pending.set(id, { resolve: resolvePromise, reject }); this.socket.send(JSON.stringify({ id, method, params })); }); } close() { this.socket.close(); } }
async function connect(url) { const socket = new WebSocket(url); await new Promise((resolvePromise, reject) => { socket.addEventListener("open", resolvePromise, { once: true }); socket.addEventListener("error", reject, { once: true }); }); return new Cdp(socket); }
async function waitForHarness(cdp) { for (let tries = 0; tries < 150; tries += 1) { if (await evaluate(cdp, "Boolean(window.__LSEW_EVENT_HISTORY_PERFORMANCE__)")) return; await delay(100); } throw new Error("Timed out waiting for Event History harness."); }
async function evaluate(cdp, expression, timeoutMs = 30000) { let timer; try { const response = await Promise.race([cdp.request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("CDP evaluation timed out.")), timeoutMs); })]); if (response.exceptionDetails) throw new Error(response.exceptionDetails.text); return response.result.value; } finally { clearTimeout(timer); } }
async function gcHeap(cdp) { await cdp.request("HeapProfiler.enable"); await cdp.request("HeapProfiler.collectGarbage"); return cdp.request("Runtime.getHeapUsage"); }
async function storageUsage(cdp, origin) { try { return await cdp.request("Storage.getUsageAndQuota", { origin }); } catch (error) { return { unavailable: true, reason: String(error) }; } }
function delay(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)); }
async function terminateChild(child) { if (child.exitCode !== null || child.signalCode !== null) return; child.kill("SIGTERM"); await new Promise((resolvePromise) => { const force = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 5000); child.once("close", () => { clearTimeout(force); resolvePromise(); }); }); }

await main();
