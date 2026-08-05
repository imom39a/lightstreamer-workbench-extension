import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import {
  CdpClient,
  evaluateByValue,
  listBrowserTargets,
  resolveChromeExecutable,
  terminateChild,
  waitForBrowserTargets,
  waitForCondition,
  waitForDebuggingPort,
  waitForExtensionPanelTarget
} from "./support/chrome-extension-cdp";
import { waitForWorkbenchPanel } from "./support/devtools-panel";

type CaptureMessage = {
  kind?: string;
  payload?: {
    subscription?: { fields?: string[] };
    listener?: { id?: string } | null;
    item?: { name?: string };
    update?: { isSnapshot?: boolean };
    raw?: { captureSource?: string; frameTag?: string };
  };
};

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const extensionDir = join(rootDir, "dist");
const baseFixtureUrl = new URL(
  "/mutate-reinject.html",
  process.env.LSEW_FIXTURE_URL ?? "http://localhost:8080/"
);
const wireFixtureUrl = baseFixtureUrl.href;
const listenerFixtureUrl = (() => {
  const url = new URL(baseFixtureUrl);
  url.searchParams.set("capture", "listener");
  url.searchParams.set("feedback", "block-window-result");
  return url.href;
})();
const initialMessage = "Attention - real Lightstreamer client.";
let localInjectionKeySequence = 0;

async function runBrowserProof(): Promise<void> {
  const profileDir = await mkdtemp(join(tmpdir(), "lsew-local-injection-transport-"));
  const chromeExecutable = await resolveChromeExecutable(rootDir);
  const chromeLogs: string[] = [];
  const chrome = spawn(chromeExecutable, [
    ...(process.env.LSEW_BROWSER_HEADLESS === "false" ? [] : ["--headless=new"]),
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--use-mock-keychain",
    "--auto-open-devtools-for-tabs",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    "--window-size=1280,900",
    "about:blank"
  ], {
    cwd: rootDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  chrome.stdout?.on("data", (chunk: Buffer) => chromeLogs.push(String(chunk)));
  chrome.stderr?.on("data", (chunk: Buffer) => chromeLogs.push(String(chunk)));

  let pageCdp: CdpClient | null = null;
  let devtoolsCdp: CdpClient | null = null;
  let panelCdp: CdpClient | null = null;
  try {
    const debugging = await waitForDebuggingPort(profileDir, chrome);
    const targets = await waitForBrowserTargets(debugging.port, { requireExtensionDevtools: true });
    const pageTarget = targets.find(
      (target) =>
        target.type === "page" &&
        !target.url?.startsWith("devtools://") &&
        typeof target.webSocketDebuggerUrl === "string"
    );
    assert.ok(pageTarget?.webSocketDebuggerUrl, "Chrome should expose the inspected fixture page.");
    pageCdp = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);
    await pageCdp.request("Page.enable");
    await pageCdp.request("Runtime.enable");
    await pageCdp.request("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        globalThis.__LSEW_E2E_CAPTURES__ = [];
        addEventListener("message", (event) => {
          if (
            event.source === globalThis &&
            event.data?.namespace === "__LSEW_CAPTURE__" &&
            event.data?.version === 1
          ) globalThis.__LSEW_E2E_CAPTURES__.push(event.data);
        });
      `
    });
    await pageCdp.request("Page.navigate", { url: wireFixtureUrl });
    await waitForFixture(pageCdp);

    const wireCapture = await latestFixtureCapture(pageCdp, "wire");
    assert.equal(wireCapture.payload?.raw?.captureSource, "websocket-tlcp");
    assert.equal(wireCapture.payload?.raw?.frameTag, "U");
    assert.equal(wireCapture.payload?.listener ?? null, null);
    assert.deepEqual(wireCapture.payload?.subscription?.fields, [
      "key",
      "command",
      "modelId",
      "modelValues"
    ]);
    assert.equal(wireCapture.payload?.update?.isSnapshot, true);

    const panelSelection = await waitForWorkbenchPanel({
      listTargets: () => listBrowserTargets(debugging.port),
      connect: CdpClient.connect,
      evaluateByValue
    });
    devtoolsCdp = panelSelection.cdp;
    assert.ok(panelSelection.selection.panelId, "DevTools should register Workbench.");
    assert.equal(panelSelection.selection.selectedTabId, panelSelection.selection.panelId);

    const panelTarget = await waitForExtensionPanelTarget(debugging.port);
    assert.ok(panelTarget.webSocketDebuggerUrl, "Chrome should expose the Workbench panel target.");
    panelCdp = await CdpClient.connect(panelTarget.webSocketDebuggerUrl);
    await panelCdp.request("Runtime.enable");

    await waitForPanelEvidence(panelCdp);
    const directWireMessage = "Direct wire Local Injection through the protected page bridge.";
    await injectFromLatestServerEvidence(panelCdp, directWireMessage);
    await waitForRenderedMessage(pageCdp, directWireMessage, 2);

    assert.equal(
      await evaluateByValue<boolean>(pageCdp, "delete globalThis.__LSEW_REINJECTION_BRIDGE__"),
      true
    );
    const messageChannelWireMessage = "Wire Local Injection through the message-channel fallback.";
    await injectFromLatestServerEvidence(panelCdp, messageChannelWireMessage);
    await waitForRenderedMessage(pageCdp, messageChannelWireMessage, 3);

    await pageCdp.request("Page.navigate", { url: listenerFixtureUrl });
    await waitForFixture(pageCdp);
    const listenerCapture = await latestFixtureCapture(pageCdp, "listener");
    assert.ok(listenerCapture.payload?.listener?.id);
    assert.notEqual(listenerCapture.payload?.raw?.captureSource, "websocket-tlcp");
    await waitForPanelEvidence(panelCdp);

    assert.equal(
      await evaluateByValue<boolean>(pageCdp, "delete globalThis.__LSEW_REINJECTION_BRIDGE__"),
      true
    );
    const listenerFallbackMessage = "Listener Local Injection with acknowledged fallback feedback.";
    await injectFromLatestServerEvidence(panelCdp, listenerFallbackMessage);
    await waitForRenderedMessage(pageCdp, listenerFallbackMessage, 2);

    console.log(
      "Local Injection transport proof passed: wire direct + message-channel fallback + listener fallback."
    );
  } catch (error) {
    const logTail = chromeLogs.join("").slice(-4_000);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${logTail ? `\nChrome output:\n${logTail}` : ""}`
    );
  } finally {
    panelCdp?.close();
    devtoolsCdp?.close();
    pageCdp?.close();
    await terminateChild(chrome);
    await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function waitForFixture(cdp: CdpClient): Promise<void> {
  await waitForCondition(
    cdp,
    `
      globalThis.__LSEW_REINJECTION_BRIDGE__?.version === 1 &&
      document.querySelector("#connection-state")?.textContent === "SUBSCRIBED" &&
      document.querySelector("#message-text")?.textContent === ${JSON.stringify(initialMessage)} &&
      Number(document.querySelector("#update-count")?.textContent) === 1
    `,
    "the official Lightstreamer fixture snapshot and Local Injection bridge"
  );
}

async function latestFixtureCapture(
  cdp: CdpClient,
  capture: "wire" | "listener"
): Promise<CaptureMessage> {
  return evaluateByValue<CaptureMessage>(
    cdp,
    `(() => {
      const found = globalThis.__LSEW_E2E_CAPTURES__.findLast((message) =>
        message.kind === "item-update" &&
        message.payload?.item?.name === "scenario.mutate-reinject" &&
        ${capture === "wire"
          ? 'message.payload?.raw?.captureSource === "websocket-tlcp"'
          : 'typeof message.payload?.listener?.id === "string"'}
      );
      if (!found) throw new Error("Expected ${capture} Item Update capture.");
      return found;
    })()`
  );
}

async function waitForPanelEvidence(cdp: CdpClient): Promise<void> {
  await waitForCondition(
    cdp,
    `
      document.querySelector(".workbench-react__operating strong")?.textContent === "Capture RUNNING" &&
      [...document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]')]
        .some((row) =>
          row.textContent?.includes("scenario.mutate-reinject") &&
          [...row.querySelectorAll('[role="gridcell"]')]
            .some((cell) => cell.textContent?.trim() === "SERVER")
        )
    `,
    "the production Evidence workspace to show the fixture Item Update"
  );
}

async function injectFromLatestServerEvidence(cdp: CdpClient, messageText: string): Promise<void> {
  await evaluateByValue(cdp, `(() => {
    const rows = [...document.querySelectorAll(
      '[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]'
    )].filter((row) =>
      row.textContent?.includes("scenario.mutate-reinject") &&
      [...row.querySelectorAll('[role="gridcell"]')]
        .some((cell) => cell.textContent?.trim() === "SERVER")
    );
    const row = rows.at(-1);
    if (!(row instanceof HTMLButtonElement)) throw new Error("Fixture SERVER Evidence is missing.");
    row.click();
  })()`);
  await waitForCondition(
    cdp,
    `[...document.querySelectorAll("button")].some(
      (button) => button.textContent?.trim() === "Create Local Injection Draft" && !button.disabled
    )`,
    "the selected Evidence to offer Local Injection"
  );
  await clickPanelButton(cdp, "Create Local Injection Draft");
  await waitForCondition(
    cdp,
    'document.querySelector(\'[aria-label="Local Injection JSON"][contenteditable="true"]\')',
    "the raw Local Injection editor"
  );

  const key = `fixture-local-${++localInjectionKeySequence}.TICKER`;
  const document = {
    command: "ADD",
    key,
    isSnapshot: false,
    fields: {
      key,
      command: "ADD",
      modelId: "MESSENGER",
      modelValues: JSON.stringify({
        messageId: "fixture-1",
        messageText,
        messageType: "TICKER"
      })
    }
  };
  await replaceLocalInjectionJson(cdp, JSON.stringify(document, null, 2));
  try {
    await waitForCondition(
      cdp,
      `[...document.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Review Local Injection" && !button.disabled
      )`,
      "the edited Local Injection to pass preflight"
    );
  } catch (error) {
    const diagnostics = await evaluateByValue<string>(
      cdp,
      `document.querySelector('[aria-label="Local Injection Draft"]')?.textContent ?? "draft unavailable"`
    );
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${diagnostics}`);
  }
  await clickPanelButton(cdp, "Review Local Injection");
  await waitForCondition(
    cdp,
    `[...document.querySelectorAll("button")].some(
      (button) => button.textContent?.trim() === "Inject locally" && !button.disabled
    )`,
    "the reviewed Local Injection to become executable"
  );
  await clickPanelButton(cdp, "Inject locally");
  await waitForCondition(
    cdp,
    'document.querySelector(\'[aria-label="Local Injection Draft"]\')?.textContent?.includes("DELIVERED LOCALLY")',
    "the Local Injection delivery acknowledgement"
  );
  await clickPanelButton(cdp, "Finish Local Injection");
}

async function replaceLocalInjectionJson(cdp: CdpClient, text: string): Promise<void> {
  await evaluateByValue(cdp, `(() => {
    const editor = document.querySelector('[aria-label="Local Injection JSON"][contenteditable="true"]');
    if (!(editor instanceof HTMLElement)) throw new Error("Local Injection JSON editor is missing.");
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection?.removeAllRanges();
    selection?.addRange(range);
  })()`);
  await cdp.request("Input.insertText", { text });
}

async function clickPanelButton(cdp: CdpClient, label: string): Promise<void> {
  await evaluateByValue(cdp, `(() => {
    const button = [...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      throw new Error("Panel button unavailable: " + ${JSON.stringify(label)});
    }
    button.click();
  })()`);
}

async function waitForRenderedMessage(
  cdp: CdpClient,
  message: string,
  updateCount: number
): Promise<void> {
  await waitForCondition(
    cdp,
    `
      document.querySelector("#message-text")?.textContent === ${JSON.stringify(message)} &&
      Number(document.querySelector("#update-count")?.textContent) === ${updateCount}
    `,
    "the official client application to render the Local Injected Update"
  );
}

await runBrowserProof();
