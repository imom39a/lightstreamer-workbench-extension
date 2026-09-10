import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { chromeTestArguments } from "../../scripts/chrome-test-policy.mjs";
import { resolveChromeExecutable } from "../support/chrome-extension-cdp";

// A real extension reload invalidates the old isolated-world Chrome bindings,
// while the already-loaded page and its application updates remain alive.
test("extension reload retires the old content bridge without interrupting page updates", async () => {
  const root = resolve(import.meta.dirname, "../..");
  const extensionDir = resolve(root, process.env.LSEW_EXTENSION_DIR ?? "dist");
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html><head><title>Content bridge lifecycle fixture</title></head><body>Original application</body></html>');
  });
  const profile = await mkdtemp(join(tmpdir(), "lsew-context-lifecycle-"));
  let context: BrowserContext | undefined;
  try {
    await new Promise<void>(resolveReady => server.listen(0, "127.0.0.1", resolveReady));
    const port = (server.address() as { port: number }).port;
    context = await chromium.launchPersistentContext(profile, {
      executablePath: await resolveChromeExecutable(root),
      headless: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [...chromeTestArguments({ additional: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`] })]
    });
    const workerUrl = /\/extension\/background\.js$/;
    const worker = context.serviceWorkers().find(candidate => workerUrl.test(candidate.url())) ??
      await context.waitForEvent("serviceworker", { predicate: candidate => workerUrl.test(candidate.url()) });
    // Chrome can initially load a command-line extension with developer mode
    // off, then disable that unpacked extension on reload. Enable it only in
    // this disposable test profile, as required for normal unpacked loading.
    const extensionSettings = await context.newPage();
    await extensionSettings.goto("chrome://extensions/");
    const developerMode = extensionSettings.getByRole("button", { name: "Developer mode", exact: true });
    if (await developerMode.getAttribute("aria-pressed") !== "true") await developerMode.click();
    await expect(developerMode).toHaveAttribute("aria-pressed", "true");
    await extensionSettings.close();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const errors: string[] = [];
    cdp.on("Runtime.exceptionThrown", event => errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text));
    await cdp.send("Runtime.enable");
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.locator("html")).toHaveAttribute("data-lsew-content-bridge-ready", "true");
    const emitUpdates = async () => page.evaluate(() => new Promise<void>(resolveDelivered => {
      window.addEventListener("message", function delivered(event) {
        if (event.data?.lifecycleTestIndex !== 19) return;
        window.removeEventListener("message", delivered);
        resolveDelivered();
      });
      for (let index = 0; index < 20; index++) {
        document.body.dataset.appUpdates = String(Number(document.body.dataset.appUpdates ?? "0") + 1);
        window.postMessage({ namespace: "__LSEW_CAPTURE__", version: 1, kind: "item-update", timestamp: Date.now(), payload: { fields: { value: "unchanged" } }, lifecycleTestIndex: index }, "*");
      }
    }));
    await emitUpdates();
    await expect(page.locator("body")).toHaveAttribute("data-app-updates", "20");
    const retired = worker.waitForEvent("close", { timeout: 10_000 });
    await worker.evaluate(() => chrome.runtime.reload()).catch(error => {
      if (!/closed|destroyed/i.test(String(error))) throw error;
    });
    await retired;
    await emitUpdates();
    await expect(page.locator("body")).toHaveAttribute("data-app-updates", "40");
    await expect(page.locator("html")).not.toHaveAttribute("data-lsew-content-bridge-ready", "true");
    expect(errors).toEqual([]);
    // Worker closure marks invalidation, not completion of the extension reload.
    // Wait until Chrome serves the reloaded extension before refreshing the page.
    const extensionProbe = await context.newPage();
    await expect(async () => {
      await extensionProbe.goto(new URL("/manifest.json", worker.url()).href);
      expect(await extensionProbe.locator("body").innerText()).toContain('"manifest_version"');
    }).toPass({ timeout: 15_000 });
    await extensionProbe.close();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-lsew-content-bridge-ready", "true");
    await emitUpdates();
    await expect(page.locator("body")).toHaveAttribute("data-app-updates", "20");
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await new Promise<void>(done => server.close(() => done()));
    await rm(profile, { recursive: true });
  }
});
