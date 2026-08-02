import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PAGE_CAPTURE_SYNC_REQUEST,
  TOPOLOGY_OBSERVATION_VERSION,
  TOPOLOGY_SYNC_BEGIN,
  TOPOLOGY_SYNC_CHUNK,
  TOPOLOGY_SYNC_COMPLETE,
  TOPOLOGY_SYNC_VERSION,
  createCaptureMessage,
  isTopologySyncFrame,
  type CaptureMessage,
  type CaptureKind,
  type CapturePayload,
  type TopologyAbsoluteRecord,
  type TopologyObservation,
  type TopologySyncFrame
} from "../src/bridge/messages";
import type { LightstreamerHost } from "../src/core/lightstreamer-types";
import {
  createEventStore,
  createIndexedDbEventStore
} from "../src/core/event-store";
import {
  deleteEventDatabase,
  eventDatabaseName
} from "../src/core/indexeddb/event-db";
import { type PanelController, renderPanel } from "../src/extension/panel/main";
import { installLightstreamerInstrumentation } from "../src/injected/lightstreamer-instrumentation";

function text(selector: string): string {
  return document.querySelector(selector)?.textContent ?? "";
}

function clickView(label: string): void {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".view-selector button")
  ).find((candidate) => candidate.textContent === label);
  if (!button) {
    throw new Error(`missing ${label} view`);
  }
  button.click();
}

function clickNode(label: string): void {
  const button = findNode(label);
  if (!button) {
    throw new Error(`missing topology node ${label}`);
  }
  button.click();
}

function findNode(label: string): HTMLButtonElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(".topology-node")
  ).find((candidate) => (candidate.textContent ?? "").includes(label));
}

function pressKey(target: Element, key: string): boolean {
  return target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
  );
}

async function flushPanel(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsText(blob);
  });
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({})
  } as DOMRect;
}

async function waitForTopologyIdle(timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (
    document.querySelector(".topology-tree-pane")?.getAttribute("aria-busy") ===
      "true" &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForTopologyNodeWhileBusy(
  label: string,
  timeoutMs = 1_000
): Promise<HTMLButtonElement | undefined> {
  const deadline = Date.now() + timeoutMs;
  let node = findNode(label);
  while (!node && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    node = findNode(label);
  }
  return node;
}

describe("topology inspector", () => {
  let panel: PanelController;

  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing test root");
    }
    panel = renderPanel(root);
  });

  it("renders page, client, session, subscription, item, and listener nodes", async () => {
    appendTopologyFixture(panel);
    await flushPanel();
    clickView("Topology");

    expect(
      document.querySelector<HTMLButtonElement>(
        '.view-selector button[data-active="true"]'
      )?.textContent
    ).toBe("Topology");
    expect(text(".topology-overview")).toContain("1/1 established");
    expect(text(".topology-tree-pane")).toContain("client-1");
    expect(text(".topology-tree-pane")).toContain("session-A");
    expect(text(".topology-tree-pane")).toContain("subscription-1");
    expect(text(".topology-tree-pane")).toContain("portfolio");
    expect(text(".topology-tree-pane")).toContain("listener-1");

    clickNode("subscription-1");
    expect(text(".topology-detail-pane")).toContain("Requested configuration");
    expect(text(".topology-detail-pane")).toContain("desk-a");
    expect(text(".topology-detail-pane")).toContain("1.5 updates/s");
    expect(text(".topology-detail-pane")).toContain("Established by server");
    expect(text(".topology-detail-pane")).toContain("2");

    clickNode("portfolio");
    expect(text(".topology-detail-pane")).toContain("Snapshot phase");
    expect(text(".topology-detail-pane")).toContain("live");
    expect(text(".topology-detail-pane")).toContain("Lost updates");
    expect(text(".topology-detail-pane")).toContain("3");

    clickNode("Session session-A");
    expect(text(".topology-detail-pane")).toContain("203.0.113.x");
    expect(text(".topology-detail-pane")).toContain(
      "Masked at capture · exact unavailable"
    );
    expect(text(".topology-detail-pane")).toContain("ws-streaming");
    expect(text(".topology-detail-pane")).toContain("5 s");

    expect(document.querySelector(".topology-mask-sensitive")).toBeNull();
  });

  it("shows conservative subscription semantic diagnostics in the detail surface", async () => {
    append(panel, "client-created", {
      client: { id: "semantic-client", status: "DISCONNECTED" }
    });
    append(panel, "subscription-started", {
      client: { id: "semantic-client", status: "DISCONNECTED" },
      subscription: {
        id: "semantic-subscription",
        mode: "RAW",
        items: ["raw-items"],
        fields: ["value"],
        requestedSnapshot: "yes",
        requestedBufferSize: "10",
        active: true
      }
    });

    await flushPanel();
    clickView("Topology");
    clickNode("semantic-subscription");

    const detail = text(".topology-detail-pane");
    expect(detail).toContain("Configuration diagnostics");
    expect(detail).toContain("RAW subscriptions do not provide snapshots");
    expect(detail).toContain("Buffer request is not valid for this mode");
  });

  it("exposes a single-select nested tree with roving keyboard navigation", async () => {
    appendTopologyFixture(panel);
    await flushPanel();
    clickView("Topology");

    const tree = document.querySelector<HTMLElement>(".topology-tree");
    const page = findNode("Inspected page");
    const client = findNode("client-1");
    const session = findNode("Session session-A");

    expect(tree?.getAttribute("role")).toBe("tree");
    expect(tree?.getAttribute("aria-label")).toBe("Current Lightstreamer topology");
    expect(page?.getAttribute("role")).toBe("treeitem");
    expect(page?.getAttribute("aria-selected")).toBe("true");
    expect(page?.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.querySelectorAll('.topology-node[role="treeitem"][tabindex="0"]')
    ).toHaveLength(1);
    expect(
      document.querySelectorAll('.topology-tree-group[role="group"]')
        .length
    ).toBeGreaterThan(0);

    page?.focus();
    expect(pressKey(page!, "ArrowDown")).toBe(false);
    expect(document.activeElement).toBe(client);
    expect(client?.getAttribute("aria-selected")).toBe("true");
    expect(page?.getAttribute("aria-selected")).toBe("false");
    expect(text(".topology-detail-heading")).toContain("client-1");

    expect(pressKey(client!, "ArrowLeft")).toBe(false);
    expect(client?.getAttribute("aria-expanded")).toBe("false");
    expect(pressKey(client!, "ArrowRight")).toBe(false);
    expect(client?.getAttribute("aria-expanded")).toBe("true");
    expect(pressKey(client!, "ArrowRight")).toBe(false);
    expect(document.activeElement).toBe(session);

    expect(pressKey(session!, "End")).toBe(false);
    expect(document.activeElement).toBe(findNode("listener-1"));
    expect(pressKey(document.activeElement!, "Home")).toBe(false);
    expect(document.activeElement).toBe(page);

    expect(pressKey(page!, "s")).toBe(false);
    expect(document.activeElement).toBe(session);
    expect(pressKey(session!, " ")).toBe(false);
    expect(session?.getAttribute("aria-selected")).toBe("true");
  });

  it("returns tree focus to the surviving page node when a focused node retires", async () => {
    appendTopologyFixture(panel);
    await flushPanel();
    clickView("Topology");

    const item = findNode("portfolio");
    item?.focus();
    item?.click();
    expect(document.activeElement).toBe(item);

    panel.clearEvents();
    await flushPanel();

    const page = findNode("Inspected page");
    expect(document.activeElement).toBe(page);
    expect(page?.getAttribute("aria-selected")).toBe("true");
    expect(page?.tabIndex).toBe(0);
  });

  it("provides a keyboard-operable topology splitter", async () => {
    appendTopologyFixture(panel);
    await flushPanel();
    clickView("Topology");

    const body = document.querySelector<HTMLElement>(".topology-body");
    const separator = document.querySelector<HTMLElement>(
      ".topology-resize-handle"
    );
    const before = Number(separator?.getAttribute("aria-valuenow"));

    expect(separator?.getAttribute("role")).toBe("separator");
    expect(separator?.getAttribute("aria-controls")).toBe("topology-tree-pane");
    expect(separator?.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator?.tabIndex).toBe(0);
    expect(pressKey(separator!, "ArrowRight")).toBe(false);
    expect(Number(separator?.getAttribute("aria-valuenow"))).toBe(before + 2);
    expect(body?.style.getPropertyValue("--topology-tree-size")).toBe(
      `${before + 2}%`
    );

    const previousWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 700
    });
    window.dispatchEvent(new Event("resize"));
    expect(body?.dataset.orientation).toBe("stacked");
    expect(separator?.getAttribute("aria-orientation")).toBe("horizontal");

    const valueBeforeDispose = separator?.getAttribute("aria-valuenow");
    panel.dispose();
    expect(pressKey(separator!, "ArrowDown")).toBe(true);
    expect(separator?.getAttribute("aria-valuenow")).toBe(valueBeforeDispose);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: previousWidth
    });
  });

  it("uses semantic topology in memory but omits it from persisted Timeline events", async () => {
    const store = createEventStore();
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) throw new Error("missing test root");
    panel = renderPanel(root, undefined, { store });

    panel.appendCaptureMessage(
      semanticCapture(
        "subscription-started",
        {
          client: { id: "semantic-client", sessionId: "semantic-session" },
          subscription: {
            id: "semantic-sub",
            mode: "MERGE",
            active: true,
            subscribed: true
          }
        },
        "page-a",
        1
      )
    );
    await flushPanel();

    expect(store.list()[0]).not.toHaveProperty("topology");
    clickView("Topology");
    expect(text(".topology-tree-pane")).toContain("semantic-sub");
  });

  it("never writes semantic topology evidence to IndexedDB", async () => {
    const previousIndexedDb = globalThis.indexedDB;
    const sessionId = "panel-topology-persistence";
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    const store = await createIndexedDbEventStore({ sessionId, reset: true });
    try {
      panel.dispose();
      document.body.innerHTML = '<main id="app"></main>';
      const root = document.querySelector<HTMLElement>("#app");
      if (!root) throw new Error("missing test root");
      panel = renderPanel(root, undefined, { store });
      panel.appendCaptureMessage(
        semanticCapture(
          "subscription-started",
          topologyPayload("indexed-semantic-sub"),
          "page-indexed",
          1
        )
      );
      await flushPanel();

      const persisted = await store.list();
      expect(persisted).toHaveLength(1);
      expect(persisted[0]).not.toHaveProperty("topology");
      clickView("Topology");
      expect(text(".topology-tree-pane")).toContain("indexed-semantic-sub");
    } finally {
      panel.dispose();
      await store.close?.();
      await deleteEventDatabase(eventDatabaseName(sessionId));
      Reflect.set(globalThis, "indexedDB", previousIndexedDb);
    }
  });

  it("atomically replaces late-open topology and applies its post-cutoff live tail once", async () => {
    panel.appendCaptureMessage(
      semanticCapture(
        "subscription-started",
        topologyPayload("old-sub"),
        "page-a",
        1
      )
    );
    await flushPanel();
    clickView("Topology");
    expect(text(".topology-tree-pane")).toContain("old-sub");

    const sync = topologyCheckpoint("page-a", "late-open", "checkpoint-sub", 10);
    panel.applyTopologySyncFrame(sync.begin);
    panel.applyTopologySyncFrame(sync.chunk);
    panel.appendCaptureMessage(
      semanticCapture(
        "subscription-started",
        topologyPayload("tail-sub"),
        "page-a",
        11
      )
    );
    await flushPanel();
    expect(text(".topology-tree-pane")).toContain("old-sub");
    expect(text(".topology-tree-pane")).not.toContain("checkpoint-sub");
    expect(text(".topology-tree-pane")).not.toContain("tail-sub");
    expect(text(".topology-overview")).toContain("Synchronizing");

    panel.applyTopologySyncFrame(sync.complete);
    expect(text(".topology-tree-pane")).not.toContain("old-sub");
    expect(text(".topology-tree-pane")).toContain("checkpoint-sub");
    expect(text(".topology-tree-pane")).toContain("tail-sub");
    expect(text(".topology-overview")).toContain("Synchronized");
    panel.applyTopologySyncFrame(sync.complete);
    expect(
      Array.from(document.querySelectorAll(".topology-node-label")).filter(
        (node) => node.textContent === "tail-sub"
      )
    ).toHaveLength(1);
  });

  it("retains confirmed topology and resumes its live tail when a replacement checkpoint is partial", async () => {
    const confirmed = topologyCheckpoint("page-a", "confirmed", "confirmed-sub", 10);
    panel.applyTopologySyncFrame(confirmed.begin);
    panel.applyTopologySyncFrame(confirmed.chunk);
    panel.applyTopologySyncFrame(confirmed.complete);
    clickView("Topology");
    expect(text(".topology-tree-pane")).toContain("confirmed-sub");

    const partial = partialTopologyCheckpoint("page-a", "partial", 20);
    panel.applyTopologySyncFrame(partial.begin);
    panel.appendCaptureMessage(
      semanticCapture(
        "subscription-started",
        topologyPayload("partial-tail"),
        "page-a",
        21
      )
    );
    await flushPanel();
    expect(text(".topology-tree-pane")).not.toContain("partial-tail");
    panel.applyTopologySyncFrame(partial.complete);

    expect(text(".topology-tree-pane")).toContain("confirmed-sub");
    expect(text(".topology-tree-pane")).toContain("partial-tail");
    expect(text(".topology-overview")).toContain("Partial · retry needed");
  });

  it("retires topology from an old page epoch when navigation traffic arrives", async () => {
    panel.appendCaptureMessage(
      semanticCapture(
        "subscription-started",
        topologyPayload("page-a-sub"),
        "page-a",
        1
      )
    );
    await flushPanel();
    clickView("Topology");
    expect(text(".topology-tree-pane")).toContain("page-a-sub");

    panel.appendCaptureMessage(
      semanticCapture(
        "subscription-started",
        topologyPayload("page-b-sub", "client-b", "session-b"),
        "page-b",
        1
      )
    );
    await flushPanel();

    expect(text(".topology-tree-pane")).not.toContain("page-a-sub");
    expect(text(".topology-tree-pane")).toContain("page-b-sub");

    const stale = topologyCheckpoint("page-a", "delayed-page-a", "stale-sub", 10);
    panel.applyTopologySyncFrame(stale.begin);
    panel.applyTopologySyncFrame(stale.chunk);
    panel.applyTopologySyncFrame(stale.complete);
    panel.appendCaptureMessage(
      semanticCapture(
        "subscription-started",
        topologyPayload("late-page-a-sub"),
        "page-a",
        12
      )
    );
    await flushPanel();

    expect(text(".topology-tree-pane")).toContain("page-b-sub");
    expect(text(".topology-tree-pane")).not.toContain("stale-sub");
    expect(text(".topology-tree-pane")).not.toContain("late-page-a-sub");
  });

  it("invalidates replay registries on page-epoch change and ignores stale replay metadata", async () => {
    panel.setBridge({
      reinjectDraft: async () => ({
        requestId: "semantic-navigation",
        ok: true,
        status: "success",
        timestamp: Date.now()
      })
    });
    panel.appendCaptureMessage(
      semanticCapture(
        "item-update",
        replayPayload("epoch-a", "page-a-client", "page-a-session"),
        "page-a",
        1
      )
    );
    await flushPanel();
    document
      .querySelector<HTMLButtonElement>('.event-row[data-command="UPDATE"]')
      ?.click();
    expect(text(".replay-target-status")).toContain("live Subscription");

    panel.appendCaptureMessage(
      semanticCapture(
        "subscription-started",
        topologyPayload("page-b-sub", "page-b-client", "page-b-session"),
        "page-b",
        1
      )
    );
    await flushPanel();
    document
      .querySelector<HTMLButtonElement>('.event-row[data-command="UPDATE"]')
      ?.click();
    expect(text(".replay-target-status")).toContain("stale Subscription");

    panel.appendCaptureMessage(
      semanticCapture(
        "item-update",
        replayPayload("late-page-a", "page-a-client", "page-a-session"),
        "page-a",
        2
      )
    );
    await flushPanel();
    const staleRow = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.event-row[data-command="UPDATE"]')
    ).find((row) => row.textContent?.includes("late-page-a"));
    staleRow?.click();
    expect(text(".replay-target-status")).toContain("stale Subscription");
  });

  it("hydrates listener attachments with a consistent subscription and overview count", () => {
    const sync = topologyCheckpoint(
      "page-a",
      "listener-count",
      "listener-sub",
      10,
      true
    );
    panel.applyTopologySyncFrame(sync.begin);
    panel.applyTopologySyncFrame(sync.chunk);
    panel.applyTopologySyncFrame(sync.complete);
    clickView("Topology");

    expect(text(".topology-overview")).toContain("Listeners1");
    clickNode("listener-sub");
    expect(text(".topology-detail-pane")).toContain("Listeners1");
    expect(text(".topology-tree-pane")).toContain("checkpoint-listener");

    panel.appendCaptureMessage(
      semanticCapture(
        "listener-added",
        {
          client: {
            id: "checkpoint-client",
            status: "CONNECTED:WS-STREAMING",
            sessionId: "checkpoint-session"
          },
          subscription: {
            id: "listener-sub",
            mode: "MERGE",
            active: true,
            subscribed: true,
            listenerCount: 2
          },
          listener: { id: "live-listener", callbacks: ["onItemUpdate"] }
        },
        "page-a",
        11
      )
    );
    expect(text(".topology-overview")).toContain("Listeners2");
  });

  it("renders checkpoint lifecycle evidence instead of collapsing it into booleans", () => {
    const sync = topologyCheckpoint(
      "page-a",
      "lifecycle-evidence",
      "command-sub",
      20,
      true
    );
    const records = (
      sync.chunk as Extract<TopologySyncFrame, { records: unknown }>
    ).records as TopologyAbsoluteRecord[];
    const attachment = records.find(
      (record) => record.kind === "listener-attachment"
    );
    if (!attachment?.values) throw new Error("missing attachment fixture");
    attachment.values.registrationCount = 3;
    records.push(
      {
        kind: "establishment",
        id: "establishment:command-sub:2",
        parentId: "command-sub",
        subscriptionId: "command-sub",
        pageEpoch: "page-a",
        captureSequence: 6,
        values: { established: true, epoch: 2 }
      },
      {
        kind: "command-generation",
        id: "command-generation:command-sub:item-1:order-1:4",
        parentId: "command-sub",
        subscriptionId: "command-sub",
        pageEpoch: "page-a",
        captureSequence: 7,
        values: {
          itemId: "item-1",
          key: "order-1",
          command: "ADD"
        }
      },
      {
        kind: "inferred-child",
        id: "inferred-child:order-1:loss",
        parentId: "command-generation:command-sub:item-1:order-1:4",
        subscriptionId: "command-sub",
        pageEpoch: "page-a",
        captureSequence: 8,
        values: {
          generationId: "command-generation:command-sub:item-1:order-1:4",
          key: "order-1",
          captureKind: "lost-updates",
          callback: "onCommandSecondLevelItemLostUpdates",
          label: "Second-level lost updates",
          provenance: "inferred-second-level",
          update: { lostUpdates: 3 }
        }
      }
    );
    for (const frame of [sync.begin, sync.chunk, sync.complete]) {
      frame.recordCount = records.length;
    }
    panel.applyTopologySyncFrame(sync.begin);
    panel.applyTopologySyncFrame(sync.chunk);
    panel.applyTopologySyncFrame(sync.complete);
    clickView("Topology");

    clickNode("command-sub");
    expect(text(".topology-detail-pane")).toContain("Establishment epochs1");
    expect(text(".topology-detail-pane")).toContain("establishment:command-sub:2");
    expect(text(".topology-detail-pane")).toContain("COMMAND generations1");
    expect(text(".topology-detail-pane")).toContain("order-1");
    expect(text(".topology-detail-pane")).toContain("Second-level lost updates");
    expect(text(".topology-detail-pane")).toContain("inferred-second-level");

    const generation = findNode("Generation order-1");
    const inferredChild = findNode("Second-level lost updates");
    expect(generation).toBeUndefined();
    expect(inferredChild).toBeUndefined();
    expect(document.querySelectorAll(".topology-command-evidence-entry")).toHaveLength(1);

    clickNode("checkpoint-listener");
    expect(text(".topology-detail-pane")).toContain("Attachment IDsattachment-1");
    expect(text(".topology-detail-pane")).toContain("Registration attempts3");
  });

  it("projects post-checkpoint lifecycle observations exactly once without waiting for another sync", async () => {
    const { host, messages, messageListeners, frames } =
      createInstrumentedPanelTopologyHarness();
    for (const listener of messageListeners) {
      listener({
        source: host,
        data: { type: PAGE_CAPTURE_SYNC_REQUEST }
      } as unknown as MessageEvent);
    }
    expect(frames.map((frame) => frame.type)).toEqual([
      TOPOLOGY_SYNC_BEGIN,
      TOPOLOGY_SYNC_COMPLETE
    ]);
    for (const frame of frames) panel.applyTopologySyncFrame(frame);

    const client = new host.LightstreamerClient();
    const subscription = new host.Subscription(
      "COMMAND",
      ["orders"],
      ["command", "key", "value"]
    );
    client.subscribe(subscription);
    const listener = {
      onSubscription: () => undefined,
      onItemUpdate: () => undefined,
      onCommandSecondLevelItemLostUpdates: () => undefined
    };
    subscription.addListener(listener);
    subscription.removeListener(listener);
    subscription.addListener(listener);
    const installed = subscription.listeners[0];
    installed?.onSubscription?.();
    installed?.onItemUpdate?.(commandItemUpdate("ADD", "live-key"));
    installed?.onItemUpdate?.(commandItemUpdate("UPDATE", "live-key"));
    installed?.onItemUpdate?.(commandItemUpdate("DELETE", "live-key"));
    installed?.onItemUpdate?.(commandItemUpdate("ADD", "live-key"));
    installed?.onCommandSecondLevelItemLostUpdates?.(3, "live-key");

    expect(messages.map(({ topology }) => topology?.kind)).toEqual(
      expect.arrayContaining([
        "subscription-established",
        "listener-added",
        "command-key-generation",
        "second-level-observed"
      ])
    );
    expect(
      messages
        .filter(({ topology }) => topology?.kind === "command-key-generation")
        .map(({ payload }) =>
          (payload.update as { command?: unknown } | undefined)?.command
        )
    ).toEqual(["ADD", "UPDATE", "DELETE", "ADD"]);
    for (const message of messages) {
      panel.appendCaptureMessage(message);
      panel.appendCaptureMessage(message);
    }
    await flushPanel();
    clickView("Topology");

    const subscriptionId = (
      messages.find(({ kind }) => kind === "subscription-started")?.payload
        .subscription as { id?: unknown } | undefined
    )?.id;
    const listenerId = (
      messages.find(({ kind }) => kind === "listener-added")?.payload.listener as
        | { id?: unknown }
        | undefined
    )?.id;
    if (typeof subscriptionId !== "string" || typeof listenerId !== "string") {
      throw new Error("instrumentation did not emit subscription/listener identities");
    }
    expect(text(".topology-tree-pane")).toContain(subscriptionId);

    clickNode(String(subscriptionId));
    const detail = text(".topology-detail-pane");
    expect(detail).toContain("Establishment epochs1");
    expect(
      detail.match(new RegExp(`establishment:${subscriptionId}:1`, "g"))
    ).toHaveLength(1);
    expect(detail).toContain("COMMAND generations1");
    expect(detail).toContain(":live-key:2");
    expect(detail.match(/live-key/g)?.length).toBeGreaterThan(0);
    expect(detail.match(/Second-level lost updates/g)).toHaveLength(1);
    expect(detail.match(/inferred-second-level/g)).toHaveLength(1);
    expect(
      Array.from(document.querySelectorAll(".topology-node-label")).filter(
        ({ textContent }) => textContent === "Generation live-key"
      )
    ).toHaveLength(0);
    expect(
      Array.from(document.querySelectorAll(".topology-node-label")).filter(
        ({ textContent }) => textContent === "Second-level lost updates"
      )
    ).toHaveLength(0);
    expect(
      Array.from(document.querySelectorAll(".topology-node-label")).filter(
        ({ textContent }) => textContent === listenerId
      )
    ).toHaveLength(1);

    clickNode(String(listenerId));
    const listenerDetail = text(".topology-detail-pane");
    expect(listenerDetail).toContain("Attachment IDslistener-attachment:");
    expect(listenerDetail.match(/listener-attachment:/g)).toHaveLength(1);
    expect(listenerDetail).toContain(":2");
    expect(listenerDetail).toContain("Registration attempts2");
  });

  it("retires establishment and COMMAND evidence across session loss and unsubscribe without detaching listeners", async () => {
    const { host, messages, messageListeners, frames } =
      createInstrumentedPanelTopologyHarness();
    for (const listener of messageListeners) {
      listener({
        source: host,
        data: { type: PAGE_CAPTURE_SYNC_REQUEST }
      } as unknown as MessageEvent);
    }
    for (const frame of frames) panel.applyTopologySyncFrame(frame);

    const client = new host.LightstreamerClient();
    client.addListener({ onStatusChange: () => undefined });
    const subscription = new host.Subscription(
      "COMMAND",
      ["orders"],
      ["command", "key", "value"]
    );
    client.subscribe(subscription);
    const listener = {
      onSubscription: () => undefined,
      onItemUpdate: () => undefined
    };
    subscription.addListener(listener);
    const installed = subscription.listeners[0];
    installed?.onSubscription?.();
    installed?.onItemUpdate?.(commandItemUpdate("ADD", "recovery-key"));
    for (const message of messages) panel.appendCaptureMessage(message);
    await flushPanel();
    clickView("Topology");

    const subscriptionId = captureEntityId(messages, "subscription-started", "subscription");
    const listenerId = captureEntityId(messages, "listener-added", "listener");
    clickNode(subscriptionId);
    expect(text(".topology-detail-pane")).toContain("Establishment epochs1");
    expect(text(".topology-detail-pane")).toContain("COMMAND generations1");

    let cursor = messages.length;
    client.status = "DISCONNECTED";
    client.sessionId = null;
    client.listeners[0]?.onStatusChange?.("DISCONNECTED");
    for (const message of messages.slice(cursor)) panel.appendCaptureMessage(message);
    await flushPanel();

    clickNode(subscriptionId);
    expect(text(".topology-detail-pane")).toContain("Establishment epochs0");
    clickNode(listenerId);
    expect(text(".topology-detail-pane")).toContain("Attachment IDslistener-attachment:");

    cursor = messages.length;
    client.status = "CONNECTED:WS-STREAMING";
    client.sessionId = "recovered-session";
    client.listeners[0]?.onStatusChange?.("CONNECTED:WS-STREAMING");
    installed?.onSubscription?.();
    installed?.onItemUpdate?.(commandItemUpdate("ADD", "recovery-key"));
    for (const message of messages.slice(cursor)) panel.appendCaptureMessage(message);
    await flushPanel();

    clickNode(subscriptionId);
    const recoveredDetail = text(".topology-detail-pane");
    expect(recoveredDetail).toContain("Establishment epochs1");
    expect(recoveredDetail).toContain(`establishment:${subscriptionId}:2`);
    expect(recoveredDetail).toContain("COMMAND generations1");

    cursor = messages.length;
    client.unsubscribe(subscription);
    for (const message of messages.slice(cursor)) panel.appendCaptureMessage(message);
    await flushPanel();

    clickNode(subscriptionId);
    const endedDetail = text(".topology-detail-pane");
    expect(endedDetail).toContain("Establishment epochs0");
    expect(endedDetail).toContain("COMMAND generations0");
    clickNode(listenerId);
    expect(text(".topology-detail-pane")).toContain("Attachment IDslistener-attachment:");
  });

  it("continues hydrated COMMAND generation epochs across UPDATE, DELETE, duplicate delivery, and ADD", async () => {
    const { host, messages, messageListeners, frames } =
      createInstrumentedPanelTopologyHarness();
    const client = new host.LightstreamerClient();
    const subscription = new host.Subscription(
      "COMMAND",
      ["orders"],
      ["command", "key", "value"]
    );
    client.subscribe(subscription);
    subscription.addListener({ onItemUpdate: () => undefined });
    const installed = subscription.listeners[0];
    installed?.onItemUpdate?.(commandItemUpdate("ADD", "hydrated-key"));

    for (const listener of messageListeners) {
      listener({
        source: host,
        data: { type: PAGE_CAPTURE_SYNC_REQUEST }
      } as unknown as MessageEvent);
    }
    for (const frame of frames) panel.applyTopologySyncFrame(frame);
    const cursor = messages.length;

    installed?.onItemUpdate?.(commandItemUpdate("UPDATE", "hydrated-key"));
    installed?.onItemUpdate?.(commandItemUpdate("DELETE", "hydrated-key"));
    installed?.onItemUpdate?.(commandItemUpdate("ADD", "hydrated-key"));
    for (const message of messages.slice(cursor)) {
      panel.appendCaptureMessage(message);
      panel.appendCaptureMessage(message);
    }
    await flushPanel();
    clickView("Topology");

    const subscriptionId = captureEntityId(
      messages,
      "subscription-started",
      "subscription"
    );
    clickNode(subscriptionId);
    const detail = text(".topology-detail-pane");
    expect(detail).toContain("COMMAND generations1");
    expect(detail).toContain(":hydrated-key:2");
    expect(detail).not.toContain(":hydrated-key:3");
  });

  it("continues an authoritative COMMAND epoch across a checkpoint taken in the deleted gap", async () => {
    const { host, messages, messageListeners, frames } =
      createInstrumentedPanelTopologyHarness();
    const client = new host.LightstreamerClient();
    const subscription = new host.Subscription(
      "COMMAND",
      ["orders"],
      ["command", "key", "value"]
    );
    client.subscribe(subscription);
    subscription.addListener({ onItemUpdate: () => undefined });
    const installed = subscription.listeners[0];
    installed?.onItemUpdate?.(commandItemUpdate("ADD", "gap-key"));
    installed?.onItemUpdate?.(commandItemUpdate("DELETE", "gap-key"));

    requestInstrumentedCheckpoint(host, messageListeners, frames);
    expect(
      frames.flatMap((frame) =>
        frame.type === TOPOLOGY_SYNC_CHUNK
          ? frame.records.filter(({ kind }) => kind === "command-generation")
          : []
      )
    ).toHaveLength(0);
    for (const frame of frames) panel.applyTopologySyncFrame(frame);
    const cursor = messages.length;

    installed?.onItemUpdate?.(commandItemUpdate("ADD", "gap-key"));
    const nextAdd = messages.slice(cursor).find(
      ({ topology }) => topology?.kind === "command-key-generation"
    );
    expect(nextAdd?.topology?.values).toMatchObject({
      generationEpoch: { state: "real", value: 2 },
      generationId: {
        state: "real",
        value: expect.stringContaining(":gap-key:2")
      }
    });
    for (const message of messages.slice(cursor)) {
      panel.appendCaptureMessage(message);
      panel.appendCaptureMessage(message);
    }
    await flushPanel();
    clickView("Topology");

    const subscriptionId = captureEntityId(
      messages,
      "subscription-started",
      "subscription"
    );
    clickNode(subscriptionId);
    const detail = text(".topology-detail-pane");
    expect(detail).toContain("COMMAND generations1");
    expect(detail).toContain(":gap-key:2");
  });

  it("continues an authoritative establishment epoch across a checkpoint taken after disconnect and unsubscribe", async () => {
    const { host, messages, messageListeners, frames } =
      createInstrumentedPanelTopologyHarness();
    const client = new host.LightstreamerClient();
    client.addListener({ onStatusChange: () => undefined });
    const subscription = new host.Subscription("MERGE", ["prices"], ["last"]);
    client.subscribe(subscription);
    subscription.addListener({ onSubscription: () => undefined });
    const installed = subscription.listeners[0];
    installed?.onSubscription?.();
    client.status = "DISCONNECTED";
    client.sessionId = null;
    client.listeners[0]?.onStatusChange?.("DISCONNECTED");
    client.unsubscribe(subscription);

    requestInstrumentedCheckpoint(host, messageListeners, frames);
    expect(
      frames.flatMap((frame) =>
        frame.type === TOPOLOGY_SYNC_CHUNK
          ? frame.records.filter(({ kind }) => kind === "establishment")
          : []
      )
    ).toHaveLength(0);
    for (const frame of frames) panel.applyTopologySyncFrame(frame);
    const cursor = messages.length;

    client.status = "CONNECTED:WS-STREAMING";
    client.sessionId = "resubscribed-session";
    client.listeners[0]?.onStatusChange?.("CONNECTED:WS-STREAMING");
    client.subscribe(subscription);
    installed?.onSubscription?.();
    const reestablished = messages.slice(cursor).find(
      ({ topology }) => topology?.kind === "subscription-established"
    );
    expect(reestablished?.topology?.values).toMatchObject({
      establishmentEpoch: { state: "real", value: 2 },
      establishmentId: {
        state: "real",
        value: expect.stringContaining(":2")
      }
    });
    for (const message of messages.slice(cursor)) {
      panel.appendCaptureMessage(message);
      panel.appendCaptureMessage(message);
    }
    await flushPanel();
    clickView("Topology");

    const subscriptionId = captureEntityId(
      messages,
      "subscription-started",
      "subscription"
    );
    clickNode(subscriptionId);
    const detail = text(".topology-detail-pane");
    expect(detail).toContain("Establishment epochs1");
    expect(detail).toContain(`establishment:${subscriptionId}:2`);
  });

  it("renders connection intervals and valueless semantic states explicitly", () => {
    const sync = topologyCheckpoint(
      "page-a",
      "semantic-values",
      "semantic-value-sub",
      10
    );
    const records = (
      sync.chunk as Extract<TopologySyncFrame, { records: unknown }>
    ).records;
    const client = records.find((record) => record.kind === "client");
    if (!client) throw new Error("missing client fixture");
    client.values = {
      client: {
        id: "checkpoint-client",
        status: { state: "real", value: "CONNECTED:WS-STREAMING" },
        sessionId: { state: "real", value: "checkpoint-session" },
        reverseHeartbeatInterval: { state: "requested", value: 1_000 },
        pollingInterval: { state: "requested", value: 2_000 },
        idleTimeout: { state: "requested", value: 3_000 },
        retryDelay: { state: "unknown", reason: "getter-missing" },
        realMaxBandwidth: { state: "unavailable" },
        forcedTransport: { state: "not-applicable" },
        clientIp: { state: "redacted", context: "masked-client-ip" }
      }
    };
    panel.applyTopologySyncFrame(sync.begin);
    panel.applyTopologySyncFrame(sync.chunk);
    panel.applyTopologySyncFrame(sync.complete);
    clickView("Topology");

    clickNode("checkpoint-client");
    const clientDetail = text(".topology-detail-pane");
    expect(clientDetail).toContain("Reverse heartbeat interval1 s");
    expect(clientDetail).toContain("Polling interval2 s");
    expect(clientDetail).toContain("Idle timeout3 s");
    expect(clientDetail).toContain("Retry delayUnknown");
    expect(clientDetail).toContain("Real max bandwidthUnavailable");
    expect(clientDetail).toContain("Forced transportNot applicable");

    clickNode("Session checkpoint-session");
    expect(text(".topology-detail-pane")).toContain("Client IPRedacted");
    expect(text(".topology-detail-pane")).toContain(
      "IP disclosureRedacted at capture boundary · exact unavailable"
    );
    expect(text(".topology-detail-pane")).not.toContain("—");
  });

  it("renders subscription value provenance and does not claim full coverage when getters are partial", () => {
    const payload: CapturePayload = {
      client: {
        id: "semantic-sub-client",
        status: "CONNECTED:WS-STREAMING",
        sessionId: "semantic-sub-session",
        instrumentationSource: "public-api",
        coverageStatus: "full"
      },
      subscription: {
        id: "semantic-subscription",
        mode: "MERGE",
        requestedSnapshot: "yes",
        realMaxFrequency: 12,
        active: true,
        subscribed: true,
        semanticValueStates: {
          mode: { state: "requested" },
          dataAdapter: { state: "unknown", reason: "getter-missing" },
          selector: { state: "unavailable" },
          requestedSnapshot: { state: "requested" },
          realMaxFrequency: { state: "real" }
        }
      }
    };
    const topology: TopologyObservation = {
      version: TOPOLOGY_OBSERVATION_VERSION,
      kind: "subscription-started",
      pageEpoch: "semantic-sub-page",
      captureSequence: 1,
      provenance: { instrumentationSource: "official-public-api" },
      coverage: {
        status: "partial",
        getters: { getDataAdapter: "missing" },
        reason: "getter-missing"
      },
      client: payload.client as TopologyObservation["client"],
      subscription: payload.subscription as TopologyObservation["subscription"]
    };
    panel.appendCaptureMessage(
      createCaptureMessage("subscription-started", payload, 1, topology)
    );
    clickView("Topology");

    clickNode("semantic-sub-client");
    expect(text(".topology-detail-pane")).toContain("Partial semantic coverage");
    expect(text(".topology-detail-pane")).not.toContain("Full API coverage");

    clickNode("semantic-subscription");
    const subscriptionDetail = text(".topology-detail-pane");
    expect(subscriptionDetail).toContain("ModeMERGE · Requested");
    expect(subscriptionDetail).toContain("Data AdapterUnknown");
    expect(subscriptionDetail).toContain("SelectorUnavailable");
    expect(subscriptionDetail).toContain("Snapshotyes · Requested");
    expect(subscriptionDetail).toContain("Real max frequency12 updates/s · Real");
  });

  it("hydrates exact aggregate update and loss counters without replaying fake updates", () => {
    const sync = topologyCheckpoint(
      "page-a",
      "aggregate-counts",
      "aggregate-sub",
      10,
      false,
      50
    );
    panel.applyTopologySyncFrame(sync.begin);
    panel.applyTopologySyncFrame(sync.chunk);
    panel.applyTopologySyncFrame(sync.complete);
    clickView("Topology");
    clickNode("aggregate-sub");

    expect(text(".topology-detail-pane")).toContain("Logical real updates50");
    expect(text(".topology-detail-pane")).toContain("Lost updates3");

    panel.appendCaptureMessage(
      semanticCapture(
        "item-update",
        {
          client: {
            id: "checkpoint-client",
            status: "CONNECTED:WS-STREAMING",
            sessionId: "checkpoint-session"
          },
          subscription: { id: "aggregate-sub", mode: "MERGE" },
          item: { name: "checkpoint-item", position: 1 },
          update: {
            isSnapshot: false,
            fields: { value: "next" },
            changedFields: { value: "next" }
          },
          raw: { logicalEventId: "post-checkpoint-update" }
        },
        "page-a",
        11
      )
    );
    expect(text(".topology-detail-pane")).toContain("Logical real updates51");
  });

  it("hydrates item snapshot, loss, and clear evidence without fabricating updates", () => {
    const sync = itemEvidenceCheckpoint();
    panel.applyTopologySyncFrame(sync.begin);
    panel.applyTopologySyncFrame(sync.chunk);
    panel.applyTopologySyncFrame(sync.complete);
    clickView("Topology");

    clickNode("loss-item");
    expect(text(".topology-detail-pane")).toContain("Logical real updates0");
    expect(text(".topology-detail-pane")).toContain("Lost updates5");
    clickNode("clear-item");
    expect(text(".topology-detail-pane")).toContain("Snapshot phasecleared");
    clickNode("snapshot-item");
    expect(text(".topology-detail-pane")).toContain(
      "Snapshot phasesnapshot-complete"
    );
  });

  it("keeps frozen session history when the current page resynchronizes", async () => {
    panel.appendCaptureMessage(
      semanticCapture(
        "subscription-started",
        topologyPayload("history-sub"),
        "page-a",
        1
      )
    );
    panel.appendCaptureMessage(
      semanticCapture(
        "client-status",
        {
          client: {
            id: "semantic-client",
            status: "CONNECTED:WS-STREAMING",
            sessionId: "semantic-session-b"
          }
        },
        "page-a",
        2
      )
    );
    await flushPanel();
    clickView("Topology");
    expect(text(".topology-tree-pane")).toContain(
      "Historical session semantic-session"
    );

    const sync = topologyCheckpoint("page-a", "history-resync", "current-sub", 10);
    panel.applyTopologySyncFrame(sync.begin);
    panel.applyTopologySyncFrame(sync.chunk);
    panel.applyTopologySyncFrame(sync.complete);

    expect(text(".topology-tree-pane")).toContain("current-sub");
    expect(text(".topology-tree-pane")).toContain(
      "Historical session semantic-session"
    );

    panel.appendCaptureMessage(
      semanticCapture(
        "subscription-started",
        topologyPayload("next-page-sub", "next-page-client", "next-page-session"),
        "page-b",
        1
      )
    );
    await flushPanel();
    expect(text(".topology-tree-pane")).toContain("next-page-sub");
    expect(text(".topology-tree-pane")).toContain(
      "Historical session semantic-session"
    );
  });

  it("flags duplicate active subscription configurations", async () => {
    appendTopologyFixture(panel);
    append(panel, "subscription-started", {
      client: {
        id: "client-1",
        status: "CONNECTED:WS-STREAMING",
        sessionId: "session-A"
      },
      subscription: {
        id: "subscription-2",
        mode: "COMMAND",
        items: ["portfolio"],
        fields: ["command", "key", "price"],
        dataAdapter: "QUOTE",
        selector: "desk-a",
        active: true,
        subscribed: true
      },
      raw: { callback: "onSubscription" }
    });
    await flushPanel();
    clickView("Topology");

    expect(text(".topology-tree-pane")).toContain("overlap ×2");
    clickNode("subscription-2");
    expect(text(".topology-detail-pane")).toContain("2 active subscriptions");
  });

  it("keeps the selected topology node through passive updates and resets on clear", async () => {
    appendTopologyFixture(panel);
    await flushPanel();
    clickView("Topology");
    clickNode("subscription-1");

    append(panel, "item-update", {
      client: { id: "client-1", sessionId: "session-A" },
      subscription: { id: "subscription-1", mode: "COMMAND" },
      item: { name: "portfolio", position: 1 },
      update: {
        isSnapshot: false,
        fields: { command: "UPDATE", key: "alpha", price: "12" },
        changedFields: { price: "12" }
      }
    });
    await flushPanel();

    expect(
      document.querySelector<HTMLButtonElement>(
        '.topology-node[data-selected="true"]'
      )?.textContent
    ).toContain("subscription-1");
    expect(text(".topology-detail-pane")).toContain("3");

    panel.clearEvents();
    await flushPanel();
    expect(text(".topology-detail-heading")).toBe("Inspected page topology");
    expect(text(".topology-overview")).toContain("Awaiting capture");
  });

  it("resets current topology without clearing events, COMMAND state, drafts, or live targets", async () => {
    panel.setBridge({
      reinjectDraft: async () => ({
        requestId: "topology-reset-target",
        ok: true,
        status: "success",
        timestamp: Date.now()
      })
    });
    appendTopologyFixture(panel);
    await flushPanel();

    const sourceUpdate = document.querySelector<HTMLButtonElement>(
      '.event-row[data-kind="item-update"][data-command="UPDATE"]'
    );
    sourceUpdate?.click();
    document.querySelector<HTMLButtonElement>(".mutate-inject-button")?.click();
    expect(text(".replay-target-status")).toContain("live Subscription");
    expect(document.querySelector(".draft-controls")).not.toBeNull();
    const retainedBeforeReset = text(".event-count");

    clickView("Topology");
    document.querySelector<HTMLButtonElement>(".topology-reset-current")?.click();
    expect(text(".event-count")).toBe(retainedBeforeReset);
    clickNode("subscription-1");
    expect(text(".topology-detail-pane")).toContain("Logical real updates0");

    clickView("COMMAND State");
    expect(text(".command-workspace")).toContain("alpha");

    clickView("Timeline");
    expect(document.querySelector(".draft-controls")).not.toBeNull();
    expect(text(".replay-target-status")).toContain("live Subscription");
    expect(
      document.querySelector<HTMLButtonElement>(".inject-edited-button")?.disabled
    ).toBe(false);
  });

  it("keeps historical topology read-only and clears it independently from timeline events", async () => {
    appendTopologyFixture(panel);
    append(panel, "client-status", {
      client: {
        id: "client-1",
        status: "CONNECTED:WS-STREAMING",
        sessionId: "session-B"
      }
    });
    await flushPanel();
    const retainedBeforeClear = text(".event-count");
    clickView("Topology");

    const historicalSession = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".topology-node")
    ).find((candidate) =>
      (candidate.textContent ?? "").includes("Historical session session-A")
    );
    const historicalItem = Array.from(
      historicalSession?.closest("li")?.querySelectorAll<HTMLButtonElement>(
        ".topology-node"
      ) ?? []
    ).find((candidate) => (candidate.textContent ?? "").includes("portfolio"));
    historicalItem?.click();
    expect(text(".topology-detail-pane")).toContain(
      "Historical topology is read-only"
    );
    document
      .querySelector<HTMLButtonElement>(".topology-view-matching-events")
      ?.click();
    expect(
      document.querySelector<HTMLButtonElement>(
        '.view-selector button[data-active="true"]'
      )?.textContent
    ).toBe("Timeline");
    expect(document.querySelectorAll(".event-row").length).toBeGreaterThan(0);
    expect(
      document.querySelector<HTMLButtonElement>(".timeline-filter-clear")?.hidden
    ).toBe(false);
    document
      .querySelector<HTMLButtonElement>(".timeline-filter-clear")
      ?.click();
    expect(
      document.querySelector<HTMLButtonElement>(".timeline-filter-clear")?.hidden
    ).toBe(true);

    clickView("Topology");
    document.querySelector<HTMLButtonElement>(".topology-clear-history")?.click();
    expect(text(".event-count")).toBe(retainedBeforeClear);
    expect(text(".topology-tree-pane")).not.toContain("Historical session");
  });

  it("labels in-progress snapshots precisely and frozen history as non-live", async () => {
    append(panel, "client-status", {
      client: {
        id: "client-1",
        status: "CONNECTED:WS-STREAMING",
        sessionId: "session-A",
        transport: "ws-streaming"
      }
    });
    append(panel, "subscription-started", {
      client: { id: "client-1", sessionId: "session-A" },
      subscription: {
        id: "subscription-1",
        mode: "COMMAND",
        items: ["portfolio"],
        fields: ["command", "key", "price"],
        requestedSnapshot: "yes",
        active: true,
        subscribed: true
      },
      raw: { callback: "onSubscription" }
    });
    append(panel, "item-update", {
      client: { id: "client-1", sessionId: "session-A" },
      subscription: { id: "subscription-1", mode: "COMMAND" },
      item: { name: "portfolio", position: 1 },
      update: {
        isSnapshot: true,
        fields: { command: "ADD", key: "alpha", price: "10" },
        changedFields: { command: "ADD", key: "alpha", price: "10" }
      },
      raw: {
        callback: "onItemUpdate",
        logicalEventId: "snapshot-in-progress"
      }
    });
    await flushPanel();
    clickView("Topology");

    const currentItem = findNode("portfolio");
    expect(
      currentItem?.querySelector(".topology-node-status")?.textContent
    ).toBe("snapshot");

    append(panel, "client-status", {
      client: {
        id: "client-1",
        status: "CONNECTED:WS-STREAMING",
        sessionId: "session-B",
        transport: "ws-streaming"
      }
    });
    await flushPanel();

    const historicalSession = findNode("Historical session session-A");
    const historicalBranch = historicalSession?.closest("li");
    const historicalSubscription = Array.from(
      historicalBranch?.querySelectorAll<HTMLButtonElement>(".topology-node") ??
        []
    ).find((candidate) =>
      (candidate.textContent ?? "").includes("subscription-1")
    );
    const historicalItem = Array.from(
      historicalBranch?.querySelectorAll<HTMLButtonElement>(".topology-node") ??
        []
    ).find((candidate) => (candidate.textContent ?? "").includes("portfolio"));

    expect(
      historicalSession?.querySelector(".topology-node-status")?.textContent
    ).toBe("frozen");
    expect(
      historicalSession?.querySelector(".topology-node-meta")?.textContent
    ).toContain("last transport: ws-streaming");
    expect(
      historicalSubscription?.querySelector(".topology-node-status")?.textContent
    ).toBe("frozen");
    expect(
      historicalItem?.querySelector(".topology-node-status")?.textContent
    ).toBe("frozen");

    historicalItem?.click();
    expect(text(".topology-detail-status")).toBe("frozen");
    expect(text(".topology-detail-pane")).toContain(
      "Frozen record only. The Workbench does not maintain or reconnect this session."
    );
  });

  it("collapses and restores each non-leaf topology branch without losing the choice on updates", async () => {
    appendTopologyFixture(panel);
    await flushPanel();
    clickView("Topology");

    const pageItem = findNode("Inspected page")?.closest<HTMLLIElement>(
      ".topology-tree-item"
    );
    const clientItem = findNode("client-1")?.closest<HTMLLIElement>(
      ".topology-tree-item"
    );
    const sessionItem = findNode("Session session-A")?.closest<HTMLLIElement>(
      ".topology-tree-item"
    );
    const subscriptionItem = findNode(
      "subscription-1"
    )?.closest<HTMLLIElement>(".topology-tree-item");
    const itemItem = findNode("portfolio")?.closest<HTMLLIElement>(
      ".topology-tree-item"
    );
    for (const branch of [
      pageItem,
      clientItem,
      sessionItem,
      subscriptionItem,
      itemItem
    ]) {
      const toggle =
        branch?.querySelector<HTMLButtonElement>(
          ":scope > .topology-node-row > .topology-collapse-toggle"
        ) ?? null;
      const children =
        branch?.querySelector<HTMLUListElement>(
          ":scope > .topology-tree-group"
        ) ?? null;
      expect(toggle?.getAttribute("aria-expanded")).toBe("true");
      expect(children).not.toBeNull();
      toggle?.click();
      expect(toggle?.getAttribute("aria-expanded")).toBe("false");
      expect(children?.hidden).toBe(true);
      toggle?.click();
      expect(toggle?.getAttribute("aria-expanded")).toBe("true");
      expect(children?.hidden).toBe(false);
    }

    const clientToggle =
      clientItem?.querySelector<HTMLButtonElement>(
        ":scope > .topology-node-row > .topology-collapse-toggle"
      ) ?? null;
    const clientChildren =
      clientItem?.querySelector<HTMLUListElement>(
        ":scope > .topology-tree-group"
      ) ?? null;

    expect(clientToggle?.getAttribute("aria-expanded")).toBe("true");

    clientToggle?.click();
    expect(clientToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(clientChildren?.hidden).toBe(true);

    append(panel, "item-update", {
      client: { id: "client-1", sessionId: "session-A" },
      subscription: { id: "subscription-1", mode: "COMMAND" },
      item: { name: "portfolio", position: 1 },
      update: {
        isSnapshot: false,
        fields: { command: "UPDATE", key: "alpha", price: "12" },
        changedFields: { price: "12" }
      }
    });
    await flushPanel();

    expect(clientToggle?.getAttribute("aria-expanded")).toBe("false");
    expect(clientChildren?.hidden).toBe(true);

    clientToggle?.click();
    expect(clientToggle?.getAttribute("aria-expanded")).toBe("true");
    expect(clientChildren?.hidden).toBe(false);
  });

  it("collapses and expands every Topology branch from the overview action", async () => {
    appendTopologyFixture(panel);
    await flushPanel();
    clickView("Topology");

    const action = (): HTMLButtonElement | null =>
      document.querySelector<HTMLButtonElement>(".topology-expand-items");
    const pageChildren = (): HTMLUListElement | null | undefined =>
      findNode("Inspected page")
        ?.closest<HTMLLIElement>(".topology-tree-item")
        ?.querySelector<HTMLUListElement>(":scope > .topology-tree-group");
    if (!action() || !pageChildren()) {
      throw new Error("missing Topology expand/collapse controls");
    }

    expect(action()?.textContent).toBe("Collapse all");
    action()?.click();

    expect(action()?.textContent).toBe("Expand all");
    expect(pageChildren()?.hidden).toBe(true);
    expect(findNode("Inspected page")?.getAttribute("aria-expanded")).toBe(
      "false"
    );

    action()?.click();

    expect(action()?.textContent).toBe("Collapse all");
    expect(
      Array.from(
        document.querySelectorAll<HTMLUListElement>(".topology-tree-group")
      ).every((group) => !group.hidden)
    ).toBe(true);
    expect(text(".topology-tree-pane")).toContain("portfolio");
    expect(text(".topology-tree-pane")).toContain("listener-1");
  });

  it("disables stale replay targets but permits a registered listener across sessions", async () => {
    panel.setBridge({
      reinjectDraft: async () => ({
        requestId: "topology-target-lifecycle",
        ok: true,
        status: "success",
        timestamp: Date.now()
      })
    });
    appendTopologyFixture(panel);
    append(panel, "listener-removed", {
      client: { id: "client-1", sessionId: "session-A" },
      subscription: { id: "subscription-1", mode: "COMMAND" },
      listener: { id: "listener-1", callbacks: ["onItemUpdate"] },
      raw: { targetAvailable: false }
    });
    await flushPanel();

    document
      .querySelector<HTMLButtonElement>(
        '.event-row[data-kind="item-update"][data-command="UPDATE"]'
      )
      ?.click();
    expect(text(".replay-target-status")).toContain("stale Subscription");
    expect(
      document.querySelector<HTMLButtonElement>(".reinject-button")?.disabled
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>(".mutate-inject-button")?.disabled
    ).toBe(true);

    append(panel, "client-status", {
      client: {
        id: "client-1",
        status: "CONNECTED:WS-STREAMING",
        sessionId: "session-B"
      }
    });
    append(panel, "listener-added", {
      client: { id: "client-1", sessionId: "session-B" },
      subscription: { id: "subscription-1", mode: "COMMAND" },
      listener: {
        id: "listener-1",
        callbacks: ["onItemUpdate"],
        registrationCount: 2
      },
      raw: { targetAvailable: true }
    });
    await flushPanel();
    document
      .querySelector<HTMLButtonElement>(
        '.event-row[data-kind="item-update"][data-command="UPDATE"]'
      )
      ?.click();

    expect(text(".replay-target-status")).toContain("differs from source");
    expect(
      document.querySelector<HTMLButtonElement>(".reinject-button")?.disabled
    ).toBe(false);
    expect(
      document.querySelector<HTMLButtonElement>(".mutate-inject-button")?.disabled
    ).toBe(false);
  });

  it("binds wire replay to the captured connection and session epoch", async () => {
    panel.setBridge({
      reinjectDraft: async () => ({
        requestId: "wire-target-epoch",
        ok: true,
        status: "success",
        timestamp: Date.now()
      })
    });
    append(panel, "item-update", {
      client: {
        id: "wire-client-1",
        status: "CONNECTED:WS-STREAMING",
        sessionId: "wire-session-A"
      },
      subscription: {
        id: "wire-subscription-1",
        mode: "COMMAND",
        fields: ["command", "key", "value"]
      },
      item: { name: "portfolio", position: 1 },
      update: {
        isSnapshot: false,
        fields: { command: "UPDATE", key: "alpha", value: "10" },
        changedFields: { value: "10" }
      },
      raw: {
        captureSource: "websocket-tlcp",
        frameTag: "U",
        rawSubId: "1"
      }
    });
    await flushPanel();
    document.querySelector<HTMLButtonElement>(".event-row")?.click();
    expect(text(".replay-target-status")).toContain(
      "live captured page stream"
    );

    append(panel, "client-status", {
      client: {
        id: "wire-client-1",
        status: "DISCONNECTED:TRYING-RECOVERY",
        sessionId: "wire-session-A"
      },
      raw: {
        captureSource: "websocket-tlcp"
      }
    });
    await flushPanel();
    document.querySelector<HTMLButtonElement>(".event-row")?.click();

    expect(text(".replay-target-status")).toContain(
      "connection epoch changed"
    );
    expect(
      document.querySelector<HTMLButtonElement>(".reinject-button")?.disabled
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>(".mutate-inject-button")?.disabled
    ).toBe(true);

    append(panel, "client-status", {
      client: {
        id: "wire-client-1",
        status: "CONNECTED:WS-STREAMING",
        sessionId: "wire-session-B"
      },
      raw: {
        captureSource: "websocket-tlcp",
        frameTag: "CONOK"
      }
    });
    await flushPanel();
    document.querySelector<HTMLButtonElement>(".event-row")?.click();

    expect(text(".replay-target-status")).toContain("session changed");
    expect(
      document.querySelector<HTMLButtonElement>(".reinject-button")?.disabled
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>(".mutate-inject-button")?.disabled
    ).toBe(true);
  });

  it("summarizes 1,000 COMMAND generations behind bounded, copyable evidence", async () => {
    const sync = topologyCheckpoint(
      "generation-page",
      "generation-volume",
      "generation-subscription",
      2_000
    );
    const records = (
      sync.chunk as Extract<TopologySyncFrame, { records: unknown }>
    ).records as TopologyAbsoluteRecord[];
    const subscriptionRecord = records.find(({ kind }) => kind === "subscription");
    const subscriptionValues = subscriptionRecord?.values;
    const subscriptionValue = subscriptionValues?.subscription;
    if (!subscriptionValues || !subscriptionValue || typeof subscriptionValue !== "object") {
      throw new Error("missing subscription fixture");
    }
    subscriptionValues.subscription = {
      ...subscriptionValue,
      mode: "COMMAND",
      fields: ["command", "key", "value"]
    };
    for (let index = 1; index <= 1_000; index += 1) {
      records.push({
        kind: "command-generation",
        id: `generation-${index}`,
        parentId: "generation-subscription",
        subscriptionId: "generation-subscription",
        pageEpoch: "generation-page",
        captureSequence: 10 + index,
        values: {
          itemId: "item-1",
          key: `key-${index}`,
          command: index % 2 === 0 ? "UPDATE" : "ADD"
        }
      });
    }
    for (const frame of [sync.begin, sync.chunk, sync.complete]) {
      frame.recordCount = records.length;
    }
    panel.applyTopologySyncFrame(sync.begin);
    panel.applyTopologySyncFrame(sync.chunk);
    panel.applyTopologySyncFrame(sync.complete);
    clickView("Topology");
    clickNode("generation-subscription");

    expect(text(".topology-detail-pane")).toContain("COMMAND generations1,000");
    expect(text(".topology-detail-pane")).toContain("key-1000");
    expect(document.querySelectorAll(".topology-command-evidence-entry")).toHaveLength(25);
    expect(text(".topology-command-evidence-summary")).toContain("25 of 1,000 shown");
    expect(text(".topology-tree-pane")).not.toContain("generation-1000");
    expect(document.querySelectorAll(".topology-node").length).toBeLessThan(20);

    const detail = document.querySelector<HTMLElement>(".topology-detail-pane");
    if (!detail) throw new Error("missing topology detail");
    detail.scrollTop = 120;
    document.querySelector<HTMLDetailsElement>(".topology-command-evidence")!.open = true;
    document
      .querySelector<HTMLDetailsElement>(".topology-command-evidence")!
      .dispatchEvent(new Event("toggle"));
    document
      .querySelector<HTMLButtonElement>(".topology-show-more-command-evidence")
      ?.click();
    expect(document.querySelectorAll(".topology-command-evidence-entry")).toHaveLength(50);
    expect(detail.scrollTop).toBe(120);
    expect(
      findNode("generation-subscription")?.dataset.selected
    ).toBe("true");

    const writes: string[] = [];
    const writeText = vi.fn(async (value: string) => {
      writes.push(value);
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    document.querySelector<HTMLButtonElement>(".topology-copy-command-evidence")?.click();
    await Promise.resolve();
    expect(JSON.parse(writes[0] ?? "[]")).toHaveLength(1_000);

    document.querySelector<HTMLButtonElement>(".topology-open-command-state")?.click();
    expect(
      document.querySelector<HTMLButtonElement>('.view-selector button[data-active="true"]')
        ?.textContent
    ).toBe("COMMAND State");
  });

  it("offers direct unredacted downloads with opt-in redaction under Advanced options", async () => {
    appendTopologyFixture(panel);
    await flushPanel();
    clickView("Topology");
    const menu = document.querySelector<HTMLDetailsElement>(".topology-export-menu");
    if (!menu) throw new Error("missing Topology export menu");
    menu.open = true;
    const advanced = document.querySelector<HTMLDetailsElement>(
      ".topology-export-advanced"
    );
    const categoryCheckboxes = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        ".topology-export-categories input[data-category]"
      )
    );

    expect(text(".topology-export-panel")).toContain("No redaction is applied by default");
    expect(document.querySelector(".topology-export-preview")).toBeNull();
    expect(document.querySelector(".topology-export-preview-content")).toBeNull();
    expect(document.querySelector<HTMLButtonElement>(".topology-export-json")?.disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>(".topology-export-html")?.disabled).toBe(false);
    expect(advanced?.open).toBe(false);
    expect(advanced?.contains(document.querySelector(".topology-export-categories"))).toBe(true);
    expect(categoryCheckboxes).toHaveLength(6);
    expect(categoryCheckboxes.every((checkbox) => !checkbox.checked)).toBe(true);
  });

  it("applies selected Advanced redactions to the next direct download", async () => {
    appendTopologyFixture(panel);
    await flushPanel();
    clickView("Topology");

    const identifierRedaction = document.querySelector<HTMLInputElement>(
      '.topology-export-categories input[data-category="identifiers"]'
    );
    if (!identifierRedaction) throw new Error("missing identifier redaction option");
    identifierRedaction.checked = true;
    identifierRedaction.dispatchEvent(new Event("change"));
    expect(text(".topology-export-advanced-toggle")).toBe(
      "Advanced options · 1 redaction selected"
    );

    const objectUrls = new Map<string, Blob>();
    let downloaded: Blob | null = null;
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      objectUrls.set("blob:redacted-export", blob);
      return "blob:redacted-export";
    });
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = function clickDownload(): void {
      downloaded = objectUrls.get(this.href) ?? null;
    };

    try {
      document.querySelector<HTMLButtonElement>(".topology-export-json")?.click();
      const content = downloaded ? await readBlobText(downloaded) : "";
      const snapshot = JSON.parse(content || "{}") as {
        privacy?: { redactedCategories?: string[] };
      };
      expect({
        redactedCategories: snapshot.privacy?.redactedCategories,
        containsIdentifier: content.includes("client-1"),
        containsIdentifierMarker: content.includes("[REDACTED:identifiers]"),
        containsUnselectedItemName: content.includes("portfolio")
      }).toEqual({
        redactedCategories: ["identifiers"],
        containsIdentifier: false,
        containsIdentifierMarker: true,
        containsUnselectedItemName: true
      });
    } finally {
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
      HTMLAnchorElement.prototype.click = originalAnchorClick;
    }
  });

  it("keeps the Topology export controls reachable in a compact panel", async () => {
    appendTopologyFixture(panel);
    await flushPanel();
    clickView("Topology");

    const menu = document.querySelector<HTMLDetailsElement>(".topology-export-menu");
    const toggle = document.querySelector<HTMLElement>(".topology-export-toggle");
    const exportPanel = document.querySelector<HTMLElement>(".topology-export-panel");
    if (!menu || !toggle || !exportPanel) {
      throw new Error("missing Topology export controls");
    }

    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 563 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 137 });
    const toggleRect = vi
      .spyOn(toggle, "getBoundingClientRect")
      .mockReturnValue(rect(514, 47, 41, 24));
    const panelRect = vi
      .spyOn(exportPanel, "getBoundingClientRect")
      .mockImplementation(() => {
        const left = Number.parseFloat(exportPanel.style.left);
        const top = Number.parseFloat(exportPanel.style.top);
        return exportPanel.style.position === "fixed" && Number.isFinite(left) && Number.isFinite(top)
          ? rect(left, top, 539, 104)
          : rect(16, 77, 539, 104);
      });

    try {
      menu.open = true;
      menu.dispatchEvent(new Event("toggle"));
      const bounds = exportPanel.getBoundingClientRect();
      const downloads = exportPanel.querySelectorAll(
        ".topology-export-json, .topology-export-html"
      );

      expect({
        open: menu.open,
        leftInsideViewport: bounds.left >= 8,
        rightInsideViewport: bounds.right <= window.innerWidth - 8,
        topInsideViewport: bounds.top >= 8,
        bottomInsideViewport: bounds.bottom <= window.innerHeight - 8,
        downloadControlsReachable: downloads.length === 2
      }).toEqual({
        open: true,
        leftInsideViewport: true,
        rightInsideViewport: true,
        topInsideViewport: true,
        bottomInsideViewport: true,
        downloadControlsReachable: true
      });
    } finally {
      toggleRect.mockRestore();
      panelRect.mockRestore();
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight
      });
    }
  });

  it("downloads unredacted JSON and HTML directly while always excluding credentials", async () => {
    appendTopologyFixture(panel);
    append(panel, "client-status", {
      client: {
        id: "client-1",
        status: "CONNECTED:WS-STREAMING",
        sessionId: "session-A",
        serverAddress:
          "https://user:password@push.example.test/lightstreamer?token=secret-token"
      }
    });
    await flushPanel();
    clickView("Topology");

    const objectUrls = new Map<string, Blob>();
    const downloads: Array<{ filename: string; blob: Blob }> = [];
    let nextObjectUrl = 1;
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      const url = `blob:test-${nextObjectUrl++}`;
      objectUrls.set(url, blob);
      return url;
    });
    URL.revokeObjectURL = vi.fn((url: string) => {
      objectUrls.delete(url);
    });
    HTMLAnchorElement.prototype.click = function clickDownload(): void {
      if (!this.isConnected) return;
      const filename = this.download;
      const url = this.href;
      queueMicrotask(() => {
        const blob = objectUrls.get(url);
        if (blob) downloads.push({ filename, blob });
      });
    };

    try {
      document.querySelector<HTMLButtonElement>(".topology-export-json")?.click();
      document.querySelector<HTMLButtonElement>(".topology-export-html")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const jsonDownload = downloads[0];
      const htmlDownload = downloads[1];
      const jsonContent = jsonDownload ? await readBlobText(jsonDownload.blob) : "";
      const htmlContent = htmlDownload ? await readBlobText(htmlDownload.blob) : "";
      const snapshot = JSON.parse(jsonContent || "{}") as {
        generatedAt: string;
        privacy: {
          redactedCategories: string[];
          completeEvidenceIncluded: boolean;
          credentialsExcluded: boolean;
        };
        schema: { id: string };
      };
      expect({
        json: jsonDownload
          ? {
              contextualFilename: /^lightstreamer-topology-session-A-\d{8}T\d{9}Z\.json$/.test(
                jsonDownload.filename
              ),
              type: jsonDownload.blob.type,
              containsClientId: jsonContent.includes("client-1"),
              containsItemName: jsonContent.includes("portfolio"),
              containsCredentials:
                jsonContent.includes("user:password") ||
                jsonContent.includes("secret-token")
            }
          : null,
        html: htmlDownload
          ? {
              contextualFilename: /^lightstreamer-topology-session-A-\d{8}T\d{9}Z\.html$/.test(
                htmlDownload.filename
              ),
              type: htmlDownload.blob.type,
              includesSchema: htmlContent.includes(snapshot.schema.id),
              containsClientId: htmlContent.includes("client-1"),
              containsCredentials:
                htmlContent.includes("user:password") ||
                htmlContent.includes("secret-token")
            }
          : null,
        privacy: snapshot.privacy
      }).toEqual({
        json: {
          contextualFilename: true,
          type: "application/json",
          containsClientId: true,
          containsItemName: true,
          containsCredentials: false
        },
        html: {
          contextualFilename: true,
          type: "text/html",
          includesSchema: true,
          containsClientId: true,
          containsCredentials: false
        },
        privacy: {
          redactedCategories: [],
          completeEvidenceIncluded: false,
          credentialsExcluded: true
        }
      });
    } finally {
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
      HTMLAnchorElement.prototype.click = originalAnchorClick;
    }
  });

  it("expands a bounded large tree once and updates it without rebuilding the DOM", async () => {
    const items = Array.from({ length: 1_005 }, (_, index) => `quote-${index + 1}`);
    append(panel, "client-status", {
      client: {
        id: "client-1",
        status: "CONNECTED:WS-STREAMING",
        sessionId: "session-A"
      }
    });
    append(panel, "subscription-started", {
      client: { id: "client-1", sessionId: "session-A" },
      subscription: {
        id: "large-subscription",
        mode: "MERGE",
        items,
        fields: ["price"],
        requestedSnapshot: "no",
        active: true,
        subscribed: true
      },
      raw: { callback: "onSubscription" }
    });
    append(panel, "listener-added", {
      client: { id: "client-1", sessionId: "session-A" },
      subscription: { id: "large-subscription", mode: "MERGE", listenerCount: 1 },
      listener: {
        id: "large-listener",
        callbacks: ["onItemUpdate"],
        registrationCount: 1
      }
    });
    await flushPanel();
    clickView("Topology");

    expect(text(".topology-tree-pane")).not.toContain("quote-1");
    document.querySelector<HTMLButtonElement>(".topology-expand-items")?.click();
    expect(
      document.querySelector(".topology-tree-pane")?.getAttribute("aria-busy")
    ).toBe("true");
    const progressivelyAppendedItem = await waitForTopologyNodeWhileBusy("quote-1");
    expect(progressivelyAppendedItem).toBeDefined();
    expect(
      document.querySelector(".topology-tree-pane")?.getAttribute("aria-busy")
    ).toBe("true");
    progressivelyAppendedItem?.focus();
    expect(pressKey(progressivelyAppendedItem!, "ArrowLeft")).toBe(false);
    expect(document.activeElement).toBe(findNode("large-subscription"));
    await waitForTopologyIdle();
    const firstItem = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".topology-node")
    ).find((candidate) =>
      (candidate.textContent ?? "").includes("quote-1")
    );
    expect(firstItem).toBeDefined();
    expect(
      document.querySelectorAll(".topology-node-kind").length
    ).toBeGreaterThanOrEqual(1_004);
    const itemGroup = firstItem?.closest(".topology-tree-group");
    const lastTreeChild = itemGroup?.lastElementChild;
    const omitted = lastTreeChild?.querySelector<HTMLElement>(
      '[role="treeitem"][aria-disabled="true"]'
    );
    expect(omitted?.textContent).toContain("5 more items omitted");
    expect(omitted?.tabIndex).toBe(-1);
    firstItem?.click();
    expect(findNode("quote-1")).toBe(firstItem);
    expect(text(".topology-detail-pane")).toContain("large-listener");

    append(panel, "item-update", {
      client: { id: "client-1", sessionId: "session-A" },
      subscription: { id: "large-subscription", mode: "MERGE" },
      item: { name: "quote-1", position: 1 },
      update: {
        isSnapshot: false,
        fields: { price: "10" },
        changedFields: { price: "10" }
      },
      raw: {
        callback: "onItemUpdate",
        logicalEventId: "large-update-1"
      }
    });
    await flushPanel();

    const updatedItem = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".topology-node")
    ).find((candidate) =>
      (candidate.textContent ?? "").includes("quote-1")
    );
    expect(updatedItem).toBe(firstItem);
    expect(updatedItem?.textContent).toContain("1 updates");
  });
});

type PanelTopologySubscriptionListener = {
  onSubscription?(): void;
  onItemUpdate?(update: unknown): void;
  onCommandSecondLevelItemLostUpdates?(lostUpdates: number, key: string): void;
  onListenStart?(owner: PanelTopologySubscription): void;
  onListenEnd?(owner: PanelTopologySubscription): void;
};

class PanelTopologyClient {
  status = "CONNECTED:WS-STREAMING";
  sessionId: string | null = "instrumented-session";
  listeners: Array<{ onStatusChange?(status: string): void }> = [];
  readonly connectionDetails = {
    getSessionId: () => this.sessionId
  };

  subscribe(subscription: unknown): void {
    if (subscription instanceof PanelTopologySubscription) {
      subscription.active = true;
    }
  }

  unsubscribe(subscription: unknown): void {
    if (subscription instanceof PanelTopologySubscription) {
      subscription.active = false;
    }
  }

  addListener(listener: { onStatusChange?(status: string): void }): void {
    this.listeners.push(listener);
  }

  getStatus(): string {
    return this.status;
  }
}

class PanelTopologySubscription {
  listeners: PanelTopologySubscriptionListener[] = [];
  active = false;

  constructor(
    readonly mode: string,
    readonly items: string[],
    readonly fields: string[]
  ) {}

  addListener(listener: PanelTopologySubscriptionListener): void {
    if (this.listeners.includes(listener)) return;
    this.listeners.push(listener);
    listener.onListenStart?.(this);
  }

  removeListener(listener: PanelTopologySubscriptionListener): void {
    const index = this.listeners.indexOf(listener);
    if (index < 0) return;
    this.listeners.splice(index, 1);
    listener.onListenEnd?.(this);
  }

  getListeners(): PanelTopologySubscriptionListener[] {
    return [...this.listeners];
  }

  getMode(): string {
    return this.mode;
  }

  getItems(): string[] {
    return this.items;
  }

  getFields(): string[] {
    return this.fields;
  }

  isActive(): boolean {
    return this.active;
  }

  isSubscribed(): boolean {
    return false;
  }
}

function createInstrumentedPanelTopologyHarness() {
  const messages: CaptureMessage[] = [];
  const messageListeners: Array<(event: MessageEvent) => void> = [];
  const frames: TopologySyncFrame[] = [];
  const host = {
    LightstreamerClient: PanelTopologyClient,
    Subscription: PanelTopologySubscription,
    addEventListener(type: "message", listener: (event: MessageEvent) => void) {
      if (type === "message") messageListeners.push(listener);
    },
    postMessage(message: unknown) {
      if (isTopologySyncFrame(message)) frames.push(message);
    }
  };
  installLightstreamerInstrumentation(
    host as unknown as LightstreamerHost,
    (message) => messages.push(message as CaptureMessage)
  );
  return { host, messages, messageListeners, frames };
}

function requestInstrumentedCheckpoint(
  host: object,
  messageListeners: readonly ((event: MessageEvent) => void)[],
  frames: TopologySyncFrame[]
): void {
  frames.length = 0;
  for (const listener of messageListeners) {
    listener({
      source: host,
      data: { type: PAGE_CAPTURE_SYNC_REQUEST }
    } as unknown as MessageEvent);
  }
}

function captureEntityId(
  messages: readonly CaptureMessage[],
  kind: CaptureKind,
  entity: "subscription" | "listener"
): string {
  const id = (
    messages.find(
      (message) =>
        message.kind === kind &&
        (entity !== "listener" || message.payload.subscription !== undefined)
    )?.payload[entity] as
      | { id?: unknown }
      | undefined
  )?.id;
  if (typeof id !== "string") {
    throw new Error(`instrumentation did not emit ${entity} identity`);
  }
  return id;
}

function commandItemUpdate(command: string, key: string) {
  return {
    forEachField(
      iterator: (name: string, position: number, value: string) => void
    ) {
      iterator("command", 1, command);
      iterator("key", 2, key);
      iterator("value", 3, "1");
    },
    forEachChangedField(
      iterator: (name: string, position: number, value: string) => void
    ) {
      this.forEachField(iterator);
    },
    getItemName: () => "orders",
    getItemPos: () => 1,
    isSnapshot: () => false
  };
}

function appendTopologyFixture(panel: PanelController): void {
  append(panel, "client-created", {
    client: {
      id: "client-1",
      status: "DISCONNECTED",
      serverAddress: "https://push.example.test/lightstreamer",
      adapterSet: "DEMO",
      libraryVersion: "9.2.3",
      instrumentationSource: "public-api",
      coverageStatus: "full",
      requestedMaxBandwidth: "unlimited",
      keepaliveInterval: 5_000,
      retryDelay: 4_000,
      stalledTimeout: 2_000,
      reconnectTimeout: 3_000,
      sessionRecoveryTimeout: 15_000
    }
  });
  append(panel, "client-status", {
    client: {
      id: "client-1",
      status: "CONNECTED:WS-STREAMING",
      sessionId: "session-A",
      transport: "ws-streaming",
      serverInstanceAddress: "https://node-a.example.test/lightstreamer",
      serverSocketName: "node-a",
      clientIp: "203.0.113.x",
      realMaxBandwidth: 25
    }
  });
  append(panel, "subscription-started", {
    client: {
      id: "client-1",
      status: "CONNECTED:WS-STREAMING",
      sessionId: "session-A"
    },
    subscription: {
      id: "subscription-1",
      mode: "COMMAND",
      items: ["portfolio"],
      fields: ["command", "key", "price"],
      dataAdapter: "QUOTE",
      selector: "desk-a",
      requestedSnapshot: "yes",
      requestedBufferSize: "10",
      requestedMaxFrequency: "2",
      active: true,
      subscribed: true,
      listenerCount: 1
    },
    raw: { callback: "onSubscription" }
  });
  append(panel, "listener-added", {
    client: { id: "client-1", sessionId: "session-A" },
    subscription: {
      id: "subscription-1",
      mode: "COMMAND",
      listenerCount: 1
    },
    listener: { id: "listener-1" }
  });
  append(panel, "subscription-frequency", {
    client: { id: "client-1", sessionId: "session-A" },
    subscription: {
      id: "subscription-1",
      mode: "COMMAND",
      realMaxFrequency: "1.5",
      active: true,
      subscribed: true
    }
  });
  append(panel, "item-update", {
    client: { id: "client-1", sessionId: "session-A" },
    subscription: { id: "subscription-1", mode: "COMMAND" },
    listener: { id: "listener-1" },
    item: { name: "portfolio", position: 1 },
    update: {
      isSnapshot: true,
      fields: { command: "ADD", key: "alpha", price: "10" },
      changedFields: { command: "ADD", key: "alpha", price: "10" }
    },
    raw: {
      callback: "onItemUpdate",
      logicalEventId: "fixture-update-1",
      targetAvailable: true
    }
  });
  append(panel, "end-of-snapshot", {
    client: { id: "client-1", sessionId: "session-A" },
    subscription: { id: "subscription-1", mode: "COMMAND" },
    item: { name: "portfolio", position: 1 }
  });
  append(panel, "item-update", {
    client: { id: "client-1", sessionId: "session-A" },
    subscription: { id: "subscription-1", mode: "COMMAND" },
    listener: { id: "listener-1" },
    item: { name: "portfolio", position: 1 },
    update: {
      isSnapshot: false,
      fields: { command: "UPDATE", key: "alpha", price: "11" },
      changedFields: { price: "11" }
    },
    raw: {
      callback: "onItemUpdate",
      logicalEventId: "fixture-update-2",
      targetAvailable: true
    }
  });
  append(panel, "lost-updates", {
    client: { id: "client-1", sessionId: "session-A" },
    subscription: { id: "subscription-1", mode: "COMMAND" },
    item: { name: "portfolio", position: 1 },
    update: { lostUpdates: 3 }
  });
}

function topologyPayload(
  subscriptionId: string,
  clientId = "semantic-client",
  sessionId = "semantic-session"
): CapturePayload {
  return {
    client: {
      id: clientId,
      status: "CONNECTED:WS-STREAMING",
      sessionId
    },
    subscription: {
      id: subscriptionId,
      mode: "MERGE",
      items: ["semantic-item"],
      fields: ["value"],
      active: true,
      subscribed: true
    },
    raw: { callback: "onSubscription" }
  };
}

function replayPayload(
  key: string,
  clientId: string,
  sessionId: string
): CapturePayload {
  return {
    client: { id: clientId, status: "CONNECTED:WS-STREAMING", sessionId },
    subscription: { id: "replay-sub", mode: "COMMAND" },
    listener: { id: "replay-listener", callbacks: ["onItemUpdate"] },
    item: { name: "replay-item", position: 1 },
    update: {
      isSnapshot: false,
      fields: { command: "UPDATE", key, value: "1" },
      changedFields: { value: "1" }
    },
    raw: {
      callback: "onItemUpdate",
      logicalEventId: `logical-${key}`,
      targetAvailable: true
    }
  };
}

function semanticCapture(
  kind: CaptureKind,
  payload: CapturePayload,
  pageEpoch: string,
  captureSequence: number
) {
  const topology: TopologyObservation = {
    version: TOPOLOGY_OBSERVATION_VERSION,
    kind: kind === "subscription-started" ? "subscription-started" : kind,
    pageEpoch,
    captureSequence,
    provenance: { instrumentationSource: "official-public-api" },
    coverage: { status: "complete", getters: {} },
    client: payload.client as TopologyObservation["client"],
    subscription: payload.subscription as TopologyObservation["subscription"]
  };
  return createCaptureMessage(kind, payload, captureSequence, topology);
}

function topologyCheckpoint(
  pageEpoch: string,
  syncId: string,
  subscriptionId: string,
  cutoffCaptureSequence: number,
  includeListener = false,
  aggregateUpdateCount = 0
): { begin: TopologySyncFrame; chunk: TopologySyncFrame; complete: TopologySyncFrame } {
  const clientId = "checkpoint-client";
  const sessionId = "checkpoint-session";
  const records: TopologyAbsoluteRecord[] = [
    {
      kind: "page",
      id: pageEpoch,
      pageEpoch,
      captureSequence: 1
    },
    {
      kind: "client",
      id: clientId,
      parentId: pageEpoch,
      pageEpoch,
      captureSequence: 2,
      values: {
        client: {
          id: clientId,
          status: "CONNECTED:WS-STREAMING",
          sessionId
        }
      }
    },
    {
      kind: "subscription",
      id: subscriptionId,
      parentId: clientId,
      clientId,
      subscriptionId,
      pageEpoch,
      captureSequence: 3,
      clientActive: true,
      serverEstablished: true,
      values: {
        client: { id: clientId, status: "CONNECTED:WS-STREAMING", sessionId },
        subscription: {
          id: subscriptionId,
          mode: "MERGE",
          items: ["checkpoint-item"],
          fields: ["value"],
          active: true,
          subscribed: true,
          listenerCount: includeListener ? 1 : 0
        }
      }
    }
  ];
  if (includeListener) {
    records.push({
      kind: "listener-attachment",
      id: "attachment-1",
      parentId: subscriptionId,
      subscriptionId,
      pageEpoch,
      captureSequence: 4,
      values: {
        clientId,
        sessionId,
        listenerId: "checkpoint-listener",
        callbacks: ["onItemUpdate"],
        registrationCount: 1,
        active: true
      }
    });
  }
  if (includeListener || aggregateUpdateCount > 0) {
    records.push({
      kind: "aggregate",
      id: `aggregate:${subscriptionId}`,
      parentId: subscriptionId,
      subscriptionId,
      pageEpoch,
      captureSequence: 5,
      values: {
        listenerCount: includeListener ? 1 : 0,
        updateCount: aggregateUpdateCount,
        lostUpdates: 3
      }
    });
  }
  const metadata = {
    version: TOPOLOGY_SYNC_VERSION,
    syncId,
    pageEpoch,
    cutoffCaptureSequence,
    chunkCount: 1,
    recordCount: records.length,
    coverage: { status: "complete" as const, getters: {} }
  };
  return {
    begin: { type: TOPOLOGY_SYNC_BEGIN, ...metadata },
    chunk: { type: TOPOLOGY_SYNC_CHUNK, ...metadata, chunkIndex: 0, records },
    complete: { type: TOPOLOGY_SYNC_COMPLETE, ...metadata }
  };
}

function partialTopologyCheckpoint(
  pageEpoch: string,
  syncId: string,
  cutoffCaptureSequence: number
): { begin: TopologySyncFrame; complete: TopologySyncFrame } {
  const metadata = {
    version: TOPOLOGY_SYNC_VERSION,
    syncId,
    pageEpoch,
    cutoffCaptureSequence,
    chunkCount: 0,
    recordCount: 0,
    coverage: {
      status: "partial" as const,
      getters: {},
      reason: "limit-exceeded" as const
    }
  };
  return {
    begin: { type: TOPOLOGY_SYNC_BEGIN, ...metadata },
    complete: {
      type: TOPOLOGY_SYNC_COMPLETE,
      ...metadata,
      reason: "limit-exceeded"
    }
  };
}

function itemEvidenceCheckpoint(): {
  begin: TopologySyncFrame;
  chunk: TopologySyncFrame;
  complete: TopologySyncFrame;
} {
  const pageEpoch = "page-item-evidence";
  const clientId = "item-client";
  const subscriptionId = "item-sub";
  const client = {
    id: clientId,
    status: "CONNECTED:WS-STREAMING",
    sessionId: "item-session"
  };
  const subscription = {
    id: subscriptionId,
    mode: "MERGE",
    items: ["snapshot-item", "loss-item", "clear-item"],
    fields: ["value"],
    active: true,
    subscribed: true
  };
  const records: TopologyAbsoluteRecord[] = [
    { kind: "page", id: pageEpoch, pageEpoch, captureSequence: 1 },
    {
      kind: "client",
      id: clientId,
      parentId: pageEpoch,
      pageEpoch,
      captureSequence: 2,
      values: { client }
    },
    {
      kind: "subscription",
      id: subscriptionId,
      parentId: clientId,
      clientId,
      subscriptionId,
      pageEpoch,
      captureSequence: 3,
      clientActive: true,
      serverEstablished: true,
      values: { client, subscription }
    },
    itemEvidenceRecord("snapshot-item", 4, "end-of-snapshot", {}, client, subscription),
    itemEvidenceRecord(
      "loss-item",
      5,
      "lost-updates",
      { lostUpdates: 5 },
      client,
      subscription
    ),
    itemEvidenceRecord("clear-item", 6, "clear-snapshot", {}, client, subscription)
  ];
  const metadata = {
    version: TOPOLOGY_SYNC_VERSION,
    syncId: "item-evidence",
    pageEpoch,
    cutoffCaptureSequence: 10,
    chunkCount: 1,
    recordCount: records.length,
    coverage: { status: "complete" as const, getters: {} }
  };
  return {
    begin: { type: TOPOLOGY_SYNC_BEGIN, ...metadata },
    chunk: { type: TOPOLOGY_SYNC_CHUNK, ...metadata, chunkIndex: 0, records },
    complete: { type: TOPOLOGY_SYNC_COMPLETE, ...metadata }
  };
}

function itemEvidenceRecord(
  itemName: string,
  captureSequence: number,
  captureKind: "end-of-snapshot" | "lost-updates" | "clear-snapshot",
  update: CapturePayload,
  client: CapturePayload,
  subscription: CapturePayload
): TopologyAbsoluteRecord {
  return {
    kind: "item",
    id: `item:${itemName}`,
    parentId: "item-sub",
    subscriptionId: "item-sub",
    pageEpoch: "page-item-evidence",
    captureSequence,
    values: {
      captureKind,
      client,
      subscription,
      item: { name: itemName },
      update
    }
  };
}

function append(
  panel: PanelController,
  kind: CaptureKind,
  payload: Parameters<typeof createCaptureMessage>[1]
): void {
  panel.appendCaptureMessage(createCaptureMessage(kind, payload));
}
