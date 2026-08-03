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
const extensionDir = join(rootDir, "dist");
const fixtureUrl = new URL(
  "/mutate-reinject.html?capture=listener",
  process.env.LSEW_FIXTURE_URL ?? "http://localhost:8080/"
).href;

test("live COMMAND Capture stays consistent across Timeline, Topology, and Local Injection", async () => {
  const profileDir = await mkdtemp(join(tmpdir(), "lsew-playwright-extension-"));
  const chromeExecutable = await resolveChromeExecutable(rootDir);
  const chromeLogs: string[] = [];
  let latestTargets: BrowserTarget[] = [];
  let chrome: ChildProcess | null = null;
  let pageCdp: CdpClient | null = null;
  let devtoolsCdp: CdpClient | null = null;
  let panelCdp: CdpClient | null = null;

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
    await panelCdp.request("Runtime.enable");
    await waitForCondition(
      panelCdp,
      `
        document.querySelector(".status-badge")?.textContent === "capturing" &&
        [...document.querySelectorAll('.event-row[data-kind="item-update"][data-source="listener"][data-synthetic="false"]')]
          .some((row) => row.querySelector(".event-item")?.textContent === "scenario.mutate-reinject")
      `,
      "Timeline to display the captured listener update"
    );

    await setPanelSearch(panelCdp, "fixture-message.TICKER");
    await waitForCondition(
      panelCdp,
      `document.querySelectorAll('.event-row[data-kind="item-update"][data-synthetic="false"]').length === 1`,
      "the active Timeline search to retain the captured COMMAND update"
    );
    await selectTimelineRow(panelCdp, false);
    await openDetailSections(panelCdp, ["Context", "Raw capture"]);
    const serverDetail = await selectedDetailProof(panelCdp);

    expect(serverDetail.eventId).toMatch(/^event-\d+$/);
    expect(serverDetail.command).toContain("ADD/fixture-message.TICKER");
    expect(serverDetail.item).toBe("scenario.mutate-reinject");
    expect(serverDetail.detail).toContain("fixture-message.TICKER");
    expect(serverDetail.detail).toContain("Attention - real Lightstreamer client.");
    expect(serverDetail.detail).toContain("scenario.mutate-reinject");
    expect(serverDetail.detail).toContain("onItemUpdate");
    expect(serverDetail.context).toContain('"name": "scenario.mutate-reinject"');

    await selectView(panelCdp, "COMMAND State");
    await waitForCondition(
      panelCdp,
      `document.querySelector(".command-workspace")?.textContent?.includes("fixture-message.TICKER")`,
      "COMMAND State to show the selected Timeline update"
    );
    await selectView(panelCdp, "Timeline");
    await waitForCondition(
      panelCdp,
      `document.querySelector(".selected-event-id")?.textContent === ${JSON.stringify(
        serverDetail.eventId
      )}`,
      "Timeline detail to remain connected after switching views"
    );
    await openDetailSections(panelCdp, ["Context", "Raw capture"]);
    const restoredServerDetail = await selectedDetailProof(panelCdp);
    expect(restoredServerDetail.detail).toContain("Attention - real Lightstreamer client.");
    expect(restoredServerDetail.context).toContain('"name": "scenario.mutate-reinject"');

    const sourceReplay = await evaluateByValue<{ clicked: boolean; disabled: boolean }>(
      panelCdp,
      `(() => {
        const button = document.querySelector(".replay-source-button");
        if (!(button instanceof HTMLButtonElement)) return { clicked: false, disabled: true };
        const disabled = button.disabled;
        if (!disabled) button.click();
        return { clicked: true, disabled };
      })()`
    );
    expect(sourceReplay).toEqual({ clicked: true, disabled: false });
    await waitForCondition(
      pageCdp,
      `Number(document.querySelector("#update-count")?.textContent) === 2`,
      "the successful Local Injection to reach the fixture listener"
    );
    await waitForCondition(
      panelCdp,
      `
        document.querySelector('.event-row[data-selected="true"][data-synthetic="true"]') &&
        document.querySelector(".reinjection-message")?.textContent?.includes("delivered")
      `,
      "Timeline to select the successfully delivered Local Injected Update"
    );
    await openDetailSections(panelCdp, ["Synthetic provenance", "Context", "Raw capture"]);
    const syntheticDetail = await selectedDetailProof(panelCdp);

    expect(syntheticDetail.eventId).toMatch(/^synthetic-/);
    expect(syntheticDetail.eventId).not.toBe(serverDetail.eventId);
    expect(syntheticDetail.command).toContain("ADD/fixture-message.TICKER");
    expect(syntheticDetail.item).toBe("scenario.mutate-reinject");
    expect(syntheticDetail.detail).toContain(serverDetail.eventId);
    expect(syntheticDetail.detail).toContain("fixture-message.TICKER");
    expect(syntheticDetail.detail).toContain("Attention - real Lightstreamer client.");
    expect(syntheticDetail.context).toContain('"name": "scenario.mutate-reinject"');

    await selectView(panelCdp, "Topology");
    await waitForCondition(
      panelCdp,
      `
        (() => {
          const overview = document.querySelector(".topology-overview")?.textContent ?? "";
          const tree = document.querySelector(".topology-tree-pane")?.textContent ?? "";
          return overview.includes("Clients1") &&
            overview.includes("Sessions1 active") &&
            overview.includes("Subscriptions1/1 established") &&
            overview.includes("Items1") &&
            overview.includes("Listeners1") &&
            tree.includes("scenario.mutate-reinject");
        })()
      `,
      "Topology to show the observed client, Session, Subscription, item, and listener hierarchy"
    );
    const topology = await evaluateByValue<{ overview: string; tree: string }>(
      panelCdp,
      `({
        overview: document.querySelector(".topology-overview")?.textContent ?? "",
        tree: document.querySelector(".topology-tree-pane")?.textContent ?? ""
      })`
    );
    expect(topology.overview).toContain("Full API coverage");
    expect(topology.overview).toContain("Legacy event projection");
    expect(topology.overview).not.toContain("Complete semantic coverage");
    expect(topology.overview).not.toContain("Awaiting capture");
    expect(topology.tree).not.toContain("0 clients");
    expect(topology.tree).toContain("scenario.mutate-reinject");
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
});

async function setPanelSearch(cdp: CdpClient, query: string): Promise<void> {
  await evaluateByValue(
    cdp,
    `(() => {
      const input = document.querySelector(".search-input");
      if (!(input instanceof HTMLInputElement)) throw new Error("Timeline search is missing");
      input.value = ${JSON.stringify(query)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`
  );
}

async function selectTimelineRow(cdp: CdpClient, synthetic: boolean): Promise<void> {
  await evaluateByValue(
    cdp,
    `(() => {
      const row = document.querySelector('.event-row[data-kind="item-update"][data-synthetic="${String(
        synthetic
      )}"]');
      if (!(row instanceof HTMLButtonElement)) throw new Error("Captured Timeline row is missing");
      row.click();
    })()`
  );
  await waitForCondition(
    cdp,
    `document.querySelector(".detail-pane")?.hasAttribute("hidden") === false`,
    "the selected event detail to open"
  );
}

async function openDetailSections(cdp: CdpClient, headings: readonly string[]): Promise<void> {
  await evaluateByValue(
    cdp,
    `(() => {
      const headings = ${JSON.stringify(headings)};
      for (const section of document.querySelectorAll(".detail-section")) {
        const heading = section.querySelector(".detail-section-heading")?.textContent;
        if (headings.includes(heading) && section instanceof HTMLDetailsElement && !section.open) {
          section.open = true;
          section.dispatchEvent(new Event("toggle"));
        }
      }
    })()`
  );
}

async function selectedDetailProof(cdp: CdpClient): Promise<{
  eventId: string;
  command: string;
  item: string;
  detail: string;
  context: string;
}> {
  return evaluateByValue(
    cdp,
    `({
      eventId: document.querySelector(".selected-event-id")?.textContent ?? "",
      command: document.querySelector(".selected-event-command")?.textContent ?? "",
      item: document.querySelector('.event-row[data-selected="true"] .event-item')?.textContent ?? "",
      detail: document.querySelector(".detail-pane")?.textContent ?? "",
      context: [...document.querySelectorAll(".detail-section")].find(
        (section) => section.querySelector(".detail-section-heading")?.textContent === "Context"
      )?.textContent ?? ""
    })`
  );
}

async function selectView(cdp: CdpClient, label: string): Promise<void> {
  await evaluateByValue(
    cdp,
    `(() => {
      const button = [...document.querySelectorAll(".view-selector button")].find(
        (candidate) => candidate.textContent === ${JSON.stringify(label)}
      );
      if (!(button instanceof HTMLButtonElement)) throw new Error("Missing ${label} view");
      button.click();
    })()`
  );
}
