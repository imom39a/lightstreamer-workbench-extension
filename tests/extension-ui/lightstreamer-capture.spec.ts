import { expect, test } from "@playwright/test";
import { constants } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { chromeTestArguments } from "../../scripts/chrome-test-policy.mjs";

import {
  CdpClient,
  evaluateByValue,
  listBrowserTargets,
  readExtensionManifest,
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
const issue16FixtureUrl = new URL(
  "/?scenario=issue-16",
  process.env.LSEW_FIXTURE_URL ?? "http://localhost:8080/"
).href;
type OfficialClientScenario =
  | "authored"
  | "scenario"
  | "diagnostics"
  | "high-volume-loading"
  | "issue-16"
  | "issue-16-scope";

async function runOfficialClientPanelJourney(
  windowSize: string,
  viewport: Readonly<{ width: number; height: number }>,
  scenario: OfficialClientScenario = "authored"
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
    const extensionManifest = await readExtensionManifest(extensionDir);
    const chromeArguments = [
      ...chromeTestArguments({
        profile: profileDir,
        headless: true,
        disableNativeOcclusion: true,
        additional: [
          "--auto-open-devtools-for-tabs",
          "--remote-debugging-port=0",
          `--disable-extensions-except=${extensionDir}`,
          `--load-extension=${extensionDir}`,
          `--window-size=${windowSize}`
        ]
      }),
      "about:blank"
    ];
    chrome = spawn(chromeExecutable, chromeArguments, {
      cwd: rootDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    chrome.stdout?.on("data", (chunk: Buffer) => chromeLogs.push(String(chunk)));
    chrome.stderr?.on("data", (chunk: Buffer) => chromeLogs.push(String(chunk)));

    const debugging = await waitForDebuggingPort(profileDir, chrome);
    latestTargets = await waitForBrowserTargets(debugging.port, {
      workbenchManifest: extensionManifest
    });
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
      url: scenario === "high-volume-loading"
        ? highVolumeFixtureUrl
        : scenario === "issue-16" || scenario === "issue-16-scope"
          ? issue16FixtureUrl
          : authoredFixtureUrl
    });
    if (scenario === "issue-16-scope") {
      await waitForCondition(
        pageCdp,
        `window.LSEW_ISSUE_16_TOTAL_EVENTS === 1692 &&
          document.querySelectorAll("#fixture-events li").length >= 1_000`,
        "the official issue-16 fixture to expose its multi-Subscription burst"
      );
    } else if (scenario === "high-volume-loading") {
      await waitForCondition(
        pageCdp,
        `window.LSEW_CONTINUOUS_EVIDENCE_TARGET === 20001 &&
          document.querySelectorAll("#fixture-events li").length >= 100`,
        "the official client fixture to begin continuous high-volume COMMAND Capture"
      );
    } else if (scenario === "issue-16") {
      await waitForCondition(
        pageCdp,
        `window.LSEW_FIXTURE?.subscriptions?.length === 15 &&
          window.LSEW_ISSUE_16_GROUPS?.length === 17 &&
          window.LSEW_ISSUE_16_TOTAL_EVENTS === 1692 &&
          [...document.querySelectorAll("#fixture-events li")]
            .filter((row) => !row.textContent?.startsWith("end-of-snapshot")).length === 1692`,
        "the exact issue-16 fixture to deliver 1,692 updates across 15 subscriptions and 17 groups"
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
      connect: (target) => CdpClient.connect(target.webSocketDebuggerUrl ?? ""),
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

    if (scenario === "diagnostics") {
      await pageCdp.request("Runtime.evaluate", {
        expression: `(() => {
          window.LSEW_DIAGNOSTIC_CALLBACKS = [];
          const keepaliveClient = new window.LightstreamerClient(window.location.origin, "LSEW_FIXTURE");
          keepaliveClient.connectionOptions.setForcedTransport("WS-STREAMING");
          keepaliveClient.connectionOptions.setKeepaliveInterval(1000);
          keepaliveClient.addListener({
            onServerKeepalive() { window.LSEW_DIAGNOSTIC_CALLBACKS.push("keepalive"); }
          });
          keepaliveClient.connect();
          const errorClient = new window.LightstreamerClient(window.location.origin, "LSEW_DIAGNOSTIC_MISSING");
          errorClient.addListener({
            onServerError(code, message) { window.LSEW_DIAGNOSTIC_CALLBACKS.push({ code, message }); }
          });
          errorClient.connect();
          window.LSEW_DIAGNOSTIC_CLIENTS = [keepaliveClient, errorClient];
        })()`,
        returnByValue: true
      });
      await waitForCondition(
        pageCdp,
        `Array.isArray(window.LSEW_DIAGNOSTIC_CALLBACKS) &&
          window.LSEW_DIAGNOSTIC_CALLBACKS.some((entry) => typeof entry === "object") &&
          window.LSEW_DIAGNOSTIC_CALLBACKS.includes("keepalive")`,
        "the official client to report a server error and keepalive callback",
        30_000
      );
    }

    if (scenario === "scenario") {
      await runOfficialClientScenarioJourney(pageCdp, panelCdp);
      expect(await readBrowserErrors(panelCdp)).toEqual([]);
      return;
    }

    if (scenario === "diagnostics") {
      await clickVisiblePanelElement(
        panelCdp,
        `[...document.querySelectorAll('footer button')].find((button) => button.textContent?.startsWith('Notifications ('))`,
        "Notifications"
      );
      await waitForCondition(
        panelCdp,
        `document.querySelector('[aria-label="Notifications"]')?.textContent?.includes("Server error") &&
          document.querySelector('[aria-label="Notifications"]')?.textContent?.includes("Server keepalive observed") &&
          !document.querySelector('[aria-label="Workbench diagnostic entries"]')?.textContent?.includes("Server error")`,
        "Notifications to own the official-client server diagnostics"
      );
      await clickVisiblePanelElement(
        panelCdp,
        `[...document.querySelectorAll('[aria-label="Notifications"] article')]
          .find((entry) => entry.textContent?.includes('Server error'))?.querySelector('button')`,
        "the server error supporting Evidence"
      );
      await waitForCondition(
        panelCdp,
        `!document.querySelector('[aria-label="Notifications"]') &&
          document.querySelector('[aria-label="Context"] [role="heading"]')?.textContent?.includes('Server Error')`,
        "the server error inspection route to open Evidence Context"
      );
      expect(await evaluateByValue(pageCdp, `window.LSEW_DIAGNOSTIC_CALLBACKS`)).toEqual(expect.arrayContaining([
        "keepalive",
        expect.objectContaining({ code: expect.any(Number), message: expect.any(String) })
      ]));
      expect(await readBrowserErrors(panelCdp)).toEqual([]);
      return;
    }

    if (scenario === "issue-16-scope") {
      await waitForCondition(
        panelCdp,
        `document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]').length > 0 &&
          document.querySelectorAll('[aria-label="Structural runtime scope"] [role="treeitem"]').length >= 4 &&
          !document.querySelector('[aria-label="Structural runtime scope"]')?.textContent?.includes("0 clients · 0 subscriptions")`,
        "the shipped panel to expose usable issue-16 Scope alongside retained Evidence"
      );
      const scopeBefore = await evaluateByValue<string>(
        panelCdp,
        `document.querySelector('[aria-label="Current runtime scope"]')?.textContent ?? ""`
      );
      await clickVisiblePanelElement(
        panelCdp,
        `document.querySelector('[aria-label="Structural runtime scope"] [role="treeitem"][aria-level="4"]')`,
        "one issue-16 Item Scope"
      );
      await waitForCondition(
        panelCdp,
        `(() => {
          const current = document.querySelector('[aria-label="Current runtime scope"]')?.textContent ?? "";
          return current !== ${JSON.stringify("Inspected page")} && current !== ${JSON.stringify(scopeBefore)};
        })()`,
        "the issue-16 Item choice to change current Scope"
       );
      expect(await readBrowserErrors(panelCdp)).toEqual([]);
      return;
    }

    if (scenario === "issue-16") {
      await waitForCondition(
        panelCdp,
        `document.querySelector(".workbench-react__operating strong")?.textContent === "Capture RUNNING" &&
          document.querySelector('[aria-label="Structural runtime scope"] [role="treeitem"][aria-level="1"]')
            ?.textContent?.includes("15 subscriptions") &&
          document.querySelector(".workbench-react__evidence-summary")?.textContent
            ?.includes("Matching 1,692") &&
          document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]').length > 0`,
        "the actual issue-16 Evidence and 15-subscription Scope topology"
      );

      const retainedProof = await evaluateByValue<{
        pageScope: string;
        evidenceSummary: string;
        retainedRows: number;
        logicalScopeNodes: number;
      }>(panelCdp, `(() => {
        const rows = [...document.querySelectorAll(
          '[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]'
        )];
        return {
          pageScope: document.querySelector(
            '[aria-label="Structural runtime scope"] [role="treeitem"][aria-level="1"]'
          )?.textContent ?? "",
          evidenceSummary: document.querySelector(".workbench-react__evidence-summary")?.textContent ?? "",
          retainedRows: rows.length,
          logicalScopeNodes: Number(
            document.querySelector('[aria-label^="Runtime Scope tree"]')
              ?.getAttribute("data-logical-node-count") ?? 0
          )
        };
      })()`);
      expect(retainedProof.pageScope).toContain("15 subscriptions");
      expect(retainedProof.evidenceSummary).not.toContain("Shown 0");
      expect(retainedProof.retainedRows).toBeGreaterThan(0);
      expect(retainedProof.logicalScopeNodes).toBeGreaterThan(15);

      const subscription = await focusScopeTreeLabel(panelCdp, "subscription-6");
      expect(subscription).toMatchObject({ level: "4", setSize: "15" });
      expect(subscription.text).toContain("50 real · 50 deliveries");
      await pressScopeTreeItemEnter(panelCdp, subscription.id);
      await waitForCondition(
        panelCdp,
        `[...document.querySelectorAll('[aria-label="Structural runtime scope"] [role="treeitem"]')]
            .find((candidate) => candidate.getAttribute("data-scope-id") === ${JSON.stringify(subscription.id)})
            ?.getAttribute("aria-selected") === "true" &&
          document.querySelector(".workbench-react__evidence-summary")?.textContent?.includes("Matching 50") &&
          [...document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]')]
            .some((row) => row.textContent?.includes("store-nyc-001-invoice")) &&
          [...document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]')]
            .some((row) => row.textContent?.includes("store-nyc-001-expense"))`,
        "the selected issue-16 subscription Scope to retain both expanded item-group positions"
      );

      const invoice = await focusScopeTreeLabel(panelCdp, "Item #1");
      expect(invoice.level).toBe("5");
      expect(invoice.text).toContain("30 updates");
      await pressScopeTreeItemEnter(panelCdp, invoice.id);
      await waitForCondition(
        panelCdp,
        `[...document.querySelectorAll('[aria-label="Structural runtime scope"] [role="treeitem"]')]
            .find((candidate) => candidate.getAttribute("data-scope-id") === ${JSON.stringify(invoice.id)})
            ?.getAttribute("aria-selected") === "true" &&
          document.querySelector(".workbench-react__evidence-summary")?.textContent?.includes("Matching 30") &&
          [...document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]')]
            .some((row) => row.textContent?.includes("store-nyc-001-invoice")) &&
          ![...document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]')]
            .some((row) => row.textContent?.includes("store-nyc-001-expense"))`,
        "the selectable issue-16 invoice group Scope to constrain retained Evidence"
      );
      expect(await readBrowserErrors(panelCdp)).toEqual([]);
      return;
    }

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
      const serverEvidenceProof = await evaluateByValue<string>(
        panelCdp,
        `[...document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]')]
          .find((candidate) => candidate.textContent?.includes("scenario.mutate-reinject"))?.textContent ?? ""`
      );
      expect(serverEvidenceProof).toContain("SERVER");
      expect(serverEvidenceProof).toContain("ADD");
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
        context: string;
        projectionSummaryPresent: boolean;
        projectionButtonPresent: boolean;
      }>(panelCdp, `({
        scope: document.querySelector('[aria-label="Structural runtime scope"]')?.textContent ?? "",
        context: document.querySelector('[aria-label="Context"]')?.textContent ?? "",
        projectionSummaryPresent: Boolean(document.querySelector('[aria-label="COMMAND projection summary"]')),
        projectionButtonPresent: [...document.querySelectorAll("button")].some(
          (button) => button.textContent?.includes("COMMAND projections")
        )
      })`);
      expect(reactProof.scope).toContain("scenario.mutate-reinject");
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
    const panelState = panelCdp
      ? await evaluateByValue(panelCdp, `({
          diagnostics: document.querySelector('[aria-label="Workbench diagnostic entries"]')?.textContent ?? null,
          evidence: document.querySelector('[aria-label="Ordered Lightstreamer Evidence"]')?.textContent ?? null,
          body: document.body?.textContent?.slice(-4000) ?? null
        })`).catch(() => null)
      : null;
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nObserved targets: ${formatTargets(
        latestTargets
      )}${panelState ? `\nPanel state:\n${JSON.stringify(panelState)}` : ""}${logTail ? `\nChrome log tail:\n${logTail}` : ""}`
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

async function runOfficialClientScenarioJourney(
  pageCdp: CdpClient,
  panelCdp: CdpClient
): Promise<void> {
  const scenarioKey = "fixture-scenario.TICKER";
  await waitForCondition(
    pageCdp,
    `globalThis.__LSEW_REINJECTION_BRIDGE__?.version === 2 &&
      typeof globalThis.__LSEW_REINJECTION_BRIDGE__.reinject === "function"`,
    "the ordinary page reinjection bridge before Scenario authoring"
  );
  await evaluateByValue<boolean>(pageCdp, `(() => {
    const bridge = globalThis.__LSEW_REINJECTION_BRIDGE__;
    const original = bridge.reinject;
    globalThis.__LSEW_SCENARIO_BRIDGE_CALLS__ = [];
    bridge.reinject = function(requestId, panelSessionId, draft) {
      const result = original.call(bridge, requestId, panelSessionId, draft);
      globalThis.__LSEW_SCENARIO_BRIDGE_CALLS__.push({
        requestId,
        panelSessionId,
        draft: structuredClone(draft),
        result: structuredClone(result)
      });
      return result;
    };
    return true;
  })()`);

  await clickVisiblePanelElement(
    panelCdp,
    `[...document.querySelectorAll('[aria-label="Ordered Lightstreamer Evidence"] [data-evidence-id]')]
      .find((candidate) => candidate.textContent?.includes("scenario.mutate-reinject"))`,
    "the deterministic Server ADD used to anchor the Scenario target"
  );
  await waitForCondition(
    panelCdp,
    `[...document.querySelectorAll("button")].some(
      (button) => button.textContent?.trim() === "Create Local Injection Draft" && !button.disabled
    )`,
    "the captured Server ADD to offer a protected Draft"
  );
  if (!await isPanelElementVisible(panelCdp, `[...document.querySelectorAll("button")]
    .find((button) => button.textContent?.trim() === "Create Local Injection Draft" && !button.disabled)`)) {
    await clickPanelButton(panelCdp, "Open selected Context");
  }
  await pressVisiblePanelButton(panelCdp, "Create Local Injection Draft");
  await waitForCondition(
    panelCdp,
    `document.querySelector('[aria-label="Local Injection JSON"][contenteditable="true"]')`,
    "the captured Draft editor"
  );
  await clickPanelButton(panelCdp, "Convert to Scenario");
  await waitForCondition(
    panelCdp,
    `document.querySelector('[aria-label="Local Injection Scenario"]') &&
      document.querySelector('[aria-label="Step 1 Local Injection JSON"][contenteditable="true"]')`,
    "the temporary Scenario document"
  );

  const documents = [
    {
      command: "ADD",
      key: scenarioKey,
      isSnapshot: false,
      fields: {
        key: scenarioKey,
        command: "ADD",
        modelId: "MESSENGER",
        modelValues: {
          messageId: "fixture-scenario",
          messageText: "Scenario ADD",
          messageType: "TICKER"
        }
      }
    },
    {
      command: "UPDATE",
      key: scenarioKey,
      isSnapshot: false,
      fields: {
        key: scenarioKey,
        command: "UPDATE",
        modelId: "MESSENGER",
        modelValues: {
          messageId: "fixture-scenario",
          messageText: "Scenario UPDATE",
          messageType: "TICKER"
        }
      }
    },
    {
      command: "DELETE",
      key: scenarioKey,
      isSnapshot: false,
      fields: {
        key: scenarioKey,
        command: "DELETE",
        modelId: "MESSENGER",
        modelValues: {
          messageId: "fixture-scenario",
          messageText: "Scenario DELETE",
          messageType: "TICKER"
        }
      }
    }
  ] as const;

  await replaceScenarioStepJson(panelCdp, 1, documents[0]);
  for (const [index, document] of documents.slice(1).entries()) {
    await clickPanelButton(panelCdp, "Add authored update");
    await replaceScenarioStepJson(panelCdp, index + 2, document);
  }
  await clickPanelButton(panelCdp, "Review Scenario");
  await waitForCondition(
    panelCdp,
    `[...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Play") ||
      document.querySelector('[aria-label="Local Injection Scenario"] [role="alert"]')`,
    "the immutable reviewed three-Step Run or a truthful Review refusal"
  );
  const reviewProof = await evaluateByValue<{ text: string; playable: boolean }>(panelCdp, `({
    text: document.querySelector('[aria-label="Local Injection Scenario"]')?.textContent ?? "",
    playable: [...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Play")
  })`);
  expect(reviewProof.playable, reviewProof.text).toBe(true);

  await clickPanelButton(panelCdp, "Play");
  await waitForScenarioRun(pageCdp, panelCdp, { expectedBridgeCalls: 3, expectedUpdateCount: 4 });
  const firstRun = await readScenarioProof(pageCdp, panelCdp, scenarioKey);
  expect(firstRun.commands).toEqual(["ADD", "UPDATE", "DELETE"]);
  expect(new Set(firstRun.requestIds).size).toBe(3);
  expect(new Set(firstRun.injectionIds).size, JSON.stringify(firstRun)).toBe(3);
  expect(new Set(firstRun.stepIds).size, JSON.stringify(firstRun)).toBe(3);
  expect(new Set(firstRun.evidenceIds).size, JSON.stringify(firstRun)).toBe(3);
  expect(firstRun.correlations).toHaveLength(3);
  expect(firstRun.correlations.map(({ outcome }) => outcome)).toEqual(["delivered", "delivered", "delivered"]);
  expect(firstRun.correlations.map(({ requestId }) => requestId)).toEqual(firstRun.requestIds);
  expect(firstRun.correlations.map(({ stepId }) => stepId)).toEqual(["step-1", "step-2", "step-3"]);
  expect(new Set(firstRun.executionIds).size, JSON.stringify(firstRun)).toBe(3);
  expect(firstRun.runIds).toHaveLength(1);
  expect(firstRun.scenarioIds).toHaveLength(1);
  expect(firstRun.applicationEvents).toEqual([
    `live | scenario.mutate-reinject | ADD | ${scenarioKey} | Scenario ADD`,
    `live | scenario.mutate-reinject | UPDATE | ${scenarioKey} | Scenario UPDATE`,
    `live | scenario.mutate-reinject | DELETE | ${scenarioKey} | Scenario DELETE`
  ]);

  await clickPanelButton(panelCdp, "Run again");
  await waitForCondition(
    panelCdp,
    `[...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Play") &&
      document.querySelector('[aria-label="Local Injection Scenario"]')?.textContent?.includes("local-injection-run-")`,
    "Run again to create a fresh reviewed Run"
  );
  await clickPanelButton(panelCdp, "Play");
  await waitForScenarioRun(pageCdp, panelCdp, { expectedBridgeCalls: 6, expectedUpdateCount: 7 });
  const allRuns = await readScenarioProof(pageCdp, panelCdp, scenarioKey);
  expect(allRuns.commands).toEqual(["ADD", "UPDATE", "DELETE", "ADD", "UPDATE", "DELETE"]);
  expect(new Set(allRuns.requestIds).size).toBe(6);
  expect(new Set(allRuns.injectionIds).size).toBe(6);
  expect(new Set(allRuns.runIds).size).toBe(2);
  expect(new Set(allRuns.scenarioIds).size).toBe(1);
  expect(allRuns.correlations).toHaveLength(6);
  expect(allRuns.correlations.map(({ outcome }) => outcome)).toEqual(Array(6).fill("delivered"));
  expect(allRuns.correlations.map(({ requestId }) => requestId)).toEqual(allRuns.requestIds);
  expect(new Set(allRuns.executionIds).size).toBe(6);
  expect(new Set(allRuns.evidenceIds).size).toBe(6);
  expect(allRuns.requestIds.slice(3)).not.toEqual(firstRun.requestIds);
  expect(allRuns.injectionIds.slice(3)).not.toEqual(firstRun.injectionIds);
  expect(allRuns.evidenceIds.slice(3)).not.toEqual(firstRun.evidenceIds);
  expect(allRuns.correlations.slice(0, 3)).toEqual(firstRun.correlations);

  await clickPanelButton(panelCdp, "Finish Scenario");
  await clearPanelEvidenceSelection(panelCdp);
  await waitForCondition(
    panelCdp,
    `document.querySelector('[aria-label="COMMAND projection summary"]')`,
    "the runtime Scope to restore after the Scenario"
  );
  await pressVisiblePanelButton(panelCdp, "Compare COMMAND projections");
  await waitForCondition(
    panelCdp,
    `document.querySelector('[aria-label="Observed Server COMMAND State"]') &&
      document.querySelector('[aria-label="Local Effective COMMAND State"]')`,
    "the final Observed Server and Local Effective projections"
  );
  const projections = await evaluateByValue<{ observed: string; localEffective: string }>(panelCdp, `({
    observed: document.querySelector('[aria-label="Observed Server COMMAND State"]')?.textContent ?? "",
    localEffective: document.querySelector('[aria-label="Local Effective COMMAND State"]')?.textContent ?? ""
  })`);
  expect(projections.observed).toContain("fixture-message.TICKER");
  expect(projections.observed).toContain("Attention - real Lightstreamer client.");
  expect(projections.observed).not.toContain(scenarioKey);
  expect(projections.localEffective).toContain("fixture-message.TICKER");
  expect(projections.localEffective).not.toContain(scenarioKey);
}

async function replaceScenarioStepJson(
  panelCdp: CdpClient,
  step: number,
  document: unknown
): Promise<void> {
  await clickPanelButton(panelCdp, `Step ${step}`);
  await waitForCondition(
    panelCdp,
    `document.querySelector('[aria-label="Step ${step} Local Injection JSON"][contenteditable="true"]')`,
    `Scenario Step ${step} editor`
  );
  await replaceLocalInjectionJson(panelCdp, JSON.stringify(document, null, 2), `Step ${step} Local Injection JSON`);
}

async function waitForScenarioRun(
  pageCdp: CdpClient,
  panelCdp: CdpClient,
  expected: Readonly<{ expectedBridgeCalls: number; expectedUpdateCount: number }>
): Promise<void> {
  await waitForCondition(
    pageCdp,
    `globalThis.__LSEW_SCENARIO_BRIDGE_CALLS__?.length === ${expected.expectedBridgeCalls} &&
      Number(document.querySelector("#update-count")?.textContent) === ${expected.expectedUpdateCount}`,
    `${expected.expectedBridgeCalls} ordinary Scenario requests and exactly-once application callbacks`
  );
  await waitForCondition(
    panelCdp,
    `document.querySelector('[aria-label="Local Injection Scenario"]')?.textContent?.includes("RUN COMPLETE")`,
    "the Scenario Run to settle through committed Local Evidence"
  );
}

async function readScenarioProof(
  pageCdp: CdpClient,
  panelCdp: CdpClient,
  scenarioKey: string
): Promise<{
  commands: string[];
  requestIds: string[];
  applicationEvents: string[];
  scenarioIds: string[];
  runIds: string[];
  stepIds: string[];
  injectionIds: string[];
  executionIds: string[];
  evidenceIds: string[];
  correlations: Array<{
    scenarioId: string;
    runId: string;
    stepId: string;
    injectionId: string;
    executionId: string;
    requestId: string;
    outcome: string;
    evidenceId: string;
  }>;
}> {
  const page = await evaluateByValue<{
    commands: string[];
    requestIds: string[];
    applicationEvents: string[];
  }>(pageCdp, `(() => {
    const calls = globalThis.__LSEW_SCENARIO_BRIDGE_CALLS__ ?? [];
    return {
      commands: calls.map(({ draft }) => draft.command),
      requestIds: calls.map(({ requestId }) => requestId),
      applicationEvents: [...document.querySelectorAll("#application-events li")]
        .map((row) => row.textContent ?? "")
        .filter((text) => text.includes(${JSON.stringify(scenarioKey)}))
        .reverse()
    };
  })()`);
  const correlations = await evaluateByValue<Array<{
    scenarioId: string;
    runId: string;
    stepId: string;
    injectionId: string;
    executionId: string;
    requestId: string;
    outcome: string;
    evidenceId: string;
  }>>(panelCdp, `(() => {
    const scenario = document.querySelector('[aria-label="Local Injection Scenario"]');
    if (!scenario) throw new Error("Scenario document is missing.");
    const scenarioId = scenario.textContent?.match(/local-injection-scenario-\\d+/)?.[0];
    const runBoundary = [...scenario.querySelectorAll("dl div")]
      .find((row) => row.querySelector("dt")?.textContent?.trim() === "Reviewed Run")
      ?.querySelector("dd")?.textContent ?? "";
    const currentRunId = runBoundary.match(/local-injection-run-\\d+/)?.[0];
    if (!scenarioId || !currentRunId) throw new Error("Scenario or current Run identity is missing.");
    const current = [...scenario.querySelectorAll('[aria-label="Ordered Scenario Steps"] > article')].map((article) => {
      const text = article.textContent ?? "";
      const stepId = text.match(/(step-\\d+) · stable identity/)?.[1];
      const injectionId = text.match(/Injection (local-injection-\\d+)/)?.[1];
      const executionId = text.match(/execution (local-injection-execution-\\d+)/)?.[1];
      const requestId = text.match(/request ([^\\s·]+)/)?.[1];
      const evidenceId = text.match(/Local Evidence ([^\\s·]+)/)?.[1];
      const headline = article.querySelector("p strong")?.textContent?.trim().toLowerCase();
      const outcome = headline?.startsWith("delivered") ? "delivered" : headline;
      if (!stepId || !injectionId || !executionId || !requestId || !evidenceId || !outcome) {
        throw new Error("Current Scenario correlation is incomplete: " + text);
      }
      return { scenarioId, runId: currentRunId, stepId, injectionId, executionId, requestId, outcome, evidenceId };
    });
    const prior = [...scenario.querySelectorAll('[aria-label="Prior Scenario Run ledgers"] li')].map((row) => {
      const text = row.textContent ?? "";
      const match = text.match(/^(\\S+(?: \\S+)*) · Scenario (local-injection-scenario-\\d+) · Run (local-injection-run-\\d+) · Step (step-\\d+)\\/\\d+ · Injection (local-injection-\\d+) · execution (local-injection-execution-\\d+) · request ([^\\s·]+) · outcome ([^\\s·]+).* · Evidence ([^\\s·]+)/);
      if (!match) throw new Error("Prior Scenario correlation is incomplete: " + text);
      const outcome = match[1].toLowerCase().startsWith("delivered") ? "delivered" : match[8];
      return { scenarioId: match[2], runId: match[3], stepId: match[4], injectionId: match[5], executionId: match[6], requestId: match[7], outcome, evidenceId: match[9] };
    });
    return [...prior, ...current];
  })()`);
  return {
    ...page,
    scenarioIds: [...new Set(correlations.map(({ scenarioId }) => scenarioId))],
    runIds: [...new Set(correlations.map(({ runId }) => runId))],
    stepIds: correlations.map(({ stepId }) => stepId),
    injectionIds: correlations.map(({ injectionId }) => injectionId),
    executionIds: correlations.map(({ executionId }) => executionId),
    evidenceIds: correlations.map(({ evidenceId }) => evidenceId),
    correlations
  };
}

test("official-client three-Step Scenario delivers ADD UPDATE DELETE once and can run again with fresh identities", async () => {
  await runOfficialClientPanelJourney(
    "2664,727",
    { width: 900, height: 700 },
    "scenario"
  );
});

test("official-client server error and keepalive remain observable through the loaded extension", async () => {
  await runOfficialClientPanelJourney("1200,900", { width: 900, height: 700 }, "diagnostics");
});

test("high-volume Capture does not leave shipped Evidence loading after repeated Scope choices", async () => {
  await runOfficialClientPanelJourney(
    "2664,927",
    { width: 1440, height: 900 },
    "high-volume-loading"
  );
});

test("issue-16 fixture retains Evidence and exposes its 15-subscription grouped Scope", async () => {
  await runOfficialClientPanelJourney(
    "2664,727",
    { width: 900, height: 700 },
    "issue-16"
  );
});

async function focusScopeTreeLabel(
  cdp: CdpClient,
  label: string
): Promise<{ id: string; level: string | null; setSize: string | null; text: string }> {
  const found = await evaluateByValue<{
    id: string;
    level: string | null;
    setSize: string | null;
    text: string;
  } | null>(cdp, `(async () => {
    const tree = document.querySelector('[aria-label^="Runtime Scope tree"]');
    if (!(tree instanceof HTMLElement)) throw new Error("Missing runtime Scope tree");
    const find = () => [...tree.querySelectorAll('[role="treeitem"]')].find(
      (candidate) => candidate.querySelector("span")?.textContent?.trim() === ${JSON.stringify(label)}
    );
    const initial = tree.querySelector('[role="treeitem"]');
    if (!(initial instanceof HTMLElement)) throw new Error("Missing runtime Scope item");
    initial.focus();
    await new Promise((resolve) => setTimeout(resolve, 750));
    for (const key of ${JSON.stringify(label)}) {
      initial.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    const candidate = find();
    if (!(candidate instanceof HTMLElement)) return null;
    candidate.scrollIntoView({ block: "center", inline: "nearest" });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const mountedCandidate = find();
    if (!(mountedCandidate instanceof HTMLElement)) return null;
    mountedCandidate.focus();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      id: mountedCandidate.getAttribute("data-scope-id") ?? "",
      level: mountedCandidate.getAttribute("aria-level"),
      setSize: mountedCandidate.getAttribute("aria-setsize"),
      text: mountedCandidate.textContent ?? ""
    };
  })()`);
  if (!found?.id) throw new Error(`Could not find Scope tree item ${label}.`);
  return found;
}

async function pressScopeTreeItemEnter(cdp: CdpClient, scopeId: string): Promise<void> {
  await evaluateByValue<void>(cdp, `(() => {
    const expectedScopeId = ${JSON.stringify(scopeId)};
    const item = [...document.querySelectorAll('[aria-label^="Runtime Scope tree"] [data-scope-id]')]
      .find((candidate) => candidate.getAttribute("data-scope-id") === expectedScopeId);
    if (!(item instanceof HTMLButtonElement)) throw new Error("Missing mounted Scope item " + expectedScopeId);
    item.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true
    }));
  })()`);
}

test("issue-16 burst keeps Scope populated and selectable beside retained Evidence", async () => {
  await runOfficialClientPanelJourney(
    "2664,927",
    { width: 1440, height: 900 },
    "issue-16-scope"
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
  await clickPanelButton(cdp, "Apply");
  await waitForCondition(
    cdp,
    `[...document.querySelectorAll("button")].some(
      (candidate) => candidate.textContent?.trim() === "Clear selection" && !candidate.disabled
    )`,
    "the filtered Evidence to offer clearing its hidden selection"
  );
  await clickPanelButton(cdp, "Clear selection");
  await clickPanelButton(cdp, "Reset Filter");
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

async function replaceLocalInjectionJson(
  cdp: CdpClient,
  text: string,
  ariaLabel = "Local Injection JSON"
): Promise<void> {
  const selector = `[aria-label=${JSON.stringify(ariaLabel)}][contenteditable="true"]`;
  await clickVisiblePanelElement(
    cdp,
    `document.querySelector(${JSON.stringify(selector)})`,
    `${ariaLabel} editor`
  );
  await selectAllInFocusedEditor(cdp);
  await cdp.request("Input.insertText", { text });
  await waitForCondition(
    cdp,
    `(() => {
      const editor = document.querySelector(${JSON.stringify(selector)});
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
