import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCaptureMessage } from "../src/bridge/messages";
import { type ReinjectionResult } from "../src/bridge/messages";
import {
  createEventStore,
  createIndexedDbEventStore,
  type EventStore
} from "../src/core/event-store";
import { deleteEventDatabase, eventDatabaseName } from "../src/core/indexeddb/event-db";
import { type ReinjectionDraft } from "../src/core/reinjection-draft";
import { type PanelController } from "../src/extension/panel/main";
import { renderPanel } from "../src/extension/panel/main";

function text(selector: string): string {
  return document.querySelector(selector)?.textContent ?? "";
}

function input(selector: string, value: string): void {
  const element = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector);
  if (!element) {
    throw new Error(`missing input ${selector}`);
  }
  element.value = value;
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", {
    bubbles: true
  }));
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushPanelRender(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 40));
}

async function waitForCondition(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for panel state.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function resetScrollWhenChildrenAreReplaced(pane: HTMLElement): void {
  const replaceChildren = pane.replaceChildren.bind(pane);
  vi.spyOn(pane, "replaceChildren").mockImplementation((...nodes: (Node | string)[]) => {
    pane.scrollTop = 0;
    pane.scrollLeft = 0;
    replaceChildren(...nodes);
  });
}

function editDraftJson(mutator: (draft: Record<string, unknown>) => void): void {
  const textarea = document.querySelector<HTMLTextAreaElement>(".draft-json");
  if (!textarea) {
    throw new Error("missing draft JSON textarea");
  }
  const draft = JSON.parse(textarea.value) as Record<string, unknown>;
  mutator(draft);
  input(".draft-json", JSON.stringify(draft, null, 2));
}

function openMutationEditor(): void {
  clickButtonByText(".replay-action-bar button", "Mutate & Inject…");
}

function openAdvancedDraftJson(): HTMLTextAreaElement {
  const section = detailSection("Advanced Draft JSON");
  section.open = true;
  section.dispatchEvent(new Event("toggle"));
  const textarea = section.querySelector<HTMLTextAreaElement>(".draft-json");
  if (!textarea) {
    throw new Error("missing advanced draft JSON textarea");
  }
  return textarea;
}

function appendCommandUpdate(
  panel: PanelController,
  key: string,
  fields: Record<string, string | number | boolean | null> = {}
): void {
  panel.appendCaptureMessage(
    createCaptureMessage("item-update", {
      client: { id: "client-1" },
      subscription: { id: "subscription-1", mode: "COMMAND" },
      listener: { id: "listener-1" },
      item: { name: "scenario.snapshot-basic", position: 1 },
      update: {
        isSnapshot: true,
        fields: { command: "ADD", key, name: key, ...fields },
        changedFields: { command: "ADD", key }
      },
      raw: { callback: "onItemUpdate", note: `raw ${key}` }
    })
  );
}

function clickFirstEventRow(): void {
  const row = document.querySelector<HTMLButtonElement>(".event-row");
  if (!row) {
    throw new Error("missing event row");
  }
  row.click();
}

function clickButtonByText(selector: string, label: string): void {
  const candidate = Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).find(
    (button) => button.textContent === label && !button.disabled
  );
  if (!candidate) {
    throw new Error(`missing enabled ${label} button in ${selector}`);
  }
  candidate.click();
}

function detailSection(heading: string): HTMLDetailsElement {
  const section = Array.from(document.querySelectorAll<HTMLDetailsElement>(".detail-section")).find(
    (candidate) =>
      candidate.querySelector<HTMLElement>(".detail-section-heading")?.textContent === heading
  );
  if (!section) {
    throw new Error(`missing detail section ${heading}`);
  }
  return section;
}

function openDetailSection(heading: string): HTMLDetailsElement {
  const section = detailSection(heading);
  section.open = true;
  section.dispatchEvent(new Event("toggle"));
  return section;
}

describe("panel shell", () => {
  let panel: PanelController;

  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing test root");
    }
    panel = renderPanel(root);
  });

  it("renders the toolbar status and zero event count", () => {
    expect(text(".product-label")).toBe("Lightstreamer Event Workbench");
    expect(document.querySelector<HTMLImageElement>(".product-icon")?.getAttribute("src")).toBe(
      "/icons/title-icon.svg"
    );
    expect(document.querySelector<HTMLImageElement>(".product-icon")?.alt).toBe("");
    expect(text(".status-badge")).toBe("idle");
    expect(text(".event-count")).toBe("0");
    expect(document.querySelector(".event-count")?.getAttribute("aria-label")).toBe("0 captured events");
    expect(document.querySelector<HTMLInputElement>(".search-input")?.placeholder).toBe(
      "Search events, fields, ids, command, key, or JSON"
    );
    expect(text(".clear-button")).toBe("Clear events");
    expect(document.querySelector<HTMLButtonElement>(".event-volume-action")?.title).toBe(
      "Dismiss this warning and keep captured events for this DevTools session."
    );
  });

  it("offers Auto, Dark, and Light themes and applies an explicit selection", () => {
    const root = document.querySelector<HTMLElement>("#app");
    const select = document.querySelector<HTMLSelectElement>(".theme-select");

    expect(select?.getAttribute("aria-label")).toBe("Workbench theme");
    expect(Array.from(select?.options ?? []).map((option) => [option.value, option.textContent])).toEqual([
      ["auto", "Auto"],
      ["dark", "Dark"],
      ["light", "Light"]
    ]);

    input(".theme-select", "dark");
    expect(root?.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    input(".theme-select", "light");
    expect(root?.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    input(".theme-select", "auto");
  });

  it("closes the event store when the panel is disposed", () => {
    panel.dispose();
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const store = createEventStore();
    const close = vi.fn();
    store.close = close;
    if (!root) {
      throw new Error("missing test root");
    }

    const controller = renderPanel(root, undefined, { store });
    controller.dispose();
    controller.dispose();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("renders the empty feed and keeps the detail pane collapsed", () => {
    expect(text(".empty-heading")).toBe("Waiting for Lightstreamer activity");
    expect(text(".empty-body")).toContain("Captured clients, subscriptions, and item updates will appear here");
    expect(document.querySelector<HTMLElement>(".detail-pane")?.hidden).toBe(true);
  });

  it("explains TLCP-aligned and Workbench-only Timeline codes", () => {
    const legend = document.querySelector<HTMLDetailsElement>(".timeline-code-legend");
    expect(legend?.open).toBe(false);
    expect(text(".timeline-code-legend-toggle")).toBe("Codes");
    expect(document.querySelector(".timeline-code-legend-toggle")?.getAttribute("aria-label")).toBe(
      "Timeline code legend"
    );
    expect(text('.timeline-code-legend-group[data-family="tlcp"]')).toContain("U");
    expect(text('.timeline-code-legend-group[data-family="tlcp"]')).toContain("SUBCMD");
    expect(text('.timeline-code-legend-group[data-family="tlcp"]')).toContain("EOS");
    expect(text('.timeline-code-legend-group[data-family="tlcp"]')).toContain("CS");
    expect(text('.timeline-code-legend-group[data-family="tlcp"]')).toContain("OV");
    expect(text('.timeline-code-legend-group[data-family="workbench"]')).toContain("C+");
    expect(text('.timeline-code-legend-group[data-family="workbench"]')).toContain("S+");
    expect(text('.timeline-code-legend-group[data-family="workbench"]')).toContain("L−");
  });

  it("renders captured semantics with compact Lightstreamer-style codes", async () => {
    const subscription = {
      id: "subscription-codes",
      mode: "COMMAND",
      items: ["orders"]
    };
    for (const message of [
      createCaptureMessage("subscription-created", { subscription }),
      createCaptureMessage("subscription-started", { subscription }),
      createCaptureMessage("item-update", {
        subscription,
        item: { name: "orders", position: 1 },
        update: { fields: { command: "ADD", key: "alpha" }, changedFields: { command: "ADD", key: "alpha" } }
      }),
      createCaptureMessage("end-of-snapshot", { subscription, item: { name: "orders", position: 1 } }),
      createCaptureMessage("clear-snapshot", { subscription, item: { name: "orders", position: 1 } }),
      createCaptureMessage("lost-updates", { subscription, item: { name: "orders", position: 1 } }),
      createCaptureMessage("subscription-ended", { subscription })
    ]) {
      panel.appendCaptureMessage(message);
    }
    await flushPanelRender();

    expect(
      Array.from(document.querySelectorAll<HTMLElement>(".event-code")).map(
        (code) => code.textContent
      )
    ).toEqual(["S+", "SUBCMD", "U", "EOS", "CS", "OV", "UNSUB"]);
    expect(Array.from(document.querySelectorAll<HTMLElement>(".event-item")).map((item) => item.textContent))
      .toEqual(["orders", "orders", "orders", "orders", "orders", "orders", "orders"]);
    expect(Array.from(document.querySelectorAll<HTMLElement>(".event-command")).map((cell) => cell.textContent))
      .toEqual(["—", "—", "ADD/alpha", "—", "—", "—", "—"]);
  });

  it("allows clearing an empty feed without changing the zero count", () => {
    const button = document.querySelector<HTMLButtonElement>(".clear-button");
    button?.click();

    expect(text(".event-count")).toBe("0");
    expect(document.querySelector(".event-count")?.getAttribute("aria-label")).toBe("0 captured events");
  });

  it("renders COMMAND snapshot rows and selected event details", () => {
    panel.appendCaptureMessage(
      createCaptureMessage("item-update", {
        client: { id: "client-1" },
        subscription: { id: "subscription-1", mode: "COMMAND" },
        listener: { id: "listener-1" },
        item: { name: "scenario.snapshot-basic", position: 1 },
        update: {
          isSnapshot: true,
          fields: { command: "ADD", key: "alpha", name: "Alpha" },
          changedFields: { command: "ADD", key: "alpha" }
        }
      })
    );

    expect(text(".event-count")).toBe("1");
    expect(
      Array.from(document.querySelectorAll<HTMLElement>(".event-header-cell")).map(
        (cell) => cell.textContent
      )
    ).toEqual(["Time", "Code", "Item", "Command / Key", "Source"]);
    expect(document.querySelector(".event-client")).toBeNull();
    expect(document.querySelector(".event-subscription")).toBeNull();
    expect(document.querySelector(".event-mode")).toBeNull();
    expect(text(".event-code")).toBe("U");
    expect(document.querySelector(".event-code")?.getAttribute("aria-label")).toContain(
      "U: Update"
    );
    expect(text(".event-marker")).toBe("server snapshot");
    expect(text(".event-command")).toBe("ADD/alpha");
    expect(document.querySelector<HTMLElement>(".event-row")?.dataset.command).toBe("ADD");
    expect(document.querySelector<HTMLElement>(".event-row")?.dataset.kind).toBe("item-update");
    expect(document.querySelector<HTMLElement>(".event-row")?.dataset.source).toBe("listener");
    expect(document.querySelector<HTMLElement>(".event-row")?.title).toContain("client client-1");
    expect(document.querySelector<HTMLElement>(".event-row")?.title).toContain(
      "subscription subscription-1"
    );
    expect(document.querySelector<HTMLElement>(".event-row")?.title).toContain("mode COMMAND");
    expect(document.querySelector<HTMLElement>(".detail-pane")?.hidden).toBe(true);

    clickFirstEventRow();
    expect(text(".detail-pane")).toContain('"key": "alpha"');
    expect(text(".detail-pane")).toContain("Listener");
    expect(detailSection("Current item fields").open).toBe(true);
    expect(document.querySelector('[data-detail-section="Changed fields"]')).toBeNull();
    expect(document.querySelector('[data-detail-section="All current fields"]')).toBeNull();
    expect(detailSection("Context").open).toBe(false);
    openDetailSection("Context");
    expect(text(".detail-pane")).toContain('"synthetic": false');
    expect(text(".detail-pane")).toContain('"id": "client-1"');
    expect(text(".detail-pane").indexOf("Raw capture")).toBeGreaterThan(
      text(".detail-pane").indexOf("Context")
    );
    expect(text(".editor-placeholder")).toBe(
      "Clone this captured item update to replay it unchanged or edit a staged copy."
    );

    document.querySelector<HTMLButtonElement>(".detail-collapse-button")?.click();
    expect(document.querySelector<HTMLElement>(".detail-pane")?.hidden).toBe(true);
  });

  it("uses compact exact semantic times across repeated seconds and local day boundaries", async () => {
    const timestamps = [
      new Date(2026, 0, 1, 23, 59, 59, 1).getTime(),
      new Date(2026, 0, 1, 23, 59, 59, 2).getTime(),
      new Date(2026, 0, 2, 0, 0, 0, 3).getTime()
    ];
    for (const [index, timestamp] of timestamps.entries()) {
      panel.appendCaptureMessage(
        createCaptureMessage(
          "item-update",
          {
            subscription: { id: "subscription-time", mode: "MERGE" },
            item: { name: "time-item", position: 1 },
            update: {
              isSnapshot: false,
              fields: { value: index },
              changedFields: { value: index }
            }
          },
          timestamp
        )
      );
    }
    await flushPanelRender();

    const rowTimes = Array.from(document.querySelectorAll<HTMLTimeElement>(".event-time"));
    expect(rowTimes).toHaveLength(3);
    expect(rowTimes.map((time) => time.dateTime)).toEqual(
      timestamps.map((timestamp) => new Date(timestamp).toISOString())
    );
    expect(rowTimes.map((time) => time.textContent)).toEqual([
      "23:59:59.001",
      "23:59:59.002",
      "00:00:00.003"
    ]);
    expect(rowTimes.every((time) => Boolean(time.title))).toBe(true);
    expect(rowTimes.every((time) => (time.getAttribute("aria-label") ?? "").includes("2026-"))).toBe(
      true
    );
    expect(rowTimes.some((time) => /\b(?:AM|PM)\b/i.test(time.textContent ?? ""))).toBe(false);

    document.querySelector<HTMLButtonElement>(".event-row")?.click();
    openDetailSection("Context");
    expect(text(".detail-pane")).not.toContain('"timestamp"');
  });

  it("lets Timeline event detail width be adjusted like split panes", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    clickFirstEventRow();

    const workspace = document.querySelector<HTMLElement>(".workspace");
    const resizeHandle = document.querySelector<HTMLElement>(".timeline-resize-handle");

    expect(workspace?.dataset.detailOpen).toBe("true");
    expect(workspace?.style.getPropertyValue("--timeline-detail-width")).toBe("520px");
    expect(resizeHandle?.getAttribute("role")).toBe("separator");
    expect(resizeHandle?.getAttribute("aria-label")).toBe("Resize Event detail pane");
    expect(resizeHandle?.getAttribute("aria-valuenow")).toBe("520");

    resizeHandle?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));

    expect(workspace?.style.getPropertyValue("--timeline-detail-width")).toBe("544px");
    expect(resizeHandle?.getAttribute("aria-valuenow")).toBe("544");
  });

  it("filters rows by free-text COMMAND key search", () => {
    appendCommandUpdate(panel, "alpha");
    appendCommandUpdate(panel, "beta");

    input(".search-input", "alpha");

    expect(document.querySelectorAll(".event-row")).toHaveLength(1);
    expect(text(".event-command")).toBe("ADD/alpha");
    expect(text(".filtered-count")).toBe("1 shown");
    expect(text(".event-count")).toBe("2");
  });

  it("shows filtered empty state when no events match", () => {
    appendCommandUpdate(panel, "alpha");

    input(".search-input", "missing");

    expect(document.querySelectorAll(".event-row")).toHaveLength(0);
    expect(text(".empty-body")).toBe(
      "No events match the active search and filters. Clear filters or broaden the search query."
    );
    expect(text(".filtered-count")).toBe("0 shown");
  });

  it("surfaces one retention clear action and pages Timeline history reversibly within a fixed DOM bound", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const store = createEventStore({ warningThreshold: 500 });
    if (!root) {
      throw new Error("missing test root");
    }

    for (let index = 1; index <= 1002; index += 1) {
      store.append({
        id: `event-${index}`,
        timestamp: index,
        direction: "inbound",
        source: "server",
        synthetic: false,
        kind: "item-update",
        subscription: { id: "subscription-1", mode: "COMMAND" },
        item: { name: `item-${index}`, position: index },
        update: {
          isSnapshot: false,
          fields: { command: "ADD", key: `key-${index}` },
          changedFields: { command: "ADD", key: `key-${index}` },
          command: "ADD",
          key: `key-${index}`
        }
      });
    }
    renderPanel(root, undefined, { store });

    expect(store.list().map((entry) => entry.id)).toContain("event-1");
    expect(text(".event-count")).toBe("1002");
    expect(text(".retention-notice")).toContain("High volume: 1,002 events retained");
    expect(text(".retention-notice")).toContain("Keep events");
    expect(
      Array.from(document.querySelectorAll<HTMLButtonElement>("button")).filter(
        (button) => button.textContent === "Clear events" && !button.hidden
      )
    ).toHaveLength(1);
    expect(text(".event-render-limit")).toBe(
      "Showing 943–1,002 of 1,002 retained events."
    );
    expect(document.querySelectorAll(".event-row")).toHaveLength(60);
    expect(root.querySelectorAll("*").length).toBeLessThan(1_000);

    const feed = document.querySelector<HTMLElement>(".event-feed");
    if (!feed) {
      throw new Error("missing event feed");
    }
    Object.defineProperties(feed, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1000 }
    });
    feed.scrollTop = 800;
    feed.dispatchEvent(new Event("scroll"));

    expect(document.querySelectorAll(".event-row")).toHaveLength(60);

    feed.scrollTop = 0;
    feed.dispatchEvent(new Event("scroll"));

    expect(document.querySelectorAll(".event-row")).toHaveLength(60);
    clickButtonByText(".event-window-navigation button", "Older");
    expect(text(".event-render-limit")).toBe(
      "Showing 883–942 of 1,002 retained events."
    );

    let priorWindowFirstId = "";
    while (!Array.from(document.querySelectorAll<HTMLButtonElement>(
      ".event-window-navigation button"
    )).find((button) => button.textContent === "Older")?.disabled) {
      priorWindowFirstId = document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId ?? "";
      clickButtonByText(".event-window-navigation button", "Older");
    }
    expect(document.querySelectorAll(".event-row")).toHaveLength(42);
    expect(document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId).toBe("event-1");
    expect(root.querySelectorAll("*").length).toBeLessThan(1_000);

    clickButtonByText(".event-window-navigation button", "Newer");
    expect(document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId).toBe(
      priorWindowFirstId
    );
    clickButtonByText(".event-window-navigation button", "Older");
    expect(document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId).toBe("event-1");

    const keepButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".event-volume-action")).find(
      (button) => button.textContent === "Keep events"
    );
    keepButton?.click();

    expect(document.querySelector<HTMLElement>(".retention-notice")?.hidden).toBe(true);
    expect(store.count()).toBe(1002);
  });

  it("keeps 3,001-event Timeline append and search rendering structurally bounded", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const store = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    const storedEvent = (index: number) => ({
      id: `volume-event-${index}`,
      timestamp: index,
      direction: "inbound" as const,
      source: "server" as const,
      synthetic: false,
      kind: "item-update" as const,
      subscription: { id: "subscription-1", mode: "COMMAND" },
      item: { name: "volume-item", position: 1 },
      update: {
        isSnapshot: false,
        fields: { command: "ADD", key: `volume-key-${index}`, qty: index },
        changedFields: { command: "ADD", key: `volume-key-${index}`, qty: index },
        command: "ADD",
        key: `volume-key-${index}`
      }
    });
    for (let index = 1; index <= 3_000; index += 1) {
      store.append(storedEvent(index));
    }
    const queryEvents = vi.spyOn(store, "queryEvents");
    const controller = renderPanel(root, undefined, { store });
    queryEvents.mockClear();

    store.append(storedEvent(3_001));
    input(".search-input", "volume-event-3001");

    expect(document.querySelectorAll(".event-row")).toHaveLength(1);
    expect(root.querySelectorAll("*").length).toBeLessThan(1_000);
    expect(queryEvents.mock.calls.length).toBeLessThanOrEqual(2);
    controller.dispose();
  });

  it("keeps a pinned Timeline detail selected by id after it leaves the live window", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const store = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    for (let index = 1; index <= 61; index += 1) {
      store.append({
        id: `selection-${index}`,
        timestamp: index,
        direction: "inbound",
        source: "server",
        synthetic: false,
        kind: "item-update",
        update: { command: "ADD", key: `key-${index}` }
      });
    }
    renderPanel(root, undefined, { store });
    document.querySelector<HTMLButtonElement>('.event-row[data-event-id="selection-2"]')?.click();
    expect(text(".detail-pane")).toContain("selection-2");
    expect(document.querySelector(".detail-exact-time")).not.toBeNull();

    store.append({
      id: "selection-62",
      timestamp: 62,
      direction: "inbound",
      source: "server",
      synthetic: false,
      kind: "item-update",
      update: { command: "ADD", key: "key-62" }
    });

    expect(text(".detail-pane")).toContain("selection-2");
    expect(text(".detail-pane")).not.toContain("selection-62");
    const offWindowTime = document.querySelector<HTMLTimeElement>(".detail-exact-time-value");
    expect(offWindowTime?.dateTime).toBe(new Date(2).toISOString());
    expect(offWindowTime?.textContent).toMatch(/^\d{4}-\d{2}-\d{2} .* UTC[+-]\d{2}:\d{2}$/);
  });

  it("preserves a partial Timeline history anchor across append, Latest, and Older", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const store = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    const append = (index: number) =>
      store.append({
        id: `timeline-roundtrip-${index}`,
        timestamp: index,
        direction: "inbound",
        source: "server",
        synthetic: false,
        kind: "item-update",
        update: { command: "ADD", key: `key-${index}` }
      });
    for (let index = 1; index <= 65; index += 1) {
      append(index);
    }
    renderPanel(root, undefined, { store });

    clickButtonByText(".event-window-navigation button", "Older");
    expect(document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId).toBe(
      "timeline-roundtrip-1"
    );
    append(66);
    clickButtonByText(".event-window-navigation button", "Newer");
    const anchoredFirstId = document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId;
    expect(anchoredFirstId).toBe("timeline-roundtrip-6");

    clickButtonByText(".event-window-navigation button", "Latest");
    clickButtonByText(".event-window-navigation button", "Older");
    expect(document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId).toBe(
      anchoredFirstId
    );
  });

  it("does not let a stale off-window detail lookup replace a newer selection", async () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const memoryStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    for (let index = 1; index <= 61; index += 1) {
      memoryStore.append({
        id: `detail-race-${index}`,
        timestamp: index,
        direction: "inbound",
        source: "server",
        synthetic: false,
        kind: "item-update",
        update: { command: "ADD", key: `key-${index}` }
      });
    }
    const detailLookup: {
      resolve?: (event: Awaited<ReturnType<EventStore["getEventById"]>>) => void;
    } = {};
    const store: EventStore = {
      ...memoryStore,
      getEventById(id) {
        if (id !== "detail-race-2") {
          return memoryStore.getEventById(id);
        }
        return new Promise((resolve) => {
          detailLookup.resolve = resolve;
        });
      }
    };
    renderPanel(root, undefined, { store });
    document.querySelector<HTMLButtonElement>('.event-row[data-event-id="detail-race-2"]')?.click();

    memoryStore.append({
      id: "detail-race-62",
      timestamp: 62,
      direction: "inbound",
      source: "server",
      synthetic: false,
      kind: "item-update",
      update: { command: "ADD", key: "key-62" }
    });
    clickButtonByText(".event-window-navigation button", "Latest");
    document.querySelector<HTMLButtonElement>('.event-row[data-event-id="detail-race-62"]')?.click();
    expect(text(".detail-pane")).toContain("detail-race-62");

    const historical = await memoryStore.getEventById("detail-race-2");
    detailLookup.resolve?.(historical);
    await flushPromises();
    expect(text(".detail-pane")).toContain("detail-race-62");
    expect(text(".detail-pane")).not.toContain("detail-race-2");
  });

  it("restores Timeline pager focus and lazily creates collapsed payload DOM", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const store = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    for (let index = 1; index <= 130; index += 1) {
      store.append({
        id: `focus-${index}`,
        timestamp: index,
        direction: "inbound",
        source: "server",
        synthetic: false,
        kind: "item-update",
        update: { command: "ADD", key: `focus-key-${index}`, fields: { payload: index } }
      });
    }
    renderPanel(root, undefined, { store });
    const older = Array.from(document.querySelectorAll<HTMLButtonElement>(
      ".event-window-navigation button"
    )).find((button) => button.textContent === "Older");
    older?.focus();
    older?.click();

    expect(document.activeElement?.textContent).toBe("Older");
    document.querySelector<HTMLButtonElement>(".event-row")?.click();
    expect(document.querySelectorAll(".detail-section:not([open]) pre")).toHaveLength(0);
    expect(document.querySelector(".event-list")?.getAttribute("role")).not.toBe("list");
    expect(document.querySelector(".event-header")?.getAttribute("role")).toBeNull();
  });

  it("suspends Timeline and COMMAND presentation work while the DevTools panel is hidden", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const store = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    const queryEvents = vi.spyOn(store, "queryEvents");
    const controller = renderPanel(root, undefined, { store }) as PanelController & {
      setVisible(visible: boolean): void;
    };
    controller.setVisible(false);
    queryEvents.mockClear();

    store.append({
      id: "hidden-1",
      timestamp: 1,
      direction: "inbound",
      source: "server",
      synthetic: false,
      kind: "item-update",
      subscription: { id: "sub-hidden", mode: "COMMAND" },
      item: { name: "hidden-item", position: 1 },
      update: { command: "ADD", key: "hidden-key" }
    });

    expect(queryEvents).not.toHaveBeenCalled();
    expect(text(".event-count")).toBe("0");
    controller.setVisible(true);
    expect(queryEvents).toHaveBeenCalledTimes(1);
    expect(text(".event-count")).toBe("1");
  });

  it("drops an in-flight Timeline query when the panel becomes hidden", async () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const memoryStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    memoryStore.append({
      id: "hidden-query-1",
      timestamp: 1,
      direction: "inbound",
      source: "server",
      synthetic: false,
      kind: "item-update",
      update: { command: "ADD", key: "hidden-query-key" }
    });
    const pendingQuery: { resolve?: () => void } = {};
    let queryCalls = 0;
    const store: EventStore = {
      ...memoryStore,
      queryEvents(query) {
        queryCalls += 1;
        if (queryCalls === 1) {
          return memoryStore.queryEvents(query);
        }
        return new Promise((resolve) => {
          pendingQuery.resolve = () => resolve(memoryStore.queryEvents(query));
        });
      }
    };
    const controller = renderPanel(root, undefined, { store });
    const eventCountBeforeHide = text(".event-count");
    controller.setVisible(false);
    pendingQuery.resolve?.();
    await flushPromises();

    expect(document.querySelectorAll(".event-row")).toHaveLength(0);
    expect(text(".event-count")).toBe(eventCountBeforeHide);
  });

  it("starts hidden without painting retained events until it is shown", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const store = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    store.append({
      id: "initially-hidden-1",
      timestamp: 1,
      direction: "inbound",
      source: "server",
      synthetic: false,
      kind: "item-update",
      update: { command: "ADD", key: "initially-hidden-key" }
    });

    const controller = renderPanel(root, undefined, { store, visible: false });
    expect(document.querySelectorAll(".event-row")).toHaveLength(0);
    expect(text(".event-count")).toBe("0");

    controller.setVisible(true);
    expect(document.querySelectorAll(".event-row")).toHaveLength(1);
    expect(text(".event-count")).toBe("1");
  });

  it("moves an async Timeline store between bounded history windows", async () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const memoryStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }

    for (let index = 1; index <= 501; index += 1) {
      memoryStore.append({
        id: `async-event-${index}`,
        timestamp: index,
        direction: "inbound",
        source: "server",
        synthetic: false,
        kind: "item-update",
        subscription: { id: "subscription-1", mode: "COMMAND" },
        item: { name: "async-item", position: 1 },
        update: {
          isSnapshot: false,
          fields: { command: "ADD", key: `key-${index}` },
          changedFields: { command: "ADD", key: `key-${index}` },
          command: "ADD",
          key: `key-${index}`
        }
      });
    }
    const asyncStore: EventStore = {
      ...memoryStore,
      queryEvents(query) {
        return Promise.resolve(memoryStore.queryEvents(query));
      }
    };
    renderPanel(root, undefined, { store: asyncStore });
    await flushPromises();

    const feed = document.querySelector<HTMLElement>(".event-feed");
    if (!feed) {
      throw new Error("missing Timeline feed");
    }
    Object.defineProperties(feed, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: {
        configurable: true,
        get: () => document.querySelectorAll(".event-row").length
      }
    });
    expect(document.querySelectorAll(".event-row")).toHaveLength(60);
    expect(document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId).toBe(
      "async-event-442"
    );
    clickButtonByText(".event-window-navigation button", "Older");
    await flushPromises();

    expect(document.querySelectorAll(".event-row")).toHaveLength(60);
    expect(document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId).toBe(
      "async-event-382"
    );
  });

  it("coalesces high-volume append rendering into bounded Timeline queries", async () => {
    vi.useFakeTimers();
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16)) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((id: number) => {
      window.clearTimeout(id);
    }) as typeof window.cancelAnimationFrame;

    let controller: PanelController | null = null;
    try {
      document.body.innerHTML = '<main id="app"></main>';
      const root = document.querySelector<HTMLElement>("#app");
      const store = createEventStore({ warningThreshold: 500 });
      if (!root) {
        throw new Error("missing test root");
      }

      const queryEvents = store.queryEvents.bind(store);
      let queryCount = 0;
      store.queryEvents = (query) => {
        queryCount += 1;
        return queryEvents(query);
      };

      controller = renderPanel(root, undefined, { store });
      const initialQueryCount = queryCount;

      for (let index = 1; index <= 1000; index += 1) {
        appendCommandUpdate(controller, `burst-${index}`, { qty: index });
      }

      expect(text(".event-count")).toBe("1000");
      expect(queryCount - initialQueryCount).toBeLessThanOrEqual(1);
      expect(document.querySelectorAll(".event-row").length).toBeLessThan(1000);

      await vi.runOnlyPendingTimersAsync();
      await flushPromises();

      expect(queryCount - initialQueryCount).toBeLessThan(50);
      expect(document.querySelectorAll(".event-row")).toHaveLength(60);
    } finally {
      controller?.dispose();
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
      vi.useRealTimers();
    }
  });

  it("flushes coalesced Timeline updates when animation frames are paused", async () => {
    vi.useFakeTimers();
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = vi.fn(() => 1);
    window.cancelAnimationFrame = vi.fn();
    let controller: PanelController | null = null;

    try {
      document.body.innerHTML = '<main id="app"></main>';
      const root = document.querySelector<HTMLElement>("#app");
      if (!root) {
        throw new Error("missing test root");
      }

      controller = renderPanel(root);
      for (let index = 1; index <= 100; index += 1) {
        appendCommandUpdate(controller, `paused-frame-${index}`, { qty: index });
      }

      expect(text(".event-count")).toBe("100");
      expect(document.querySelectorAll(".event-row").length).toBeLessThan(100);

      await vi.advanceTimersByTimeAsync(40);

      expect(document.querySelectorAll(".event-row")).toHaveLength(60);
      expect(Array.from(document.querySelectorAll(".event-command")).at(-1)?.textContent).toBe(
        "ADD/paused-frame-100"
      );
    } finally {
      controller?.dispose();
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
      vi.useRealTimers();
    }
  });

  it("keeps the Timeline page current during concurrent IndexedDB capture", async () => {
    const previousIndexedDb = globalThis.indexedDB;
    const sessionId = "panel-concurrent-capture-test";
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    await deleteEventDatabase(eventDatabaseName(sessionId));
    const store = await createIndexedDbEventStore({ sessionId, reset: true });
    let controller: PanelController | null = null;

    try {
      document.body.innerHTML = '<main id="app"></main>';
      const root = document.querySelector<HTMLElement>("#app");
      if (!root) {
        throw new Error("missing test root");
      }

      controller = renderPanel(root, undefined, { store });
      for (let index = 1; index <= 600; index += 1) {
        appendCommandUpdate(controller, `indexed-${index}`, { qty: index });
      }

      await waitForCondition(() => text(".event-count") === "600");
      await waitForCondition(() => document.querySelectorAll(".event-row").length === 60);

      expect(text(".event-render-limit")).toBe(
        "Showing 541–600 of 600 retained events."
      );
      expect(Array.from(document.querySelectorAll(".event-command")).at(-1)?.textContent).toBe(
        "ADD/indexed-600"
      );

      const feed = document.querySelector<HTMLElement>(".event-feed");
      if (!feed) {
        throw new Error("missing Timeline feed");
      }
      clickButtonByText(".event-window-navigation button", "Older");
      await waitForCondition(
        () => document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId === "event-481"
      );

      expect(document.querySelectorAll(".event-row")).toHaveLength(60);
      expect(text(".event-render-limit")).toBe("Showing 481–540 of 600 retained events.");
    } finally {
      controller?.dispose();
      await store.close?.();
      await deleteEventDatabase(eventDatabaseName(sessionId));
      Reflect.set(globalThis, "indexedDB", previousIndexedDb);
    }
  }, 15_000);

  it("realigns detail with newest visible event when filters hide the selected row", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    appendCommandUpdate(panel, "beta", { qty: 2 });

    const firstRow = document.querySelectorAll<HTMLButtonElement>(".event-row")[0];
    firstRow.click();
    expect(text(".detail-pane")).toContain('"key": "alpha"');

    input(".search-input", "beta");

    expect(document.querySelectorAll(".event-row")).toHaveLength(1);
    expect(text(".event-command")).toBe("ADD/beta");
    expect(text(".detail-pane")).toContain('"key": "beta"');
    expect(text(".filtered-count")).toBe("1 shown");
  });

  it("renders synthetic live markers and row styling", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const store = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    renderPanel(root, undefined, { store });

    store.append({
      id: "synthetic-1",
      timestamp: 1,
      direction: "inbound",
      source: "synthetic",
      synthetic: true,
      kind: "item-update",
      subscription: { id: "subscription-1", mode: "COMMAND" },
      listener: { id: "listener-1" },
      item: { name: "scenario.snapshot-basic", position: 1 },
      update: {
        isSnapshot: false,
        fields: { command: "UPDATE", key: "alpha", qty: 11 },
        changedFields: { qty: 11 },
        command: "UPDATE",
        key: "alpha"
      },
      raw: { sourceEventId: "event-1" }
    });

    expect(text(".event-marker")).toBe("synthetic live");
    expect(document.querySelector(".event-row")?.getAttribute("data-synthetic")).toBe("true");
    expect(document.querySelector<HTMLElement>(".event-row")?.dataset.command).toBe("UPDATE");
    expect(document.querySelector<HTMLElement>(".event-row")?.dataset.source).toBe("workbench");
    clickFirstEventRow();
    expect(text(".selected-event-source")).toBe("Listener replay");
    expect(document.querySelector(".selected-event-source")?.classList).toContain(
      "source-listener-replay"
    );
    expect(text(".detail-pane")).toContain("Synthetic provenance");
    openDetailSection("Synthetic provenance");
    expect(text(".detail-pane")).toContain('"sourceEventId": "event-1"');
  });

  it("labels Workbench-only simulations and shows their edited-field provenance", () => {
    panel.dispose();
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const store = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    panel = renderPanel(root, undefined, { store });

    store.append({
      id: "synthetic-workbench-1",
      timestamp: 2,
      direction: "inbound",
      source: "synthetic",
      synthetic: true,
      kind: "item-update",
      subscription: { id: "subscription-1", mode: "COMMAND" },
      item: { name: "scenario.snapshot-basic", position: 1 },
      update: {
        isSnapshot: false,
        fields: { command: "UPDATE", key: "alpha", qty: 22 },
        changedFields: { command: "UPDATE", key: "alpha" },
        command: "UPDATE",
        key: "alpha"
      },
      raw: {
        sourceEventId: "event-1",
        executionTarget: "workbench-only",
        deliveredToPage: false,
        editedFields: { qty: 22 }
      }
    });

    expect(text(".event-marker")).toBe("workbench live");
    clickFirstEventRow();
    expect(text(".selected-event-source")).toBe("Workbench only");
    expect(document.querySelector(".selected-event-source")?.classList).toContain(
      "source-workbench-only"
    );
    const provenance = openDetailSection("Synthetic provenance").textContent ?? "";
    expect(provenance).toContain('"executionTarget": "workbench-only"');
    expect(provenance).toContain('"editedFields"');
    expect(provenance).toContain('"qty": 22');
  });

  it("renders captured HTML-like field values as inert text", () => {
    appendCommandUpdate(panel, "alpha", { html: "<img src=x onerror=alert(1)>" });
    clickFirstEventRow();

    expect(document.querySelector(".detail-pane img")).toBeNull();
    openDetailSection("Current item fields");
    expect(text(".detail-pane")).toContain("<img src=x onerror=alert(1)>");
  });

  it("combines current item fields and formats JSON-looking string values for display", () => {
    appendCommandUpdate(panel, "json-key", {
      modelValues: JSON.stringify({ messageId: "6675531", messageType: "NEWS" })
    });
    clickFirstEventRow();

    const fields = detailSection("Current item fields");
    expect(fields.open).toBe(true);
    expect(text(".detail-changed-fields")).toContain("command");
    expect(text(".detail-changed-fields")).toContain("key");
    expect(text(".detail-json")).toContain('"modelValues": {');
    expect(text(".detail-json")).toContain('"messageType": "NEWS"');
    expect(text(".detail-json")).not.toContain('"modelValues": "{\\"');
    expect(document.querySelector('[data-detail-section="Changed fields"]')).toBeNull();
    expect(document.querySelector('[data-detail-section="All current fields"]')).toBeNull();
  });

  it("copies the canonical selected event JSON and announces clipboard status", async () => {
    const writeText = vi.fn((_value: string) => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    appendCommandUpdate(panel, "copy-key", { qty: 7 });
    clickFirstEventRow();

    document.querySelector<HTMLButtonElement>(".copy-event-json-button")?.click();
    await flushPromises();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(JSON.parse(writeText.mock.calls[0][0])).toMatchObject({
      id: "event-1",
      source: "server",
      synthetic: false,
      update: { fields: { key: "copy-key", qty: 7 } }
    });
    expect(text(".detail-copy-message")).toBe("Copied the canonical selected event JSON.");
    expect(document.querySelector(".detail-copy-message")?.getAttribute("role")).toBe("status");
    expect(document.querySelector(".detail-copy-message")?.getAttribute("aria-live")).toBe("polite");
  });

  it("disables Clone event for non-item-update rows", () => {
    panel.appendCaptureMessage(
      createCaptureMessage("client-status", {
        client: { id: "client-1", status: "CONNECTED:WS-STREAMING" }
      })
    );
    clickFirstEventRow();

    expect(text(".clone-button")).toBe("Clone");
    expect(document.querySelector<HTMLButtonElement>(".clone-button")?.disabled).toBe(true);
  });

  it("stages an unchanged clone before exposing separate replay and mutation actions", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    clickFirstEventRow();

    document.querySelector<HTMLButtonElement>(".clone-button")?.click();

    expect(text(".draft-source-context")).toContain("Staged source clone");
    expect(text(".replay-source-button")).toBe("Re-inject");
    expect(text(".mutate-inject-button")).toBe("Mutate & Inject…");
    expect(document.querySelector(".draft-controls")).toBeNull();
    expect(document.querySelector(".draft-json")).toBeNull();
    expect(
      document.querySelectorAll<HTMLInputElement>('input[name="draft-execution-target"]')
    ).toHaveLength(2);
  });

  it("defaults wire captures to Workbench-only execution and bypasses the bridge", async () => {
    const reinjectDraft = vi.fn(() => Promise.resolve(createSuccessResult("should-not-run")));
    panel.dispose();
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing test root");
    }
    panel = renderPanel(root, undefined, { bridge: { reinjectDraft } });
    panel.appendCaptureMessage(
      createCaptureMessage("item-update", {
        client: { id: "client-1" },
        subscription: { id: "subscription-1", mode: "COMMAND" },
        item: { name: "scenario.snapshot-basic", position: 1 },
        update: {
          isSnapshot: true,
          fields: { command: "ADD", key: "alpha", name: "Alpha", qty: "10" },
          changedFields: { command: "ADD", key: "alpha", name: "Alpha", qty: "10" },
          command: "ADD",
          key: "alpha"
        },
        raw: { captureSource: "websocket-tlcp" }
      })
    );

    expect(text(".event-marker")).toBe("wire snapshot");
    clickFirstEventRow();
    expect(document.querySelector<HTMLButtonElement>(".clone-button")?.disabled).toBe(false);

    document.querySelector<HTMLButtonElement>(".clone-button")?.click();

    expect(text(".draft-source-context")).toContain("Listener-");
    const targets = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="draft-execution-target"]')
    );
    expect(targets).toHaveLength(2);
    expect(targets.map((target) => target.value)).toEqual([
      "captured-listener",
      "workbench-only"
    ]);
    expect(targets[0].disabled).toBe(true);
    expect(targets[1].checked).toBe(true);
    expect(text('.draft-target-option[data-target="captured-listener"]')).toContain(
      "Original app listener"
    );
    expect(text('.draft-target-option[data-target="workbench-only"]')).toContain(
      "The inspected page is unchanged."
    );

    const executeButton = document.querySelector<HTMLButtonElement>(".reinject-button");
    expect(executeButton?.textContent).toBe("Re-inject");
    expect(executeButton?.disabled).toBe(false);
    executeButton?.click();
    await flushPromises();
    await flushPanelRender();

    expect(reinjectDraft).not.toHaveBeenCalled();
    expect(text(".reinjection-message")).toBe(
      "Source clone added to Workbench only. The inspected page was not reached."
    );
    expect(document.querySelector(".reinjection-message")?.getAttribute("role")).toBe("status");
    expect(document.querySelector(".reinjection-message")?.getAttribute("aria-live")).toBe("polite");
    expect(text(".event-count")).toBe("2");
    expect(Array.from(document.querySelectorAll(".event-marker")).map((marker) => marker.textContent)).toContain(
      "workbench snapshot"
    );

    openMutationEditor();
    input('.structured-field-input[data-field-name="qty"]', "12");
    document.querySelector<HTMLButtonElement>(".inject-edited-button")?.click();
    await flushPromises();
    await flushPanelRender();

    expect(reinjectDraft).not.toHaveBeenCalled();
    expect(text(".reinjection-message")).toBe(
      "Edited draft added to Workbench only. The inspected page was not reached."
    );
    expect(text(".event-count")).toBe("3");
  });

  it("shows source context after cloning without changing the selected row", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    appendCommandUpdate(panel, "beta", { qty: 2 });

    const firstRow = document.querySelectorAll<HTMLButtonElement>(".event-row")[0];
    firstRow.click();
    expect(document.querySelectorAll<HTMLButtonElement>(".event-row")[0].getAttribute("data-selected")).toBe("true");

    document.querySelector<HTMLButtonElement>(".clone-button")?.click();

    expect(document.querySelectorAll<HTMLButtonElement>(".event-row")[0].getAttribute("data-selected")).toBe("true");
    expect(text(".draft-source-context")).toContain("Source event");
    expect(text(".draft-source-context")).toContain("event-1");
    expect(text(".draft-source-context")).toContain("subscription-1");
    expect(text(".draft-source-context")).toContain("listener-1");
    expect(text(".draft-source-context")).toContain("scenario.snapshot-basic");
    expect(text(".draft-source-context")).toContain("ADD/alpha");
    expect(document.querySelector(".draft-source-fields")).toBeNull();
  });

  it("keeps source command and key immutable in the source summary after edits", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    clickFirstEventRow();
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();
    openMutationEditor();

    input('.structured-field-input[data-field-name="command"]', "UPDATE");
    input('.structured-field-input[data-field-name="key"]', "beta");

    expect(text(".draft-source-summary-meta")).toContain("ADD/alpha");
    const commandKeyRow = Array.from(
      document.querySelectorAll<HTMLElement>(".draft-source-row")
    ).find(
      (row) => row.querySelector<HTMLElement>(".draft-source-label")?.textContent === "Command/key"
    );
    expect(commandKeyRow?.querySelector<HTMLElement>(".draft-source-value")?.textContent).toBe(
      "ADD/alpha"
    );
  });

  it("moves large JSON strings out of narrow diff cells into a full-width editor", () => {
    const modelValues = JSON.stringify({
      alarms: Array.from({ length: 18 }, (_, index) => ({
        domain: `domain-${index}`,
        status: "GREEN",
        timestamp: 1_784_628_396_199 + index
      })),
      baseItemKey: "DDE_HEALTH"
    });
    appendCommandUpdate(panel, "DDE_HEALTH.HEARTBEAT", { modelValues });
    clickFirstEventRow();
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();
    openMutationEditor();

    const summaryRow = document.querySelector<HTMLTableRowElement>(
      '.draft-field-diff tr[data-field-name="modelValues"][data-layout="json-summary"]'
    );
    const editorRow = document.querySelector<HTMLTableRowElement>(
      '.draft-json-editor-row[data-field-name="modelValues"]'
    );
    const jsonInput = editorRow?.querySelector<HTMLTextAreaElement>(".structured-json-input");

    expect(summaryRow).not.toBeNull();
    expect(summaryRow?.querySelector(".draft-field-original")?.textContent).toMatch(
      /^JSON object · 2 keys · [\d.]+k chars$/
    );
    expect(summaryRow?.querySelector(".draft-field-original")?.textContent).not.toContain(
      "domain-17"
    );
    expect(
      Array.from(document.querySelectorAll<HTMLElement>(".draft-field-heading")).map(
        (heading) => heading.textContent
      )
    ).toEqual(["Field", "Original", "Draft"]);
    expect(editorRow?.querySelector<HTMLTableCellElement>(".draft-json-editor-cell")?.colSpan).toBe(3);
    expect(jsonInput?.rows).toBe(10);
    expect(jsonInput?.value).toContain("\n");
    expect(jsonInput?.value).toContain('"baseItemKey": "DDE_HEALTH"');
    expect(text(".structured-json-editor-summary")).toContain("JSON object");
    expect(
      Array.from(editorRow?.querySelectorAll(".parsed-json-disclosure summary") ?? []).map(
        (summary) => summary.textContent
      )
    ).toEqual(["Original captured JSON"]);
    expect(jsonInput?.value).toContain('"alarms": [');

    const editedModelValues = JSON.stringify({ alarms: [], baseItemKey: "DDE_HEALTH_EDITED" }, null, 2);
    input('.structured-json-input[data-field-name="modelValues"]', editedModelValues);

    expect(text(".draft-dirty-count")).toBe("1 changed");
    expect(
      document.querySelector(
        '.draft-field-diff tr[data-field-name="modelValues"] .draft-field-changed-indicator'
      )?.getAttribute("aria-label")
    ).toBe("changed");
    const advanced = openAdvancedDraftJson();
    const advancedDraft = JSON.parse(advanced.value) as { fields: Record<string, unknown> };
    expect(advancedDraft.fields.modelValues).toBe(editedModelValues);
  });

  it("formats short JSON strings directly in their text editor without a draft preview", () => {
    const modelValues = JSON.stringify({ messageId: "6675533", messageType: "TICKER" });
    appendCommandUpdate(panel, "MESSENGER_TICKER", { modelValues });
    clickFirstEventRow();
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();
    openMutationEditor();

    const row = document.querySelector<HTMLTableRowElement>(
      '.draft-field-diff tr[data-field-name="modelValues"]'
    );
    const jsonInput = row?.querySelector<HTMLTextAreaElement>(
      '.structured-field-input[data-field-name="modelValues"]'
    );

    expect(row?.dataset.layout).toBe("scalar");
    expect(jsonInput?.value).toContain("\n");
    expect(jsonInput?.value).toContain('"messageType": "TICKER"');
    expect(jsonInput?.classList).toContain("structured-json-inline-input");
    expect(row?.querySelectorAll(".parsed-json-disclosure")).toHaveLength(1);
    expect(row?.querySelector(".parsed-json-disclosure summary")?.textContent).toBe(
      "Original captured JSON"
    );
    expect(row?.textContent).not.toContain("Draft formatted preview");
  });

  it("preserves focus on the selected execution target after its change rerender", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    clickFirstEventRow();
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();

    const workbenchTarget = document.querySelector<HTMLInputElement>(
      'input[name="draft-execution-target"][value="workbench-only"]'
    );
    if (!workbenchTarget) {
      throw new Error("missing Workbench execution target");
    }
    workbenchTarget.focus();
    workbenchTarget.checked = true;
    workbenchTarget.dispatchEvent(new Event("change", { bubbles: true }));

    const replacement = document.querySelector<HTMLInputElement>(
      'input[name="draft-execution-target"][value="workbench-only"]'
    );
    expect(replacement?.checked).toBe(true);
    expect(document.activeElement).toBe(replacement);
  });

  it("gates a production bridge by status and falls back after disconnect", async () => {
    const reinjectDraft = vi.fn(() => Promise.resolve(createSuccessResult("should-not-run")));
    panel.dispose();
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing test root");
    }
    panel = renderPanel(root);
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    clickFirstEventRow();
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();

    panel.setStatus("idle");
    panel.setBridge({ reinjectDraft });
    expect(
      document.querySelector<HTMLInputElement>(
        'input[name="draft-execution-target"][value="captured-listener"]'
      )?.disabled
    ).toBe(true);

    panel.setStatus("bridge connected");
    const listenerTarget = document.querySelector<HTMLInputElement>(
      'input[name="draft-execution-target"][value="captured-listener"]'
    );
    expect(listenerTarget?.disabled).toBe(false);
    listenerTarget?.click();
    expect(listenerTarget?.checked).toBe(true);

    panel.setStatus("bridge disconnected");
    const disconnectedListener = document.querySelector<HTMLInputElement>(
      'input[name="draft-execution-target"][value="captured-listener"]'
    );
    const workbenchTarget = document.querySelector<HTMLInputElement>(
      'input[name="draft-execution-target"][value="workbench-only"]'
    );
    expect(disconnectedListener?.disabled).toBe(true);
    expect(workbenchTarget?.disabled).toBe(false);
    expect(workbenchTarget?.checked).toBe(true);

    document.querySelector<HTMLButtonElement>(".reinject-button")?.click();
    await flushPromises();
    expect(reinjectDraft).not.toHaveBeenCalled();
    expect(text(".reinjection-message")).toContain("added to Workbench only");
  });

  it("derives changed fields from draft JSON edits without remounting the editor", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    clickFirstEventRow();
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();
    openMutationEditor();
    openAdvancedDraftJson();
    const detail = document.querySelector<HTMLElement>(".detail-pane");
    const textarea = document.querySelector<HTMLTextAreaElement>(".draft-json");
    if (!detail || !textarea) {
      throw new Error("missing detail editor");
    }
    detail.scrollTop = 300;
    textarea.focus();

    editDraftJson((draft) => {
      const fields = draft.fields as Record<string, unknown>;
      fields.qty = "2";
    });

    expect(document.activeElement).toBe(textarea);
    expect(textarea.isConnected).toBe(true);
    expect(text(".draft-changed-fields-preview")).toContain('"qty": "2"');
    expect(detail.scrollTop).toBe(300);
  });

  it("keeps the last valid draft when advanced JSON becomes invalid", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    clickFirstEventRow();
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();
    openMutationEditor();
    openAdvancedDraftJson();
    editDraftJson((draftJson) => {
      (draftJson.fields as Record<string, unknown>).qty = 3;
    });

    input(".draft-json", "{");

    expect(text(".draft-json-error")).toContain("Draft JSON parse error");
    expect(text(".draft-changed-fields-preview")).toContain('"qty": 3');
    expect(document.querySelector<HTMLButtonElement>(".inject-edited-button")?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>(".replay-source-button")?.disabled).toBe(false);
    expect(document.querySelector(".draft-json-error")?.getAttribute("role")).toBe("alert");
  });

  it("uses Escape to leave editing without changing the selected event", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    clickFirstEventRow();
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();
    openMutationEditor();
    const inputElement = document.querySelector<HTMLElement>(
      '.structured-field-input[data-field-name="qty"]'
    );
    inputElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(document.querySelector(".draft-controls")).toBeNull();
    expect(document.querySelector<HTMLButtonElement>(".event-row")?.dataset.selected).toBe("true");
    expect(text(".selected-event-id")).toBe("event-1");
  });

  it("uses Ctrl+Enter to execute the current valid edited action", async () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    clickFirstEventRow();
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();
    openMutationEditor();
    input('.structured-field-input[data-field-name="qty"]', "2");

    document
      .querySelector<HTMLElement>('.structured-field-input[data-field-name="qty"]')
      ?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })
      );
    await flushPromises();
    await flushPanelRender();

    expect(text(".event-count")).toBe("2");
    expect(text(".reinjection-message")).toBe(
      "Edited draft added to Workbench only. The inspected page was not reached."
    );
  });

  it("keeps the Timeline detail editor mounted and focused when new events arrive", async () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    await flushPanelRender();
    clickFirstEventRow();
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();
    openMutationEditor();
    openAdvancedDraftJson();

    const detail = document.querySelector<HTMLElement>(".detail-pane");
    const textarea = document.querySelector<HTMLTextAreaElement>(".draft-json");
    if (!detail || !textarea) {
      throw new Error("missing detail editor");
    }

    detail.scrollTop = 280;
    textarea.focus();
    textarea.setSelectionRange(18, 18);

    for (let index = 0; index < 8; index += 1) {
      appendCommandUpdate(panel, `burst-${index}`, { qty: index + 2 });
    }
    await flushPanelRender();

    const nextTextarea = document.querySelector<HTMLTextAreaElement>(".draft-json");
    expect(nextTextarea).toBe(textarea);
    expect(document.querySelector<HTMLElement>(".detail-pane")?.hidden).toBe(false);
    expect(text(".draft-source-context")).toContain("event-1");
    expect(document.activeElement).toBe(nextTextarea);
    expect(nextTextarea?.selectionStart).toBe(18);
    expect(detail.scrollTop).toBe(280);
  });

  it("keeps editing the cloned source after it leaves the live Timeline window", async () => {
    const modelValues = JSON.stringify({
      selected: false,
      passengers: Array.from({ length: 12 }, (_, index) => ({ id: index, active: true }))
    });
    for (let index = 0; index < 60; index += 1) {
      appendCommandUpdate(panel, `key-${index}`, { modelValues });
    }
    await flushPanelRender();

    const sourceRow = document.querySelector<HTMLButtonElement>(".event-row");
    const sourceEventId = sourceRow?.dataset.eventId;
    sourceRow?.click();
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();
    openMutationEditor();

    appendCommandUpdate(panel, "overflow", { modelValues });
    await flushPanelRender();

    const jsonInput = document.querySelector<HTMLTextAreaElement>(
      '.structured-json-input[data-field-name="modelValues"]'
    );
    if (!jsonInput || !sourceEventId) {
      throw new Error("missing out-of-window JSON draft");
    }
    jsonInput.value = jsonInput.value.replace('"selected": false', '"selected": true');
    jsonInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();

    expect(document.querySelector(".draft-controls")).not.toBeNull();
    expect(text(".draft-source-context")).toContain(sourceEventId);
    expect(text(".selected-event-id")).toBe(sourceEventId);
    expect(
      document.querySelector<HTMLTextAreaElement>(
        '.structured-json-input[data-field-name="modelValues"]'
      )?.value
    ).toContain('"selected": true');
  });

  it("preserves the Timeline viewport and focused event during live updates", async () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    appendCommandUpdate(panel, "beta", { qty: 2 });

    const feed = document.querySelector<HTMLElement>(".event-feed");
    const originalRow = document.querySelector<HTMLButtonElement>(".event-row");
    if (!feed || !originalRow) {
      throw new Error("missing Timeline feed");
    }
    resetScrollWhenChildrenAreReplaced(feed);
    Object.defineProperties(feed, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1000 }
    });
    feed.scrollTop = 180;
    feed.scrollLeft = 23;
    feed.dispatchEvent(new Event("scroll"));
    originalRow.focus();

    appendCommandUpdate(panel, "gamma", { qty: 3 });
    await flushPanelRender();

    expect(feed.scrollTop).toBe(180);
    expect(feed.scrollLeft).toBe(23);
    expect(document.activeElement).not.toBe(originalRow);
    expect(document.activeElement?.classList.contains("event-row")).toBe(true);
    expect(document.activeElement?.textContent).toContain("alpha");
  });

  it("anchors a selected full Timeline window while live events continue", async () => {
    for (let index = 0; index < 60; index += 1) {
      appendCommandUpdate(panel, `anchor-${index}`, { qty: index });
    }
    await flushPanelRender();

    const initialRows = Array.from(document.querySelectorAll<HTMLButtonElement>(".event-row"));
    const initialEventIds = initialRows.map((row) => row.dataset.eventId);
    const selectedRow = initialRows[20];
    const selectedEventId = selectedRow?.dataset.eventId;
    selectedRow?.click();

    appendCommandUpdate(panel, "live-60", { qty: 60 });
    appendCommandUpdate(panel, "live-61", { qty: 61 });
    appendCommandUpdate(panel, "live-62", { qty: 62 });
    await flushPanelRender();

    expect(
      Array.from(document.querySelectorAll<HTMLButtonElement>(".event-row")).map(
        (row) => row.dataset.eventId
      )
    ).toEqual(initialEventIds);
    expect(
      document.querySelector<HTMLButtonElement>('.event-row[data-selected="true"]')?.dataset.eventId
    ).toBe(selectedEventId);
    expect(text(".selected-event-id")).toBe(selectedEventId);
    expect(
      Array.from(document.querySelectorAll<HTMLButtonElement>(".event-window-navigation button")).find(
        (button) => button.textContent === "Latest"
      )?.disabled
    ).toBe(false);
  });

  it("follows events captured while COMMAND State is active until the user scrolls into history", async () => {
    const feed = document.querySelector<HTMLElement>(".event-feed");
    if (!feed) {
      throw new Error("missing Timeline feed");
    }
    resetScrollWhenChildrenAreReplaced(feed);
    Object.defineProperties(feed, {
      clientHeight: { configurable: true, value: 80 },
      scrollHeight: {
        configurable: true,
        get: () => document.querySelectorAll(".event-row").length * 40
      }
    });

    appendCommandUpdate(panel, "alpha", { qty: 1 });
    appendCommandUpdate(panel, "bravo", { qty: 2 });
    document.querySelectorAll<HTMLButtonElement>(".view-selector button")[1]?.click();

    appendCommandUpdate(panel, "charlie", { qty: 3 });
    appendCommandUpdate(panel, "delta", { qty: 4 });
    document.querySelectorAll<HTMLButtonElement>(".view-selector button")[0]?.click();

    expect(document.querySelectorAll(".event-row")).toHaveLength(4);
    expect(feed.scrollTop).toBe(80);
    expect(document.querySelectorAll<HTMLElement>(".event-command")[3]?.textContent).toBe(
      "ADD/delta"
    );

    feed.scrollTop = 0;
    feed.dispatchEvent(new Event("scroll"));
    appendCommandUpdate(panel, "echo", { qty: 5 });
    await flushPanelRender();

    expect(document.querySelectorAll(".event-row")).toHaveLength(5);
    expect(feed.scrollTop).toBe(0);
  });

  it("keeps Timeline event detail sections expanded or collapsed when new events arrive", async () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    await flushPanelRender();
    clickFirstEventRow();

    openDetailSection("Context");
    detailSection("Current item fields").open = false;
    const selectedHeader = document.querySelector(".selected-event-header");

    appendCommandUpdate(panel, "beta", { qty: 2 });
    await flushPanelRender();

    expect(document.querySelector(".selected-event-header")).toBe(selectedHeader);
    expect(text(".detail-pane")).toContain('"id": "event-1"');
    expect(detailSection("Context").open).toBe(true);
    expect(detailSection("Current item fields").open).toBe(false);
  });

  it("clears the cloned draft when selecting a different captured event", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    appendCommandUpdate(panel, "beta", { qty: 2 });

    const rows = document.querySelectorAll<HTMLButtonElement>(".event-row");
    rows[0].click();
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();
    openMutationEditor();
    openAdvancedDraftJson();
    editDraftJson((draft) => {
      const fields = draft.fields as Record<string, unknown>;
      fields.qty = "11";
    });

    expect(text(".draft-source-context")).toContain("event-1");
    expect(text(".draft-changed-fields-preview")).toContain('"qty": "11"');

    document.querySelectorAll<HTMLButtonElement>(".event-row")[1].click();

    expect(document.querySelector<HTMLTextAreaElement>(".draft-json")).toBeNull();
    expect(text(".editor-placeholder")).toBe(
      "Clone this captured item update to replay it unchanged or edit a staged copy."
    );
    expect(document.querySelector<HTMLButtonElement>(".clone-button")?.disabled).toBe(false);
    expect(text(".draft-source-context")).toBe("");
    expect(text(".reinjection-message")).toBe("");
  });

  it("shows validation and disables reinjection when the draft key is cleared", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    clickFirstEventRow();
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();
    openMutationEditor();
    openAdvancedDraftJson();

    editDraftJson((draft) => {
      draft.key = "";
    });

    expect(text(".draft-json-error")).toBe(
      "Draft is missing required COMMAND values. Add a captured subscription, item, command/key, and valid field names before reinjecting."
    );
    expect(document.querySelector<HTMLButtonElement>(".inject-edited-button")?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>(".reinject-button")?.disabled).toBe(false);
  });

  it("re-injects original source values and changed-field semantics after edits exist", async () => {
    const receivedDrafts: ReinjectionDraft[] = [];
    panel.dispose();
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing test root");
    }
    panel = renderPanel(root, undefined, {
      bridge: {
        reinjectDraft(currentDraft) {
          receivedDrafts.push(currentDraft);
          return Promise.resolve(createSuccessResult("source-replay"));
        }
      }
    });
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    clickFirstEventRow();
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();
    openMutationEditor();
    openAdvancedDraftJson();
    editDraftJson((draftJson) => {
      draftJson.isSnapshot = false;
      (draftJson.fields as Record<string, unknown>).qty = 12;
    });

    document.querySelector<HTMLButtonElement>(".replay-source-button")?.click();
    await flushPromises();
    await flushPanelRender();

    expect(receivedDrafts[0]?.fields.qty).toBe(1);
    expect(receivedDrafts[0]?.changedFields).toEqual({ command: "ADD", key: "alpha" });
    expect(receivedDrafts[0]?.isSnapshot).toBe(true);
    expect(text(".reinjection-message")).toBe(
      "Source clone delivered to the original app listener. The inspected page was reached."
    );
  });

  it("reinjects a valid draft and appends a synthetic live row", async () => {
    const receivedDrafts: ReinjectionDraft[] = [];
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing test root");
    }
    panel = renderPanel(root, undefined, {
      bridge: {
        reinjectDraft(draft) {
          receivedDrafts.push(draft);
          return Promise.resolve(createSuccessResult("request-1"));
        }
      }
    });

    appendCommandUpdate(panel, "alpha", { qty: 1 });
    clickFirstEventRow();
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();
    openMutationEditor();
    input('.structured-field-input[data-field-name="qty"]', "2");
    expect(text(".draft-dirty-count")).toBe("1 changed");
    expect(document.querySelector<HTMLInputElement>('.structured-field-input[data-field-name="qty"]')?.type).toBe(
      "number"
    );
    document.querySelector<HTMLButtonElement>(".reset-draft-button")?.click();
    expect(text(".draft-dirty-count")).toBe("0 changed");
    expect(document.querySelector<HTMLInputElement>('.structured-field-input[data-field-name="qty"]')?.value).toBe(
      "1"
    );

    input('.structured-field-input[data-field-name="qty"]', "12");
    const snapshot = document.querySelector<HTMLInputElement>(".structured-snapshot-input");
    if (!snapshot) {
      throw new Error("missing snapshot control");
    }
    snapshot.checked = false;
    snapshot.dispatchEvent(new Event("change", { bubbles: true }));

    const button = document.querySelector<HTMLButtonElement>(".inject-edited-button");
    expect(button?.disabled).toBe(false);
    button?.click();

    expect(text(".inject-edited-button")).toBe("Injecting…");
    expect(document.querySelector(".replay-card")?.getAttribute("aria-busy")).toBe("true");
    await flushPromises();
    await flushPanelRender();

    const receivedDraft = receivedDrafts[0];
    expect(receivedDraft).toBeDefined();
    expect(receivedDraft?.sourceEventId).toBe("event-1");
    expect(receivedDraft?.fields.qty).toBe(12);
    expect(receivedDraft?.changedFields.qty).toBe(12);
    expect(receivedDraft?.isSnapshot).toBe(false);
    expect(text(".reinjection-message")).toBe(
      "Edited draft delivered to the original app listener. The inspected page was reached."
    );
    expect(text(".event-count")).toBe("2");
    expect(Array.from(document.querySelectorAll(".event-marker")).map((marker) => marker.textContent)).toContain(
      "synthetic live"
    );
    expect(document.querySelectorAll<HTMLButtonElement>(".event-row")[0].dataset.selected).toBe("true");
    openDetailSection("Context");
    expect(text(".detail-pane")).toContain('"id": "event-1"');
    expect(text(".detail-pane")).toContain('"source": "server"');
  });

  it("shows stale-target copy without appending a synthetic row", async () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing test root");
    }
    panel = renderPanel(root, undefined, {
      bridge: {
        reinjectDraft() {
          return Promise.resolve({
            requestId: "request-2",
            ok: false,
            status: "stale-target",
            timestamp: 123,
            error: "gone"
          });
        }
      }
    });

    appendCommandUpdate(panel, "alpha", { qty: 1 });
    clickFirstEventRow();
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();
    document.querySelector<HTMLButtonElement>(".reinject-button")?.click();
    await flushPromises();

    expect(text(".reinjection-message")).toBe(
      "Original listener is no longer available. Capture a fresh update for this subscription, then clone it again."
    );
    expect(text(".event-count")).toBe("1");
    expect(Array.from(document.querySelectorAll(".event-marker")).map((marker) => marker.textContent)).not.toContain(
      "synthetic snapshot"
    );
  });

  it("shows listener failure copy without appending a synthetic row", async () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing test root");
    }
    panel = renderPanel(root, undefined, {
      bridge: {
        reinjectDraft() {
          return Promise.resolve({
            requestId: "request-3",
            ok: false,
            status: "listener-error",
            timestamp: 123,
            error: "fixture listener failed"
          });
        }
      }
    });

    appendCommandUpdate(panel, "alpha", { qty: 1 });
    clickFirstEventRow();
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();
    document.querySelector<HTMLButtonElement>(".reinject-button")?.click();
    await flushPromises();

    expect(text(".reinjection-message")).toContain(
      "Reinjection failed before a synthetic event was appended. Review the listener error and adjust the draft."
    );
    expect(text(".reinjection-detail")).toBe("fixture listener failed");
    expect(text(".event-count")).toBe("1");
    expect(Array.from(document.querySelectorAll(".event-marker")).map((marker) => marker.textContent)).not.toContain(
      "synthetic snapshot"
    );
  });
});

function createSuccessResult(requestId: string): ReinjectionResult {
  return {
    requestId,
    ok: true,
    status: "success",
    timestamp: 123
  };
}
