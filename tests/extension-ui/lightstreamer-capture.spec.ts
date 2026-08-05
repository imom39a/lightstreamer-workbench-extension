import { expect, test } from "@playwright/test";
import { constants } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";

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
} from "../support/chrome-extension-cdp";
import {
  formatTargets,
  type BrowserTarget,
  waitForWorkbenchPanel
} from "../support/devtools-panel";

const rootDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const extensionDir = resolve(rootDir, process.env.LSEW_EXTENSION_DIR ?? "dist");
const fixtureUrl = new URL(
  "/mutate-reinject.html?capture=listener",
  process.env.LSEW_FIXTURE_URL ?? "http://localhost:8080/"
).href;

test("official-client COMMAND Local Injection is edited, delivered, and projected", async () => {
  const profileDir = await mkdtemp(join(tmpdir(), "lsew-playwright-extension-"));
  const chromeExecutable = await resolveChromeExecutable(rootDir);
  const chromeLogs: string[] = [];
  let latestTargets: BrowserTarget[] = [];
  let chrome: ChildProcess | null = null;
  let pageCdp: CdpClient | null = null;
  let devtoolsCdp: CdpClient | null = null;
  let panelCdp: CdpClient | null = null;
  const panelScriptUrls: string[] = [];

  try {
    await access(extensionDir, constants.R_OK);
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
      "--window-size=1280,900",
      "about:blank"
    ];
    if (process.env.LSEW_BROWSER_HEADLESS !== "false") {
      chromeArguments.unshift("--headless=new");
    }
    chrome = spawn(chromeExecutable, chromeArguments, {
      cwd: rootDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    chrome.stdout?.on("data", (chunk: Buffer) => chromeLogs.push(String(chunk)));
    chrome.stderr?.on("data", (chunk: Buffer) => chromeLogs.push(String(chunk)));

    const debugging = await waitForDebuggingPort(profileDir, chrome);
    latestTargets = await waitForBrowserTargets(debugging.port);
    const inspectedTarget = latestTargets.find(
      (target) =>
        target.type === "page" &&
        !target.url?.startsWith("devtools://") &&
        typeof target.webSocketDebuggerUrl === "string"
    );
    expect(inspectedTarget?.webSocketDebuggerUrl).toBeTruthy();
    pageCdp = await CdpClient.connect(inspectedTarget?.webSocketDebuggerUrl ?? "");
    await pageCdp.request("Page.enable");
    await pageCdp.request("Runtime.enable");
    await pageCdp.request("Page.navigate", { url: fixtureUrl });
    await waitForCondition(
      pageCdp,
      `
        document.querySelector("#connection-state")?.textContent === "SUBSCRIBED" &&
        Number(document.querySelector("#update-count")?.textContent) === 1 &&
        document.querySelector("#message-text")?.textContent === "Attention - real Lightstreamer client."
      `,
      "the official client fixture to receive its deterministic COMMAND snapshot"
    );

    const panelSelection = await waitForWorkbenchPanel({
      listTargets: () => listBrowserTargets(debugging.port),
      connect: CdpClient.connect,
      evaluateByValue
    });
    latestTargets = panelSelection.targets;
    devtoolsCdp = panelSelection.cdp;
    expect(panelSelection.selection.panelId).toBeTruthy();
    expect(panelSelection.selection.selectedTabId).toBe(panelSelection.selection.panelId);

    const panelTarget = await waitForExtensionPanelTarget(debugging.port);
    latestTargets = await listBrowserTargets(debugging.port);
    panelCdp = await CdpClient.connect(panelTarget.webSocketDebuggerUrl ?? "");
    panelCdp.on("Debugger.scriptParsed", (params) => {
      const url = (params as { url?: unknown } | undefined)?.url;
      if (typeof url === "string" && url) panelScriptUrls.push(url);
    });
    await panelCdp.request("Debugger.enable");
    await panelCdp.request("Runtime.enable");
    await installBrowserErrorCapture(panelCdp);

      await waitForCondition(
        panelCdp,
        `
document.querySelector(".workbench-react__operating strong")?.textContent === "Capture RUNNING" &&
          [...document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]')]
            .some((row) => row.textContent?.includes("scenario.mutate-reinject"))
        `,
        "React Evidence to display the official-client COMMAND update"
      );
      await evaluateByValue(panelCdp, `(() => {
        const row = [...document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]')]
          .find((candidate) => candidate.textContent?.includes("scenario.mutate-reinject"));
        if (!(row instanceof HTMLButtonElement)) throw new Error("React Evidence row is missing");
        row.click();
      })()`);
      await waitForCondition(
        panelCdp,
        `document.querySelector('[aria-label="Context"]')?.textContent?.includes("scenario.mutate-reinject")`,
        "React Context to follow the selected official-client Evidence"
      );
      const reactProof = await evaluateByValue<{
        scope: string;
        evidence: string;
        context: string;
        observed: string;
      }>(panelCdp, `({
        scope: document.querySelector('[aria-label="Structural runtime scope"]')?.textContent ?? "",
        evidence: document.querySelector('[aria-label="Ordered Lightstreamer Evidence"]')?.textContent ?? "",
        context: document.querySelector('[aria-label="Context"]')?.textContent ?? "",
        observed: document.querySelector('[aria-label="Observed Server COMMAND State"]')?.textContent ?? ""
      })`);
      expect(reactProof.scope).toContain("scenario.mutate-reinject");
      expect(reactProof.evidence).toContain("SERVER");
      expect(reactProof.evidence).toContain("ADD");
      expect(reactProof.context).toContain("fixture-message.TICKER");
      expect(reactProof.observed).toContain("fixture-message.TICKER");

      const editedMessage = "Edited by Workbench Local Injection.";
      const localInjectionDocument = {
        command: "UPDATE",
        key: "fixture-message.TICKER",
        isSnapshot: false,
        fields: {
          key: "fixture-message.TICKER",
          command: "UPDATE",
          modelId: "MESSENGER",
          modelValues: JSON.stringify({
            messageId: "fixture-1",
            messageText: editedMessage,
            messageType: "TICKER"
          })
        }
      };
      await waitForCondition(
        panelCdp,
        `
          [...document.querySelectorAll("button")].some(
            (button) => button.textContent?.trim() === "Create Local Injection Draft" && !button.disabled
          )
        `,
        "the selected captured update to offer one Local Injection Draft"
      );
      expect(
        await evaluateByValue<boolean>(panelCdp, `Boolean(document.querySelector(".cm-editor"))`)
      ).toBe(false);
      expect(
        panelScriptUrls.some((url) => url.endsWith("/assets/local-injection-document.js"))
      ).toBe(false);
      await clickPanelButton(panelCdp, "Create Local Injection Draft");
      await waitForCondition(
        panelCdp,
        `
          document.querySelector('[aria-label="Local Injection Draft"]') &&
          document.querySelector('[aria-label="Local Injection JSON"][contenteditable="true"]')
        `,
        "the raw Local Injection JSON editor to open"
      );
      expect(
        await evaluateByValue<boolean>(panelCdp, `Boolean(document.querySelector(".cm-editor"))`)
      ).toBe(true);
      await expect
        .poll(
          () =>
            panelScriptUrls.some((url) =>
              url.endsWith("/assets/local-injection-document.js")
            ),
          { message: "the lazy Local Injection module to be parsed by Chrome", timeout: 15_000 }
        )
        .toBe(true);
      await replaceLocalInjectionJson(
        panelCdp,
        JSON.stringify(localInjectionDocument, null, 2)
      );
      await waitForCondition(
        panelCdp,
        `
          [...document.querySelectorAll("button")].some(
            (button) => button.textContent?.trim() === "Review Local Injection" && !button.disabled
          )
        `,
        "the edited Local Injection document to pass preflight"
      );
      await clickPanelButton(panelCdp, "Review Local Injection");
      await waitForCondition(
        panelCdp,
        `
          [...document.querySelectorAll("button")].some(
            (button) => button.textContent?.trim() === "Inject locally" && !button.disabled
          ) &&
          [...document.querySelectorAll("button")].some(
            (button) => button.textContent?.trim() === "Compare Source"
          )
        `,
        "the reviewed Local Injection and its optional source comparison"
      );
      await clickPanelButton(panelCdp, "Inject locally");
      await waitForCondition(
        pageCdp,
        `
          Number(document.querySelector("#update-count")?.textContent) === 2 &&
          document.querySelector("#message-text")?.textContent === ${JSON.stringify(editedMessage)}
        `,
        "the official application listener to receive the edited Local Injected Update"
      );
      await waitForCondition(
        panelCdp,
        `document.querySelector('[aria-label="Local Injection Draft"]')?.textContent?.includes("DELIVERED LOCALLY")`,
        "the Local Injection document to retain its delivered outcome"
      );
      const deliveredOutcome = await evaluateByValue<string>(
        panelCdp,
        `document.querySelector('[aria-label="Local Injection Draft"]')?.textContent ?? ""`
      );
      expect(deliveredOutcome).toContain("DELIVERED LOCALLY");
      await clickPanelButton(panelCdp, "Finish Local Injection");
      await waitForCondition(
        panelCdp,
        `
          [...document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]')]
            .some((row) => [...row.querySelectorAll('[role="gridcell"]')]
              .some((cell) => cell.textContent?.trim() === "LOCAL")) &&
          document.querySelector('[aria-label="Observed Server COMMAND State"]')?.textContent
            ?.includes("Attention - real Lightstreamer client.") &&
          document.querySelector('[aria-label="Local Effective COMMAND State"]')?.textContent
            ?.includes(${JSON.stringify(editedMessage)})
        `,
        "React Evidence and named COMMAND projections to reflect the delivered Local Injection"
      );
      const localProof = await evaluateByValue<{
        localEvidence: string;
        observed: string;
        localEffective: string;
      }>(panelCdp, `({
        localEvidence: [...document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]')]
          .find((row) => [...row.querySelectorAll('[role="gridcell"]')]
            .some((cell) => cell.textContent?.trim() === "LOCAL"))?.textContent ?? "",
        observed: document.querySelector('[aria-label="Observed Server COMMAND State"]')?.textContent ?? "",
        localEffective: document.querySelector('[aria-label="Local Effective COMMAND State"]')?.textContent ?? ""
      })`);
      expect(localProof.localEvidence).toContain("LOCAL");
      expect(localProof.localEvidence).toContain("UPDATE");
      expect(localProof.observed).toContain("Attention - real Lightstreamer client.");
      expect(localProof.observed).not.toContain(editedMessage);
      expect(localProof.localEffective).toContain(editedMessage);

      await evaluateByValue(panelCdp, `(() => {
        const item = [...document.querySelectorAll('[aria-label="Structural runtime scope"] [role="treeitem"]')]
          .find((candidate) => candidate.querySelector("span")?.textContent?.includes("scenario.mutate-reinject"));
        if (!(item instanceof HTMLButtonElement)) throw new Error("Fixture COMMAND Item Scope is missing");
        item.click();
      })()`);
      await waitForCondition(
        panelCdp,
        `[...document.querySelectorAll("button")].some(
          (button) => button.textContent?.trim() === "Author COMMAND Item Update" && !button.disabled
        )`,
        "the live COMMAND Item Scope to offer authored Local Injection"
      );
      await clickPanelButton(panelCdp, "Author COMMAND Item Update");
      await waitForCondition(
        panelCdp,
        `document.querySelector('[aria-label="Local Injection JSON"][contenteditable="true"]')`,
        "the authored Local Injection JSON editor to open"
      );
      const authoredMessage = "Authored by Workbench Local Injection.";
      const authoredDocument = {
        command: "ADD",
        key: "fixture-authored.TICKER",
        isSnapshot: false,
        fields: {
          key: "fixture-authored.TICKER",
          command: "ADD",
          modelId: "MESSENGER",
          modelValues: JSON.stringify({
            messageId: "fixture-authored",
            messageText: authoredMessage,
            messageType: "TICKER"
          })
        }
      };
      await replaceLocalInjectionJson(panelCdp, JSON.stringify(authoredDocument, null, 2));
      await waitForCondition(
        panelCdp,
        `[...document.querySelectorAll("button")].some(
          (button) => button.textContent?.trim() === "Review Local Injection" && !button.disabled
        )`,
        "the authored document to pass preflight"
      );
      await clickPanelButton(panelCdp, "Review Local Injection");
      await waitForCondition(
        panelCdp,
        `[...document.querySelectorAll("button")].some(
          (button) => button.textContent?.trim() === "Inject locally" && !button.disabled
        )`,
        "the authored Local Injection review to become executable"
      );
      await clickPanelButton(panelCdp, "Inject locally");
      await waitForCondition(
        pageCdp,
        `Number(document.querySelector("#update-count")?.textContent) === 3 &&
          document.querySelector("#message-text")?.textContent === ${JSON.stringify(authoredMessage)}`,
        "the official application listener to receive the authored Local Injected Update"
      );
      await waitForCondition(
        panelCdp,
        `document.querySelector('[aria-label="Local Injection Draft"]')?.textContent?.includes("DELIVERED LOCALLY")`,
        "the authored Local Injection to retain its delivered outcome"
      );
      await clickPanelButton(panelCdp, "Finish Local Injection");
      await waitForCondition(
        panelCdp,
        `(() => {
          const localRows = [...document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]')]
            .filter((row) => [...row.querySelectorAll('[role="gridcell"]')]
              .some((cell) => cell.textContent?.trim() === "LOCAL"));
          return localRows.length === 2 &&
            document.querySelector('[aria-label="Observed Server COMMAND State"]')?.textContent
              ?.includes("Attention - real Lightstreamer client.") &&
            !document.querySelector('[aria-label="Observed Server COMMAND State"]')?.textContent
              ?.includes(${JSON.stringify(authoredMessage)}) &&
            document.querySelector('[aria-label="Local Effective COMMAND State"]')?.textContent
              ?.includes(${JSON.stringify(authoredMessage)});
        })()`,
        "the authored Local Evidence and divergent COMMAND projections"
      );
      expect(await readBrowserErrors(panelCdp)).toEqual([]);
  } catch (error) {
    const logTail = chromeLogs.join("").slice(-4_000);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nObserved targets: ${formatTargets(
        latestTargets
      )}${logTail ? `\nChrome log tail:\n${logTail}` : ""}`
    );
  } finally {
    panelCdp?.close();
    devtoolsCdp?.close();
    pageCdp?.close();
    if (chrome) await terminateChild(chrome);
    await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  }
);

async function clickPanelButton(cdp: CdpClient, label: string): Promise<void> {
  await evaluateByValue(
    cdp,
    `(() => {
      const button = [...document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)}
      );
      if (!(button instanceof HTMLButtonElement)) throw new Error("Missing ${label} button");
      if (button.disabled) throw new Error("${label} button is disabled");
      button.click();
    })()`
  );
}
async function replaceLocalInjectionJson(cdp: CdpClient, text: string): Promise<void> {
  await evaluateByValue(
    cdp,
    `(() => {
      const editor = document.querySelector('[aria-label="Local Injection JSON"][contenteditable="true"]');
      if (!(editor instanceof HTMLElement)) throw new Error("Local Injection JSON editor is missing");
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection?.removeAllRanges();
      selection?.addRange(range);
    })()`
  );
  await cdp.request("Input.insertText", { text });
}

async function installBrowserErrorCapture(cdp: CdpClient): Promise<void> {
  await evaluateByValue(
    cdp,
    `(() => {
      const errors = [];
      Object.defineProperty(window, "__LSEW_BROWSER_ERRORS__", {
        configurable: true,
        value: errors
      });
      const record = (kind, value) => {
        const text = value instanceof Error ? value.stack ?? value.message : String(value ?? "");
        errors.push(kind + ": " + text);
      };
      window.addEventListener("error", (event) => record("error", event.error ?? event.message));
      window.addEventListener("unhandledrejection", (event) =>
        record("unhandledrejection", event.reason)
      );
      window.addEventListener("securitypolicyviolation", (event) =>
        record(
          "securitypolicyviolation",
          event.violatedDirective + " " + event.blockedURI
        )
      );
      const originalError = console.error.bind(console);
      console.error = (...args) => {
        record("console.error", args.map((argument) => String(argument)).join(" "));
        originalError(...args);
      };
    })()`
  );
}

async function readBrowserErrors(cdp: CdpClient): Promise<string[]> {
  return evaluateByValue<string[]>(
    cdp,
    `Array.isArray(window.__LSEW_BROWSER_ERRORS__)
      ? [...window.__LSEW_BROWSER_ERRORS__]
      : ["browser error capture missing"]`
  );
}
