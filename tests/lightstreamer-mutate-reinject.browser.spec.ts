import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { Browser, Cache } from "@puppeteer/browsers";
import WebSocket from "ws";

type CdpResponse = {
  id?: number;
  result?: unknown;
  error?: { message?: string };
};

type RuntimeEvaluation = {
  result?: {
    value?: unknown;
    description?: string;
  };
  exceptionDetails?: {
    text?: string;
    exception?: { description?: string };
  };
};

type CaptureMessage = {
  kind?: string;
  payload?: {
    subscription?: { id?: string; fields?: string[] };
    listener?: { id?: string } | null;
    item?: { name?: string; position?: number };
    update?: { command?: string; key?: string; isSnapshot?: boolean };
    fields?: Record<string, string | number | boolean | null>;
    raw?: { captureSource?: string; frameTag?: string };
  };
};

type PreparedBrowserProof = {
  bridgeVersion: number;
  sourceCapture: CaptureMessage;
  initialMessage: string;
  initialUpdateCount: number;
};

type PanelSelectionProof = {
  panelId: string | null;
  selectedTabId: string | null;
  availableTabIds: string[];
};

type PanelDraftEditProof = {
  value: string;
  dirtyCount: string;
  injectDisabled: boolean;
  validationValid: string | null;
  error: string;
};

type BrowserTarget = {
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const extensionDir = join(rootDir, "dist");
const fixtureUrl = new URL(
  "/mutate-reinject.html",
  process.env.LSEW_FIXTURE_URL ?? "http://localhost:8080/"
).href;
const listenerFixtureUrl = (() => {
  const url = new URL(fixtureUrl);
  url.searchParams.set("capture", "listener");
  url.searchParams.set("feedback", "block-window-result");
  return url.href;
})();
const expectedInitialMessage = "Attention - real Lightstreamer client.";
const mutatedMessage = "Mutated and reinjected through the captured Lightstreamer WebSocket.";
const fallbackMutatedMessage =
  "Mutated through the panel fallback and rendered by the Lightstreamer client.";
const listenerFallbackMutatedMessage =
  "Mutated through the listener fallback with acknowledged feedback.";

async function runBrowserProof(): Promise<void> {
  const profileDir = await mkdtemp(join(tmpdir(), "lsew-mutate-reinject-"));
  const chromeExecutable = await resolveChromeExecutable();
  const chromeLogs: string[] = [];
  const chromeArguments = [
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
    "--window-size=1200,900",
    "about:blank"
  ];
  if (process.env.LSEW_BROWSER_HEADLESS !== "false") {
    chromeArguments.unshift("--headless=new");
  }
  const chrome = spawn(chromeExecutable, chromeArguments, {
    cwd: rootDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  chrome.stdout?.on("data", (chunk: Buffer) => chromeLogs.push(String(chunk)));
  chrome.stderr?.on("data", (chunk: Buffer) => chromeLogs.push(String(chunk)));

  let cdp: CdpClient | null = null;
  let devtoolsFrontendCdp: CdpClient | null = null;
  let panelCdp: CdpClient | null = null;
  try {
    const debuggingPort = await waitForDebuggingPort(profileDir, chrome);
    const targets = await waitForBrowserTargets(debuggingPort);
    const pageTarget = targets.find(
      (target) =>
        target.type === "page" &&
        !target.url?.startsWith("devtools://") &&
        typeof target.webSocketDebuggerUrl === "string"
    );
    const extensionDevtoolsTarget = targets.find(
      (target) =>
        target.type === "iframe" &&
        target.url?.startsWith("chrome-extension://") &&
        target.url.endsWith("/devtools.html") &&
        typeof target.webSocketDebuggerUrl === "string"
    );
    const devtoolsFrontendTarget = targets.find(
      (target) =>
        target.type === "page" &&
        target.url?.startsWith("devtools://") &&
        typeof target.webSocketDebuggerUrl === "string"
    );
    assert.ok(pageTarget?.webSocketDebuggerUrl, "Chrome should expose an inspectable page target");
    assert.ok(
      extensionDevtoolsTarget?.webSocketDebuggerUrl,
      "Chrome should load the extension DevTools page for the inspected fixture"
    );
    assert.ok(
      devtoolsFrontendTarget?.webSocketDebuggerUrl,
      "Chrome should expose the DevTools frontend target"
    );

    cdp = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);
    devtoolsFrontendCdp = await CdpClient.connect(devtoolsFrontendTarget.webSocketDebuggerUrl);
    await cdp.request("Page.enable");
    await cdp.request("Runtime.enable");
    await devtoolsFrontendCdp.request("Runtime.enable");
    await cdp.request("Page.addScriptToEvaluateOnNewDocument", {
      source: `
      globalThis.__LSEW_E2E_CAPTURES__ = [];
      addEventListener("message", (event) => {
        if (
          event.source === globalThis &&
          event.data?.namespace === "__LSEW_CAPTURE__" &&
          event.data?.version === 1
        ) {
          globalThis.__LSEW_E2E_CAPTURES__.push(event.data);
        }
      });
    `
    });
    await cdp.request("Page.navigate", { url: fixtureUrl });

    await waitForCondition(
      cdp,
      `
      globalThis.__LSEW_REINJECTION_BRIDGE__?.version === 1 &&
      document.querySelector("#message-text")?.textContent === ${JSON.stringify(expectedInitialMessage)} &&
      Number(document.querySelector("#update-count")?.textContent) >= 1
    `,
      "official Lightstreamer client snapshot and extension bridge"
    );

    const proof = await evaluateByValue<PreparedBrowserProof>(
      cdp,
      `(() => {
      const sourceCapture = globalThis.__LSEW_E2E_CAPTURES__.findLast((capture) =>
        capture.kind === "item-update" &&
        capture.payload?.item?.name === "scenario.mutate-reinject" &&
        capture.payload?.raw?.captureSource === "websocket-tlcp"
      );
      if (!sourceCapture) {
        throw new Error("No listenerless websocket-tlcp item update was captured.");
      }
      const initialMessage = document.querySelector("#message-text")?.textContent ?? "";
      const initialUpdateCount = Number(document.querySelector("#update-count")?.textContent);
      return {
        bridgeVersion: globalThis.__LSEW_REINJECTION_BRIDGE__.version,
        sourceCapture,
        initialMessage,
        initialUpdateCount
      };
    })()`
    );

    assert.equal(proof.bridgeVersion, 1);
    assert.equal(proof.sourceCapture.payload?.raw?.captureSource, "websocket-tlcp");
    assert.equal(proof.sourceCapture.payload?.raw?.frameTag, "U");
    assert.equal(proof.sourceCapture.payload?.listener ?? null, null);
    assert.deepEqual(proof.sourceCapture.payload?.subscription?.fields, [
      "key",
      "command",
      "modelId",
      "modelValues"
    ]);
    assert.equal(proof.sourceCapture.payload?.update?.isSnapshot, true);
    assert.equal(proof.initialMessage, expectedInitialMessage);
    assert.equal(proof.initialUpdateCount, 1);

    const panelSelection = await showWorkbenchPanel(devtoolsFrontendCdp);
    assert.ok(
      panelSelection.panelId,
      `DevTools should register the Workbench panel. Available tabs: ${panelSelection.availableTabIds.join(
        ", "
      )}`
    );
    assert.equal(panelSelection.selectedTabId, panelSelection.panelId);

    const panelTarget = await waitForExtensionPanelTarget(debuggingPort);
    assert.ok(
      panelTarget.webSocketDebuggerUrl,
      "Chrome should expose the selected Workbench panel target"
    );
    panelCdp = await CdpClient.connect(panelTarget.webSocketDebuggerUrl);
    await panelCdp.request("Runtime.enable");

    await waitForCondition(
      panelCdp,
      `
      document.querySelector(".status-badge")?.textContent === "capturing" &&
      [...document.querySelectorAll('.event-row[data-kind="item-update"][data-source="wire"][data-synthetic="false"]')]
        .some((row) => row.querySelector(".event-item")?.textContent === "scenario.mutate-reinject")
      `,
      "the shipped panel UI to render the captured wire update"
    );

    const stagedDraft = await stageCapturedUpdate(panelCdp, "wire");
    assert.deepEqual(stagedDraft, {
      staged: true,
      cloneVisible: false,
      deliveryTargetVisible: false,
      source: "wire",
      command: "ADD"
    });

    const directEdit = await editPanelDraftMessage(panelCdp, mutatedMessage);
    assert.deepEqual(JSON.parse(directEdit.value), {
      messageId: "fixture-1",
      messageText: mutatedMessage,
      messageType: "TICKER"
    });
    assert.deepEqual(
      {
        dirtyCount: directEdit.dirtyCount,
        injectDisabled: directEdit.injectDisabled,
        validationValid: directEdit.validationValid,
        error: directEdit.error
      },
      {
        dirtyCount: "1 changed",
        injectDisabled: false,
        validationValid: "true",
        error: ""
      }
    );
    assert.deepEqual(await clickPanelInject(panelCdp), {
      clicked: true,
      busy: "true"
    });

    await waitForCondition(
      cdp,
      `
      document.querySelector("#message-text")?.textContent === ${JSON.stringify(mutatedMessage)} &&
      Number(document.querySelector("#update-count")?.textContent) === 2
      `,
      "the shipped panel mutation to reach the Lightstreamer listener and rendered UI"
    );

    await waitForCondition(
      panelCdp,
      `
      document.querySelector(".replay-card")?.getAttribute("aria-busy") === "false" &&
      document.querySelector(".reinjection-message")?.textContent?.includes(
        "Edited update delivered locally through the captured page WebSocket"
      )
      `,
      "the shipped panel to render direct reinjection success"
    );

    assert.equal(
      await evaluateByValue<boolean>(
        cdp,
        `delete globalThis.__LSEW_REINJECTION_BRIDGE__`
      ),
      true
    );

    const fallbackEdit = await editPanelDraftMessage(panelCdp, fallbackMutatedMessage);
    assert.deepEqual(JSON.parse(fallbackEdit.value), {
      messageId: "fixture-1",
      messageText: fallbackMutatedMessage,
      messageType: "TICKER"
    });
    assert.deepEqual(
      {
        dirtyCount: fallbackEdit.dirtyCount,
        injectDisabled: fallbackEdit.injectDisabled,
        validationValid: fallbackEdit.validationValid,
        error: fallbackEdit.error
      },
      {
        dirtyCount: "1 changed",
        injectDisabled: false,
        validationValid: "true",
        error: ""
      }
    );
    assert.deepEqual(await clickPanelInject(panelCdp), {
      clicked: true,
      busy: "true"
    });

    await waitForCondition(
      cdp,
      `
      document.querySelector("#message-text")?.textContent === ${JSON.stringify(fallbackMutatedMessage)} &&
      Number(document.querySelector("#update-count")?.textContent) === 3
    `,
      "fallback reinjection to reach the official Lightstreamer client listener and rendered UI"
    );

    await waitForCondition(
      panelCdp,
      `
      document.querySelector(".replay-card")?.getAttribute("aria-busy") === "false" &&
      document.querySelector(".reinjection-message")?.textContent?.includes(
        "Edited update delivered locally through the captured page WebSocket"
      ) &&
      ![...document.querySelectorAll('[role="alert"]')].some((alert) => !alert.hidden)
      `,
      "the shipped panel to render fallback reinjection success without an error"
    );

    const finalUi = await evaluateByValue<{
      message: string;
      model: string;
      updateCount: number;
    }>(
      cdp,
      `({
      message: document.querySelector("#message-text")?.textContent ?? "",
      model: document.querySelector("#rendered-model")?.textContent ?? "",
      updateCount: Number(document.querySelector("#update-count")?.textContent)
    })`
    );
    assert.equal(finalUi.message, fallbackMutatedMessage);
    assert.match(finalUi.model, /Mutated through the panel fallback/);
    assert.equal(finalUi.updateCount, 3);

    await cdp.request("Page.navigate", { url: listenerFixtureUrl });
    await waitForCondition(
      cdp,
      `
      globalThis.__LSEW_REINJECTION_BRIDGE__?.version === 1 &&
      new URL(location.href).searchParams.get("feedback") === "block-window-result" &&
      document.querySelector("#message-text")?.textContent === ${JSON.stringify(expectedInitialMessage)} &&
      Number(document.querySelector("#update-count")?.textContent) === 1 &&
      globalThis.__LSEW_E2E_CAPTURES__.some((capture) =>
        capture.kind === "item-update" &&
        capture.payload?.item?.name === "scenario.mutate-reinject" &&
        typeof capture.payload?.listener?.id === "string"
      )
      `,
      "official Lightstreamer listener capture and rendered snapshot"
    );

    const listenerProof = await evaluateByValue<PreparedBrowserProof>(
      cdp,
      `(() => {
      const sourceCapture = globalThis.__LSEW_E2E_CAPTURES__.findLast((capture) =>
        capture.kind === "item-update" &&
        capture.payload?.item?.name === "scenario.mutate-reinject" &&
        typeof capture.payload?.listener?.id === "string"
      );
      if (!sourceCapture) {
        throw new Error("No official-client listener item update was captured.");
      }
      return {
        bridgeVersion: globalThis.__LSEW_REINJECTION_BRIDGE__.version,
        sourceCapture,
        initialMessage: document.querySelector("#message-text")?.textContent ?? "",
        initialUpdateCount: Number(document.querySelector("#update-count")?.textContent)
      };
    })()`
    );
    assert.equal(listenerProof.bridgeVersion, 1);
    assert.ok(listenerProof.sourceCapture.payload?.listener?.id);
    assert.notEqual(
      listenerProof.sourceCapture.payload?.raw?.captureSource,
      "websocket-tlcp"
    );
    assert.equal(listenerProof.initialMessage, expectedInitialMessage);
    assert.equal(listenerProof.initialUpdateCount, 1);

    await waitForCondition(
      panelCdp,
      `
      [...document.querySelectorAll('.event-row[data-kind="item-update"][data-source="listener"][data-synthetic="false"]')]
        .some((row) => row.querySelector(".event-item")?.textContent === "scenario.mutate-reinject")
      `,
      "the shipped panel UI to render the captured listener update"
    );

    const listenerDraft = await stageCapturedUpdate(panelCdp, "listener");
    assert.deepEqual(listenerDraft, {
      staged: true,
      cloneVisible: false,
      deliveryTargetVisible: false,
      source: "listener",
      command: "ADD"
    });

    const listenerEdit = await editPanelDraftMessage(
      panelCdp,
      listenerFallbackMutatedMessage
    );
    assert.deepEqual(JSON.parse(listenerEdit.value), {
      messageId: "fixture-1",
      messageText: listenerFallbackMutatedMessage,
      messageType: "TICKER"
    });
    assert.deepEqual(
      {
        dirtyCount: listenerEdit.dirtyCount,
        injectDisabled: listenerEdit.injectDisabled,
        validationValid: listenerEdit.validationValid,
        error: listenerEdit.error
      },
      {
        dirtyCount: "1 changed",
        injectDisabled: false,
        validationValid: "true",
        error: ""
      }
    );

    assert.equal(
      await evaluateByValue<boolean>(
        cdp,
        `delete globalThis.__LSEW_REINJECTION_BRIDGE__`
      ),
      true
    );
    assert.deepEqual(await clickPanelInject(panelCdp), {
      clicked: true,
      busy: "true"
    });

    await waitForCondition(
      cdp,
      `
      document.querySelector("#message-text")?.textContent === ${JSON.stringify(listenerFallbackMutatedMessage)} &&
      Number(document.querySelector("#update-count")?.textContent) === 2
      `,
      "listener fallback reinjection to update the official Lightstreamer client UI once"
    );

    await waitForCondition(
      panelCdp,
      `
      document.querySelector(".replay-card")?.getAttribute("aria-busy") === "false" &&
      document.querySelector(".reinjection-message")?.textContent?.includes(
        "Edited update delivered to every current listener on the target Subscription"
      ) &&
      ![...document.querySelectorAll('[role="alert"]')].some((alert) => !alert.hidden)
      `,
      "the shipped panel to acknowledge listener fallback success without an error"
    );

    const listenerFinalUi = await evaluateByValue<{
      message: string;
      model: string;
      updateCount: number;
    }>(
      cdp,
      `({
      message: document.querySelector("#message-text")?.textContent ?? "",
      model: document.querySelector("#rendered-model")?.textContent ?? "",
      updateCount: Number(document.querySelector("#update-count")?.textContent)
    })`
    );
    assert.equal(listenerFinalUi.message, listenerFallbackMutatedMessage);
    assert.match(listenerFinalUi.model, /acknowledged feedback/);
    assert.equal(listenerFinalUi.updateCount, 2);

    console.log(
      "Mutate & re-inject browser proof passed: wire + listener fallback delivery, feedback, and official client UI"
    );
  } catch (error) {
    const logTail = chromeLogs.join("").slice(-4_000);
    let pageState = "unavailable";
    let panelState = "unavailable";
    if (cdp) {
      try {
        pageState = JSON.stringify(
          await evaluateByValue(
            cdp,
            `({
            href: location.href,
            title: document.title,
            readyState: document.readyState,
            bridgeVersion: globalThis.__LSEW_REINJECTION_BRIDGE__?.version ?? null,
            instrumented: globalThis.__LSEW_INSTRUMENTED__ ?? null,
            connection: document.querySelector("#connection-state")?.textContent ?? null,
            message: document.querySelector("#message-text")?.textContent ?? null,
            updateCount: document.querySelector("#update-count")?.textContent ?? null,
            captures: globalThis.__LSEW_E2E_CAPTURES__?.map((capture) => ({
              kind: capture.kind,
              item: capture.payload?.item?.name,
              source: capture.payload?.raw?.captureSource
            })) ?? []
          })`
          )
        );
      } catch (diagnosticError) {
        pageState = `diagnostic failed: ${String(diagnosticError)}`;
      }
    }
    if (panelCdp) {
      try {
        panelState = JSON.stringify(
          await evaluateByValue(
            panelCdp,
            `({
            readyState: document.readyState,
            status: document.querySelector(".status-badge")?.textContent ?? null,
            eventCount: document.querySelector(".event-count")?.textContent ?? null,
            selectedEvent: document.querySelector('.event-row[data-selected="true"]')?.getAttribute("data-event-id") ?? null,
            replay: document.querySelector(".replay-card")?.innerText ?? null,
            alerts: [...document.querySelectorAll('[role="alert"]')]
              .filter((alert) => !alert.hidden)
              .map((alert) => alert.textContent)
          })`
          )
        );
      } catch (diagnosticError) {
        panelState = `diagnostic failed: ${String(diagnosticError)}`;
      }
    }
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nPage state: ${pageState}\nPanel state: ${panelState}${
        logTail ? `\nChrome output:\n${logTail}` : ""
      }`
    );
  } finally {
    cdp?.close();
    devtoolsFrontendCdp?.close();
    panelCdp?.close();
    await terminateChild(chrome);
    await rm(profileDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100
    });
  }
}

async function showWorkbenchPanel(cdp: CdpClient): Promise<PanelSelectionProof> {
  return evaluateByValue<PanelSelectionProof>(
    cdp,
    `(async () => {
      const UI = await import("devtools://devtools/bundled/ui/legacy/legacy.js");
      const tabbedPane = UI.InspectorView.InspectorView.instance().tabbedPane;
      const availableTabIds = tabbedPane.tabIds();
      const panelId =
        availableTabIds.find((id) => id.includes("LightstreamerWorkbench")) ?? null;
      if (panelId) {
        await tabbedPane.selectTab(panelId, true);
      }
      return {
        panelId,
        selectedTabId: tabbedPane.selectedTabId ?? null,
        availableTabIds
      };
    })()`
  );
}

async function stageCapturedUpdate(
  cdp: CdpClient,
  source: "wire" | "listener"
): Promise<{
  staged: boolean;
  cloneVisible: boolean;
  deliveryTargetVisible: boolean;
  source: string | null;
  command: string | null;
}> {
  return evaluateByValue(
    cdp,
    `(() => {
      const row = [...document.querySelectorAll(
        '.event-row[data-kind="item-update"][data-source=${JSON.stringify(source)}][data-synthetic="false"]'
      )].find(
        (candidate) =>
          candidate.querySelector(".event-item")?.textContent === "scenario.mutate-reinject"
      );
      if (!(row instanceof HTMLButtonElement)) {
        throw new Error(${JSON.stringify(
          `The captured ${source} update row is missing from the shipped panel.`
        )});
      }
      const source = row.dataset.source ?? null;
      const command = row.dataset.command ?? null;
      row.click();

      const reinject = document.querySelector(".replay-source-button");
      if (!(reinject instanceof HTMLButtonElement) || reinject.disabled) {
        throw new Error("The shipped panel did not expose an enabled Re-inject action.");
      }

      const mutate = document.querySelector(".mutate-inject-button");
      if (!(mutate instanceof HTMLButtonElement) || mutate.disabled) {
        throw new Error("The shipped panel did not expose an enabled Mutate & re-inject action.");
      }
      mutate.click();

      return {
        staged: document.querySelector(".draft-controls") !== null,
        cloneVisible: document.querySelector(".clone-button") !== null,
        deliveryTargetVisible: document.querySelector(".draft-execution-targets") !== null,
        source,
        command
      };
    })()`
  );
}

async function editPanelDraftMessage(
  cdp: CdpClient,
  messageText: string
): Promise<PanelDraftEditProof> {
  const modelValues = JSON.stringify({
    messageId: "fixture-1",
    messageText,
    messageType: "TICKER"
  });
  return evaluateByValue<PanelDraftEditProof>(
    cdp,
    `(() => {
      const input = document.querySelector(
        '.structured-field-input[data-field-name="modelValues"]'
      );
      if (!(input instanceof HTMLTextAreaElement)) {
        throw new Error("The shipped panel modelValues editor is unavailable.");
      }
      input.value = ${JSON.stringify(modelValues)};
      input.dispatchEvent(new Event("input", { bubbles: true }));

      const currentInput = document.querySelector(
        '.structured-field-input[data-field-name="modelValues"]'
      );
      const inject = document.querySelector(".inject-edited-button");
      if (
        !(currentInput instanceof HTMLTextAreaElement) ||
        !(inject instanceof HTMLButtonElement)
      ) {
        throw new Error("The shipped panel did not retain the edited draft controls.");
      }
      return {
        value: currentInput.value,
        dirtyCount: document.querySelector(".draft-dirty-count")?.textContent ?? "",
        injectDisabled: inject.disabled,
        validationValid: inject.dataset.validationValid ?? null,
        error: document.querySelector(".draft-structured-error")?.textContent ?? ""
      };
    })()`
  );
}

async function clickPanelInject(cdp: CdpClient): Promise<{
  clicked: boolean;
  busy: string | null;
}> {
  return evaluateByValue(
    cdp,
    `(() => {
      const inject = document.querySelector(".inject-edited-button");
      if (!(inject instanceof HTMLButtonElement) || inject.disabled) {
        throw new Error("The shipped panel edited-draft injection action is unavailable.");
      }
      inject.click();
      return {
        clicked: true,
        busy: document.querySelector(".replay-card")?.getAttribute("aria-busy") ?? null
      };
    })()`
  );
}

class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const response = JSON.parse(String(event.data)) as CdpResponse;
      if (typeof response.id !== "number") {
        return;
      }
      const request = this.pending.get(response.id);
      if (!request) {
        return;
      }
      clearTimeout(request.timeout);
      this.pending.delete(response.id);
      if (response.error) {
        request.reject(new Error(response.error.message ?? "Chrome DevTools Protocol error"));
      } else {
        request.resolve(response.result);
      }
    });
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolvePromise, rejectPromise) => {
      socket.addEventListener("open", () => resolvePromise(), { once: true });
      socket.addEventListener(
        "error",
        () => rejectPromise(new Error("Unable to connect to Chrome DevTools Protocol")),
        { once: true }
      );
    });
    return new CdpClient(socket);
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`Timed out waiting for Chrome DevTools Protocol method ${method}`));
      }, 10_000);
      this.pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timeout
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.socket.close();
  }
}

async function evaluateByValue<T>(cdp: CdpClient, expression: string): Promise<T> {
  const evaluation = (await cdp.request("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  })) as RuntimeEvaluation;
  if (evaluation.exceptionDetails) {
    throw new Error(
      evaluation.exceptionDetails.exception?.description ??
        evaluation.exceptionDetails.text ??
        "Browser evaluation failed"
    );
  }
  return evaluation.result?.value as T;
}

async function waitForCondition(
  cdp: CdpClient,
  condition: string,
  description: string,
  timeoutMs = 15_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluateByValue<boolean>(cdp, `Boolean(${condition})`)) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function resolveChromeExecutable(): Promise<string> {
  const configured = process.env.CHROME_PATH?.trim();
  const cacheDir =
    process.env.LSEW_BROWSER_CACHE_DIR?.trim() || join(rootDir, ".cache", "lsew-browsers");
  const installedTestingBrowsers = new Cache(cacheDir)
    .getInstalledBrowsers()
    .filter((installed) => installed.browser === Browser.CHROME)
    .sort((left, right) => right.buildId.localeCompare(left.buildId, undefined, { numeric: true }))
    .map((installed) => installed.executablePath);
  const candidates = [
    configured,
    ...installedTestingBrowsers,
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    ...commandCandidatesFromPath()
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next platform-specific Chrome location.
    }
  }
  throw new Error(
    "Chrome for Testing or Chromium was not found. Run npm run fixture:browser:install, or set CHROME_PATH, to run the real Mutate & re-inject browser proof."
  );
}

function commandCandidatesFromPath(): string[] {
  const executableNames =
    process.platform === "win32" ? ["chromium.exe"] : ["chromium", "chromium-browser"];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .flatMap((directory) => executableNames.map((name) => join(directory, name)));
}

async function waitForDebuggingPort(
  profile: string,
  child: ChildProcess,
  timeoutMs = 15_000
): Promise<number> {
  const activePortFile = join(profile, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Chrome exited before its debugging port opened (${child.exitCode ?? child.signalCode}).`
      );
    }
    try {
      const [rawPort] = (await readFile(activePortFile, "utf8")).trim().split(/\r?\n/);
      const port = Number(rawPort);
      if (Number.isInteger(port) && port > 0) {
        return port;
      }
    } catch {
      // Chrome creates DevToolsActivePort after the profile has initialized.
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for Chrome's remote debugging port.");
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  assert.equal(response.ok, true, `${url} should respond successfully`);
  return response.json();
}

async function waitForBrowserTargets(port: number, timeoutMs = 10_000): Promise<BrowserTarget[]> {
  const url = `http://127.0.0.1:${port}/json/list`;
  const deadline = Date.now() + timeoutMs;
  let latestTargets: BrowserTarget[] = [];
  while (Date.now() < deadline) {
    latestTargets = (await fetchJson(url)) as BrowserTarget[];
    const hasPage = latestTargets.some(
      (target) => target.type === "page" && !target.url?.startsWith("devtools://")
    );
    const hasExtensionDevtools = latestTargets.some(
      (target) =>
        target.type === "iframe" &&
        target.url?.startsWith("chrome-extension://") &&
        target.url.endsWith("/devtools.html")
    );
    const hasDevtoolsFrontend = latestTargets.some(
      (target) => target.type === "page" && target.url?.startsWith("devtools://")
    );
    if (hasPage && hasExtensionDevtools && hasDevtoolsFrontend) {
      return latestTargets;
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for inspected-page and extension DevTools targets. Observed: ${JSON.stringify(
      latestTargets.map(({ type, url }) => ({ type, url }))
    )}`
  );
}

async function waitForExtensionPanelTarget(
  port: number,
  timeoutMs = 10_000
): Promise<BrowserTarget> {
  const url = `http://127.0.0.1:${port}/json/list`;
  const deadline = Date.now() + timeoutMs;
  let latestTargets: BrowserTarget[] = [];
  while (Date.now() < deadline) {
    latestTargets = (await fetchJson(url)) as BrowserTarget[];
    const panelTarget = latestTargets.find(
      (target) =>
        target.type === "iframe" &&
        target.url?.startsWith("chrome-extension://") &&
        target.url.endsWith("/extension/panel/index.html") &&
        typeof target.webSocketDebuggerUrl === "string"
    );
    if (panelTarget) {
      return panelTarget;
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for the selected Workbench panel target. Observed: ${JSON.stringify(
      latestTargets.map(({ type, url }) => ({ type, url }))
    )}`
  );
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill();
  if (await waitForExit(child, 2_000)) {
    return;
  }
  child.kill("SIGKILL");
  await waitForExit(child, 2_000);
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true;
  }
  return new Promise((resolvePromise) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolvePromise(true);
    };
    const timeout = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolvePromise(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

await runBrowserProof();
