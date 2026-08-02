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
  document.querySelector<HTMLButtonElement>(".mutate-inject-button")?.click();
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
    panel = renderPanel(root, undefined, {
      bridge: {
        reinjectDraft: vi.fn(() => Promise.resolve(createSuccessResult("panel-test")))
      }
    });
  });

  it("renders the toolbar status and zero event count", () => {
    expect(text(".product-label")).toBe("Lightstreamer Workbench");
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

  it("explains TLCP-aligned and local capture lifecycle Timeline codes", () => {
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
    expect(text(".replay-source-button")).toBe("Re-inject");
    expect(text(".mutate-inject-button")).toBe("Mutate & re-inject…");
    expect(document.querySelector(".clone-button")).toBeNull();
    expect(document.querySelector(".draft-execution-targets")).toBeNull();

    document.querySelector<HTMLButtonElement>(".detail-collapse-button")?.click();
    expect(document.querySelector<HTMLElement>(".detail-pane")?.hidden).toBe(true);
  });

  it("renders captured diagnostic context in selected event details", async () => {
    panel.appendCaptureMessage(
      createCaptureMessage("client-error", {
        client: { id: "client-1" },
        listener: { id: "listener-1" },
        diagnostic: { scope: "client", code: 61, message: "parse failed" }
      })
    );
    await flushPanelRender();

    clickFirstEventRow();
    openDetailSection("Context");

    expect(text(".detail-pane")).toContain('"scope": "client"');
    expect(text(".detail-pane")).toContain('"code": "LS-CLIENT-61"');
    expect(text(".detail-pane")).toContain('"serverMessage": "parse failed"');
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

    const searchInput = document.querySelector<HTMLInputElement>(".search-input");
    if (!searchInput) {
      throw new Error("missing Timeline search input");
    }
    searchInput.focus();
    searchInput.value = "alpha";
    searchInput.setSelectionRange(5, 5);
    searchInput.scrollLeft = 12;
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(document.querySelector(".search-input")).toBe(searchInput);
    expect(document.activeElement).toBe(searchInput);
    expect(searchInput.selectionStart).toBe(5);
    expect(searchInput.selectionEnd).toBe(5);
    expect(searchInput.scrollLeft).toBe(12);
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

  describe("high-volume Timeline history navigation", () => {
    it("counts retained matching events newer than each Frozen history window", async () => {
      for (let index = 1; index <= 130; index += 1) {
        appendCommandUpdate(panel, `newer-count-${index}`, { qty: index });
      }
      await flushPanelRender();

      clickButtonByText(".event-window-navigation button", "Older");
      expect(text(".timeline-display-badge")).toBe("Frozen");
      expect(text(".timeline-display-summary")).toContain("60 newer");

      clickButtonByText(".event-window-navigation button", "Older");
      expect(text(".timeline-display-summary")).toContain("120 newer");

      clickButtonByText(".event-window-navigation button", "Newer");
      expect(text(".timeline-display-summary")).toContain("60 newer");
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
      expect(text(".event-render-limit")).toBe(
        "Showing 883–942 of 1,002 retained events."
      );
      expect(
        document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId
      ).toBe("event-883");

      clickButtonByText(".event-window-navigation button", "Newer");
      expect(text(".event-render-limit")).toBe(
        "Showing 943–1,002 of 1,002 retained events."
      );
      clickButtonByText(".event-window-navigation button", "Older");

      let priorWindowFirstId = "";
      while (!Array.from(document.querySelectorAll<HTMLButtonElement>(
        ".event-window-navigation button"
      )).find((button) => button.textContent === "Older")?.disabled) {
        priorWindowFirstId = document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId ?? "";
        feed.scrollTop = 0;
        feed.dispatchEvent(new Event("scroll"));
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

    it("loads the preceding Timeline window when a high-volume live stream is scrolled to the top", async () => {
      document.body.innerHTML = '<main id="app"></main>';
      const root = document.querySelector<HTMLElement>("#app");
      const store = createEventStore();
      if (!root) {
        throw new Error("missing test root");
      }
      renderPanel(root, undefined, { store });

      for (let index = 1; index <= 61; index += 1) {
        store.append({
          id: `live-volume-event-${index}`,
          timestamp: index,
          direction: "inbound",
          source: "server",
          synthetic: false,
          kind: "item-update",
          subscription: { id: "subscription-1", mode: "COMMAND" },
          item: { name: "volume-item", position: 1 },
          update: {
            isSnapshot: false,
            command: "UPDATE",
            key: `key-${index}`,
            fields: { command: "UPDATE", key: `key-${index}` },
            changedFields: { key: `key-${index}` }
          }
        });
      }
      await flushPanelRender();

      expect(text(".event-render-limit")).toBe(
        "Showing 2–61 of 61 retained events."
      );
      const feed = document.querySelector<HTMLElement>(".event-feed");
      if (!feed) {
        throw new Error("missing event feed");
      }
      Object.defineProperties(feed, {
        clientHeight: { configurable: true, value: 200 },
        scrollHeight: { configurable: true, value: 1_000 }
      });

      feed.scrollTop = 800;
      feed.dispatchEvent(new Event("scroll"));
      feed.scrollTop = 0;
      feed.dispatchEvent(new Event("scroll"));
      await flushPanelRender();

      expect(text(".event-render-limit")).toBe(
        "Showing 1–1 of 61 retained events."
      );
      expect(document.querySelectorAll(".event-row")).toHaveLength(1);
      expect(root.querySelectorAll("*").length).toBeLessThan(1_000);

      feed.scrollTop = 400;
      feed.dispatchEvent(new Event("scroll"));
      feed.scrollTop = 800;
      feed.dispatchEvent(new Event("scroll"));
      await flushPanelRender();

      expect(text(".event-render-limit")).toBe(
        "Showing 2–61 of 61 retained events."
      );
      expect(document.querySelectorAll(".event-row")).toHaveLength(60);
    });

    it("scrolls through every bounded Timeline window and back to latest", () => {
      document.body.innerHTML = '<main id="app"></main>';
      const root = document.querySelector<HTMLElement>("#app");
      const store = createEventStore();
      if (!root) {
        throw new Error("missing test root");
      }
      for (let index = 1; index <= 180; index += 1) {
        store.append({
          id: `scroll-roundtrip-${index}`,
          timestamp: index,
          direction: "inbound",
          source: "server",
          synthetic: false,
          kind: "item-update",
          update: { command: "UPDATE", key: `key-${index}` }
        });
      }
      renderPanel(root, undefined, { store });

      const feed = document.querySelector<HTMLElement>(".event-feed");
      if (!feed) {
        throw new Error("missing Timeline feed");
      }
      Object.defineProperties(feed, {
        clientHeight: { configurable: true, value: 200 },
        scrollHeight: { configurable: true, value: 1_000 }
      });
      const visibleRange = () => text(".event-render-limit");
      const firstVisibleId = () =>
        document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId;
      const visibleIds = () =>
        Array.from(document.querySelectorAll<HTMLButtonElement>(".event-row")).map(
          (row) => row.dataset.eventId
        );

      feed.scrollTop = 800;
      feed.dispatchEvent(new Event("scroll"));
      expect(visibleRange()).toBe("Showing 121–180 of 180 retained events.");
      const newestWindow = visibleIds();

      feed.scrollTop = 0;
      feed.dispatchEvent(new Event("scroll"));
      expect(visibleRange()).toBe("Showing 61–120 of 180 retained events.");
      expect(firstVisibleId()).toBe("scroll-roundtrip-61");
      const middleWindow = visibleIds();

      feed.scrollTop = 0;
      feed.dispatchEvent(new Event("scroll"));
      expect(visibleRange()).toBe("Showing 1–60 of 180 retained events.");
      expect(firstVisibleId()).toBe("scroll-roundtrip-1");
      const oldestWindow = visibleIds();
      expect([...oldestWindow, ...middleWindow, ...newestWindow]).toEqual(
        Array.from({ length: 180 }, (_, index) => `scroll-roundtrip-${index + 1}`)
      );

      feed.scrollTop = 400;
      feed.dispatchEvent(new Event("scroll"));
      feed.scrollTop = 800;
      feed.dispatchEvent(new Event("scroll"));
      expect(visibleRange()).toBe("Showing 61–120 of 180 retained events.");
      expect(firstVisibleId()).toBe("scroll-roundtrip-61");

      feed.scrollTop = 800;
      feed.dispatchEvent(new Event("scroll"));
      expect(visibleRange()).toBe("Showing 121–180 of 180 retained events.");
      expect(firstVisibleId()).toBe("scroll-roundtrip-121");
      expect(document.querySelectorAll(".event-row")).toHaveLength(60);
      expect(root.querySelectorAll("*").length).toBeLessThan(1_000);
    });

    it("keeps the scrolled Timeline history window stable while live events append", async () => {
      document.body.innerHTML = '<main id="app"></main>';
      const root = document.querySelector<HTMLElement>("#app");
      const store = createEventStore();
      if (!root) {
        throw new Error("missing test root");
      }
      const append = (index: number) =>
        store.append({
          id: `scroll-anchor-${index}`,
          timestamp: index,
          direction: "inbound",
          source: "server",
          synthetic: false,
          kind: "item-update",
          update: { command: "UPDATE", key: `key-${index}` }
        });
      for (let index = 1; index <= 125; index += 1) {
        append(index);
      }
      renderPanel(root, undefined, { store });

      const feed = document.querySelector<HTMLElement>(".event-feed");
      if (!feed) {
        throw new Error("missing Timeline feed");
      }
      Object.defineProperties(feed, {
        clientHeight: { configurable: true, value: 200 },
        scrollHeight: { configurable: true, value: 1_000 }
      });
      feed.scrollTop = 800;
      feed.dispatchEvent(new Event("scroll"));
      feed.scrollTop = 0;
      feed.dispatchEvent(new Event("scroll"));

      const anchoredIds = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".event-row")
      ).map((row) => row.dataset.eventId);
      expect(text(".event-render-limit")).toBe(
        "Showing 6–65 of 125 retained events."
      );

      for (let index = 126; index <= 130; index += 1) {
        append(index);
      }
      await flushPanelRender();

      expect(text(".event-render-limit")).toBe(
        "Showing 6–65 of 130 retained events."
      );
      expect(
        Array.from(
          document.querySelectorAll<HTMLButtonElement>(".event-row")
        ).map((row) => row.dataset.eventId)
      ).toEqual(anchoredIds);

      feed.scrollTop = 0;
      feed.dispatchEvent(new Event("scroll"));
      expect(text(".event-render-limit")).toBe(
        "Showing 1–5 of 130 retained events."
      );
      expect(
        document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId
      ).toBe("scroll-anchor-1");
    });

    it("resets scroll paging to the latest matching window when Timeline filters change", () => {
      document.body.innerHTML = '<main id="app"></main>';
      const root = document.querySelector<HTMLElement>("#app");
      const store = createEventStore();
      if (!root) {
        throw new Error("missing test root");
      }
      for (let index = 1; index <= 180; index += 1) {
        const id =
          index <= 90 ? `filter-hit-${index}` : `filter-miss-${index}`;
        store.append({
          id,
          timestamp: index,
          direction: "inbound",
          source: "server",
          synthetic: false,
          kind: "item-update",
          update: { command: "UPDATE", key: id }
        });
      }
      renderPanel(root, undefined, { store });

      const feed = document.querySelector<HTMLElement>(".event-feed");
      if (!feed) {
        throw new Error("missing Timeline feed");
      }
      Object.defineProperties(feed, {
        clientHeight: { configurable: true, value: 200 },
        scrollHeight: { configurable: true, value: 1_000 }
      });
      feed.scrollTop = 800;
      feed.dispatchEvent(new Event("scroll"));
      feed.scrollTop = 0;
      feed.dispatchEvent(new Event("scroll"));
      expect(text(".event-render-limit")).toBe(
        "Showing 61–120 of 180 retained events."
      );

      input(".search-input", "filter-hit-");
      expect(text(".filtered-count")).toBe("90 shown");
      expect(text(".event-render-limit")).toBe(
        "Showing 31–90 of 90 retained events."
      );

      feed.scrollTop = 0;
      feed.dispatchEvent(new Event("scroll"));
      expect(text(".event-render-limit")).toBe(
        "Showing 1–30 of 90 retained events."
      );
      expect(
        document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId
      ).toBe("filter-hit-1");

      input(".search-input", "");
      expect(text(".event-render-limit")).toBe(
        "Showing 121–180 of 180 retained events."
      );
      expect(
        document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId
      ).toBe("filter-miss-121");
    });
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

    clickButtonByText(".event-window-navigation button", "Follow live");
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
      scrollHeight: { configurable: true, value: 1_000 }
    });
    expect(document.querySelectorAll(".event-row")).toHaveLength(60);
    expect(document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId).toBe(
      "async-event-442"
    );
    feed.scrollTop = 800;
    feed.dispatchEvent(new Event("scroll"));
    feed.scrollTop = 0;
    feed.dispatchEvent(new Event("scroll"));
    await flushPromises();

    expect(document.querySelectorAll(".event-row")).toHaveLength(60);
    expect(document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId).toBe(
      "async-event-382"
    );

    clickButtonByText(".event-window-navigation button", "Newer");
    await flushPromises();
    expect(document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId).toBe(
      "async-event-442"
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

  it("keeps a bounded live tail moving while one latest reconciliation is in flight", async () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const memoryStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }

    const pendingLatest: Array<{
      resolve: () => void;
    }> = [];
    let latestQueriesInFlight = 0;
    let maximumLatestQueriesInFlight = 0;
    const store: EventStore = {
      ...memoryStore,
      queryEvents(query) {
        if (query?.limit !== 60 || query.offset !== 0) {
          return memoryStore.queryEvents(query);
        }
        latestQueriesInFlight += 1;
        maximumLatestQueriesInFlight = Math.max(
          maximumLatestQueriesInFlight,
          latestQueriesInFlight
        );
        return new Promise((resolve) => {
          pendingLatest.push({
            resolve: () => {
              latestQueriesInFlight -= 1;
              resolve(memoryStore.queryEvents(query));
            }
          });
        });
      }
    };

    const controller = renderPanel(root, undefined, { store });
    expect(pendingLatest).toHaveLength(1);
    pendingLatest.shift()?.resolve();
    await flushPromises();

    for (let index = 1; index <= 1_000; index += 1) {
      appendCommandUpdate(controller, `live-tail-${index}`, { qty: index });
    }

    await waitForCondition(
      () =>
        Array.from(document.querySelectorAll(".event-command")).at(-1)?.textContent ===
        "ADD/live-tail-1000",
      250
    );
    expect(document.querySelectorAll(".event-row")).toHaveLength(60);
    expect(pendingLatest).toHaveLength(1);
    expect(maximumLatestQueriesInFlight).toBe(1);

    pendingLatest.shift()?.resolve();
    await flushPromises();
    expect(pendingLatest).toHaveLength(1);
    expect(maximumLatestQueriesInFlight).toBe(1);

    pendingLatest.shift()?.resolve();
    await flushPromises();
    expect(Array.from(document.querySelectorAll(".event-command")).at(-1)?.textContent).toBe(
      "ADD/live-tail-1000"
    );
    controller.dispose();
  });

  it("keeps scroll-paged Timeline history stable during concurrent IndexedDB capture", async () => {
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
      Object.defineProperties(feed, {
        clientHeight: { configurable: true, value: 200 },
        scrollHeight: { configurable: true, value: 1_000 }
      });
      feed.scrollTop = 800;
      feed.dispatchEvent(new Event("scroll"));
      feed.scrollTop = 0;
      feed.dispatchEvent(new Event("scroll"));
      appendCommandUpdate(controller, "indexed-601", { qty: 601 });

      await waitForCondition(() => text(".event-count") === "601");
      await waitForCondition(
        () => document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId === "event-481"
      );
      await waitForCondition(
        () => text(".event-render-limit") === "Showing 481–540 of 601 retained events."
      );

      expect(document.querySelectorAll(".event-row")).toHaveLength(60);
      expect(text(".event-render-limit")).toBe("Showing 481–540 of 601 retained events.");

      clickButtonByText(".event-window-navigation button", "Newer");
      await waitForCondition(
        () => document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId === "event-541"
      );
      expect(text(".event-render-limit")).toBe("Showing 541–600 of 601 retained events.");

      clickButtonByText(".event-window-navigation button", "Follow live");
      await waitForCondition(
        () => document.querySelector<HTMLButtonElement>(".event-row")?.dataset.eventId === "event-542"
      );
      expect(text(".event-render-limit")).toBe("Showing 542–601 of 601 retained events.");
      expect(Array.from(document.querySelectorAll(".event-command")).at(-1)?.textContent).toBe(
        "ADD/indexed-601"
      );
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

  it("labels successful wire replays and shows their page-delivery provenance", () => {
    panel.dispose();
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const store = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    panel = renderPanel(root, undefined, { store });

    store.append({
      id: "synthetic-wire-1",
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
        executionTarget: "captured-wire",
        deliveredToPage: true,
        editedFields: { qty: 22 }
      }
    });

    expect(text(".event-marker")).toBe("wire replay live");
    clickFirstEventRow();
    expect(text(".selected-event-source")).toBe("Wire replay");
    expect(document.querySelector(".selected-event-source")?.classList).toContain(
      "source-wire-replay"
    );
    const provenance = openDetailSection("Synthetic provenance").textContent ?? "";
    expect(provenance).toContain('"executionTarget": "captured-wire"');
    expect(provenance).toContain('"deliveredToPage": true');
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

  it("disables replay actions for non-item-update rows", () => {
    panel.appendCaptureMessage(
      createCaptureMessage("client-status", {
        client: { id: "client-1", status: "CONNECTED:WS-STREAMING" }
      })
    );
    clickFirstEventRow();

    expect(document.querySelector<HTMLButtonElement>(".replay-source-button")?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>(".mutate-inject-button")?.disabled).toBe(true);
    expect(document.querySelector(".clone-button")).toBeNull();
  });

  it("exposes direct replay and mutation actions without a delivery-target step", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    clickFirstEventRow();

    expect(text(".replay-source-button")).toBe("Re-inject");
    expect(text(".mutate-inject-button")).toBe("Mutate & re-inject…");
    expect(document.querySelector(".clone-button")).toBeNull();
    expect(document.querySelector(".draft-execution-targets")).toBeNull();
    expect(document.querySelector(".draft-source-context")).toBeNull();

    openMutationEditor();

    expect(text(".draft-source-context")).toContain("Replay source");
    expect(document.querySelector(".draft-controls")).not.toBeNull();
  });

  it("blocks replay when the captured page stream is unavailable", async () => {
    panel.dispose();
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing test root");
    }
    panel = renderPanel(root);
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

    const executeButton = document.querySelector<HTMLButtonElement>(".reinject-button");
    expect(executeButton?.textContent).toBe("Re-inject");
    expect(executeButton?.disabled).toBe(true);
    expect(executeButton?.title).toContain("captured page WebSocket bridge is unavailable");
    expect(document.querySelector<HTMLButtonElement>(".mutate-inject-button")?.disabled).toBe(false);
    expect(document.querySelector(".draft-execution-targets")).toBeNull();
    executeButton?.click();
    await flushPromises();
    await flushPanelRender();

    expect(document.querySelector(".reinjection-message")).toBeNull();
    expect(text(".event-count")).toBe("1");

    openMutationEditor();
    input('.structured-field-input[data-field-name="qty"]', "12");
    expect(document.querySelector<HTMLButtonElement>(".inject-edited-button")?.disabled).toBe(true);
    document.querySelector<HTMLButtonElement>(".inject-edited-button")?.click();
    await flushPromises();
    await flushPanelRender();

    expect(text(".event-count")).toBe("1");
    expect(document.querySelector('.event-row[data-synthetic="true"]')).toBeNull();
  });

  it("shows source context after opening mutation without changing the selected row", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    appendCommandUpdate(panel, "beta", { qty: 2 });

    const firstRow = document.querySelectorAll<HTMLButtonElement>(".event-row")[0];
    firstRow.click();
    expect(document.querySelectorAll<HTMLButtonElement>(".event-row")[0].getAttribute("data-selected")).toBe("true");

    openMutationEditor();

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

  it("preserves JSON editor and detail scroll state across repeated field edits", () => {
    const modelValues = JSON.stringify({
      alarms: Array.from({ length: 24 }, (_, index) => ({
        domain: `domain-${index}`,
        status: "GREEN",
        timestamp: 1_784_628_396_199 + index
      })),
      baseItemKey: "DDE_HEALTH"
    });
    appendCommandUpdate(panel, "DDE_HEALTH.HEARTBEAT", { modelValues });
    clickFirstEventRow();
    openMutationEditor();

    const detail = document.querySelector<HTMLElement>(".detail-pane");
    const jsonInput = document.querySelector<HTMLTextAreaElement>(
      '.structured-json-input[data-field-name="modelValues"]'
    );
    if (!detail || !jsonInput) {
      throw new Error("missing expanded JSON field editor");
    }
    resetScrollWhenChildrenAreReplaced(detail);

    jsonInput.focus();
    const initialCaret = jsonInput.value.lastIndexOf("}");
    jsonInput.setSelectionRange(initialCaret, initialCaret);
    jsonInput.scrollTop = 360;
    jsonInput.scrollLeft = 18;
    detail.scrollTop = 640;
    detail.scrollLeft = 12;

    for (const insertedText of [" ", "x", " "]) {
      const caret = jsonInput.selectionStart ?? 0;
      jsonInput.setRangeText(insertedText, caret, caret, "end");
      const expectedCaret = caret + insertedText.length;
      jsonInput.dispatchEvent(new Event("input", { bubbles: true }));

      expect(
        document.querySelector<HTMLTextAreaElement>(
          '.structured-json-input[data-field-name="modelValues"]'
        )
      ).toBe(jsonInput);
      expect(jsonInput.isConnected).toBe(true);
      expect(document.activeElement).toBe(jsonInput);
      expect(jsonInput.selectionStart).toBe(expectedCaret);
      expect(jsonInput.selectionEnd).toBe(expectedCaret);
      expect(jsonInput.scrollTop).toBe(360);
      expect(jsonInput.scrollLeft).toBe(18);
      expect(detail.scrollTop).toBe(640);
      expect(detail.scrollLeft).toBe(12);
    }
  });

  it("keeps replay key and number inputs mounted while editing", () => {
    appendCommandUpdate(panel, "alpha", { qty: 12_345 });
    clickFirstEventRow();
    openMutationEditor();

    const detail = document.querySelector<HTMLElement>(".detail-pane");
    const keyInput = document.querySelector<HTMLTextAreaElement>(
      '.structured-field-input[data-field-name="key"]'
    );
    if (!detail || !keyInput) {
      throw new Error("missing replay key editor");
    }
    resetScrollWhenChildrenAreReplaced(detail);

    keyInput.focus();
    keyInput.setSelectionRange(2, 2);
    keyInput.scrollTop = 22;
    keyInput.scrollLeft = 14;
    detail.scrollTop = 520;
    detail.scrollLeft = 8;
    keyInput.setRangeText("X", 2, 2, "end");
    keyInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(
      document.querySelector<HTMLTextAreaElement>(
        '.structured-field-input[data-field-name="key"]'
      )
    ).toBe(keyInput);
    expect(keyInput.isConnected).toBe(true);
    expect(document.activeElement).toBe(keyInput);
    expect(keyInput.selectionStart).toBe(3);
    expect(keyInput.selectionEnd).toBe(3);
    expect(keyInput.scrollTop).toBe(22);
    expect(keyInput.scrollLeft).toBe(14);
    expect(detail.scrollTop).toBe(520);
    expect(detail.scrollLeft).toBe(8);

    const numberInput = document.querySelector<HTMLInputElement>(
      '.structured-field-input[data-field-name="qty"]'
    );
    if (!numberInput) {
      throw new Error("missing replay number editor");
    }
    numberInput.focus();
    numberInput.value = "123456";
    numberInput.scrollLeft = 17;
    detail.scrollTop = 540;
    detail.scrollLeft = 9;
    numberInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(
      document.querySelector<HTMLInputElement>(
        '.structured-field-input[data-field-name="qty"]'
      )
    ).toBe(numberInput);
    expect(numberInput.isConnected).toBe(true);
    expect(document.activeElement).toBe(numberInput);
    expect(numberInput.scrollLeft).toBe(17);
    expect(detail.scrollTop).toBe(540);
    expect(detail.scrollLeft).toBe(9);
    expect(text(".draft-dirty-count")).toBe("2 changed");

    const advancedDraft = JSON.parse(openAdvancedDraftJson().value) as {
      key: string;
      fields: Record<string, unknown>;
    };
    expect(advancedDraft.key).toBe("alXpha");
    expect(advancedDraft.fields.qty).toBe(123456);
  });

  it("formats short JSON strings directly in their text editor without a draft preview", () => {
    const modelValues = JSON.stringify({ messageId: "6675533", messageType: "TICKER" });
    appendCommandUpdate(panel, "MESSENGER_TICKER", { modelValues });
    clickFirstEventRow();
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

  it("keeps the capture-derived delivery path out of the replay UI", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    clickFirstEventRow();

    expect(document.querySelector(".draft-execution-targets")).toBeNull();
    expect(document.querySelectorAll('input[name="draft-execution-target"]')).toHaveLength(0);
    expect(document.querySelector<HTMLButtonElement>(".replay-source-button")?.disabled).toBe(false);
  });

  it("gates a production bridge by status without a local fallback", async () => {
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

    panel.setStatus("idle");
    panel.setBridge({ reinjectDraft });
    expect(document.querySelector<HTMLButtonElement>(".replay-source-button")?.disabled).toBe(true);

    panel.setStatus("bridge connected");
    expect(document.querySelector<HTMLButtonElement>(".replay-source-button")?.disabled).toBe(false);

    panel.setStatus("bridge disconnected");
    expect(document.querySelector<HTMLButtonElement>(".replay-source-button")?.disabled).toBe(true);
    expect(document.querySelector(".draft-execution-targets")).toBeNull();

    document.querySelector<HTMLButtonElement>(".reinject-button")?.click();
    await flushPromises();
    expect(reinjectDraft).not.toHaveBeenCalled();
    expect(document.querySelector(".reinjection-message")).toBeNull();
  });

  it("preserves nested editor state when bridge availability rerenders the detail", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    clickFirstEventRow();
    openMutationEditor();
    const textarea = openAdvancedDraftJson();
    const detail = document.querySelector<HTMLElement>(".detail-pane");
    if (!detail) {
      throw new Error("missing Timeline detail pane");
    }
    resetScrollWhenChildrenAreReplaced(detail);

    textarea.focus();
    textarea.setSelectionRange(40, 40);
    textarea.scrollTop = 180;
    textarea.scrollLeft = 16;
    detail.scrollTop = 460;
    detail.scrollLeft = 10;

    panel.setBridge({
      reinjectDraft: vi.fn(() => Promise.resolve(createSuccessResult("replacement-bridge")))
    });

    const nextTextarea = document.querySelector<HTMLTextAreaElement>(".draft-json");
    expect(nextTextarea).not.toBeNull();
    expect(document.activeElement).toBe(nextTextarea);
    expect(nextTextarea?.selectionStart).toBe(40);
    expect(nextTextarea?.selectionEnd).toBe(40);
    expect(nextTextarea?.scrollTop).toBe(180);
    expect(nextTextarea?.scrollLeft).toBe(16);
    expect(detail.scrollTop).toBe(460);
    expect(detail.scrollLeft).toBe(10);
    expect(detailSection("Advanced Draft JSON").open).toBe(true);
  });

  it("derives changed fields from draft JSON edits without remounting the editor", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    clickFirstEventRow();
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
      "Edited update delivered to every current listener on the target Subscription. The inspected page was reached."
    );
  });

  it("keeps the Timeline detail editor mounted and focused when new events arrive", async () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    await flushPanelRender();
    clickFirstEventRow();
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

  it("keeps editing the replay source after it leaves the live Timeline window", async () => {
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

  it("keeps a selected detail pinned while the Live Timeline continues", async () => {
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

    const updatedEventIds = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".event-row")
    ).map((row) => row.dataset.eventId);
    expect(updatedEventIds).not.toEqual(initialEventIds);
    expect(updatedEventIds.at(-1)).toBe("event-63");
    expect(
      document.querySelector<HTMLButtonElement>('.event-row[data-selected="true"]')?.dataset.eventId
    ).toBe(selectedEventId);
    expect(text(".selected-event-id")).toBe(selectedEventId);
    expect(text(".timeline-display-badge")).toBe("Live");
  });

  it("separates Capture from a filtered Frozen Timeline and follows live on request", async () => {
    appendCommandUpdate(panel, "alpha-1", { qty: 1 });
    appendCommandUpdate(panel, "alpha-2", { qty: 2 });
    await flushPanelRender();
    input(".search-input", "alpha");
    await flushPromises();

    const frozenIds = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".event-row")
    ).map(({ dataset }) => dataset.eventId);
    clickButtonByText(".timeline-display-state button", "Freeze view");
    document.querySelector<HTMLButtonElement>(".event-row")?.click();
    appendCommandUpdate(panel, "beta-ignored", { qty: 3 });
    appendCommandUpdate(panel, "alpha-3", { qty: 4 });
    appendCommandUpdate(panel, "alpha-4", { qty: 5 });
    await flushPanelRender();

    expect(text(".status-badge")).toBe("capturing");
    expect(text(".timeline-display-badge")).toBe("Frozen");
    expect(text(".timeline-display-summary")).toContain("2 newer");
    expect(
      Array.from(document.querySelectorAll<HTMLButtonElement>(".event-row")).map(
        ({ dataset }) => dataset.eventId
      )
    ).toEqual(frozenIds);
    expect(text(".selected-event-id")).toBe(frozenIds[0]);

    clickButtonByText(".timeline-display-state button", "Follow live");
    await flushPromises();
    expect(text(".timeline-display-badge")).toBe("Live");
    expect(text(".timeline-display-summary")).not.toContain("newer");
    expect(Array.from(document.querySelectorAll(".event-command")).at(-1)?.textContent).toBe(
      "ADD/alpha-4"
    );
    expect(text(".selected-event-id")).toBe(frozenIds[0]);
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

    expect(document.querySelectorAll(".event-row")).toHaveLength(4);
    expect(feed.scrollTop).toBe(0);
    expect(text(".timeline-display-badge")).toBe("Frozen");
    expect(text(".timeline-display-summary")).toContain("1 newer");
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

  it("clears the replay draft when selecting a different captured event", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    appendCommandUpdate(panel, "beta", { qty: 2 });

    const rows = document.querySelectorAll<HTMLButtonElement>(".event-row");
    rows[0].click();
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
    expect(document.querySelector<HTMLButtonElement>(".replay-source-button")?.disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>(".mutate-inject-button")?.disabled).toBe(false);
    expect(document.querySelector(".clone-button")).toBeNull();
    expect(text(".draft-source-context")).toBe("");
    expect(text(".reinjection-message")).toBe("");
  });

  it("shows validation and disables reinjection when the draft key is cleared", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    clickFirstEventRow();
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
      "Source update delivered to every current listener on the target Subscription. The inspected page was reached."
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

    expect(text(".inject-edited-button")).toBe("Re-injecting…");
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
      "Edited update delivered to every current listener on the target Subscription. The inspected page was reached."
    );
    expect(text(".event-count")).toBe("2");
    expect(Array.from(document.querySelectorAll(".event-marker")).map((marker) => marker.textContent)).toContain(
      "synthetic live"
    );
    expect(
      document.querySelector<HTMLButtonElement>(
        '.event-row[data-event-id="synthetic-request-1"]'
      )?.dataset.selected
    ).toBe("true");
    expect(text(".selected-event-id")).toBe("synthetic-request-1");
    expect(detailSection("Current item fields").textContent).toContain('"qty": 12');
    openDetailSection("Context");
    expect(text(".detail-pane")).toContain('"id": "synthetic-request-1"');
    expect(text(".detail-pane")).toContain('"source": "synthetic"');
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
    document.querySelector<HTMLButtonElement>(".reinject-button")?.click();
    await flushPromises();

    expect(text(".reinjection-message")).toBe(
      "The inspected page can no longer receive this replay. Capture a fresh update for this subscription, then try again."
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
    document.querySelector<HTMLButtonElement>(".reinject-button")?.click();
    await flushPromises();

    expect(text(".reinjection-message")).toContain(
      "Reinjection failed before a synthetic event was appended. Review the delivery error and adjust the draft."
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
