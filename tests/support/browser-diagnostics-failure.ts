import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromeTestArguments } from "../../scripts/chrome-test-policy.mjs";
import { chromium, type Browser } from "@playwright/test";
import { createBrowserFailureDiagnostics } from "./browser-failure-diagnostics.mjs";
import { CdpClient, evaluateByValue, listBrowserTargets, resolveChromeExecutable, terminateChild, waitForDebuggingPort } from "./chrome-extension-cdp";

// This executable must fail. Its caller verifies evidence after Chrome teardown.
const root = process.env.LSEW_PROJECT_ROOT!;
const diagnostics = createBrowserFailureDiagnostics({ outputDir: process.env.LSEW_BROWSER_DIAGNOSTICS_DIR!, journey: "synthetic-failure" });
const profile = await mkdtemp(join(tmpdir(), "lsew-diagnostics-browser-"));
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end(`<!doctype html><html data-lsew-panel-bridge-status="synthetic ready"><title>Synthetic diagnostics</title><body><main>Synthetic browser failure proof</main><script>console.log("synthetic console evidence", ${JSON.stringify(process.env.LSEW_DIAGNOSTICS_PROOF_TOKEN)}); setTimeout(() => { throw new Error("synthetic page error evidence"); }, 0);</script>`);
});
let chrome: ReturnType<typeof spawn> | undefined;
let pageCdp: CdpClient | undefined;
let diagnosticBrowser: Browser | undefined;
try {
  await new Promise<void>(ready => server.listen(0, "127.0.0.1", ready));
  chrome = spawn(await resolveChromeExecutable(root), [...chromeTestArguments({ profile, headless: true, additional: ["--remote-debugging-port=0"] }), "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
  chrome.stdout?.on("data", chunk => diagnostics.browserLog(String(chunk)));
  chrome.stderr?.on("data", chunk => diagnostics.browserLog(String(chunk)));
  const debugging = await waitForDebuggingPort(profile, chrome);
  diagnosticBrowser = await chromium.connectOverCDP(debugging.browserWebSocketUrl);
  await diagnostics.observeContext(diagnosticBrowser.contexts()[0]);
  const page = (await listBrowserTargets(debugging.port)).find(target => target.type === "page");
  pageCdp = await CdpClient.connect(page!.webSocketDebuggerUrl!);
  await diagnostics.observeCdp("synthetic-panel", pageCdp);
  await diagnostics.step("assert the synthetic panel is ready");
  await pageCdp.request("Page.navigate", { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/` });
  await evaluateByValue(pageCdp, "new Promise(resolve => setTimeout(resolve, 100))");
  assert.equal(await evaluateByValue(pageCdp, "document.title"), "Deliberately wrong title", "Deliberate synthetic browser assertion");
} catch (error) {
  await diagnostics.captureFailure(error);
  throw error;
} finally {
  await diagnostics.dispose();
  await diagnosticBrowser?.close();
  pageCdp?.close();
  if (chrome) await terminateChild(chrome);
  await new Promise<void>(closed => server.close(() => closed()));
  await rm(profile, { recursive: true, force: true });
}
