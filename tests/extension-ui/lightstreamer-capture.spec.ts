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
const authoredFixtureUrl = new URL(
  "/mutate-reinject.html?capture=listener",
  process.env.LSEW_FIXTURE_URL ?? "http://localhost:8080/"
).href;
const highVolumeFixtureUrl = new URL(
  "/?scenario=loading-evidence",
  process.env.LSEW_FIXTURE_URL ?? "http://localhost:8080/"
).href;

async function runOfficialClientPanelJourney(
  windowSize: string,
  viewport: Readonly<{ width: number; height: number }>,
  scenario: "authored" | "high-volume-loading" = "authored"
): Promise<void> {
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
      `--window-size=${windowSize}`,
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
    await pageCdp.request("Page.navigate", {
      url: scenario === "high-volume-loading" ? highVolumeFixtureUrl : authoredFixtureUrl
    });
    if (scenario === "high-volume-loading") {
      await waitForCondition(
        pageCdp,
        `window.LSEW_CONTINUOUS_EVIDENCE_TARGET === 20001 &&
          document.querySelectorAll("#fixture-events li").length >= 100`,
        "the official client fixture to begin continuous high-volume COMMAND Capture"
      );
    } else {
      await waitForCondition(
        pageCdp,
        `
          document.querySelector("#connection-state")?.textContent === "SUBSCRIBED" &&
          Number(document.querySelector("#update-count")?.textContent) === 1 &&
          document.querySelector("#message-text")?.textContent === "Attention - real Lightstreamer client."
        `,
        "the official client fixture to receive its deterministic COMMAND snapshot"
      );
    }

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
    await setPanelViewport(
      devtoolsCdp,
      panelCdp,
      viewport,
      `${viewport.width}×${viewport.height}`
    );

    if (scenario === "high-volume-loading") {
      await waitForCondition(
        panelCdp,
        `document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]').length > 0 &&
          document.querySelectorAll('[aria-label="Structural runtime scope"] [role="treeitem"]').length >= 4`,
        "the shipped panel to expose high-volume Evidence and Scope"
      );
      await clickVisiblePanelElement(
        panelCdp,
        `document.querySelector('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]')`,
        "one high-volume Evidence row"
      );
      for (const level of [2, 3, 4]) {
        await clickVisiblePanelElement(
          panelCdp,
          `document.querySelector('[aria-label="Structural runtime scope"] [role="treeitem"][aria-level="${level}"]')`,
          `high-volume Scope level ${level}`
        );
      }
      try {
        await waitForCondition(
          panelCdp,
          `!document.querySelector('[aria-label="Ordered Evidence"]')?.textContent?.includes("Loading Evidence") &&
            document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]').length > 0`,
          "the shipped panel to recover Evidence after repeated Scope choices"
        );
      } catch (error) {
        const panelState = await evaluateByValue<unknown>(panelCdp, `({
          evidence: document.querySelector('[aria-label="Ordered Evidence"]')?.textContent ?? "",
          scope: document.querySelector('[aria-label="Current runtime scope"]')?.textContent ?? "",
          rowCount: document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]').length,
          context: document.querySelector('[aria-label="Context"]')?.textContent ?? "",
          errors: window.__LSEW_BROWSER_ERRORS__ ?? []
        })`);
        const pageCaptureCount = await evaluateByValue<number>(
          pageCdp,
          `document.querySelectorAll("#fixture-events li").length`
        );
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\n` +
          `Panel state: ${JSON.stringify(panelState)}\n` +
          `Page capture count: ${pageCaptureCount}`
        );
      }
      const pageCaptureCountAfterRecovery = await evaluateByValue<number>(
        pageCdp,
        `document.querySelectorAll("#fixture-events li").length`
      );
      const workbenchDeliveryCountExpression = `(() => {
        const detail = document.querySelector(
          '[aria-label="Structural runtime scope"] [role="treeitem"][aria-level="4"]'
        )?.textContent ?? "";
        return Number(detail.match(/([0-9]+) deliveries/)?.[1] ?? -1);
      })()`;
      const workbenchDeliveriesAfterRecovery = await evaluateByValue<number>(
        panelCdp,
        workbenchDeliveryCountExpression
      );
      expect(workbenchDeliveriesAfterRecovery).toBeGreaterThanOrEqual(0);
      await waitForCondition(
        pageCdp,
        `document.querySelectorAll("#fixture-events li").length > ${pageCaptureCountAfterRecovery + 25}`,
        "the official client fixture to keep receiving updates after Evidence recovers"
      );
      await waitForCondition(
        panelCdp,
        `${workbenchDeliveryCountExpression} > ${workbenchDeliveriesAfterRecovery + 25}`,
        "Workbench Capture to keep ingesting updates after Evidence recovers"
      );
      expect(await readBrowserErrors(panelCdp)).toEqual([]);
      return;
    }

      await waitForCondition(
        panelCdp,
        `
document.querySelector(".workbench-react__operating strong")?.textContent === "Capture RUNNING" &&
          [...document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]')]
            .some((row) => row.textContent?.includes("scenario.mutate-reinject"))
        `,
        "React Evidence to display the official-client COMMAND update"
      );
      await clickVisiblePanelElement(
        panelCdp,
        `[...document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]')]
          .find((candidate) => candidate.textContent?.includes("scenario.mutate-reinject"))`,
        "the rendered official-client Evidence row"
      );
      await waitForCondition(
        panelCdp,
        `document.querySelector('[aria-label="Context"]')?.textContent?.includes("scenario.mutate-reinject")`,
        "React Context to follow the selected official-client Evidence"
      );
      const reactProof = await evaluateByValue<{
        scope: string;
        evidence: string;
        context: string;
        projectionSummaryPresent: boolean;
        projectionButtonPresent: boolean;
      }>(panelCdp, `({
        scope: document.querySelector('[aria-label="Structural runtime scope"]')?.textContent ?? "",
        evidence: document.querySelector('[aria-label="Ordered Lightstreamer Evidence"]')?.textContent ?? "",
        context: document.querySelector('[aria-label="Context"]')?.textContent ?? "",
        projectionSummaryPresent: Boolean(document.querySelector('[aria-label="COMMAND projection summary"]')),
        projectionButtonPresent: [...document.querySelectorAll("button")].some(
          (button) => button.textContent?.includes("COMMAND projections")
        )
      })`);
      expect(reactProof.scope).toContain("scenario.mutate-reinject");
      expect(reactProof.evidence).toContain("SERVER");
      expect(reactProof.evidence).toContain("ADD");
      expect(reactProof.context).toContain("fixture-message.TICKER");
      expect(reactProof.projectionSummaryPresent).toBe(false);
      expect(reactProof.projectionButtonPresent).toBe(false);

      const editedMessage = "Edited by Workbench Local Injection.";
      const localInjectionDocument = {
        command: "UPDATE",
        key: "fixture-message.TICKER",
        isSnapshot: false,
        fields: {
          key: "fixture-message.TICKER",
          command: "UPDATE",
          modelId: "MESSENGER",
          modelValues: {
            messageId: "fixture-1",
            messageText: editedMessage,
            messageType: "TICKER"
          }
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
      if (!await isPanelElementVisible(panelCdp, `[...document.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "Create Local Injection Draft" && !button.disabled)`)) {
        await clickPanelButton(panelCdp, "Open selected Context");
        await waitForCondition(
          panelCdp,
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
      expect(
        await evaluateByValue<boolean>(panelCdp, `Boolean(document.querySelector(".cm-editor"))`)
      ).toBe(false);
      expect(
        panelScriptUrls.some((url) => url.endsWith("/assets/local-injection-document.js"))
      ).toBe(false);
      await pressVisiblePanelButton(panelCdp, "Create Local Injection Draft");
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
      await waitForCondition(
        panelCdp,
        `(() => {
          const text = document.querySelector('[aria-label="Local Injection JSON"]')?.textContent ?? "";
          return text.includes('"modelValues": {') &&
            text.includes('"messageId": "fixture-1"') &&
            !text.includes('\\\\"messageId\\\\"');
        })()`,
        "the captured JSON-string field to expand as structured editor JSON"
      );
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
          !document.querySelector('[aria-label="COMMAND projection summary"]') &&
          ![...document.querySelectorAll("button")].some(
            (button) => button.textContent?.includes("COMMAND projections")
          )
        `,
        "React Evidence to reflect the delivered Local Injection without a projection summary in Selected Evidence"
      );
      const localEvidenceProof = await evaluateByValue<string>(
        panelCdp,
        `[...document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]')]
          .find((row) => [...row.querySelectorAll('[role="gridcell"]')]
            .some((cell) => cell.textContent?.trim() === "LOCAL"))?.textContent ?? ""`
      );
      expect(localEvidenceProof).toContain("LOCAL");
      expect(localEvidenceProof).toContain("UPDATE");
      if (viewport.width > 700) {
        await clearPanelEvidenceSelection(panelCdp);
        await waitForCondition(
          panelCdp,
          `document.querySelector('[aria-label="COMMAND projection summary"]')?.textContent
            ?.includes("Projections differ")`,
          "runtime-object Context to expose the divergent COMMAND summary"
        );
        await pressVisiblePanelButton(panelCdp, "Compare COMMAND projections");
        await waitForCondition(
          panelCdp,
          `document.querySelector('[aria-label="Observed Server COMMAND State"]')?.textContent
              ?.includes("Attention - real Lightstreamer client.") &&
            document.querySelector('[aria-label="Local Effective COMMAND State"]')?.textContent
              ?.includes(${JSON.stringify(editedMessage)})`,
          "the promoted comparison to expose the divergent COMMAND rows"
        );
        const projectionProof = await evaluateByValue<{
          observed: string;
          localEffective: string;
        }>(panelCdp, `({
          observed: document.querySelector('[aria-label="Observed Server COMMAND State"]')?.textContent ?? "",
          localEffective: document.querySelector('[aria-label="Local Effective COMMAND State"]')?.textContent ?? ""
        })`);
        expect(projectionProof.observed).toContain("Attention - real Lightstreamer client.");
        expect(projectionProof.observed).not.toContain(editedMessage);
        expect(projectionProof.localEffective).toContain(editedMessage);
        await clickPanelButton(panelCdp, "Back to Evidence");
      }

      if (!await isPanelElementVisible(panelCdp, `[...document.querySelectorAll('[aria-label="Structural runtime scope"] [role="treeitem"]')]
        .find((candidate) => candidate.querySelector("span")?.textContent?.includes("scenario.mutate-reinject"))`)) {
        await clickPanelButton(panelCdp, "Scope");
      }
      await clickVisiblePanelElement(
        panelCdp,
        `[...document.querySelectorAll('[aria-label="Structural runtime scope"] [role="treeitem"]')]
          .find((candidate) => candidate.querySelector("span")?.textContent?.includes("scenario.mutate-reinject"))`,
        "the rendered fixture COMMAND Item Scope"
      );

      await waitForCondition(
        panelCdp,
        `[...document.querySelectorAll("button")].some(
          (button) => button.textContent?.trim() === "Author COMMAND Item Update" && !button.disabled
        )`,
        "the live COMMAND Item Scope to offer authored Local Injection"
      );
      await pressVisiblePanelButton(panelCdp, "Author COMMAND Item Update");
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
          return localRows.length === 2;
        })()`,
        "the authored Local Evidence"
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

test("official-client authored COMMAND Local Injection works through visible normal DevTools controls", async () => {
  await runOfficialClientPanelJourney("2664,727", { width: 900, height: 700 });
});

test("official-client authored COMMAND Local Injection works through visible compact DevTools controls", async () => {
  await runOfficialClientPanelJourney("1653,727", { width: 563, height: 700 });
});

test("high-volume Capture does not leave shipped Evidence loading after repeated Scope choices", async () => {
  await runOfficialClientPanelJourney(
    "2664,927",
    { width: 1440, height: 900 },
    "high-volume-loading"
  );
});

async function clickPanelButton(cdp: CdpClient, label: string): Promise<void> {
  await clickVisiblePanelElement(
    cdp,
    `[...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)} && !candidate.disabled
    )`,
    `${label} button`
  );
}

async function pressVisiblePanelButton(cdp: CdpClient, label: string): Promise<void> {
  await evaluateByValue<void>(cdp, `(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)} && !candidate.disabled
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error("Missing ${label} button");
    button.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    if (!rect.width || !rect.height || style.visibility === "hidden" || style.display === "none") {
      throw new Error("${label} button is not visibly keyboard reachable");
    }
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (!button.contains(document.elementFromPoint(x, y))) {
      throw new Error("${label} button is obscured at its keyboard target");
    }
    button.focus();
    if (document.activeElement !== button) throw new Error("${label} button did not receive keyboard focus");
  })()`);
  await cdp.request("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    text: "\r",
    unmodifiedText: "\r",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13
  });
  await cdp.request("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
}

async function clearPanelEvidenceSelection(cdp: CdpClient): Promise<void> {
  const contextBack = `document.querySelector('[aria-label="Context"] .workbench-react__compact-back')`;
  if (await isPanelElementVisible(cdp, contextBack)) {
    await clickVisiblePanelElement(cdp, contextBack, "Context Back to Evidence button");
  }
  await clickPanelButton(cdp, "Filter");
  await clickVisiblePanelElement(
    cdp,
    `document.querySelector("#workbench-filter-query")`,
    "Filter Evidence input"
  );
  await cdp.request("Input.insertText", { text: "no-evidence-matches-this-query" });
  await clickPanelButton(cdp, "Apply Filter");
  await waitForCondition(
    cdp,
    `[...document.querySelectorAll("button")].some(
      (candidate) => candidate.textContent?.trim() === "Clear selection" && !candidate.disabled
    )`,
    "the filtered Evidence to offer clearing its hidden selection"
  );
  await clickPanelButton(cdp, "Clear selection");
  await clickPanelButton(cdp, "Clear filters");
}

async function setPanelViewport(
  devtoolsCdp: CdpClient,
  panelCdp: CdpClient,
  viewport: Readonly<{ width: number; height: number }>,
  label: string
): Promise<void> {
  const devtoolsViewport = await evaluateByValue<{ width: number; height: number }>(
    devtoolsCdp,
    `({ width: window.innerWidth, height: window.innerHeight })`
  );
  const devtoolsChromeHeight = 27;
  const devtoolsHeight = viewport.height + devtoolsChromeHeight;
  await devtoolsCdp.request("Emulation.setDeviceMetricsOverride", {
    width: devtoolsViewport.width,
    height: devtoolsHeight,
    deviceScaleFactor: 1,
    mobile: false
  });
  await evaluateByValue<void>(devtoolsCdp, `(async () => {
    const UI = await import("devtools://devtools/bundled/ui/legacy/legacy.js");
    const split = UI.InspectorView.InspectorView.instance().ownerSplit();
    if (!split) throw new Error("DevTools Inspector split is unavailable.");
    // The split owns a one-pixel divider outside the panel iframe.
    split.setSidebarSize(${viewport.width + 1});
  })()`);
  try {
    await waitForCondition(
      panelCdp,
      `(() => {
        const panel = document.querySelector(".workbench-react");
        if (!(panel instanceof HTMLElement)) return false;
        const rect = panel.getBoundingClientRect();
        return window.innerWidth === ${viewport.width} &&
          window.innerHeight === ${viewport.height} &&
          rect.width === ${viewport.width} &&
          rect.height === ${viewport.height} &&
          document.documentElement.scrollWidth <= document.documentElement.clientWidth;
      })()`,
      `the ${label} DevTools panel viewport to fit the shipped Workbench root`
    );
  } catch (error) {
    const actual = await evaluateByValue<unknown>(panelCdp, `(() => {
      const rect = document.querySelector(".workbench-react")?.getBoundingClientRect();
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        panelWidth: rect?.width ?? 0,
        panelHeight: rect?.height ?? 0,
        documentWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth
      };
    })()`);
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nPanel viewport: ${JSON.stringify(actual)}`);
  }
}

async function clickVisiblePanelElement(
  cdp: CdpClient,
  targetExpression: string,
  description: string
): Promise<void> {
  const point = await evaluateByValue<{ x: number; y: number }>(
    cdp,
    `(() => {
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
    })()`
  );
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

async function replaceLocalInjectionJson(cdp: CdpClient, text: string): Promise<void> {
  await clickVisiblePanelElement(
    cdp,
    `document.querySelector('[aria-label="Local Injection JSON"][contenteditable="true"]')`,
    "Local Injection JSON editor"
  );
  await selectAllInFocusedEditor(cdp);
  await cdp.request("Input.insertText", { text });
  await waitForCondition(
    cdp,
    `(() => {
      const editor = document.querySelector('[aria-label="Local Injection JSON"][contenteditable="true"]');
      return editor instanceof HTMLElement &&
        [...editor.querySelectorAll(".cm-line")].map((line) => line.textContent ?? "").join("\\n") === ${JSON.stringify(text)};
    })()`,
    "the visible Local Injection JSON editor to replace its complete document"
  );
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
