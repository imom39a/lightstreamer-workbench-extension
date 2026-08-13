import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(repositoryRoot, "test-results"), { recursive: true });
const temporaryModuleRoot = mkdtempSync(join(repositoryRoot, "test-results", ".event-history-performance-script-test-"));
const scriptCopy = join(temporaryModuleRoot, "event-history-performance.mjs");
const runnerOperationsCopy = join(temporaryModuleRoot, "event-history-performance-runner-operations.mjs");
const cleanupTemporaryModuleRoot = () => rmSync(temporaryModuleRoot, { recursive: true, force: true });
process.once("exit", cleanupTemporaryModuleRoot);
try {
  writeFileSync(scriptCopy, readFileSync(join(repositoryRoot, "scripts/event-history-performance.mjs"), "utf8").replace(/^#![^\n]*\n/u, ""));
  writeFileSync(runnerOperationsCopy, readFileSync(join(repositoryRoot, "scripts/event-history-performance-runner-operations.mjs"), "utf8"));
} catch (error) {
  cleanupTemporaryModuleRoot();
  throw error;
}
const scriptUrl = pathToFileURL(scriptCopy).href;
const runNode = (source: string) => execFileSync(process.execPath, ["--input-type=module", "-e", source], {
  cwd: repositoryRoot,
  encoding: "utf8",
  timeout: 5_000
});
afterAll(cleanupTemporaryModuleRoot);

describe("Event History performance startup fail-closed seams", () => {
  it("preserves a primary timeout across every outer evidence and cleanup failure", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { finalizePerformanceRun } = await import(${JSON.stringify(scriptUrl)});
      const primary = new Error("primary timeout");
      primary.name = "PerformanceOperationTimeout";
      const never = () => new Promise(() => undefined);
      const started = Date.now();
      const result = await finalizePerformanceRun({
        primaryError: primary,
        timeout: primary,
        writeEvidence: () => { throw new Error("evidence write failed"); },
        closeCdp: () => { throw new Error("cdp close failed"); },
        terminateChrome: () => Promise.reject(new Error("termination failed")),
        closeServer: never,
        removeTemporaryRoot: never,
        timeoutMs: 25
      });
      assert.strictEqual(result, primary);
      assert.ok(Date.now() - started < 500);
      assert.deepEqual(
        primary.outerDiagnostics.map(({ phase }) => phase),
        ["timeout-evidence", "cdp-close", "chrome-termination", "server-close", "temporary-root-removal"]
      );
      assert.equal(primary.outerDiagnostics.every(({ outcome }) => outcome === "failed" || outcome === "timed-out"), true);
    `);
  });

  it("reports cleanup failure when there is no primary error", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { finalizePerformanceRun } = await import(${JSON.stringify(scriptUrl)});
      await assert.rejects(
        finalizePerformanceRun({ closeCdp: () => { throw new Error("cdp close failed"); }, timeoutMs: 25 }),
        (error) => error?.name === "PerformanceOuterCleanupError"
          && error.diagnostics[0].phase === "cdp-close"
      );
    `);
  });

  it("records synchronous termination and temporary-root failures without masking timeout", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { finalizePerformanceRun } = await import(${JSON.stringify(scriptUrl)});
      const primary = new Error("primary timeout");
      const result = await finalizePerformanceRun({
        primaryError: primary,
        timeout: primary,
        writeEvidence: () => new Promise(() => undefined),
        terminateChrome: () => { throw new Error("kill failed"); },
        removeTemporaryRoot: () => Promise.reject(new Error("rm failed")),
        timeoutMs: 20
      });
      assert.strictEqual(result, primary);
      assert.deepEqual(primary.outerDiagnostics.map(({ phase, outcome }) => [phase, outcome]), [
        ["timeout-evidence", "timed-out"],
        ["chrome-termination", "failed"],
        ["temporary-root-removal", "failed"]
      ]);
    `);
  });

  it("preserves a primary setup error when bounded target cleanup also fails", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { closeFreshHarnessPageWithErrorPreservation } = await import(${JSON.stringify(scriptUrl)});
      const primary = new Error("primary setup failed");
      const controlCdp = { request: () => new Promise(() => undefined) };
      const page = { cdp: { close() {} }, targetId: "target-1", pageToken: "page-1" };
      await closeFreshHarnessPageWithErrorPreservation(controlCdp, page, { deadlineAt: Date.now() - 1, requestCeilingMs: 5 }, primary);
      assert.equal(primary.message, "primary setup failed");
      assert.equal(primary.cleanupEvidence.code, "SHARED_DEADLINE_EXCEEDED");
      assert.equal(primary.cleanupEvidence.status.state, "rejected");
    `);
  });

  it("fails closed when standalone target cleanup times out", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { closeFreshHarnessPageWithErrorPreservation } = await import(${JSON.stringify(scriptUrl)});
      const controlCdp = { request: () => new Promise(() => undefined) };
      const page = { cdp: { close() {} }, targetId: "target-1", pageToken: "page-1" };
      await assert.rejects(
        closeFreshHarnessPageWithErrorPreservation(controlCdp, page, { deadlineAt: Date.now() - 1, requestCeilingMs: 5 }),
        (error) => error?.name === "PerformanceOperationTimeout" && error.status.lastRequestTimeout.ceilingMs === 5
      );
    `);
  });

  it("keeps fresh-page setup on the supplied absolute deadline", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { openFreshHarnessPage } = await import(${JSON.stringify(scriptUrl)});
      const deadlineAt = Date.now() + 37;
      await assert.rejects(
        openFreshHarnessPage({ request: () => new Promise(() => undefined) }, 9222, "http://127.0.0.1:4173/", "deadline", { deadlineAt, requestCeilingMs: 5 }),
        (error) => error?.name === "PerformanceOperationTimeout"
      );
    `);
  });

  it("includes macOS foreground activation for headed Chrome", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { chromeLaunchArguments } = await import(${JSON.stringify(scriptUrl)});
      const args = chromeLaunchArguments("/tmp/lsew-profile", "http://127.0.0.1:4173/", "darwin");
      assert.equal(args.includes("--activate-on-launch"), true);
      assert.equal(args.includes("--headless"), false);
      assert.equal(args.includes("--js-flags=--expose-gc"), true);
      assert.equal(args.at(-1), "http://127.0.0.1:4173/");
    `);
  });

  it("omits macOS foreground activation on non-macOS platforms", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { chromeLaunchArguments } = await import(${JSON.stringify(scriptUrl)});
      const args = chromeLaunchArguments("/tmp/lsew-profile", "http://127.0.0.1:4173/", "linux");
      assert.equal(args.includes("--activate-on-launch"), false);
      assert.equal(args.includes("--headless"), false);
      assert.equal(args.at(-1), "http://127.0.0.1:4173/");
    `);
  });

  it("brings the attached page to the foreground before checking visibility", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { preparePageForAuthoritativeRun } = await import(${JSON.stringify(scriptUrl)});
      const calls = [];
      const cdp = {
        request(method, params) {
          calls.push({ method, params });
          if (method === "Page.bringToFront") return Promise.resolve({});
          return Promise.resolve({ result: { value: true } });
        }
      };
      await preparePageForAuthoritativeRun(cdp, 100);
      assert.deepEqual(calls.map(({ method }) => method), ["Page.bringToFront", "Runtime.evaluate"]);
      assert.match(calls[1].params.expression, /document\\.visibilityState/u);
      assert.equal(calls[1].params.expression.match(/requestAnimationFrame/gu)?.length, 2);
      assert.equal(calls[1].params.awaitPromise, true);
    `);
  });

  it("readies the initial target document before the harness paint probe", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { prepareInitialPageForAuthoritativeRun } = await import(${JSON.stringify(scriptUrl)});
      const expected = "http://127.0.0.1:4173/";
      const calls = [];
      const cdp = {
        request(method, params) {
          calls.push({ method, params });
          if (method === "Page.navigate") return Promise.resolve({});
          if (method === "Runtime.evaluate" && params.expression === "location.href") {
            return Promise.resolve({ result: { value: expected } });
          }
          if (method === "Runtime.evaluate") return Promise.resolve({ result: { value: true } });
          return Promise.resolve({});
        }
      };
      await prepareInitialPageForAuthoritativeRun(cdp, expected, 100);
      assert.deepEqual(calls.map(({ method }) => method), [
        "Page.enable",
        "Runtime.enable",
        "Page.navigate",
        "Runtime.evaluate",
        "Runtime.evaluate",
        "Page.bringToFront",
        "Runtime.evaluate"
      ]);
      assert.equal(calls[3].params.expression, "location.href");
      assert.match(calls[6].params.expression, /requestAnimationFrame/);
    `);
  });

  it("fails closed when initial Page.enable never settles", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { prepareInitialPageForAuthoritativeRun } = await import(${JSON.stringify(scriptUrl)});
      const calls = [];
      const cdp = { request(method) {
        calls.push(method);
        return method === "Page.enable" ? new Promise(() => undefined) : Promise.resolve({});
      }};
      await assert.rejects(
        prepareInitialPageForAuthoritativeRun(cdp, "http://127.0.0.1:4173/", { deadlineAt: Date.now() + 25, requestCeilingMs: 10 }),
        (error) => error?.name === "PerformanceOperationTimeout"
          && error.status.error.code === "SHARED_DEADLINE_EXCEEDED"
          && error.status.error.name === "CdpRequestTimeout"
      );
      assert.deepEqual(calls, ["Page.enable"]);
    `);
  });

  it("retires a pending visibility request for the numeric setup API", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { preparePageForAuthoritativeRun } = await import(${JSON.stringify(scriptUrl)});
      let cancelled = 0;
      const cdp = { request(method) {
        if (method === "Page.bringToFront") return Promise.resolve({});
        const pending = new Promise(() => undefined);
        pending.cancel = () => { cancelled += 1; };
        return pending;
      }};
      await assert.rejects(preparePageForAuthoritativeRun(cdp, 20), /timed out|deadline expired/u);
      assert.equal(cancelled, 1);
    `);
  });

  it("fails closed when initial Page.navigate never settles", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { prepareInitialPageForAuthoritativeRun } = await import(${JSON.stringify(scriptUrl)});
      const calls = [];
      const cdp = { request(method) {
        calls.push(method);
        return method === "Page.navigate" ? new Promise(() => undefined) : Promise.resolve({});
      }};
      await assert.rejects(
        prepareInitialPageForAuthoritativeRun(cdp, "http://127.0.0.1:4173/", { deadlineAt: Date.now() + 25, requestCeilingMs: 10 }),
        (error) => error?.name === "PerformanceOperationTimeout"
          && error.status.error.code === "SHARED_DEADLINE_EXCEEDED"
          && error.status.error.name === "CdpRequestTimeout"
      );
      assert.deepEqual(calls, ["Page.enable", "Runtime.enable", "Page.navigate"]);
    `);
  });

  it("uses the initial setup deadline for later fresh-page work", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { prepareInitialPageForAuthoritativeRun, openFreshHarnessPage } = await import(${JSON.stringify(scriptUrl)});
      const deadlineAt = Date.now() + 100;
      const cdp = { request(method, params) {
        if (method === "Runtime.evaluate" && params.expression === "location.href") return Promise.resolve({ result: { value: "http://127.0.0.1:4173/" } });
        if (method === "Runtime.evaluate") return Promise.resolve({ result: { value: true } });
        return new Promise((resolve) => setTimeout(() => resolve({}), 15));
      }};
      await prepareInitialPageForAuthoritativeRun(cdp, "http://127.0.0.1:4173/", { deadlineAt, requestCeilingMs: 20 });
      await assert.rejects(
        openFreshHarnessPage(cdp, 9222, "http://127.0.0.1:4173/", "later", { deadlineAt, requestCeilingMs: 10 }),
        (error) => error?.name === "PerformanceOperationTimeout" && error.status.error.code === "SHARED_DEADLINE_EXCEEDED"
      );
    `);
  });

  it("fails closed when the foreground paint rAF callbacks are never delivered", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { preparePageForAuthoritativeRun } = await import(${JSON.stringify(scriptUrl)});
      const calls = [];
      const cdp = {
        request(method, params) {
          calls.push({ method, params });
          if (method === "Page.bringToFront") return Promise.resolve({});
          if (method === "Runtime.evaluate") {
            const expression = params.expression;
            const probe = new Function("document", "requestAnimationFrame", "return " + expression);
            return probe({ visibilityState: "visible" }, () => undefined).then((value) => ({ result: { value } }));
          }
          return Promise.resolve({});
        }
      };
      await assert.rejects(
        preparePageForAuthoritativeRun(cdp, 100),
        (error) => /visible foreground/u.test(error?.message ?? "")
          || (error?.name === "PerformanceOperationTimeout" && error.status.error.code === "SHARED_DEADLINE_EXCEEDED")
      );
      assert.equal(calls.length, 2);
    `);
  });

  it("rejects a hidden page after bringing it to the foreground", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { preparePageForAuthoritativeRun } = await import(${JSON.stringify(scriptUrl)});
      const calls = [];
      const cdp = {
        request(method, params) {
          calls.push({ method, params });
          if (method === "Page.bringToFront") return Promise.resolve({});
          return Promise.resolve({ result: { value: false } });
        }
      };
      await assert.rejects(
        preparePageForAuthoritativeRun(cdp, 100),
        (error) => /visible foreground page/u.test(error?.message ?? "")
      );
      assert.deepEqual(calls.map(({ method }) => method), ["Page.bringToFront", "Runtime.evaluate"]);
    `);
  });

  it("fails closed when the double-frame visibility evaluation is rejected", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { preparePageForAuthoritativeRun } = await import(${JSON.stringify(scriptUrl)});
      const calls = [];
      const cdp = {
        request(method, params) {
          calls.push({ method, params });
          if (method === "Page.bringToFront") return Promise.resolve({});
          return Promise.reject(new Error("renderer unavailable"));
        }
      };
      await assert.rejects(preparePageForAuthoritativeRun(cdp, 100), /renderer unavailable/u);
      assert.deepEqual(calls.map(({ method }) => method), ["Page.bringToFront", "Runtime.evaluate"]);
    `);
  });

  it("fails closed when the double-frame visibility evaluation times out", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { preparePageForAuthoritativeRun } = await import(${JSON.stringify(scriptUrl)});
      const calls = [];
      const cdp = {
        request(method, params) {
          calls.push({ method, params });
          if (method === "Page.bringToFront") return Promise.resolve({});
          return new Promise(() => undefined);
        }
      };
      await assert.rejects(preparePageForAuthoritativeRun(cdp, 10), (error) => /timed out/u.test(error?.message ?? ""));
      assert.deepEqual(calls.map(({ method }) => method), ["Page.bringToFront", "Runtime.evaluate"]);
    `);
  });

  it("bounds a hung CDP WebSocket open and closes the socket", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { connect } = await import(${JSON.stringify(scriptUrl)});
      let closed = false;
      const socket = { addEventListener() {}, removeEventListener() {}, close() { closed = true; } };
      await assert.rejects(
        connect("ws://127.0.0.1:1", { deadlineMs: 30, requestTimeoutMs: 10, createSocket: () => socket }),
        (error) => error?.name === "StartupTimeout"
      );
      assert.equal(closed, true);
    `);
  });

  it("bounds a hung DevToolsActivePort file read", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { debuggingPort } = await import(${JSON.stringify(scriptUrl)});
      const pending = () => new Promise(() => undefined);
      await assert.rejects(
        debuggingPort("/profile", { exitCode: null }, { deadlineMs: 30, requestTimeoutMs: 10, readProfileFile: pending, sleep: async () => undefined }),
        (error) => error?.name === "StartupTimeout"
      );
    `);
  });

  it("bounds a hung target fetch and response body read", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { pageTarget } = await import(${JSON.stringify(scriptUrl)});
      const pending = () => new Promise(() => undefined);
      await assert.rejects(
        pageTarget(9222, "http://127.0.0.1", { deadlineMs: 30, requestTimeoutMs: 10, fetchImplementation: pending, sleep: async () => undefined }),
        (error) => error?.name === "StartupTimeout"
      );
    `);
  });

  it("bounds a hung target response body read", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { pageTarget } = await import(${JSON.stringify(scriptUrl)});
      const pending = () => new Promise(() => undefined);
      await assert.rejects(
        pageTarget(9222, "http://127.0.0.1", {
          deadlineMs: 30,
          requestTimeoutMs: 10,
          fetchImplementation: async () => ({ json: pending }),
          sleep: async () => undefined
        }),
        (error) => error?.name === "StartupTimeout"
      );
    `);
  });

  it("re-navigates a fresh target whose metadata URL precedes renderer commit", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { ensureFreshHarnessDocument } = await import(${JSON.stringify(scriptUrl)});
      const expected = "http://127.0.0.1:4173/?pageToken=fresh";
      const calls = [];
      let href = "about:blank";
      const cdp = { request(method, params) {
        calls.push({ method, params });
        if (method === "Page.navigate") { href = expected; return Promise.resolve({}); }
        if (method === "Runtime.evaluate") return Promise.resolve({ result: { value: href } });
        return Promise.resolve({});
      }};
      await ensureFreshHarnessDocument(cdp, expected, 100);
      assert.deepEqual(calls.slice(0, 3).map(({ method }) => method), ["Page.enable", "Runtime.enable", "Page.navigate"]);
      assert.equal(calls.some(({ method, params }) => method === "Runtime.evaluate" && params.expression === "location.href"), true);
    `);
  });

  it("reports structured timeout evidence when the fresh document never reaches the expected URL", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { ensureFreshHarnessDocument } = await import(${JSON.stringify(scriptUrl)});
      const expected = "http://127.0.0.1:4173/?pageToken=never";
      const cdp = { request(method, params) {
        if (method === "Runtime.evaluate" && params.expression === "location.href") {
          return Promise.resolve({ result: { value: "about:blank" } });
        }
        return Promise.resolve({});
      }};
      await assert.rejects(
        ensureFreshHarnessDocument(cdp, expected, 20, { deadlineAt: Date.now() + 20, requestCeilingMs: 5 }),
        (error) => error?.name === "PerformanceOperationTimeout"
          && error.status.error.code === "SHARED_DEADLINE_EXCEEDED"
          && error.status.error.name === "CdpRequestTimeout"
          && error.status.error.message.includes("page-document-polling")
      );
    `);
  });

  it("reports structured timeout evidence when harness readiness never becomes true", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { prepareInitialPageForAuthoritativeRun } = await import(${JSON.stringify(scriptUrl)});
      const expected = "http://127.0.0.1:4173/";
      const cdp = { request(method, params) {
        if (method === "Runtime.evaluate" && params.expression === "location.href") {
          return Promise.resolve({ result: { value: expected } });
        }
        if (method === "Runtime.evaluate" && params.expression.includes("__LSEW_EVENT_HISTORY_PERFORMANCE__")) {
          return Promise.resolve({ result: { value: false } });
        }
        return Promise.resolve({});
      }};
      await assert.rejects(
        prepareInitialPageForAuthoritativeRun(cdp, expected, { deadlineAt: Date.now() + 20, requestCeilingMs: 5 }),
        (error) => error?.name === "PerformanceOperationTimeout"
          && error.status.error.code === "SHARED_DEADLINE_EXCEEDED"
          && error.status.error.name === "CdpRequestTimeout"
          && error.status.error.message.includes("harness-readiness")
      );
    `);
  });

  it("writes both startup timeout evidence files with partial metadata", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "lsew-startup-timeout-test-"));
    const outputPath = join(temporaryRoot, "timeout.json");
    const markdownPath = join(temporaryRoot, "timeout.md");
    try {
      runNode(`
        import assert from "node:assert/strict";
        import { readFile } from "node:fs/promises";
        const { prepareInitialPageForAuthoritativeRun, writeTimeoutEvidenceForTimeout } = await import(${JSON.stringify(scriptUrl)});
        const cdp = { request(method) {
          return method === "Page.enable" ? new Promise(() => undefined) : Promise.resolve({});
        }};
        const timeout = await prepareInitialPageForAuthoritativeRun(cdp, "http://127.0.0.1:4173/", { deadlineAt: Date.now() + 20, requestCeilingMs: 5 }).then(() => null, (error) => error);
        assert.equal(timeout.name, "PerformanceOperationTimeout");
        await writeTimeoutEvidenceForTimeout({
          outputPath: ${JSON.stringify(outputPath)}, markdownPath: ${JSON.stringify(markdownPath)}, timeout,
          referencePath: "reference.json", deadlineMs: 3600000,
          source: { revision: "44b537e", dirty: false }
        });
        const json = JSON.parse(await readFile(${JSON.stringify(outputPath)}, "utf8"));
        const markdown = await readFile(${JSON.stringify(markdownPath)}, "utf8");
        assert.equal(json.status, "TIMED_OUT");
        assert.equal(json.runner.product, null);
        assert.equal(json.environment.chromeMajor, null);
        assert.equal(json.operation.phase, "page-enable");
        assert.equal(json.operation.lastStatus.state, "rejected");
        assert.match(markdown, /Operation phase: \\*\\*page-enable\\*\\*/u);
        assert.match(markdown, /Source revision: 44b537e/u);
      `);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("writes both evidence files when initial harness readiness times out", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "lsew-readiness-timeout-test-"));
    const outputPath = join(temporaryRoot, "timeout.json");
    const markdownPath = join(temporaryRoot, "timeout.md");
    try {
      runNode(`
        import assert from "node:assert/strict";
        import { readFile } from "node:fs/promises";
        const { prepareInitialPageForAuthoritativeRun, writeTimeoutEvidenceForTimeout } = await import(${JSON.stringify(scriptUrl)});
        const expected = "http://127.0.0.1:4173/";
        const cdp = { request(method, params) {
          if (method === "Runtime.evaluate" && params.expression === "location.href") return Promise.resolve({ result: { value: expected } });
          if (method === "Runtime.evaluate") return Promise.resolve({ result: { value: false } });
          return Promise.resolve({});
        }};
        const timeout = await prepareInitialPageForAuthoritativeRun(cdp, expected, { deadlineAt: Date.now() + 20, requestCeilingMs: 5 }).then(() => null, (error) => error);
        assert.equal(timeout.name, "PerformanceOperationTimeout");
        await writeTimeoutEvidenceForTimeout({
          outputPath: ${JSON.stringify(outputPath)}, markdownPath: ${JSON.stringify(markdownPath)}, timeout,
          referencePath: "reference.json", deadlineMs: 3600000,
          source: { revision: "44b537e", dirty: false }
        });
        const json = JSON.parse(await readFile(${JSON.stringify(outputPath)}, "utf8"));
        const markdown = await readFile(${JSON.stringify(markdownPath)}, "utf8");
        assert.equal(json.operation.phase, "harness-readiness");
        assert.equal(json.operation.lastStatus.state, "rejected");
        assert.match(markdown, /Operation phase: \\*\\*harness-readiness\\*\\*/u);
      `);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("bounds final server cleanup when close never invokes its callback", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { closeServerWithDeadline } = await import(${JSON.stringify(scriptUrl)});
      let destroyed = 0;
      let closedAll = 0;
      const server = {
        close() {},
        closeAllConnections() { closedAll += 1; },
        __eventHistorySockets: new Set([{ destroy() { destroyed += 1; } }])
      };
      const started = Date.now();
      const result = await closeServerWithDeadline(server, 20);
      assert.equal(result.timedOut, true);
      assert.ok(Date.now() - started < 500);
      assert.equal(closedAll, 1);
      assert.equal(destroyed, 1);
    `);
  });

  it("retires the Runtime.evaluate request when ensureFreshHarnessDocument uses no options", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { ensureFreshHarnessDocument } = await import(${JSON.stringify(scriptUrl)});
      const expected = "http://127.0.0.1:4173/?pageToken=retire";
      let cancelled = 0;
      const cdp = { request(method, params) {
        if (method === "Runtime.evaluate" && params.expression === "location.href") {
          const pending = new Promise(() => undefined);
          pending.cancel = () => { cancelled += 1; };
          return pending;
        }
        return Promise.resolve({});
      }};
      await assert.rejects(ensureFreshHarnessDocument(cdp, expected, 20));
      assert.equal(cancelled, 1);
    `);
  });
});

describe("Event History performance timeout evidence", () => {
  it("writes fail-closed JSON and Markdown for a remote HarnessStageTimeout", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "lsew-script-timeout-test-"));
    const outputPath = join(temporaryRoot, "timeout.json");
    const markdownPath = join(temporaryRoot, "timeout.md");
    try {
      runNode(`
        import assert from "node:assert/strict";
        import { readFile } from "node:fs/promises";
        const { normalizePerformanceTimeout, writeTimeoutEvidence } = await import(${JSON.stringify(scriptUrl)});
        const error = Object.assign(new Error("Harness stage cellReceipts exceeded its 120000 ms deadline."), {
          name: "HarnessStageTimeout",
          code: "HARNESS_STAGE_TIMEOUT",
          progress: {
            operationId: "operation-1", phase: "cells", stage: "cellReceipts", substage: "receipts", sample: 1,
            cellIndex: 1, cellTotal: 36, adapter: "indexeddb", workload: "sustained", shape: "ordinary-item-update",
            workloadPhase: "commit", sequence: 7, pageElapsedMs: 120001,
            runtimeDiagnostics: {
              expectedFinalId: "expected-final", disposed: false, visible: true,
              committedEvidenceBoundary: { intervalId: "interval-1", sequence: 100, eventId: "expected-final" },
              renderedEvidenceBoundary: { intervalId: "interval-1", sequence: 99, eventId: "prior" },
              pendingVisibleCount: 1,
              pendingVisibleHead: { intervalId: "interval-1", sequence: 100, eventId: "expected-final" },
              pendingVisibleTail: { intervalId: "interval-1", sequence: 100, eventId: "expected-final" },
              evidenceQueryPending: true, passiveRefreshPending: true, queryGeneration: 4,
              liveEvidenceTotal: 99, liveEvidenceTail: { eventId: "prior" }, lastEvidenceQueryError: null,
              documentVisibilityState: "visible", visibleFrameHeartbeat: 3, lastVisibleFrameAtMs: 120000
            }
          }
        });
        const timeout = normalizePerformanceTimeout(error);
        assert.equal(timeout.status.error.name, "HarnessStageTimeout");
        assert.equal(timeout.status.error.stage, "cellReceipts");
        await writeTimeoutEvidence({
          outputPath: ${JSON.stringify(outputPath)},
          markdownPath: ${JSON.stringify(markdownPath)},
          diagnostic: {
            schemaVersion: 2, status: "TIMED_OUT", generatedAt: "2026-08-11T00:00:00.000Z",
            source: { revision: "aa8a2a2", dirty: false }, runner: { kind: "real-chrome", headless: false },
            environment: { chromeMajor: 151, headless: false },
            operation: { deadlineMs: 3600000, lastStatus: timeout.status, progress: timeout.status.progress },
            classification: "NOT_CLASSIFIED", reference: { path: "reference.json", separatelyPinned: true, adopted: false },
            decision: { verdict: "FAIL", failures: ["stage timeout"], reviewReasons: [], checkedCells: 0, checkedSamples: 0 }
          }
        });
        const json = JSON.parse(await readFile(${JSON.stringify(outputPath)}, "utf8"));
        const markdown = await readFile(${JSON.stringify(markdownPath)}, "utf8");
        assert.equal(json.status, "TIMED_OUT");
        assert.equal(json.classification, "NOT_CLASSIFIED");
        assert.equal(json.reference.adopted, false);
        assert.equal(json.operation.lastStatus.error.stage, "cellReceipts");
        assert.equal(json.operation.progress.runtimeDiagnostics.expectedFinalId, "expected-final");
        assert.equal(json.operation.progress.runtimeDiagnostics.committedEvidenceBoundary.eventId, "expected-final");
        assert.equal(json.decision.verdict, "FAIL");
        assert.match(markdown, /Status: \\*\\*TIMED_OUT\\*\\*/u);
        assert.match(markdown, /"stage":"cellReceipts"/u);
        assert.match(markdown, /not classified as a performance PASS or REVIEW/u);
      `);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
