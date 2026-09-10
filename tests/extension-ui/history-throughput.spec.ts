import { chromium, expect, test, type Browser } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromeTestArguments } from "../../scripts/chrome-test-policy.mjs";
import { resolveChromeExecutable } from "../support/chrome-extension-cdp";
import type { HistoryThroughputOptions } from "../../benchmarks/history-throughput-harness";

for (const scenario of [
  { name: "JSON-rich snapshot", options: { count: 2500 } },
  { name: "live updates at 200 events per second", options: { count: 2500, burstSize: 10, pauseMs: 50 } },
  { name: "rolling retention during continuous capture", options: { count: 6000, payloadFields: 0, burstSize: 256, drainEachBurst: true, maxRetainedCount: 2500 } }
] satisfies Array<{ name: string; options: HistoryThroughputOptions }>) {
  test(`IndexedDB commits a ${scenario.name} without backlog warnings`, async ({}, testInfo) => {
    await verifyThroughput(scenario.options, testInfo.attach.bind(testInfo));
  });
}

test("IndexedDB retains 100k records and continues rolling capture", async ({}, testInfo) => {
  test.skip(process.env.LSEW_HISTORY_THROUGHPUT_100K !== "1", "Opt-in capacity proof; ordinary regressions use smaller retention windows.");
  test.setTimeout(900_000);
  await verifyThroughput({ count: 100500, payloadFields: 0, burstSize: 512, drainEachBurst: true }, testInfo.attach.bind(testInfo));
});

async function verifyThroughput(options: HistoryThroughputOptions, attach: (name: string, options: { body: string; contentType: string }) => Promise<void>) {
  const root = resolve(import.meta.dirname, "../..");
  const temporary = await mkdtemp(join(tmpdir(), "lsew-history-throughput-"));
  const harnessPath = join(temporary, "harness.js");
  let browser: Browser | undefined;
  const server = createServer(async (request, response) => {
    if (request.url === "/harness.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(await readFile(harnessPath));
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><html><body><script type="module" src="/harness.js"></script></body></html>');
    }
  });
  try {
    await build({ entryPoints: [join(root, "benchmarks/history-throughput-harness.ts")], outfile: harnessPath, bundle: true, format: "esm", platform: "browser", target: "chrome151", logLevel: "silent", loader: { ".css": "css" } });
    await new Promise<void>(ready => server.listen(0, "127.0.0.1", ready));
    browser = await chromium.launch({ executablePath: await resolveChromeExecutable(root), headless: true, args: [...chromeTestArguments()] });
    const page = await browser.newPage();
    page.on("console", message => {
      if (message.text().startsWith('{"type":"history-throughput-progress"')) console.log(message.text());
    });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    await page.waitForFunction(() => typeof window.runHistoryThroughput === "function");
    const result = await page.evaluate(options => window.runHistoryThroughput(options), options);
    console.log(JSON.stringify(result));
    await attach("history-throughput.json", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
    expect(errors).toEqual([]);
    expect(result.accepted).toBe(options.count);
    expect(result.refused).toBe(0);
    expect(result.persistence).toMatchObject({ mode: "JOURNAL", health: "HEALTHY", retryCount: 0, failureCount: 0 });
    expect(result.maxPendingAgeMs).toBeLessThan(10_000);
    expect(result.retained?.retainedCount).toBeLessThanOrEqual(options.maxRetainedCount ?? 100000);
    expect(result.retained?.retainedCount).toBeGreaterThanOrEqual(Math.min(options.count, (options.maxRetainedCount ?? 100000) * 0.9));
    expect(result.latestId).toBe(result.expectedLatestId);
    expect(result.findTotal).toBe(1);
    expect(result.findIds).toEqual([result.expectedLatestId]);
  } finally {
    await browser?.close();
    await new Promise<void>(done => server.close(() => done()));
    await rm(temporary, { recursive: true });
  }
}
