import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptCopy = join(repositoryRoot, "scripts", `.event-history-performance-script-test-${process.pid}.mjs`);
writeFileSync(scriptCopy, readFileSync(join(repositoryRoot, "scripts/event-history-performance.mjs"), "utf8").replace(/^#![^\n]*\n/u, ""));
const scriptUrl = pathToFileURL(scriptCopy).href;
const runNode = (source: string) => execFileSync(process.execPath, ["--input-type=module", "-e", source], {
  cwd: repositoryRoot,
  encoding: "utf8",
  timeout: 5_000
});
afterAll(() => rmSync(scriptCopy, { force: true }));

describe("Event History performance startup fail-closed seams", () => {
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
            workloadPhase: "commit", sequence: 7, pageElapsedMs: 120001
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
