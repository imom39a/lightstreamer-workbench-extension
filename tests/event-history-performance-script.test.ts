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
const chromePolicyCopy = join(temporaryModuleRoot, "chrome-test-policy.mjs");
const cleanupTemporaryModuleRoot = () => rmSync(temporaryModuleRoot, { recursive: true, force: true });
process.once("exit", cleanupTemporaryModuleRoot);
try {
  writeFileSync(scriptCopy, readFileSync(join(repositoryRoot, "scripts/event-history-performance.mjs"), "utf8").replace(/^#![^\n]*\n/u, ""));
  writeFileSync(runnerOperationsCopy, readFileSync(join(repositoryRoot, "scripts/event-history-performance-runner-operations.mjs"), "utf8"));
  writeFileSync(chromePolicyCopy, readFileSync(join(repositoryRoot, "scripts/chrome-test-policy.mjs"), "utf8"));
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
  it("keeps native activation able to take Chrome in front of the invoking app", () => {
    const helperSource = readFileSync(join(repositoryRoot, "scripts/process-activation-helper.swift"), "utf8");
    expect(helperSource).toContain(".activateIgnoringOtherApps");
    expect(helperSource).toContain(".activateAllWindows");
    expect(helperSource).toContain("application.unhide()");
    expect(helperSource).toContain(".yieldActivation(to: application)");
    expect(helperSource).toContain("application.activate(from: currentApplication");
  });

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
        removeTemporaryRoot: never,
        timeoutMs: 25
      });
      assert.strictEqual(result, primary);
      assert.ok(Date.now() - started < 500);
      assert.deepEqual(
        primary.outerDiagnostics.map(({ phase }) => phase),
        ["timeout-evidence", "cdp-close", "chrome-termination", "temporary-root-removal"]
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
        openFreshHarnessPage({ request: () => new Promise(() => undefined) }, 9222, "file:///tmp/lsew-event-history/index.html", "deadline", { deadlineAt, requestCeilingMs: 5 }),
        (error) => error?.name === "PerformanceOperationTimeout"
      );
    `);
  });

  it("uses the macOS activation flag while keeping other platforms neutral", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { chromeLaunchArguments } = await import(${JSON.stringify(scriptUrl)});
      for (const [platform, activates] of [["darwin", true], ["linux", false], ["win32", false]]) {
        const args = chromeLaunchArguments("/tmp/lsew-profile", platform);
        assert.equal(args.some((arg) => arg === "--activate-on-launch"), activates);
        assert.equal(args.includes("--headless"), false);
        assert.equal(args.includes("--no-proxy-server"), true);
        assert.equal(args.includes("--use-mock-keychain"), true);
        assert.equal(args.includes("--password-store=basic"), true);
        assert.equal(args.includes("--disable-sync"), true);
        assert.equal(args.includes("--no-first-run"), true);
        assert.equal(args.includes("--no-default-browser-check"), true);
        assert.equal(
          args.includes("--disable-features=CalculateNativeWinOcclusion,PasswordManagerOnboarding,SigninInterception,ProfilePickerOnStartup"),
          true
        );
        assert.equal(args.includes("--allow-file-access-from-files"), true);
        assert.equal(args.includes("--disable-background-timer-throttling"), true);
        assert.equal(args.includes("--disable-backgrounding-occluded-windows"), true);
        assert.equal(args.includes("--disable-renderer-backgrounding"), true);
        assert.equal(args.includes("--js-flags=--expose-gc"), true);
        assert.equal(args.at(-1), "about:blank");
        assert.equal(args.includes("http://127.0.0.1:4173/"), false);
      }
      const nonInteractive = chromeLaunchArguments("/tmp/lsew-profile", "darwin", "non-interactive-layout-commit");
      assert.equal(nonInteractive.includes("--headless=new"), true);
      assert.equal(nonInteractive.includes("--activate-on-launch"), false);
      assert.equal(nonInteractive.includes("--use-mock-keychain"), true);
      assert.equal(nonInteractive.includes("--password-store=basic"), true);
      assert.equal(nonInteractive.includes("--disable-sync"), true);
      assert.equal(nonInteractive.includes("--no-first-run"), true);
      assert.equal(nonInteractive.includes("--no-default-browser-check"), true);
    `);
  });

  it("uses a modest default foreground keeper cadence", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { createForegroundKeeper } = await import(${JSON.stringify(scriptUrl)});
      let intervalMilliseconds;
      let cleared = null;
      const keeper = createForegroundKeeper(49217, {
        platform: "darwin",
        deadlineAt: 10_000,
        setInterval(callback, milliseconds) {
          intervalMilliseconds = milliseconds;
          return 17;
        },
        clearInterval(handle) { cleared = handle; },
        activate() {
          return Promise.resolve({ attempted: true, pid: 49217, activatedPID: 49217, frontmostPID: 49217, windows: [] });
        }
      });
      keeper.start();
      assert.equal(intervalMilliseconds, 5_000);
      assert.equal(keeper.snapshot().cadenceMs, 5_000);
      await keeper.stop();
      assert.equal(cleared, 17);
    `);
  });

  it("builds a self-contained file harness with relative assets and no HTTP server dependency", () => {
    runNode(`
      import assert from "node:assert/strict";
      import { readFile } from "node:fs/promises";
      const { createHarnessDocument } = await import(${JSON.stringify(scriptUrl)});
      const html = createHarnessDocument();
      assert.match(html, /href="\\.\\/harness\\.css"/u);
      assert.match(html, /src="\\.\\/harness\\.js"/u);
      assert.doesNotMatch(html, /href="\\/|src="\\//u);
      const source = await readFile(${JSON.stringify(join(repositoryRoot, "scripts/event-history-performance.mjs"))}, "utf8");
      assert.match(source, /pathToFileURL\\(indexPath\\)\\.href/u);
      assert.doesNotMatch(source, /createServer|server = await serve|closeServerWithDeadline/u);
    `);
  });

  it("keeps file page-token URLs exact and unique", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { harnessPageUrl } = await import(${JSON.stringify(scriptUrl)});
      const base = "file:///tmp/lsew-event-history/index.html";
      const first = harnessPageUrl(base, "shard-1-token");
      const second = harnessPageUrl(base, "shard-2-token");
      assert.equal(first, "file:///tmp/lsew-event-history/index.html?pageToken=shard-1-token");
      assert.equal(second, "file:///tmp/lsew-event-history/index.html?pageToken=shard-2-token");
      assert.notEqual(first, second);
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
        const expected = "file:///tmp/lsew-event-history/index.html";
      const calls = [];
      const cdp = {
        request(method, params) {
          calls.push({ method, params });
          if (method === "Runtime.evaluate" && params.expression === "location.href") {
            return Promise.resolve({ result: { value: expected } });
          }
          if (method === "Runtime.evaluate") return Promise.resolve({ result: { value: true } });
          return Promise.resolve({});
        }
      };
      await prepareInitialPageForAuthoritativeRun(cdp, expected, 100);
      assert.equal(calls.some(({ method }) => method === "Page.navigate"), false);
      assert.deepEqual(calls.map(({ method }) => method), [
        "Page.enable",
        "Runtime.enable",
        "Runtime.evaluate",
        "Runtime.evaluate",
        "Page.bringToFront",
        "Runtime.evaluate"
      ]);
      assert.equal(calls[2].params.expression, "location.href");
      assert.match(calls[5].params.expression, /requestAnimationFrame/);
  `);
  });

  it("polls an about:blank or stale document until the exact URL commits", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { ensureFreshHarnessDocument } = await import(${JSON.stringify(scriptUrl)});
      const expected = "file:///tmp/lsew-event-history/index.html?pageToken=fresh";
      const calls = [];
      const hrefs = ["about:blank", "file:///tmp/lsew-event-history/index.html?pageToken=stale", expected];
      const cdp = { request(method, params) {
        calls.push({ method, params });
        if (method === "Runtime.evaluate") return Promise.resolve({ result: { value: hrefs.shift() ?? expected } });
        return Promise.resolve({});
      }};
      await ensureFreshHarnessDocument(cdp, expected, 500);
      assert.equal(calls.some(({ method }) => method === "Page.navigate"), false);
      assert.equal(calls.filter(({ method }) => method === "Page.navigate").length, 0);
      assert.equal(calls[2].params.expression, "location.href");
      assert.equal(calls.filter(({ method }) => method === "Runtime.evaluate").length, 3);
    `);
  });

  it("polls through a different page token until the exact token commits", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { ensureFreshHarnessDocument } = await import(${JSON.stringify(scriptUrl)});
      const expected = "file:///tmp/lsew-event-history/index.html?pageToken=fresh";
      const calls = [];
      const hrefs = ["file:///tmp/lsew-event-history/index.html?pageToken=wrong", expected];
      const cdp = { request(method, params) {
        calls.push({ method, params });
        if (method === "Runtime.evaluate") return Promise.resolve({ result: { value: hrefs.shift() ?? expected } });
        return Promise.resolve({});
      }};
      await ensureFreshHarnessDocument(cdp, expected, 100);
      assert.equal(calls.some(({ method }) => method === "Page.navigate"), false);
      assert.equal(calls.filter(({ method }) => method === "Runtime.evaluate").length, 2);
    `);
  });

  it("fails closed and cancels a pending initial URL evaluation", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { ensureFreshHarnessDocument } = await import(${JSON.stringify(scriptUrl)});
      let cancelled = 0;
      const calls = [];
      const cdp = { request(method, params) {
        calls.push({ method, params });
        if (method === "Runtime.evaluate" && params.expression === "location.href") {
          const pending = new Promise(() => undefined);
          pending.cancel = () => { cancelled += 1; };
          return pending;
        }
        return Promise.resolve({});
      }};
      await assert.rejects(
        ensureFreshHarnessDocument(cdp, "file:///tmp/lsew-event-history/index.html?pageToken=pending", 20, { deadlineAt: Date.now() + 20, requestCeilingMs: 5 }),
        (error) => error?.name === "PerformanceOperationTimeout"
          && error.status.error.code === "SHARED_DEADLINE_EXCEEDED"
          && error.status.error.message.includes("page-document-evaluate")
      );
      assert.equal(cancelled, 1);
      assert.equal(calls.some(({ method }) => method === "Page.navigate"), false);
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
        prepareInitialPageForAuthoritativeRun(cdp, "file:///tmp/lsew-event-history/index.html", { deadlineAt: Date.now() + 25, requestCeilingMs: 10 }),
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

  it("uses the initial setup deadline for later fresh-page work", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { prepareInitialPageForAuthoritativeRun, openFreshHarnessPage } = await import(${JSON.stringify(scriptUrl)});
      const deadlineAt = Date.now() + 100;
      const cdp = { request(method, params) {
        if (method === "Runtime.evaluate" && params.expression === "location.href") return Promise.resolve({ result: { value: "file:///tmp/lsew-event-history/index.html" } });
        if (method === "Runtime.evaluate") return Promise.resolve({ result: { value: true } });
        return new Promise((resolve) => setTimeout(() => resolve({}), 15));
      }};
      await prepareInitialPageForAuthoritativeRun(cdp, "file:///tmp/lsew-event-history/index.html", { deadlineAt, requestCeilingMs: 20 });
      await assert.rejects(
        openFreshHarnessPage(cdp, 9222, "file:///tmp/lsew-event-history/index.html", "later", { deadlineAt, requestCeilingMs: 10 }),
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

  it("bounds browser websocket discovery from /json/version", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { browserTarget } = await import(${JSON.stringify(scriptUrl)});
      await assert.rejects(
        browserTarget(9222, { deadlineMs: 30, requestTimeoutMs: 10, fetchImplementation: () => new Promise(() => undefined), sleep: async () => undefined }),
        (error) => error?.name === "StartupTimeout"
      );
    `);
  });

  it("creates and attaches the initial target by exact target id and URL", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { openHarnessTarget } = await import(${JSON.stringify(scriptUrl)});
      const expected = "file:///tmp/lsew-event-history/index.html";
      const calls = [];
      const control = { request(method, params) {
        calls.push([method, params]);
        if (method === "Target.createTarget") return Promise.resolve({ targetId: "initial-1" });
        if (method === "Target.getTargetInfo") return Promise.resolve({ targetInfo: { targetId: params.targetId, type: "page", url: expected } });
        if (method === "Browser.getWindowForTarget") return Promise.resolve({ windowId: 7, bounds: { windowState: "normal" } });
        if (method === "Target.closeTarget") return Promise.resolve({ success: true });
        return Promise.resolve({});
      } };
      let fetches = 0;
      const pageCdp = { request(method, params) {
        calls.push([method, params]);
        if (method === "Runtime.evaluate" && params.expression === "location.href") return Promise.resolve({ result: { value: expected } });
        if (method === "Runtime.evaluate") return Promise.resolve({ result: { value: true } });
        return Promise.resolve({});
      }, close() {} };
      await openHarnessTarget(control, 9222, expected, {
        deadlineAt: Date.now() + 500,
        fetchJson: async (url) => { fetches += 1; assert.equal(url, "http://127.0.0.1:9222/json/list"); return [{ id: "other", type: "page", webSocketDebuggerUrl: "ws://other" }, { id: "initial-1", type: "page", webSocketDebuggerUrl: "ws://initial" }]; },
        createSocket: () => { const listeners = {}; return { addEventListener(name, handler) { listeners[name] = handler; if (name === "open") queueMicrotask(handler); }, removeEventListener() {}, send(raw) { const request = JSON.parse(raw); queueMicrotask(() => listeners.message?.({ data: JSON.stringify({ id: request.id, result: request.method === "Runtime.evaluate" ? { result: { value: request.params.expression === "location.href" ? expected : true } } : {} }) })); }, close() {} }; }
      });
      assert.deepEqual(calls[0], ["Target.createTarget", { url: expected, newWindow: true, background: false, left: 40, top: 40, width: 1280, height: 900 }]);
      assert.equal(fetches, 1);
    `);
  });

  it("re-focuses only the exact target window with bounded CDP requests", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { focusHarnessTarget } = await import(${JSON.stringify(scriptUrl)});
      const calls = [];
      const controlCdp = {
        request(method, params) {
          calls.push(["browser", method, params]);
          if (method === "Target.getTargetInfo") return Promise.resolve({ targetInfo: { targetId: params.targetId, url: "file:///tmp/harness.html" } });
          if (method === "Browser.getWindowForTarget") return Promise.resolve({ windowId: 7, bounds: { windowState: "normal" } });
          if (method === "Browser.setWindowBounds") {
            assert.deepEqual(params, { windowId: 7, bounds: { focused: true } });
            return Promise.resolve({});
          }
          throw new Error("unexpected browser method " + method);
        }
      };
      const pageCdp = {
        request(method, params) {
          calls.push(["page", method, params]);
          assert.equal(method, "Page.bringToFront");
          assert.deepEqual(params, {});
          return Promise.resolve({});
        }
      };
      const result = await focusHarnessTarget(controlCdp, pageCdp, "target-1", { deadlineAt: Date.now() + 500, requestCeilingMs: 25 });
      assert.deepEqual(result, {
        targetId: "target-1",
        windowId: 7,
        targetUrl: "file:///tmp/harness.html",
        windowState: "normal",
        bounds: { windowState: "normal" },
        pageBroughtToFront: true
      });
      assert.deepEqual(calls.map(([owner, method]) => [owner, method]), [
        ["browser", "Target.getTargetInfo"],
        ["browser", "Browser.getWindowForTarget"],
        ["browser", "Browser.setWindowBounds"],
        ["page", "Page.bringToFront"],
        ["browser", "Browser.getWindowForTarget"],
        ["browser", "Target.getTargetInfo"]
      ]);
    `);
  });

  it("keeps the exact spawned PID foreground at a bounded cadence and cleans up", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { createForegroundKeeper } = await import(${JSON.stringify(scriptUrl)});
      let now = 0;
      let tick;
      let cleared = null;
      const activations = [];
      const keeper = createForegroundKeeper(49217, {
        platform: "darwin",
        helperPath: "/tmp/process-activation-helper",
        deadlineAt: 10_000,
        cadenceMs: 1_000,
        now: () => now,
        setInterval(callback, milliseconds) {
          assert.equal(milliseconds, 1_000);
          tick = callback;
          return 17;
        },
        clearInterval(handle) { cleared = handle; },
        activate(pid, options) {
          activations.push({ pid, options });
          return Promise.resolve({ attempted: true, pid, activatedPID: pid, frontmostPID: pid, windows: [] });
        }
      });
      keeper.start();
      now = 1_000;
      await tick();
      assert.deepEqual(activations, [{
        pid: 49217,
        options: { helperPath: "/tmp/process-activation-helper", deadlineAt: 10_000, timeoutMs: 2_000 }
      }]);
      assert.deepEqual(keeper.snapshot().attempts.map(({ status, pid }) => ({ status, pid })), [{ status: "PASS", pid: 49217 }]);
      await keeper.stop();
      assert.equal(cleared, 17);
      assert.equal(keeper.snapshot().stopped, true);
      assert.equal(keeper.failure(), null);
    `);
  });

  it("awaits exact target-window focus as part of a foreground keeper attempt", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { createForegroundKeeper } = await import(${JSON.stringify(scriptUrl)});
      let now = 0;
      let tick;
      let focusCalls = 0;
      const keeper = createForegroundKeeper(49217, {
        platform: "darwin",
        helperPath: "/tmp/process-activation-helper",
        deadlineAt: 10_000,
        cadenceMs: 1_000,
        now: () => now,
        setInterval(callback) { tick = callback; return 17; },
        clearInterval() {},
        activate(pid) {
          return Promise.resolve({ attempted: true, pid, activatedPID: pid, frontmostPID: pid, windows: [] });
        }
      });
      keeper.start();
      now = 1_000;
      const focusResult = { targetId: "target-1", windowId: 7, pageBroughtToFront: true };
      const focused = await keeper.keepAlive({
        reason: "target-heartbeat",
        focusTarget: async ({ pid, deadlineAt, timeoutMs }) => {
          focusCalls += 1;
          assert.equal(pid, 49217);
          assert.equal(deadlineAt, 10_000);
          assert.equal(timeoutMs, 2_000);
          return focusResult;
        }
      });
      assert.equal(focusCalls, 1);
      assert.deepEqual(focused.attempts.at(-1).focus, focusResult);
      await keeper.stop();
    `);
  });

  it("does not drop heartbeat target focus when cadence activation is in flight", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { createForegroundKeeper } = await import(${JSON.stringify(scriptUrl)});
      let now = 0;
      let tick;
      let resolveActivation;
      let focusCalls = 0;
      const activation = new Promise((resolve) => { resolveActivation = resolve; });
      const keeper = createForegroundKeeper(49217, {
        platform: "darwin",
        helperPath: "/tmp/process-activation-helper",
        deadlineAt: 10_000,
        cadenceMs: 1_000,
        now: () => now,
        setInterval(callback) { tick = callback; return 17; },
        clearInterval() {},
        activate(pid) {
          assert.equal(pid, 49217);
          return activation;
        }
      });
      keeper.start();
      now = 1_000;
      const cadence = tick();
      const focusResult = { targetId: "target-1", windowId: 7, pageBroughtToFront: true };
      const heartbeat = keeper.keepAlive({
        reason: "target-heartbeat",
        focusTarget: async ({ pid, activation: activationResult }) => {
          focusCalls += 1;
          assert.equal(pid, 49217);
          assert.deepEqual(activationResult, { attempted: true, pid: 49217, activatedPID: 49217, frontmostPID: 49217, windows: [] });
          return focusResult;
        }
      });
      resolveActivation({ attempted: true, pid: 49217, activatedPID: 49217, frontmostPID: 49217, windows: [] });
      await Promise.all([cadence, heartbeat]);
      assert.equal(focusCalls, 1);
      assert.deepEqual(keeper.snapshot().attempts[0].focus, focusResult);
      await keeper.stop();
    `);
  });

  it("does not repeatedly refocus the same operation target", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { createForegroundKeeper } = await import(${JSON.stringify(scriptUrl)});
      let now = 0;
      let tick;
      let focusCalls = 0;
      const keeper = createForegroundKeeper(49217, {
        platform: "darwin",
        helperPath: "/tmp/process-activation-helper",
        deadlineAt: 10_000,
        cadenceMs: 1_000,
        now: () => now,
        setInterval(callback) { tick = callback; return 17; },
        clearInterval() {},
        activate(pid) {
          return Promise.resolve({ attempted: true, pid, activatedPID: pid, frontmostPID: pid, windows: [] });
        }
      });
      const focusTarget = async () => {
        focusCalls += 1;
        return { targetId: "target-1", windowId: 7, pageBroughtToFront: true };
      };
      keeper.start();
      now = 1_000;
      await keeper.keepAlive({ focusTarget });
      now = 2_000;
      await keeper.keepAlive({ focusTarget });
      assert.equal(focusCalls, 1);
      assert.equal(keeper.snapshot().attempts.at(-1).focus, null);
      await keeper.stop();
    `);
  });

  it("refreshes exact target focus at the bounded keeper cadence", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { createForegroundFocusTargetSelector } = await import(${JSON.stringify(scriptUrl)});
      const select = createForegroundFocusTargetSelector(() => undefined, 5_000);
      const first = select({ cellIndex: 1, elapsedMs: 100 });
      assert.strictEqual(select({ cellIndex: 1, elapsedMs: 4_999 }), first);
      const cadenceRefresh = select({ cellIndex: 1, elapsedMs: 5_000 });
      assert.notStrictEqual(cadenceRefresh, first);
      assert.strictEqual(select({ cellIndex: 1, elapsedMs: 5_100 }), cadenceRefresh);
      assert.notStrictEqual(select({ cellIndex: 2, elapsedMs: 5_200 }), cadenceRefresh);
    `);
  });

  it("fails closed on keeper activation errors and expired proof deadlines", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { createForegroundKeeper } = await import(${JSON.stringify(scriptUrl)});
      let now = 0;
      let tick;
      const activationError = new Error("native helper failed");
      const keeper = createForegroundKeeper(49217, {
        platform: "darwin",
        deadlineAt: 10_000,
        cadenceMs: 1_000,
        now: () => now,
        setInterval(callback) { tick = callback; return 1; },
        clearInterval() {},
        activate() { return Promise.reject(activationError); }
      });
      keeper.start();
      now = 1_000;
      await assert.rejects(tick(), (error) => error === activationError);
      assert.equal(keeper.failure(), activationError);
      assert.equal(keeper.snapshot().attempts[0].status, "FAIL");
      await assert.rejects(keeper.assertHealthy(), (error) => error === activationError);
      await keeper.stop();

      let deadlineNow = 0;
      let deadlineTick;
      const expired = createForegroundKeeper(49218, {
        platform: "darwin",
        deadlineAt: 50,
        cadenceMs: 1_000,
        now: () => deadlineNow,
        setInterval(callback) { deadlineTick = callback; return 2; },
        clearInterval() {},
        activate() { throw new Error("must not call helper after deadline"); }
      });
      expired.start();
      deadlineNow = 1_000;
      await assert.rejects(deadlineTick(), (error) => error?.name === "PerformanceOperationTimeout"
        && error.status.error.code === "SHARED_DEADLINE_EXCEEDED"
        && error.status.error.message.includes("foreground-keeper"));
      assert.equal(expired.snapshot().attempts[0].error.code, "SHARED_DEADLINE_EXCEEDED");
      await expired.stop();
    `);
  });

  it("preserves the initial setup error when initial target cleanup fails", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { openHarnessTarget } = await import(${JSON.stringify(scriptUrl)});
      const primary = await (async () => {
        try {
          await openHarnessTarget({ request: async (method, params) => {
            if (method === "Target.createTarget") return { targetId: "initial-1" };
            if (method === "Target.getTargetInfo") return { targetInfo: { targetId: params.targetId, type: "page", url: "file:///tmp/lsew-event-history/index.html" } };
            if (method === "Browser.getWindowForTarget") return { windowId: 7, bounds: { windowState: "normal" } };
            return {};
          } }, 9222, "file:///tmp/lsew-event-history/index.html", {
            deadlineAt: Date.now() + 100,
            fetchJson: async () => [{ id: "initial-1", type: "page", webSocketDebuggerUrl: "ws://initial" }],
            createSocket: () => { const listeners = {}; return { addEventListener(name, handler) { listeners[name] = handler; if (name === "open") queueMicrotask(handler); }, removeEventListener() {}, send(raw) { const request = JSON.parse(raw); queueMicrotask(() => listeners.message?.({ data: JSON.stringify({ id: request.id, result: request.method === "Runtime.evaluate" ? { result: { value: false } } : {} }) })); }, close() {} }; }
          });
        } catch (error) { return error; }
      })();
      assert.match(primary?.message ?? "", /visible foreground|page/u);
      assert.equal(primary?.cleanupEvidence?.code, "Error");
    `);
  });

  it("closes a created target when per-target activation fails", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { openHarnessTarget, openFreshHarnessPage } = await import(${JSON.stringify(scriptUrl)});
      const activationError = new Error("activation failed");
      const run = async (open, expectedTarget, args) => {
        const closed = [];
        const control = { request(method) {
          if (method === "Target.createTarget") return Promise.resolve({ targetId: expectedTarget });
          if (method === "Target.closeTarget") {
            closed.push(expectedTarget);
            return Promise.resolve({ success: true });
          }
          return Promise.resolve({});
        } };
        await assert.rejects(open(control, 9222, ...args, {
          deadlineAt: Date.now() + 500,
          activateWindow: async () => { throw activationError; }
        }), (error) => error === activationError);
        assert.deepEqual(closed, [expectedTarget]);
      };
      await run(openHarnessTarget, "initial-activation-failure", ["file:///tmp/lsew-event-history/index.html"]);
      await run(openFreshHarnessPage, "fresh-activation-failure", ["file:///tmp/lsew-event-history/index.html", "fresh"]);
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

  it("waits for a fresh target whose metadata URL precedes renderer commit", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { ensureFreshHarnessDocument } = await import(${JSON.stringify(scriptUrl)});
      const expected = "file:///tmp/lsew-event-history/index.html?pageToken=fresh";
      const calls = [];
      const hrefs = ["about:blank", expected];
      const cdp = { request(method, params) {
        calls.push({ method, params });
        if (method === "Runtime.evaluate") return Promise.resolve({ result: { value: hrefs.shift() ?? expected } });
        return Promise.resolve({});
      }};
      await ensureFreshHarnessDocument(cdp, expected, 100);
      assert.deepEqual(calls.slice(0, 4).map(({ method }) => method), ["Page.enable", "Runtime.enable", "Runtime.evaluate", "Runtime.evaluate"]);
      assert.equal(calls.some(({ method }) => method === "Page.navigate"), false);
      assert.equal(calls.some(({ method, params }) => method === "Runtime.evaluate" && params.expression === "location.href"), true);
    `);
  });

  it("reports structured timeout evidence when the fresh document never reaches the expected URL", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { ensureFreshHarnessDocument } = await import(${JSON.stringify(scriptUrl)});
      const expected = "file:///tmp/lsew-event-history/index.html?pageToken=never";
      const calls = [];
      const cdp = { request(method, params) {
        calls.push({ method, params });
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
      assert.equal(calls.some(({ method }) => method === "Page.navigate"), false);
    `);
  });

  it("reports structured timeout evidence when harness readiness never becomes true", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { prepareInitialPageForAuthoritativeRun } = await import(${JSON.stringify(scriptUrl)});
      const expected = "file:///tmp/lsew-event-history/index.html";
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
        const timeout = await prepareInitialPageForAuthoritativeRun(cdp, "file:///tmp/lsew-event-history/index.html", { deadlineAt: Date.now() + 20, requestCeilingMs: 5 }).then(() => null, (error) => error);
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
        const expected = "file:///tmp/lsew-event-history/index.html";
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

  it("retires the Runtime.evaluate request when ensureFreshHarnessDocument uses no options", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { ensureFreshHarnessDocument } = await import(${JSON.stringify(scriptUrl)});
      const expected = "file:///tmp/lsew-event-history/index.html?pageToken=retire";
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

  it("bounds no-options document setup and URL polling in one elapsed budget", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { ensureFreshHarnessDocument } = await import(${JSON.stringify(scriptUrl)});
      const started = Date.now();
      const expected = "file:///tmp/lsew-event-history/index.html?pageToken=budget";
      const cdp = { request(method, params) {
        if (method === "Runtime.evaluate" && params.expression === "location.href") {
          return Promise.resolve({ result: { value: "about:blank" } });
        }
        return new Promise((resolve) => setTimeout(() => resolve({}), 12));
      }};
      await assert.rejects(ensureFreshHarnessDocument(cdp, expected, 20));
      assert.ok(Date.now() - started < 80, "setup plus polling must not receive a second timeout window");
    `);
  });

  it("composes the chrome termination budget and preserves the primary error", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { finalizePerformanceRun } = await import(${JSON.stringify(scriptUrl)});
      const primary = new Error("primary timeout");
      let received;
      const started = Date.now();
      const result = await finalizePerformanceRun({
        primaryError: primary,
        terminateChrome: ({ deadlineAt }) => {
          received = { deadlineAt };
          return new Promise((resolve) => setTimeout(resolve, 10));
        },
        timeoutMs: 25
      });
      assert.strictEqual(result, primary);
      assert.ok(received.deadlineAt >= started + 9);
      assert.ok(received.deadlineAt <= started + 25);
      assert.equal(primary.outerDiagnostics, undefined);
    `);
  });

  it("records termination overrun without replacing the primary error", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { finalizePerformanceRun } = await import(${JSON.stringify(scriptUrl)});
      const primary = new Error("primary timeout");
      const result = await finalizePerformanceRun({
        primaryError: primary,
        terminateChrome: ({ deadlineAt }) => new Promise((resolve) => setTimeout(resolve, Math.max(0, deadlineAt - Date.now()) + 20)),
        timeoutMs: 25
      });
      assert.strictEqual(result, primary);
      assert.equal(primary.outerDiagnostics[0].phase, "chrome-termination");
      assert.equal(primary.outerDiagnostics[0].outcome, "timed-out");
    `);
  });

  it("stops the foreground keeper before Chrome termination and preserves its failure", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { finalizePerformanceRun } = await import(${JSON.stringify(scriptUrl)});
      const primary = new Error("primary timeout");
      const keeperFailure = new Error("keeper stop failed");
      const order = [];
      const result = await finalizePerformanceRun({
        primaryError: primary,
        stopForegroundKeeper: () => { order.push("keeper"); throw keeperFailure; },
        terminateChrome: () => { order.push("chrome"); },
        timeoutMs: 25
      });
      assert.strictEqual(result, primary);
      assert.deepEqual(order, ["keeper", "chrome"]);
      assert.deepEqual(primary.outerDiagnostics.map(({ phase, outcome }) => [phase, outcome]), [
        ["foreground-keeper-stop", "failed"]
      ]);
    `);
  });

  it("activates and verifies only the spawned Chrome process through a bounded native helper", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { activateSpawnedChromeWindow } = await import(${JSON.stringify(scriptUrl)});
      let invocation;
      await activateSpawnedChromeWindow(49217, {
        platform: "darwin",
        timeoutMs: 50,
        execute(file, args, callback) {
          invocation = { file, args };
          callback(null, JSON.stringify({ activatedPID: 49217, frontmostPID: 49217, windows: [] }), "");
          return { kill() { throw new Error("should not kill a completed activation"); } };
        }
      });
      assert.match(invocation.file, /process-activation-helper/u);
      assert.deepEqual(invocation.args, ["activate", "49217"]);
    `);
  });

  it("marks frame diagnostics incomplete without inventing trace or target evidence", () => {
    runNode(`
      import assert from "node:assert/strict";
      const { createFrameDiagnostics, validateFrameDiagnostics } = await import(${JSON.stringify(scriptUrl)});
      const diagnostics = createFrameDiagnostics();
      assert.equal(diagnostics.status, "INCOMPLETE");
      assert.deepEqual(diagnostics.nativeWindows, []);
      assert.deepEqual(diagnostics.traceChunks, []);
      assert.deepEqual(diagnostics.traceEvents, []);
      assert.equal(diagnostics.tracingComplete, null);
      assert.equal(validateFrameDiagnostics(diagnostics).complete, false);
      assert.ok(validateFrameDiagnostics(diagnostics).missing.length === 0);
      diagnostics.status = "COMPLETE";
      diagnostics.tracingComplete = { dataLossOccurred: false };
      assert.equal(validateFrameDiagnostics(diagnostics).complete, true);
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
