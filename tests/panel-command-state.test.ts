import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { createEventStore, type InMemoryEventStore } from "../src/core/event-store";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { type PanelController, renderPanel } from "../src/extension/panel/main";
import { type ReinjectionDraft } from "../src/core/reinjection-draft";
import { type ReinjectionResult } from "../src/bridge/messages";

type Fields = NonNullable<LightstreamerEventEnvelope["update"]>["fields"];

function text(selector: string): string {
  return document.querySelector(selector)?.textContent ?? "";
}

function texts(selector: string): string[] {
  return Array.from(document.querySelectorAll(selector)).map((element) => element.textContent ?? "");
}

function selectedTexts(selector: string): string[] {
  return Array.from(document.querySelectorAll(`${selector}[data-selected="true"]`)).map(
    (element) => element.textContent ?? ""
  );
}

function resetScrollWhenChildrenAreReplaced(pane: HTMLElement): void {
  const replaceChildren = pane.replaceChildren.bind(pane);
  vi.spyOn(pane, "replaceChildren").mockImplementation((...nodes: (Node | string)[]) => {
    pane.scrollTop = 0;
    pane.scrollLeft = 0;
    replaceChildren(...nodes);
  });
}

async function flushInteractionRender(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 40));
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

function control(selector: string): HTMLInputElement | HTMLSelectElement {
  const element = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  if (!element) {
    throw new Error(`missing control ${selector}`);
  }
  return element;
}

function button(selector: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(selector);
  if (!element) {
    throw new Error(`missing button ${selector}`);
  }
  return element;
}

function input(selector: string, value: string): void {
  const element = control(selector);
  element.value = value;
  element.dispatchEvent(
    new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })
  );
}

function checkbox(selector: string, checked: boolean): void {
  const element = document.querySelector<HTMLInputElement>(selector);
  if (!element) {
    throw new Error(`missing checkbox ${selector}`);
  }
  element.checked = checked;
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function clickCommandState(): void {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>(".view-selector button")).find(
    (candidate) => candidate.textContent === "COMMAND State"
  );
  if (!button) {
    throw new Error("missing COMMAND State view button");
  }
  button.click();
}

function clickRowByText(selector: string, value: string): void {
  const row = Array.from(document.querySelectorAll<HTMLButtonElement>(selector)).find((candidate) =>
    (candidate.textContent ?? "").includes(value)
  );
  if (!row) {
    throw new Error(`missing row containing ${value}`);
  }
  row.click();
}

function event(
  id: string,
  overrides: {
    subscriptionId?: string;
    mode?: string | null;
    itemName?: string | null;
    itemPosition?: number | null;
    command?: string | null;
    key?: string | null;
    fields?: Fields;
    changedFields?: Fields;
    snapshot?: boolean;
    source?: LightstreamerEventEnvelope["source"];
    synthetic?: boolean;
    raw?: LightstreamerEventEnvelope["raw"];
    subscriptionItems?: string[];
    subscriptionItemGroup?: string | null;
  } = {}
): LightstreamerEventEnvelope {
  const command: string | null = Object.prototype.hasOwnProperty.call(overrides, "command")
    ? overrides.command ?? null
    : "ADD";
  const key: string | null = Object.prototype.hasOwnProperty.call(overrides, "key")
    ? overrides.key ?? null
    : "alpha";
  const itemName: string | null = Object.prototype.hasOwnProperty.call(overrides, "itemName")
    ? overrides.itemName ?? null
    : "item-a";
  const itemPosition: number | null = Object.prototype.hasOwnProperty.call(overrides, "itemPosition")
    ? overrides.itemPosition ?? null
    : 1;
  return {
    id,
    timestamp: 1_700_000_000_000 + Number(id.replace(/\D/g, "") || 0),
    direction: "inbound",
    source: overrides.source ?? "server",
    synthetic: overrides.synthetic ?? false,
    kind: "item-update",
    client: { id: "client-1" },
    subscription: {
      id: overrides.subscriptionId ?? "sub-command",
      mode: overrides.mode ?? "COMMAND",
      items: overrides.subscriptionItems,
      itemGroup: overrides.subscriptionItemGroup,
      fields: ["command", "key", "name", "qty", "html", "status"]
    },
    listener: { id: "listener-1" },
    item: {
      name: itemName,
      position: itemPosition
    },
    update: {
      isSnapshot: overrides.snapshot ?? false,
      command,
      key,
      fields: overrides.fields ?? {
        command,
        key,
        name: `${key}-name`,
        qty: "1",
        html: "<img src=x onerror=alert(1)>",
        status: "open"
      },
      changedFields: overrides.changedFields ?? { command, key }
    },
    raw: overrides.raw ?? {
      diagnosticText: "<script>alert('diagnostic')</script>",
      fixture: { id, note: `${overrides.subscriptionId ?? "sub-command"} ${key ?? "missing-key"}` }
    }
  };
}

function seedCommandEvents(store: InMemoryEventStore): void {
  store.append(
    event("event-1", {
      command: "ADD",
      key: "alpha",
      snapshot: true,
      fields: {
        command: "ADD",
        key: "alpha",
        name: "Alpha",
        qty: "1",
        html: "<img src=x onerror=alert(1)>",
        status: "snapshot"
      }
    })
  );
  store.append(
    event("event-2", {
      command: "UPDATE",
      key: "alpha",
      fields: {
        command: "UPDATE",
        key: "alpha",
        name: "Alpha",
        qty: "2",
        html: "<img src=x onerror=alert(1)>",
        status: "live"
      },
      changedFields: { qty: "2", status: "live" }
    })
  );
  store.append(event("event-3", { command: "ADD", key: "beta", snapshot: true }));
  store.append(event("event-4", { command: "DELETE", key: "beta", changedFields: { status: "closed" } }));
  store.append(
    event("event-5", {
      command: "UPDATE",
      key: "alpha",
      source: "synthetic",
      synthetic: true,
      fields: {
        command: "UPDATE",
        key: "alpha",
        name: "Alpha",
        qty: "3",
        html: "<strong>synthetic-value</strong>",
        status: "synthetic"
      },
      changedFields: { qty: "3", html: "<strong>synthetic-value</strong>", status: "synthetic" },
      raw: { sourceEventId: "event-2", patch: { html: "<strong>synthetic-value</strong>" } }
    })
  );
  store.append(event("event-6", { command: "DELETE", key: "ghost", raw: { reason: "<b>unknown delete</b>" } }));
  store.append(event("event-7", { subscriptionId: "sub-merge", mode: "MERGE", key: "merge-key" }));
}

function seedIssue16CommandGroups(store: InMemoryEventStore): number {
  const groups: Array<{
    subscriptionId: string;
    items: Array<[string, number]>;
    itemGroup?: string;
  }> = [
    { subscriptionId: "subscription-1", items: [["session.metadata", 2]] },
    {
      subscriptionId: "subscription-2",
      items: [
        ["orderDetails.STORE_NYC_001", 850],
        ["healthCheck.SYS_MONITOR", 6]
      ]
    },
    { subscriptionId: "subscription-3", items: [["inventorySearch.STORE_NYC_001", 1]] },
    { subscriptionId: "subscription-4", items: [["inventorySearch.STORE_LA_002", 1]] },
    { subscriptionId: "subscription-5", items: [["productCatalog.STORE_NYC_001", 3]] },
    {
      subscriptionId: "subscription-6",
      itemGroup: "salesActivity.STORE_NYC_001",
      items: [
        ["STORE_NYC_001.INVOICE", 30],
        ["STORE_NYC_001.EXPENSE", 20]
      ]
    },
    { subscriptionId: "subscription-7", items: [["returnRequests.STORE_NYC_001", 9]] },
    { subscriptionId: "subscription-8", items: [["staffSchedule.STORE_NYC_001", 15]] },
    { subscriptionId: "subscription-9", items: [["customerQueue.STORE_NYC_001", 4]] },
    { subscriptionId: "subscription-10", items: [["promotions.STORE_NYC_001", 2]] },
    { subscriptionId: "subscription-11", items: [["shippingStatus.STORE_NYC_001", 30]] },
    { subscriptionId: "subscription-12", items: [["orderDetails.STORE_LA_002", 700]] },
    { subscriptionId: "subscription-13", items: [["paymentActivity.STORE_NYC_001", 4]] },
    { subscriptionId: "subscription-14", items: [["loyaltyPoints.STORE_NYC_001", 12]] },
    { subscriptionId: "subscription-15", items: [["storeAlerts.STORE_NYC_001", 3]] }
  ];
  let eventIndex = 1;

  for (const group of groups) {
    const subscriptionItems = group.itemGroup ? undefined : group.items.map(([itemName]) => itemName);
    for (const [itemName, count] of group.items) {
      const itemPosition = group.items.findIndex(([candidate]) => candidate === itemName) + 1;
      const keyPrefix = itemName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
      for (let updateIndex = 1; updateIndex <= count; updateIndex += 1) {
        const key = `${keyPrefix}-${updateIndex}`;
        store.append(
          event(`issue-16-${eventIndex}`, {
            subscriptionId: group.subscriptionId,
            itemName: null,
            itemPosition,
            subscriptionItems,
            subscriptionItemGroup: group.itemGroup,
            key,
            fields: {
              command: "ADD",
              key,
              name: itemName,
              qty: String(updateIndex),
              html: "",
              status: "open"
            },
            changedFields: { command: "ADD", key }
          })
        );
        eventIndex += 1;
      }
    }
  }

  return eventIndex - 1;
}

describe("COMMAND State panel workbench", () => {
  let store: InMemoryEventStore;
  let reinjectDraft: Mock<(draft: ReinjectionDraft) => Promise<ReinjectionResult>>;

  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing test root");
    }
    store = createEventStore();
    reinjectDraft = vi.fn();
    renderPanel(root, undefined, { store, bridge: { reinjectDraft } });
    seedCommandEvents(store);
  });

  it("keeps Timeline available and renders COMMAND subscription/item/key/update drilldown", () => {
    expect(text(".view-selector")).toContain("Timeline");
    expect(text(".view-selector")).toContain("COMMAND State");
    expect(document.querySelector(".event-feed")).not.toBeNull();

    clickCommandState();

    expect(document.querySelector('[aria-label="COMMAND state workbench"]')).not.toBeNull();
    expect(text(".command-group-pane")).toContain("sub-command");
    expect(text(".command-group-pane")).toContain("item-a");
    expect(text(".command-group-pane")).not.toContain("COMMAND");
    expect(text(".command-group-pane")).not.toContain("sub-merge");
    expect(text(".command-group-pane")).not.toContain("1 active");
    expect(text(".command-group-pane")).not.toContain("1 deleted");
    expect(text(".command-group-pane")).not.toContain("live server");
    expect(document.querySelector(".command-item-meta")).toBeNull();
    expect(document.querySelector(".command-pane-help")).toBeNull();
    expect(document.querySelector(".command-current-table > .command-pane-heading")).toBeNull();
    expect(text(".command-current-header")).toContain("Key");
    expect(text(".command-current-header")).toContain("Updates");
    expect(text(".command-current-header")).toContain("Last seen");
    expect(text(".command-current-header")).not.toContain("State");
    expect(text(".command-current-header")).not.toContain("Latest");
    expect(document.querySelectorAll(".command-current-header .command-current-cell")).toHaveLength(3);
    expect(text(".command-current-rows")).toContain("alpha");
    expect(text(".command-current-rows")).toContain("beta");
    expect(document.querySelector('.command-current-row[data-status="deleted"]')?.textContent).toContain("beta");
    expect(document.querySelector('.command-current-row[data-status="deleted"]')?.textContent).not.toContain(
      "deleted"
    );
    expect(text(".command-update-list")).toContain("Updates · alpha · 3");
    expect(text(".command-update-list")).toContain("event-1");
    expect(text(".command-update-list")).toContain("event-2");
    expect(text(".command-update-list")).toContain("event-5");
    expect(document.querySelector(".command-update-pane")?.parentElement).toBe(
      document.querySelector(".command-workspace")
    );
    expect(document.querySelector(".command-current-table .command-update-list")).toBeNull();
    expect(text(".command-update-header")).not.toContain("Changed");
    expect(text(".command-update-header")).not.toContain("Source");
    expect(document.querySelectorAll(".command-update-header .command-update-cell")).toHaveLength(3);
    expect(document.querySelector(".command-update-row")?.querySelectorAll(".command-update-cell")).toHaveLength(
      3
    );
    expect(document.querySelector(".command-current-header .command-help-icon")).toBeNull();
    expect(document.querySelector(".command-tooltip")).toBeNull();
    const subscriptionSummary = document.querySelector<HTMLElement>(".command-subscription-summary");
    expect(subscriptionSummary?.textContent).toBe("sub-command");
    expect(subscriptionSummary?.getAttribute("aria-label")).toBe("COMMAND subscription sub-command");
    expect(getComputedStyle(subscriptionSummary as HTMLElement).borderTopStyle).toBe("");
    expect(getComputedStyle(document.querySelector<HTMLElement>(".command-item-button") as HTMLElement).borderBottomStyle).toBe("");
    const commandWorkspace = document.querySelector<HTMLElement>(".command-workspace");
    const resizeHandles = document.querySelectorAll(".command-resize-handle");
    const keysResizeHandle = document.querySelector<HTMLElement>(
      '.command-resize-handle[data-resize-target="keys"]'
    );
    expect(commandWorkspace?.style.getPropertyValue("--command-keys-width")).toBe("360px");
    expect(resizeHandles).toHaveLength(3);
    expect(keysResizeHandle?.getAttribute("role")).toBe("separator");
    keysResizeHandle?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(commandWorkspace?.style.getPropertyValue("--command-keys-width")).toBe("384px");
    expect(keysResizeHandle?.getAttribute("aria-valuenow")).toBe("384");
    expect(document.querySelector(".command-filter-key")).toBeNull();
  });

  it("shares compact exact times with Timeline without duplicating selected update time", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const timeStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    const timestamps = [
      new Date(2026, 0, 1, 23, 59, 59, 1).getTime(),
      new Date(2026, 0, 1, 23, 59, 59, 2).getTime(),
      new Date(2026, 0, 2, 0, 0, 0, 3).getTime()
    ];
    for (const [index, timestamp] of timestamps.entries()) {
      timeStore.append({
        ...event(`time-${index + 1}`, {
          command: index === 0 ? "ADD" : "UPDATE",
          key: "clock-key"
        }),
        timestamp
      });
    }
    const controller = renderPanel(root, undefined, {
      store: timeStore,
      bridge: { reinjectDraft }
    });

    clickCommandState();
    const updateTimes = Array.from(
      document.querySelectorAll<HTMLTimeElement>(".command-update-time")
    );
    expect(updateTimes.map((time) => time.dateTime)).toEqual(
      timestamps.map((timestamp) => new Date(timestamp).toISOString())
    );
    expect(updateTimes.map((time) => time.textContent)).toEqual([
      "23:59:59.001",
      "23:59:59.002",
      "00:00:00.003"
    ]);
    const lastSeen = document.querySelector<HTMLTimeElement>(
      ".command-current-row .command-current-time"
    );
    expect(lastSeen?.dateTime).toBe(new Date(timestamps[2]).toISOString());
    expect(lastSeen?.title).toBeTruthy();
    expect(lastSeen?.getAttribute("aria-label")).toContain("2026-");

    document.querySelector<HTMLButtonElement>('.command-update-row[data-event-id="time-3"]')?.click();
    expect(text(".command-detail-pane")).toContain("Update time-3");
    expect(texts(".command-summary-label")).not.toContain("Time ");
    clickRowByText(".command-current-row", "clock-key");
    button(".command-lifecycle-toggle").click();
    expect(texts(".command-lifecycle-line").some((line) => /\d{1,2}:\d{2}:\d{2}/.test(line))).toBe(
      false
    );
    controller.dispose();
  });

  it("shows one precise COMMAND detail time only when its selected update leaves the window", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const historyStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    for (let index = 1; index <= 40; index += 1) {
      historyStore.append(
        event(`precise-${index}`, {
          command: index === 1 ? "ADD" : "UPDATE",
          key: "precise-key"
        })
      );
    }
    const controller = renderPanel(root, undefined, {
      store: historyStore,
      bridge: { reinjectDraft }
    });

    clickCommandState();
    document.querySelector<HTMLButtonElement>('.command-update-row[data-event-id="precise-40"]')?.click();
    expect(texts(".command-summary-label")).not.toContain("Time ");

    clickRowByText(".command-window-navigation button", "Older");
    expect(texts(".command-summary-label")).toContain("Time ");
    const preciseTime = document.querySelector<HTMLTimeElement>(
      ".command-detail-summary time.command-summary-value"
    );
    expect(preciseTime?.dateTime).toBe(new Date(event("precise-40").timestamp).toISOString());
    expect(preciseTime?.textContent).toMatch(/^\d{4}-\d{2}-\d{2} .* UTC[+-]\d{2}:\d{2}$/);
    controller.dispose();
  });

  it("bounds high-volume COMMAND update and lifecycle DOM windows structurally", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const volumeStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    for (let index = 1; index <= 3_001; index += 1) {
      volumeStore.append(
        event(`volume-${index}`, {
          command: index === 1 ? "ADD" : "UPDATE",
          key: "hot-key",
          fields: { command: index === 1 ? "ADD" : "UPDATE", key: "hot-key", qty: String(index) },
          changedFields: { qty: String(index) }
        })
      );
    }
    const controller = renderPanel(root, undefined, {
      store: volumeStore,
      bridge: { reinjectDraft }
    });

    clickCommandState();

    expect(document.querySelectorAll(".command-update-row")).toHaveLength(32);
    expect(document.querySelectorAll(".command-lifecycle-entry")).toHaveLength(0);
    expect(text(".command-window-status")).toBe("Showing updates 2,970–3,001 of 3,001.");
    expect(root.querySelectorAll("*").length).toBeLessThan(900);

    button(".command-lifecycle-toggle").click();

    expect(document.querySelectorAll(".command-update-row")).toHaveLength(32);
    expect(document.querySelectorAll(".command-lifecycle-entry")).toHaveLength(32);
    expect(root.querySelectorAll("*").length).toBeLessThan(900);

    button(".command-window-navigation .window-navigation-button").click();
    expect(document.querySelector<HTMLButtonElement>(".command-update-row")?.dataset.eventId).toBe(
      "volume-2938"
    );
    expect(document.querySelectorAll(".command-update-row")).toHaveLength(32);
    expect(document.querySelectorAll(".command-lifecycle-entry")).toHaveLength(32);
    controller.dispose();
  });

  it("reuses COMMAND lifecycle search projections across renders and invalidates on mutation", async () => {
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      clickCommandState();
      const inactiveLifecycleValues = stringify.mock.calls
        .map(([value]) => value)
        .filter(
          (value): value is unknown[] =>
            Array.isArray(value) &&
            value.length > 0 &&
            typeof value[0] === "object" &&
            value[0] !== null &&
            "eventId" in value[0]
        );
      expect(inactiveLifecycleValues).toHaveLength(0);

      stringify.mockClear();
      input(".command-search", "alpha");
      const activeLifecycleValues = stringify.mock.calls
        .map(([value]) => value)
        .filter(
          (value): value is Record<string, unknown> =>
            !Array.isArray(value) &&
            typeof value === "object" &&
            value !== null &&
            "eventId" in value &&
            "provenance" in value &&
            "changedFields" in value
        );
      expect(activeLifecycleValues.length).toBeGreaterThan(0);
      expect(activeLifecycleValues.length).toBe(new Set(activeLifecycleValues).size);

      stringify.mockClear();
      input(".command-search", "alpha ");
      expect(
        stringify.mock.calls.filter(
          ([value]) =>
            !Array.isArray(value) &&
            typeof value === "object" &&
            value !== null &&
            "eventId" in value &&
            "provenance" in value &&
            "changedFields" in value
        )
      ).toHaveLength(0);

      stringify.mockClear();
      store.append(event("search-cache-update", { command: "UPDATE", key: "alpha" }));
      await flushInteractionRender();
      expect(
        stringify.mock.calls.filter(
          ([value]) =>
            !Array.isArray(value) &&
            typeof value === "object" &&
            value !== null &&
            "eventId" in value &&
            "provenance" in value &&
            "changedFields" in value
        )
      ).toHaveLength(1);
    } finally {
      stringify.mockRestore();
    }
  });

  it("bounds 3,001 COMMAND subscription items independently of retained model cardinality", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const volumeStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    for (let index = 1; index <= 3_001; index += 1) {
      volumeStore.append(
        event(`item-volume-${index}`, {
          itemName: `item-volume-${index}`,
          itemPosition: index,
          key: `item-key-${index}`
        })
      );
    }
    renderPanel(root, undefined, { store: volumeStore, bridge: { reinjectDraft } });
    clickCommandState();

    expect(document.querySelectorAll(".command-item-button").length).toBeLessThanOrEqual(60);
    expect(text(".command-item-window-status")).toContain("3,001");
    expect(root.querySelectorAll("*").length).toBeLessThan(1_000);
  });

  it("bounds 3,001 COMMAND keys and matching diagnostics independently of model cardinality", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const keyStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    for (let index = 1; index <= 3_001; index += 1) {
      keyStore.append(event(`key-volume-${index}`, { key: `key-volume-${index}` }));
    }
    const keyController = renderPanel(root, undefined, {
      store: keyStore,
      bridge: { reinjectDraft }
    });
    clickCommandState();

    expect(document.querySelectorAll(".command-current-row").length).toBeLessThanOrEqual(60);
    expect(text(".command-key-window-status")).toContain("3,001");
    expect(root.querySelectorAll("*").length).toBeLessThan(1_000);
    keyController.dispose();

    document.body.innerHTML = '<main id="app"></main>';
    const diagnosticRoot = document.querySelector<HTMLElement>("#app");
    const diagnosticStore = createEventStore();
    if (!diagnosticRoot) {
      throw new Error("missing diagnostic test root");
    }
    for (let index = 1; index <= 3_001; index += 1) {
      diagnosticStore.append(
        event(`diagnostic-volume-${index}`, {
          command: "DELETE",
          key: `ghost-${index}`
        })
      );
    }
    renderPanel(diagnosticRoot, undefined, {
      store: diagnosticStore,
      bridge: { reinjectDraft }
    });
    clickCommandState();
    input(".command-search", "unknown-key-delete");

    expect(document.querySelectorAll(".command-diagnostic-result").length).toBeLessThanOrEqual(32);
    expect(text(".command-diagnostic-window-status")).toContain("3,001");
    expect(diagnosticRoot.querySelectorAll("*").length).toBeLessThan(1_000);
  });

  it("round-trips the non-divisible oldest COMMAND lifecycle page", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const historyStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    for (let index = 1; index <= 1_002; index += 1) {
      historyStore.append(
        event(`roundtrip-${index}`, {
          command: index === 1 ? "ADD" : "UPDATE",
          key: "roundtrip-key"
        })
      );
    }
    renderPanel(root, undefined, { store: historyStore, bridge: { reinjectDraft } });
    clickCommandState();

    let priorWindowFirstId = "";
    while (!Array.from(document.querySelectorAll<HTMLButtonElement>(
      ".command-window-navigation button"
    )).find((candidate) => candidate.textContent === "Older")?.disabled) {
      priorWindowFirstId = document.querySelector<HTMLButtonElement>(
        ".command-update-row"
      )?.dataset.eventId ?? "";
      clickRowByText(".command-window-navigation button", "Older");
    }
    expect(document.querySelector<HTMLButtonElement>(".command-update-row")?.dataset.eventId).toBe(
      "roundtrip-1"
    );

    clickRowByText(".command-window-navigation button", "Newer");
    expect(document.querySelector<HTMLButtonElement>(".command-update-row")?.dataset.eventId).toBe(
      priorWindowFirstId
    );
    clickRowByText(".command-window-navigation button", "Older");
    expect(document.querySelector<HTMLButtonElement>(".command-update-row")?.dataset.eventId).toBe(
      "roundtrip-1"
    );
  });

  it("anchors an older COMMAND lifecycle window during matching live append", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const historyStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    for (let index = 1; index <= 100; index += 1) {
      historyStore.append(
        event(`anchor-${index}`, {
          command: index === 1 ? "ADD" : "UPDATE",
          key: "anchor-key"
        })
      );
    }
    renderPanel(root, undefined, { store: historyStore, bridge: { reinjectDraft } });
    clickCommandState();
    clickRowByText(".command-window-navigation button", "Older");
    const visibleBefore = Array.from(document.querySelectorAll<HTMLButtonElement>(
      ".command-update-row"
    )).map((row) => row.dataset.eventId);

    historyStore.append(event("anchor-101", { command: "UPDATE", key: "anchor-key" }));

    expect(
      Array.from(document.querySelectorAll<HTMLButtonElement>(".command-update-row")).map(
        (row) => row.dataset.eventId
      )
    ).toEqual(visibleBefore);
  });

  it("anchors a selected full COMMAND update window during live appends", async () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const historyStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    for (let index = 1; index <= 32; index += 1) {
      historyStore.append(
        event(`selected-anchor-${index}`, {
          command: index === 1 ? "ADD" : "UPDATE",
          key: "selected-anchor-key"
        })
      );
    }
    renderPanel(root, undefined, { store: historyStore, bridge: { reinjectDraft } });
    clickCommandState();
    const visibleBefore = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".command-update-row")
    ).map((row) => row.dataset.eventId);
    document.querySelector<HTMLButtonElement>(".command-update-row")?.click();
    const selectedEventId = document.querySelector<HTMLButtonElement>(
      '.command-update-row[data-selected="true"]'
    )?.dataset.eventId;

    for (let index = 33; index <= 35; index += 1) {
      historyStore.append(
        event(`selected-anchor-${index}`, {
          command: "UPDATE",
          key: "selected-anchor-key"
        })
      );
    }
    await flushInteractionRender();

    expect(
      Array.from(document.querySelectorAll<HTMLButtonElement>(".command-update-row")).map(
        (row) => row.dataset.eventId
      )
    ).toEqual(visibleBefore);
    expect(
      document.querySelector<HTMLButtonElement>('.command-update-row[data-selected="true"]')?.dataset
        .eventId
    ).toBe(selectedEventId);
    expect(text(".command-detail-pane")).toContain(`Update ${selectedEventId}`);
  });

  it("preserves a partial COMMAND history anchor across append, Latest, and Older", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const historyStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    for (let index = 1; index <= 65; index += 1) {
      historyStore.append(
        event(`partial-anchor-${index}`, {
          command: index === 1 ? "ADD" : "UPDATE",
          key: "partial-anchor-key"
        })
      );
    }
    renderPanel(root, undefined, { store: historyStore, bridge: { reinjectDraft } });
    clickCommandState();
    clickRowByText(".command-window-navigation button", "Older");
    clickRowByText(".command-window-navigation button", "Older");
    expect(document.querySelector<HTMLButtonElement>(".command-update-row")?.dataset.eventId).toBe(
      "partial-anchor-1"
    );

    historyStore.append(
      event("partial-anchor-66", { command: "UPDATE", key: "partial-anchor-key" })
    );
    clickRowByText(".command-window-navigation button", "Newer");
    clickRowByText(".command-window-navigation button", "Newer");
    const anchoredFirstId = document.querySelector<HTMLButtonElement>(
      ".command-update-row"
    )?.dataset.eventId;
    expect(anchoredFirstId).toBe("partial-anchor-34");

    clickRowByText(".command-window-navigation button", "Latest");
    clickRowByText(".command-window-navigation button", "Older");
    expect(document.querySelector<HTMLButtonElement>(".command-update-row")?.dataset.eventId).toBe(
      anchoredFirstId
    );
  });

  it("restores keyboard focus for COMMAND paging and lifecycle controls", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const historyStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    for (let index = 1; index <= 80; index += 1) {
      historyStore.append(
        event(`focus-command-${index}`, {
          command: index === 1 ? "ADD" : "UPDATE",
          key: "focus-command-key"
        })
      );
    }
    renderPanel(root, undefined, { store: historyStore, bridge: { reinjectDraft } });
    clickCommandState();
    const older = Array.from(document.querySelectorAll<HTMLButtonElement>(
      ".command-window-navigation button"
    )).find((candidate) => candidate.textContent === "Older");
    older?.focus();
    older?.click();
    expect(document.activeElement?.textContent).toBe("Older");

    const toggle = button(".command-lifecycle-toggle");
    toggle.focus();
    toggle.click();
    expect(document.activeElement?.classList.contains("command-lifecycle-toggle")).toBe(true);
  });

  it("renders all high-volume COMMAND subscription groups without collapsing repeated subscription ids", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const issueStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    const totalEvents = seedIssue16CommandGroups(issueStore);
    renderPanel(root, undefined, { store: issueStore, bridge: { reinjectDraft } });

    clickCommandState();

    const sidebarText = text(".command-group-pane");
    expect(text(".event-count")).toBe(String(totalEvents));
    expect(document.querySelectorAll(".command-subscription-summary")).toHaveLength(15);
    expect(document.querySelectorAll(".command-item-button")).toHaveLength(17);
    expect(sidebarText).toContain("subscription-15");
    expect(sidebarText).not.toContain("subscription-15 COMMAND");
    expect(sidebarText).toContain("storeAlerts.STORE_NYC_001");
    expect(sidebarText).toContain("orderDetails.STORE_NYC_001");
    expect(sidebarText).toContain("healthCheck.SYS_MONITOR");
    expect(sidebarText).toContain("salesActivity.STORE_NYC_001 position 1");
    expect(sidebarText).toContain("salesActivity.STORE_NYC_001 position 2");

    clickRowByText(".command-item-button", "orderDetails.STORE_NYC_001");
    input(".command-search", "orderdetails-store-nyc-001-850");
    expect(text(".command-current-table")).toContain("orderdetails-store-nyc-001-850");
    input(".command-search", "");
    clickRowByText(".command-item-button", "orderDetails.STORE_NYC_001");
    expect(button(".new-command-button").disabled).toBe(false);
    button(".new-command-button").click();
    expect(text(".command-draft-context")).toContain("orderDetails.STORE_NYC_001");
    expect(text(".command-draft-context")).toContain("listener-1");

    clickRowByText(".command-item-button", "salesActivity.STORE_NYC_001 position 1");
    expect(text(".command-current-table")).toContain("store-nyc-001-invoice-30");
    expect(text(".command-current-table")).not.toContain("store-nyc-001-expense-20");

    clickRowByText(".command-item-button", "salesActivity.STORE_NYC_001 position 2");
    expect(text(".command-current-table")).toContain("store-nyc-001-expense-20");
    expect(text(".command-current-table")).not.toContain("store-nyc-001-invoice-30");
  });

  it("filters high-volume COMMAND navigation to the item containing a deep field match", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const issueStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    seedIssue16CommandGroups(issueStore);
    issueStore.append(
      event("target-filter-event", {
        subscriptionId: "subscription-15",
        itemName: null,
        itemPosition: 1,
        subscriptionItems: ["storeAlerts.STORE_NYC_001"],
        key: "target-filter-key",
        fields: {
          command: "ADD",
          key: "target-filter-key",
          name: "Target alert",
          qty: "1",
          html: "",
          status: "deep-field-needle"
        },
        changedFields: { status: "deep-field-needle" }
      })
    );
    renderPanel(root, undefined, { store: issueStore, bridge: { reinjectDraft } });

    clickCommandState();
    input(".command-search", "deep-field-needle");

    expect(document.querySelectorAll(".command-subscription-summary")).toHaveLength(1);
    expect(document.querySelectorAll(".command-item-button")).toHaveLength(1);
    expect(text(".command-group-pane")).toContain("subscription-15");
    expect(text(".command-group-pane")).toContain("storeAlerts.STORE_NYC_001");
    expect(texts(".command-subscription-summary")).toEqual(["subscription-15"]);
    expect(text(".command-group-pane")).toContain("Subscriptions (1 of 17)");
    expect(selectedTexts(".command-item-button")).toEqual([
      expect.stringContaining("storeAlerts.STORE_NYC_001")
    ]);
    expect(texts(".command-current-row")).toEqual([
      expect.stringContaining("target-filter-key")
    ]);
    expect(text(".command-update-list")).toContain("target-filter-event");
    expect(text(".command-detail-pane")).toContain("Key target-filter-key - active");
    expect(text(".command-detail-pane")).toContain("deep-field-needle");

    input(".command-search", "");

    expect(document.querySelectorAll(".command-subscription-summary")).toHaveLength(15);
    expect(document.querySelectorAll(".command-item-button")).toHaveLength(17);
    expect(selectedTexts(".command-item-button")).toEqual([
      expect.stringContaining("storeAlerts.STORE_NYC_001")
    ]);

    input(".command-search", "subscription-6");

    expect(document.querySelectorAll(".command-subscription-summary")).toHaveLength(1);
    expect(document.querySelectorAll(".command-item-button")).toHaveLength(2);
    expect(text(".command-group-pane")).toContain("Subscriptions (2 of 17)");
    expect(text(".command-group-pane")).toContain("salesActivity.STORE_NYC_001 position 1");
    expect(text(".command-group-pane")).toContain("salesActivity.STORE_NYC_001 position 2");
    expect(texts(".command-current-row")).toHaveLength(30);
    expect(text(".command-current-rows")).toContain("store-nyc-001-invoice-30");
    expect(text(".command-current-rows")).not.toContain("store-nyc-001-expense-20");
  });

  it("shows a coherent COMMAND empty state when search matches no items and recovers when cleared", () => {
    clickCommandState();

    input(".command-search", "missing-deep-field-value");

    expect(document.querySelectorAll(".command-subscription-summary")).toHaveLength(0);
    expect(document.querySelectorAll(".command-item-button")).toHaveLength(0);
    expect(text(".command-group-pane")).toContain("No matching COMMAND items");
    expect(text(".command-group-pane")).toContain("Clear the search or try a broader query.");
    expect(text(".command-current-table")).toContain("No keys to show because no COMMAND items match.");
    expect(text(".command-update-pane")).toContain("No updates to show because no COMMAND items match.");
    expect(document.querySelector<HTMLElement>(".command-detail-pane")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>(".command-workspace")?.dataset.detailOpen).toBe("false");

    input(".command-search", "");

    expect(document.querySelectorAll(".command-subscription-summary")).toHaveLength(1);
    expect(document.querySelectorAll(".command-item-button")).toHaveLength(1);
    expect(text(".command-current-rows")).toContain("alpha");
    expect(text(".command-detail-pane")).toContain("Key alpha - active");
    expect(document.querySelector<HTMLElement>(".command-detail-pane")?.hidden).toBe(false);
  });

  it("shows a synchronized active COMMAND subscription in both views before its first update", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const quietStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    const started = event("quiet-subscription", {
      subscriptionId: "subscription-19",
      itemName: null,
      itemPosition: null,
      subscriptionItems: ["quiet.orders"]
    });
    started.kind = "subscription-snapshot";
    started.item = undefined;
    started.update = undefined;
    quietStore.append(started);
    renderPanel(root, undefined, { store: quietStore, bridge: { reinjectDraft } });

    expect(text(".event-feed")).toContain("S~");
    expect(text(".event-feed")).toContain("quiet.orders");
    expect(text(".event-feed")).not.toContain("subscription-19");
    expect(document.querySelector<HTMLElement>(".event-row")?.title).toContain("subscription subscription-19");

    clickCommandState();

    expect(text(".command-group-pane")).toContain("subscription-19");
    expect(text(".command-group-pane")).toContain("quiet.orders");
    expect(text(".command-current-rows")).not.toContain("alpha");

    input(".command-search", "subscription-19 quiet.orders");

    expect(document.querySelectorAll(".command-item-button")).toHaveLength(1);
    expect(text(".command-group-pane")).toContain("quiet.orders");
    expect(text(".command-current-table")).toContain("No keys match this item and search query.");
  });

  it("keeps timeline rows selectable when live inflow arrives during pointer selection", async () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const liveStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    liveStore.append(event("timeline-1", { key: "alpha" }));
    liveStore.append(event("timeline-2", { key: "beta" }));
    renderPanel(root, undefined, { store: liveStore, bridge: { reinjectDraft } });

    const alphaRow = Array.from(document.querySelectorAll<HTMLButtonElement>(".event-row")).find(
      (candidate) => (candidate.textContent ?? "").includes("alpha")
    );
    if (!alphaRow) {
      throw new Error("missing alpha timeline row");
    }

    alphaRow.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    liveStore.append(event("timeline-3", { key: "gamma" }));

    expect(text(".event-count")).toBe("3");
    expect(alphaRow.isConnected).toBe(true);

    alphaRow.click();
    expect(text(".detail-pane")).toContain("timeline-1");
    expect(text(".detail-pane")).toContain("alpha");

    await flushInteractionRender();
  });

  it("keeps COMMAND item buttons selectable when live inflow arrives during pointer selection", async () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const liveStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    liveStore.append(event("command-1", { itemName: "item-a", itemPosition: 1, key: "alpha" }));
    liveStore.append(event("command-2", { itemName: "item-b", itemPosition: 2, key: "bravo" }));
    renderPanel(root, undefined, { store: liveStore, bridge: { reinjectDraft } });
    clickCommandState();

    const itemButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".command-item-button")).find(
      (candidate) => (candidate.textContent ?? "").includes("item-b")
    );
    if (!itemButton) {
      throw new Error("missing item-b button");
    }

    itemButton.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    liveStore.append(event("command-3", { itemName: "item-a", itemPosition: 1, key: "charlie" }));

    expect(text(".event-count")).toBe("3");
    expect(itemButton.isConnected).toBe(true);

    itemButton.click();
    expect(selectedTexts(".command-item-button")).toContain("item-b");
    expect(text(".command-current-table")).toContain("bravo");
    expect(text(".command-current-table")).not.toContain("charlie");

    await flushInteractionRender();
  });

  it("preserves every COMMAND list viewport and focused control during live updates", async () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const liveStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    liveStore.append(event("command-1", { itemName: "item-a", itemPosition: 1, key: "alpha" }));
    liveStore.append(event("command-2", { itemName: "item-b", itemPosition: 2, key: "bravo" }));
    renderPanel(root, undefined, { store: liveStore, bridge: { reinjectDraft } });
    clickCommandState();

    const groups = document.querySelector<HTMLElement>(".command-group-pane");
    const keys = document.querySelector<HTMLElement>(".command-current-table");
    const updates = document.querySelector<HTMLElement>(".command-update-pane");
    if (!groups || !keys || !updates) {
      throw new Error("missing COMMAND list panes");
    }
    resetScrollWhenChildrenAreReplaced(groups);
    resetScrollWhenChildrenAreReplaced(keys);
    resetScrollWhenChildrenAreReplaced(updates);

    groups.scrollTop = 140;
    groups.scrollLeft = 11;
    keys.scrollTop = 90;
    keys.scrollLeft = 13;
    updates.scrollTop = 60;
    updates.scrollLeft = 17;
    const originalItemButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".command-item-button")
    ).find((candidate) => (candidate.textContent ?? "").includes("item-a"));
    originalItemButton?.focus();

    liveStore.append(event("command-3", { itemName: "item-a", itemPosition: 1, key: "charlie" }));
    await flushInteractionRender();

    expect(groups.scrollTop).toBe(140);
    expect(groups.scrollLeft).toBe(11);
    expect(keys.scrollTop).toBe(90);
    expect(keys.scrollLeft).toBe(13);
    expect(updates.scrollTop).toBe(60);
    expect(updates.scrollLeft).toBe(17);
    expect(document.activeElement).not.toBe(originalItemButton);
    expect(document.activeElement?.classList.contains("command-item-button")).toBe(true);
    expect(document.activeElement?.textContent).toContain("item-a");

    keys.scrollTop = 115;
    updates.scrollTop = 75;
    const originalKeyRow = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".command-current-row")
    ).find((candidate) => (candidate.textContent ?? "").includes("alpha"));
    originalKeyRow?.focus();

    liveStore.append(event("command-4", { itemName: "item-a", itemPosition: 1, key: "delta" }));
    await flushInteractionRender();

    expect(keys.scrollTop).toBe(115);
    expect(updates.scrollTop).toBe(75);
    expect(document.activeElement).not.toBe(originalKeyRow);
    expect(document.activeElement?.classList.contains("command-current-row")).toBe(true);
    expect(document.activeElement?.textContent).toContain("alpha");

    const originalUpdateRow = document.querySelector<HTMLButtonElement>(".command-update-row");
    originalUpdateRow?.focus();
    updates.scrollTop = 88;
    liveStore.append(
      event("command-5", {
        itemName: "item-a",
        itemPosition: 1,
        command: "UPDATE",
        key: "alpha"
      })
    );
    await flushInteractionRender();

    expect(updates.scrollTop).toBe(88);
    expect(document.activeElement).not.toBe(originalUpdateRow);
    expect(document.activeElement?.classList.contains("command-update-row")).toBe(true);
    expect(document.activeElement?.textContent).toContain("command-1");
  });

  it("keeps the same COMMAND key selected when its live status changes", async () => {
    clickCommandState();
    clickRowByText(".command-current-row", "alpha");

    store.append(event("event-8", { command: "DELETE", key: "alpha" }));
    await flushInteractionRender();

    expect(selectedTexts(".command-current-row")).toHaveLength(1);
    expect(selectedTexts(".command-current-row")[0]).toContain("alpha");
    expect(
      document.querySelector<HTMLButtonElement>('.command-current-row[data-selected="true"]')?.dataset
        .status
    ).toBe("deleted");
    expect(text(".command-detail-pane")).toContain("Key alpha - deleted");
  });

  it("keeps a transitioned COMMAND key visible across a full key window", async () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    const liveStore = createEventStore();
    if (!root) {
      throw new Error("missing test root");
    }
    for (let index = 0; index < 70; index += 1) {
      liveStore.append(event(`window-${index}`, { key: `key-${index}` }));
    }
    renderPanel(root, undefined, { store: liveStore, bridge: { reinjectDraft } });
    clickCommandState();
    clickRowByText(".command-current-row", "key-0");

    liveStore.append(event("window-delete", { command: "DELETE", key: "key-0" }));
    await flushInteractionRender();

    const selected = document.querySelector<HTMLButtonElement>(
      '.command-current-row[data-selected="true"]'
    );
    expect(selected?.dataset.key).toBe("key-0");
    expect(selected?.dataset.status).toBe("deleted");
    expect(text(".command-key-window-status")).toContain("61–70 of 70");
    expect(text(".command-detail-pane")).toContain("Key key-0 - deleted");
  });

  it("renders help tooltips in a clamped overlay for hover and focus", () => {
    clickCommandState();

    const helpText = "The latest field values for this active key after applying its lifecycle.";
    const helpIcon = document.querySelector<HTMLButtonElement>(
      '.command-help-icon[aria-label^="Current fields:"]'
    );
    if (!helpIcon) {
      throw new Error("missing help trigger");
    }
    expect(document.querySelector(".command-tooltip")).toBeNull();

    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    const helpIconRect = vi.spyOn(helpIcon, "getBoundingClientRect").mockReturnValue(rect(12, 2, 16, 16));
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 160 });

    try {
      helpIcon.dispatchEvent(new Event("pointerover", { bubbles: true }));
      const tooltip = document.querySelector<HTMLElement>(".command-tooltip");
      if (!tooltip) {
        throw new Error("missing lazy tooltip overlay");
      }
      const tooltipRect = vi.spyOn(tooltip, "getBoundingClientRect").mockReturnValue(rect(0, 0, 220, 48));
      window.dispatchEvent(new Event("resize"));

      expect(tooltip.hidden).toBe(false);
      expect(tooltip.getAttribute("role")).toBe("tooltip");
      expect(tooltip.textContent).toContain(helpText);
      expect(tooltip.dataset.placement).toBe("bottom");
      expect(Number.parseInt(tooltip.style.left, 10)).toBeGreaterThanOrEqual(8);
      expect(Number.parseInt(tooltip.style.top, 10)).toBeGreaterThanOrEqual(26);
      expect(helpIcon.getAttribute("aria-describedby")).toBe(tooltip.id);
      expect(helpIcon.hasAttribute("title")).toBe(false);

      helpIcon.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }));

      expect(document.querySelector(".command-tooltip")).toBeNull();
      expect(helpIcon.title).toBe(helpText);

      helpIcon.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

      const focusedTooltip = document.querySelector<HTMLElement>(".command-tooltip");
      expect(focusedTooltip?.hidden).toBe(false);
      expect(helpIcon.getAttribute("aria-describedby")).toBe(focusedTooltip?.id);

      helpIcon.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));

      expect(document.querySelector(".command-tooltip")).toBeNull();
      expect(helpIcon.title).toBe(helpText);
      tooltipRect.mockRestore();
    } finally {
      helpIconRect.mockRestore();
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    }
  });

  it("dismisses a help tooltip when a live render removes its trigger", async () => {
    clickCommandState();

    const helpIcon = document.querySelector<HTMLButtonElement>(
      '.command-help-icon[aria-label^="Current fields:"]'
    );
    if (!helpIcon) {
      throw new Error("missing tooltip trigger");
    }

    helpIcon.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(document.querySelector<HTMLElement>(".command-tooltip")?.hidden).toBe(false);

    store.append(event("tooltip-live", { key: "live-key" }));
    await flushInteractionRender();

    expect(helpIcon.isConnected).toBe(false);
    expect(document.querySelector(".command-tooltip")).toBeNull();
  });

  it("hides the COMMAND detail shell until COMMAND rows exist", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing test root");
    }
    const mergeOnlyStore = createEventStore();
    renderPanel(root, undefined, { store: mergeOnlyStore, bridge: { reinjectDraft } });
    mergeOnlyStore.append(event("event-merge", { mode: "MERGE", key: "merge-key" }));

    clickCommandState();

    expect(text(".command-group-pane")).toContain("No COMMAND state yet");
    expect(document.querySelector<HTMLElement>(".command-detail-pane")?.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>(".command-workspace")?.dataset.detailOpen).toBe("false");
  });

  it("selects a current row and shows current fields before per-key lifecycle provenance", () => {
    clickCommandState();
    clickRowByText(".command-current-row", "alpha");

    const detailText = text(".command-detail-pane");
    expect(detailText).toContain("Key alpha - active");
    expect(detailText).toContain("Current fields");
    expect(document.querySelector(".command-lifecycle")?.getAttribute("aria-label")).toBe(
      "Selected key lifecycle"
    );
    expect(detailText).toContain('"qty": "3"');
    expect(detailText).toContain("<strong>synthetic-value</strong>");
    expect(detailText).toContain("Origin snapshot server");
    expect(detailText).toContain("Latest synthetic UPDATE");
    expect(document.querySelectorAll(".command-lifecycle-entry")).toHaveLength(0);
    expect(text(".command-lifecycle-toggle")).toBe("Show lifecycle payloads (3)");

    button(".command-lifecycle-toggle").click();

    expect(text(".command-lifecycle-toggle")).toBe("Hide lifecycle payloads (3)");
    expect(texts(".command-lifecycle-entry")).toEqual(
      expect.arrayContaining([
        expect.stringContaining("event-1"),
        expect.stringContaining("event-2"),
        expect.stringContaining("event-5")
      ])
    );
    const expandedDetailText = text(".command-detail-pane");
    expect(expandedDetailText).toContain("ADD");
    expect(expandedDetailText).toContain("UPDATE");
    expect(expandedDetailText).toContain("snapshot server");
    expect(expandedDetailText).toContain("live server");
    expect(expandedDetailText).toContain("synthetic live");
    expect(document.querySelector(".command-detail-pane img")).toBeNull();
    expect(document.querySelector(".command-detail-pane strong")).toBeNull();

    button(".detail-collapse-button").click();
    expect(document.querySelector<HTMLElement>(".command-detail-pane")?.hidden).toBe(true);

    clickRowByText(".command-current-row", "alpha");
    expect(document.querySelector<HTMLElement>(".command-detail-pane")?.hidden).toBe(false);
    expect(text(".command-detail-pane")).toContain("Key alpha - active");
  });

  it("finds deleted keys as key rows and shows their updates", () => {
    clickCommandState();

    input(".command-search", "event-4");

    expect(text(".command-current-rows")).toContain("beta");
    expect(document.querySelector('.command-current-row[data-status="deleted"]')?.textContent).toContain("beta");
    expect(text(".command-update-list")).toContain("Updates · beta · 2");
    expect(text(".command-update-list")).toContain("event-3");
    expect(text(".command-update-list")).toContain("event-4");
    expect(text(".command-detail-pane")).toContain("Key beta - deleted");
    expect(text(".command-detail-pane")).not.toContain("event-3");
    button(".command-lifecycle-toggle").click();
    expect(text(".command-detail-pane")).toContain("event-3");
    expect(text(".command-detail-pane")).toContain("event-4");
    expect(text(".command-detail-pane")).toContain("DELETE");
  });

  it("shows selected key context and selected update detail separately", () => {
    clickCommandState();

    expect(selectedTexts(".command-current-row")).toHaveLength(1);
    expect(selectedTexts(".command-current-row")[0]).toContain("alpha");
    expect(selectedTexts(".command-update-row")).toHaveLength(0);

    clickRowByText(".command-update-row", "event-2");

    expect(text(".command-detail-pane")).toContain("Update event-2");
    expect(text(".command-detail-pane")).toContain("Update payload");
    expect(selectedTexts(".command-current-row")).toHaveLength(1);
    expect(selectedTexts(".command-current-row")[0]).toContain("alpha");
    expect(selectedTexts(".command-update-row")).toHaveLength(1);
    expect(selectedTexts(".command-update-row")[0]).toContain("event-2");

    clickRowByText(".command-current-row", "alpha");

    expect(text(".command-detail-pane")).toContain("Key alpha - active");
    expect(selectedTexts(".command-current-row")).toHaveLength(1);
    expect(selectedTexts(".command-current-row")[0]).toContain("alpha");
    expect(selectedTexts(".command-update-row")).toHaveLength(0);
  });

  it("reconciles selected COMMAND detail against the current visible results", () => {
    clickCommandState();
    clickRowByText(".command-current-row", "alpha");

    expect(text(".command-detail-pane")).toContain("Key alpha - active");

    input(".command-search", "beta");

    expect(text(".command-current-rows")).not.toContain("alpha");
    expect(text(".command-current-rows")).toContain("beta");
    expect(text(".command-update-list")).toContain("event-4");
    expect(text(".command-detail-pane")).toContain("Key beta - deleted");
    expect(text(".command-detail-pane")).not.toContain("Key alpha - active");
  });

  it("applies COMMAND search with AND semantics across all required fields", () => {
    clickCommandState();

    input(".command-search", "sub-command item-a alpha UPDATE synthetic-value event-5");
    expect(text(".command-current-table")).toContain("alpha");
    expect(text(".command-update-list")).toContain("event-5");
    expect(text(".command-detail-pane")).toContain("Key alpha - active");

    input(".command-search", "sub-command item-a alpha UPDATE synthetic live none");

    expect(text(".command-current-rows")).toContain("alpha");
    expect(text(".command-current-rows")).not.toContain("beta");

    input(".command-search", "unknown-key-delete ghost");

    expect(text(".command-current-rows")).not.toContain("alpha");
    expect(text(".command-current-rows")).not.toContain("ghost");
    expect(document.querySelectorAll(".command-diagnostic-result")).toHaveLength(1);
    expect(text(".command-diagnostic-key")).toBe("ghost");
    expect(text(".command-diagnostic-code")).toBe("unknown-key-delete");
    expect(text(".command-diagnostic-event")).toBe("event-6");
    expect(selectedTexts(".command-diagnostic-result")).toHaveLength(1);
    expect(text(".command-update-list")).toContain(
      "Selected diagnostic · no key lifecycle"
    );
    expect(text(".command-detail-pane")).toContain("COMMAND diagnostic");
    expect(text(".command-detail-pane")).toContain('"code": "unknown-key-delete"');
    expect(text(".command-detail-pane")).toContain('"key": "ghost"');
  });

  it("creates a schema-derived COMMAND draft with validation diagnostics and no auto-correction", () => {
    clickCommandState();

    expect(text(".command-detail-pane")).toContain("New COMMAND update");

    button(".new-command-button").click();

    expect(text(".command-draft-context")).toContain("sub-command");
    expect(text(".command-draft-context")).toContain("item-a");
    expect(text(".command-draft-field-table")).toContain("name");
    expect(text(".command-draft-field-table")).toContain("qty");
    expect(text(".command-draft-diagnostics")).toContain("missing-command");
    expect(text(".command-draft-diagnostics")).toContain("missing-key");
    expect(button(".inject-command-button").disabled).toBe(true);

    input(".command-draft-command", "UPDATE");
    input(".command-draft-key", "ghost");
    input('.command-draft-field-input[data-field-name="qty"]', "9");
    checkbox(".command-draft-snapshot", true);

    expect(text(".command-draft-diagnostics")).toContain("unknown-key-update");
    expect(text(".command-draft-diagnostics")).toContain("snapshot-update");
    expect(control(".command-draft-command").value).toBe("UPDATE");
    expect(control(".command-draft-key").value).toBe("ghost");
    expect((document.querySelector<HTMLInputElement>(".command-draft-snapshot")?.checked)).toBe(true);
    expect((document.querySelector<HTMLInputElement>('.command-draft-field-input[data-field-name="qty"]')?.value)).toBe("9");
    expect(button(".inject-command-button").disabled).toBe(false);
  });

  it("clears COMMAND state and reinjection context when events are cleared", () => {
    clickCommandState();

    button(".clear-button").click();

    expect(text(".event-count")).toBe("0");
    expect(store.count()).toBe(0);
    expect(text(".command-current-rows")).not.toContain("alpha");
    expect(text(".command-group-pane")).toContain("No COMMAND state yet");
    expect(text(".command-current-table")).toContain("Select a COMMAND subscription item");
    expect(document.querySelector<HTMLElement>(".command-detail-pane")?.hidden).toBe(true);
    expect(document.querySelector(".new-command-editor")).toBeNull();
    expect(document.querySelector(".new-command-button")).toBeNull();
    expect(reinjectDraft).not.toHaveBeenCalled();
  });

  it("clears a New COMMAND draft when the selected item context changes", () => {
    store.append(
      event("event-8", {
        itemName: "item-b",
        itemPosition: 2,
        key: "gamma",
        fields: {
          command: "ADD",
          key: "gamma",
          name: "Gamma",
          qty: "7",
          html: "",
          status: "open"
        }
      })
    );
    clickCommandState();
    button(".new-command-button").click();
    input(".command-draft-command", "ADD");
    input(".command-draft-key", "delta");

    expect(text(".command-draft-context")).toContain("item-a");
    expect(control(".command-draft-key").value).toBe("delta");

    clickRowByText(".command-item-button", "item-b");

    expect(document.querySelector(".command-draft-controls")).toBeNull();
    expect(document.querySelector(".command-draft-key")).toBeNull();
    expect(document.querySelectorAll(".new-command-editor > *")).toHaveLength(1);
    expect(button(".new-command-button").disabled).toBe(false);

    button(".new-command-button").click();

    expect(text(".command-draft-context")).toContain("item-b");
    expect(control(".command-draft-key").value).toBe("");
  });

  it("keeps the new COMMAND draft editor in view while typing", () => {
    clickCommandState();
    button(".new-command-button").click();

    const detailPane = document.querySelector<HTMLElement>(".command-detail-pane");
    if (!detailPane) {
      throw new Error("missing command detail pane");
    }
    detailPane.scrollTop = 240;

    const keyInput = control(".command-draft-key") as HTMLInputElement;
    keyInput.focus();
    keyInput.value = "g";
    keyInput.setSelectionRange(1, 1);
    keyInput.dispatchEvent(new Event("input", { bubbles: true }));

    const nextKeyInput = control(".command-draft-key") as HTMLInputElement;
    expect(detailPane.scrollTop).toBe(240);
    expect(document.activeElement).toBe(nextKeyInput);
    expect(nextKeyInput.value).toBe("g");
  });

  it("keeps COMMAND detail editors mounted and focused when new events arrive", async () => {
    clickCommandState();
    await flushInteractionRender();
    button(".new-command-button").click();
    input(".command-draft-key", "g");

    const detailPane = document.querySelector<HTMLElement>(".command-detail-pane");
    if (!detailPane) {
      throw new Error("missing command detail pane");
    }
    detailPane.scrollTop = 240;

    const keyInput = control(".command-draft-key") as HTMLInputElement;
    keyInput.focus();
    keyInput.setSelectionRange(1, 1);

    for (let index = 8; index < 16; index += 1) {
      store.append(event(`event-${index}`, { mode: "MERGE", key: `merge-key-${index}` }));
    }
    await flushInteractionRender();

    const nextKeyInput = control(".command-draft-key") as HTMLInputElement;
    expect(nextKeyInput).toBe(keyInput);
    expect(document.querySelector<HTMLElement>(".command-detail-pane")?.hidden).toBe(false);
    expect(document.activeElement).toBe(nextKeyInput);
    expect(nextKeyInput.value).toBe("g");
    expect(nextKeyInput.selectionStart).toBe(1);
    expect(detailPane.scrollTop).toBe(240);
  });

  it("appends a synthetic COMMAND row only after listener-path success", async () => {
    reinjectDraft.mockResolvedValue({
      requestId: "request-1",
      ok: true,
      status: "success",
      timestamp: 1_700_000_000_999
    });
    clickCommandState();
    button(".new-command-button").click();
    input(".command-draft-command", "ADD");
    input(".command-draft-key", "bravo");
    input('.command-draft-field-input[data-field-name="name"]', "Bravo");
    input('.command-draft-field-input[data-field-name="qty"]', "4");

    await button(".inject-command-button").click();
    await Promise.resolve();
    await flushInteractionRender();

    expect(reinjectDraft).toHaveBeenCalledTimes(1);
    expect(store.list().filter((entry) => entry.synthetic)).toHaveLength(2);
    expect(text(".reinjection-message")).toContain(
      "Synthetic COMMAND update injected through the captured listener."
    );
    expect(text(".command-current-rows")).toContain("bravo");
    clickRowByText(".command-current-row", "bravo");
    button(".command-lifecycle-toggle").click();
    expect(text(".command-detail-pane")).toContain("synthetic-request-1");
    expect(store.list().at(-1)?.raw).toMatchObject({
      provenance: {
        source: "new-command"
      }
    });
  });

  it("preserves failed COMMAND drafts and appends no synthetic row for listener errors", async () => {
    reinjectDraft.mockResolvedValue({
      requestId: "request-2",
      ok: false,
      status: "listener-error",
      timestamp: 1_700_000_001_111,
      error: "listener threw"
    });
    clickCommandState();
    button(".new-command-button").click();
    input(".command-draft-command", "ADD");
    input(".command-draft-key", "charlie");
    input('.command-draft-field-input[data-field-name="name"]', "Charlie");

    await button(".inject-command-button").click();
    await Promise.resolve();

    expect(store.list().filter((entry) => entry.synthetic)).toHaveLength(1);
    expect(text(".reinjection-message")).toContain(
      "Synthetic COMMAND update was not appended. Review the listener error and adjust the draft."
    );
    expect(text(".reinjection-message")).toContain("listener threw");
    expect(control(".command-draft-key").value).toBe("charlie");
    expect(text(".command-current-rows")).not.toContain("charlie");
  });
});
