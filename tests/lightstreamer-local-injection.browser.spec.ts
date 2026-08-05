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

    const wireEvidenceCount = await waitForPanelEvidence(panelCdp);
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
    await waitForPanelEvidence(panelCdp, wireEvidenceCount);

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

async function waitForPanelEvidence(cdp: CdpClient, previousCount = 0): Promise<number> {
  await waitForCondition(
    cdp,
    `
      document.querySelector(".workbench-react__operating strong")?.textContent === "Capture RUNNING" &&
      [...document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]')]
        .filter((row) =>
          row.textContent?.includes("scenario.mutate-reinject") &&
          [...row.querySelectorAll('[role="gridcell"]')]
            .some((cell) => cell.textContent?.trim() === "SERVER")
        ).length > ${previousCount}
    `,
    "the production Evidence workspace to show the fixture Item Update"
  );
  return evaluateByValue<number>(
    cdp,
    `[...document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]')]
      .filter((row) =>
        row.textContent?.includes("scenario.mutate-reinject") &&
        [...row.querySelectorAll('[role="gridcell"]')]
          .some((cell) => cell.textContent?.trim() === "SERVER")
      ).length`
  );
}

async function injectFromLatestServerEvidence(cdp: CdpClient, messageText: string): Promise<void> {
  const latestServerEvidence = `(() => {
    const rows = [...document.querySelectorAll(
      '[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]'
    )].filter((row) =>
      row.textContent?.includes("scenario.mutate-reinject") &&
      [...row.querySelectorAll('[role="gridcell"]')]
        .some((cell) => cell.textContent?.trim() === "SERVER")
    );
    return rows.at(-1);
  })()`;
  if (!await isPanelElementVisible(cdp, latestServerEvidence)) {
    await clickVisiblePanelElement(
      cdp,
      `[...document.querySelectorAll("button")].find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return candidate.textContent?.trim() === "Back to Evidence" && rect.width > 0 && rect.height > 0;
      })`,
      "visible Back to Evidence button"
    );
    await waitForCondition(
      cdp,
      `(() => {
        const target = ${latestServerEvidence};
        if (!(target instanceof HTMLElement)) return false;
        const rect = target.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })()`,
      "the latest fixture SERVER Evidence to return to view"
    );
  }
  await clickVisiblePanelElement(
    cdp,
    latestServerEvidence,
    "latest visible fixture SERVER Evidence"
  );
  try {
    await waitForCondition(
      cdp,
      `[...document.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Create Local Injection Draft" && !button.disabled
      )`,
      "the selected Evidence to offer Local Injection"
    );
  } catch (error) {
    const diagnostic = await evaluateByValue<unknown>(cdp, `(() => {
      const row = ${latestServerEvidence};
      const shell = document.querySelector(".workbench-react");
      return {
        compactSurface: shell?.getAttribute("data-compact-surface"),
        rowSelected: row?.getAttribute("aria-selected"),
        activeElement: document.activeElement?.textContent?.trim(),
        context: document.querySelector('[aria-label="Context"]')?.textContent?.trim()
      };
    })()`);
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nPanel state: ${JSON.stringify(diagnostic)}`);
  }
  if (!await isPanelElementVisible(cdp, `[...document.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "Create Local Injection Draft" && !button.disabled)`)) {
    await clickPanelButton(cdp, "Open Context");
    await waitForCondition(
      cdp,
      `(() => {
        const button = [...document.querySelectorAll("button")]
          .find((candidate) => candidate.textContent?.trim() === "Create Local Injection Draft" && !candidate.disabled);
        if (!(button instanceof HTMLElement)) return false;
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(button).display !== "none";
      })()`,
      "the compact Context route to reveal Local Injection"
    );
  }
  await clickPanelButton(cdp, "Create Local Injection Draft");
  await waitForCondition(
    cdp,
    'document.querySelector(\'[aria-label="Local Injection JSON"][contenteditable="true"]\')',
    "the raw Local Injection editor"
  );
  await waitForCondition(
    cdp,
    `(() => {
      const text = document.querySelector('[aria-label="Local Injection JSON"]')?.textContent ?? "";
      return text.includes('"modelValues": {') &&
        text.includes(${JSON.stringify(initialMessage)}) &&
        !text.includes('\\\\"messageId\\\\"');
    })()`,
    "the captured JSON-string field to expand as structured editor JSON"
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
      modelValues: {
        messageId: "fixture-1",
        messageText,
        messageType: "TICKER"
      }
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
  await clickVisiblePanelElement(
    cdp,
    `document.querySelector('[aria-label="Local Injection JSON"][contenteditable="true"]')`,
    "Local Injection JSON editor"
  );
  await selectAllInFocusedEditor(cdp);
  await cdp.request("Input.insertText", { text });
  try {
    await waitForCondition(
      cdp,
      `(() => {
        const editor = document.querySelector('[aria-label="Local Injection JSON"][contenteditable="true"]');
        return editor instanceof HTMLElement &&
          [...editor.querySelectorAll(".cm-line")].map((line) => line.textContent ?? "").join("\\n") === ${JSON.stringify(text)};
      })()`,
      "the visible Local Injection JSON editor to replace its complete document"
    );
  } catch (error) {
    const actualText = await evaluateByValue<string>(
      cdp,
      `(() => {
        const editor = document.querySelector('[aria-label="Local Injection JSON"][contenteditable="true"]');
        return editor instanceof HTMLElement
          ? [...editor.querySelectorAll(".cm-line")].map((line) => line.textContent ?? "").join("\\n")
          : "";
      })()`
    );
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nEditor contents: ${JSON.stringify(actualText)}`);
  }
}

async function selectAllInFocusedEditor(cdp: CdpClient): Promise<void> {
  const modifier = process.platform === "darwin"
    ? { key: "Meta", code: "MetaLeft", windowsVirtualKeyCode: 91, nativeVirtualKeyCode: 91, modifiers: 4 }
    : { key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: 2 };
  await cdp.request("Input.dispatchKeyEvent", { type: "rawKeyDown", ...modifier });
  await cdp.request("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: modifier.modifiers });
  await cdp.request("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: modifier.modifiers });
  await cdp.request("Input.dispatchKeyEvent", { type: "keyUp", ...modifier });
}

async function clickPanelButton(cdp: CdpClient, label: string): Promise<void> {
  await clickVisiblePanelElement(
    cdp,
    `[...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)} && !candidate.disabled)`,
    `${label} button`
  );
}

async function clickVisiblePanelElement(
  cdp: CdpClient,
  targetExpression: string,
  description: string
): Promise<void> {
  const point = await evaluateByValue<{ x: number; y: number }>(cdp, `(() => {
    const target = ${targetExpression};
    if (!(target instanceof HTMLElement)) throw new Error("Missing ${description}");
    target.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = target.getBoundingClientRect();
    const style = getComputedStyle(target);
    if (!rect.width || !rect.height || style.visibility === "hidden" || style.display === "none") {
      throw new Error("${description} is not visibly operable");
    }
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (!target.contains(document.elementFromPoint(x, y))) {
      throw new Error("${description} is obscured at its visible click target");
    }
    return { x, y };
  })()`);
  await cdp.request("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.request("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function isPanelElementVisible(cdp: CdpClient, targetExpression: string): Promise<boolean> {
  return evaluateByValue<boolean>(cdp, `(() => {
    const target = ${targetExpression};
    if (!(target instanceof HTMLElement)) return false;
    const rect = target.getBoundingClientRect();
    const style = getComputedStyle(target);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
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
