import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createBrowserFailureDiagnostics } from "./support/browser-failure-diagnostics.mjs";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

test("a failed browser journey retains its original assertion and named step even before Chrome connects", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "lsew-diagnostics-contract-"));
  temporaryDirectories.push(outputDir);
  const diagnostics = createBrowserFailureDiagnostics({ outputDir, journey: "synthetic-startup", attempt: 1 });
  await diagnostics.step("load the synthetic extension");
  const failure = new assert.AssertionError({ message: "Expected the synthetic panel to be ready", actual: false, expected: true });
  const path = await diagnostics.captureFailure(failure);
  await diagnostics.dispose();
  expect(path).toBe(join(outputDir, "synthetic-startup", "attempt-01"));
  const metadata = JSON.parse(await readFile(join(path!, "failure.json"), "utf8"));
  expect(metadata.failure).toMatchObject({ name: "AssertionError", message: "Expected the synthetic panel to be ready", code: "ERR_ASSERTION" });
  expect(metadata.step).toBe("load the synthetic extension");
  expect(metadata.browser).toBeNull();
});

test("retry evidence stays separate while captured logs and secrets remain bounded", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "lsew-diagnostics-contract-"));
  temporaryDirectories.push(outputDir);
  const diagnostics = createBrowserFailureDiagnostics({ outputDir, journey: "synthetic-retry", redactValues: ["synthetic-auth-secret"] });
  for (let index = 0; index < 1000; index++) diagnostics.browserLog(`record ${index}: token=synthetic-auth-secret ${"x".repeat(4000)}`);
  const first = await diagnostics.captureFailure(new Error("first assertion: synthetic-auth-secret"));
  const second = await diagnostics.captureFailure(new Error("second assertion"));
  await diagnostics.dispose();
  expect(second).toBe(join(outputDir, "synthetic-retry", "attempt-02"));
  expect(JSON.parse(await readFile(join(first!, "failure.json"), "utf8")).failure.message).toBe("first assertion: [REDACTED]");
  const text = await readFile(join(first!, "browser-logs.json"), "utf8");
  expect(text).not.toContain("synthetic-auth-secret");
  const logs = JSON.parse(text);
  expect(logs.length).toBeLessThanOrEqual(200);
  expect(logs.at(-1).text).toContain("record 999");
  expect(logs.every((log: { text: string }) => log.text.length <= 2048)).toBe(true);
});

test("an unresponsive browser cannot block failure evidence or owned browser cleanup", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "lsew-diagnostics-contract-"));
  temporaryDirectories.push(outputDir);
  const diagnostics = createBrowserFailureDiagnostics({ outputDir, journey: "synthetic-unresponsive", operationTimeoutMs: 25 });
  // Chrome's protocol is the external boundary. A lost response is possible
  // after the target crashes; no Workbench collaborator is mocked here.
  await diagnostics.observeCdp("crashed-panel", { on: () => () => {}, request: () => new Promise(() => {}) });
  const directory = await diagnostics.captureFailure(new Error("original browser assertion"));
  await diagnostics.dispose();
  const metadata = JSON.parse(await readFile(join(directory!, "failure.json"), "utf8"));
  expect(metadata.failure.message).toBe("original browser assertion");
  expect(metadata.collectorErrors.some((error: { message: string }) => error.message.includes("Timed out"))).toBe(true);
}, 1000);
