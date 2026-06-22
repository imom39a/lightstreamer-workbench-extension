import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { createEventStore, type EventStore } from "../src/core/event-store";
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

async function flushInteractionRender(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
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

function seedCommandEvents(store: EventStore): void {
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

function seedIssue16CommandGroups(store: EventStore): number {
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
  let store: EventStore;
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
    expect(text(".command-group-pane")).toContain("COMMAND");
    expect(text(".command-group-pane")).toContain("item-a");
    expect(text(".command-group-pane")).toContain("Choose an item.");
    expect(text(".command-group-pane")).not.toContain("sub-merge");
    expect(text(".command-group-pane")).not.toContain("1 active");
    expect(text(".command-group-pane")).not.toContain("1 deleted");
    expect(text(".command-group-pane")).not.toContain("live server");
    expect(document.querySelector(".command-item-meta")).toBeNull();
    expect(text(".command-current-table")).toContain("Keys");
    expect(text(".command-current-table")).toContain("Select a key to inspect its updates.");
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
    expect(text(".command-update-list")).toContain("Updates for selected key");
    expect(text(".command-update-list")).toContain("3 updates for alpha.");
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
    expect(sidebarText).toContain("subscription-15 COMMAND");
    expect(sidebarText).toContain("storeAlerts.STORE_NYC_001");
    expect(sidebarText).toContain("orderDetails.STORE_NYC_001");
    expect(sidebarText).toContain("healthCheck.SYS_MONITOR");
    expect(sidebarText).toContain("salesActivity.STORE_NYC_001 position 1");
    expect(sidebarText).toContain("salesActivity.STORE_NYC_001 position 2");

    clickRowByText(".command-item-button", "orderDetails.STORE_NYC_001");
    expect(text(".command-current-table")).toContain("orderdetails-store-nyc-001-850");
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

  it("renders help tooltips in a clamped overlay for hover and focus", () => {
    clickCommandState();

    const helpText = "How many captured or synthetic updates are in this key lifecycle.";
    const helpIcon = document.querySelector<HTMLButtonElement>('.command-help-icon[aria-label^="Updates:"]');
    const tooltip = document.querySelector<HTMLElement>(".command-tooltip");
    if (!helpIcon || !tooltip) {
      throw new Error("missing tooltip test elements");
    }

    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    const helpIconRect = vi.spyOn(helpIcon, "getBoundingClientRect").mockReturnValue(rect(12, 2, 16, 16));
    const tooltipRect = vi.spyOn(tooltip, "getBoundingClientRect").mockReturnValue(rect(0, 0, 220, 48));
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 160 });

    try {
      helpIcon.dispatchEvent(new Event("pointerover", { bubbles: true }));

      expect(tooltip.hidden).toBe(false);
      expect(tooltip.getAttribute("role")).toBe("tooltip");
      expect(tooltip.textContent).toContain(helpText);
      expect(tooltip.dataset.placement).toBe("bottom");
      expect(Number.parseInt(tooltip.style.left, 10)).toBeGreaterThanOrEqual(8);
      expect(Number.parseInt(tooltip.style.top, 10)).toBeGreaterThanOrEqual(26);
      expect(helpIcon.getAttribute("aria-describedby")).toBe(tooltip.id);
      expect(helpIcon.hasAttribute("title")).toBe(false);

      helpIcon.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }));

      expect(tooltip.hidden).toBe(true);
      expect(helpIcon.title).toBe(helpText);

      helpIcon.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

      expect(tooltip.hidden).toBe(false);
      expect(helpIcon.getAttribute("aria-describedby")).toBe(tooltip.id);

      helpIcon.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }));

      expect(tooltip.hidden).toBe(true);
      expect(helpIcon.title).toBe(helpText);
    } finally {
      helpIconRect.mockRestore();
      tooltipRect.mockRestore();
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    }
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
    expect(detailText).toContain("Selected key lifecycle");
    expect(detailText).toContain("Events for this key only.");
    expect(detailText.indexOf("Current fields")).toBeLessThan(detailText.indexOf("Selected key lifecycle"));
    expect(detailText).toContain('"qty": "3"');
    expect(detailText).toContain("<strong>synthetic-value</strong>");
    expect(detailText).toContain("Origin snapshot server");
    expect(detailText).toContain("Latest synthetic UPDATE");
    expect(texts(".command-lifecycle-entry")).toEqual(
      expect.arrayContaining([
        expect.stringContaining("event-1"),
        expect.stringContaining("event-2"),
        expect.stringContaining("event-5")
      ])
    );
    expect(detailText).toContain("ADD");
    expect(detailText).toContain("UPDATE");
    expect(detailText).toContain("snapshot server");
    expect(detailText).toContain("live server");
    expect(detailText).toContain("synthetic live");
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
    expect(text(".command-update-list")).toContain("Updates for selected key");
    expect(text(".command-update-list")).toContain("event-3");
    expect(text(".command-update-list")).toContain("event-4");
    expect(text(".command-detail-pane")).toContain("Key beta - deleted");
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
    expect(text(".command-update-list")).toContain("Select a key to inspect its updates.");
    expect(text(".command-detail-pane")).toContain("Select a key or update");
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

  it("preserves COMMAND reinjection context after clearing visible events", async () => {
    reinjectDraft.mockResolvedValue({
      requestId: "request-after-clear",
      ok: true,
      status: "success",
      timestamp: 1_700_000_002_222
    });
    clickCommandState();

    button(".clear-button").click();

    expect(text(".event-count")).toBe("0");
    expect(store.count()).toBe(0);
    expect(text(".command-current-rows")).toContain("alpha");
    expect(text(".command-detail-pane")).toContain("New COMMAND update");

    button(".new-command-button").click();
    input(".command-draft-command", "UPDATE");
    input(".command-draft-key", "alpha");
    input('.command-draft-field-input[data-field-name="qty"]', "10");

    expect(button(".inject-command-button").disabled).toBe(false);

    await button(".inject-command-button").click();
    await Promise.resolve();

    expect(reinjectDraft).toHaveBeenCalledTimes(1);
    expect(reinjectDraft.mock.calls[0]?.[0]).toMatchObject({
      target: {
        subscriptionId: "sub-command",
        listenerId: "listener-1"
      },
      command: "UPDATE",
      key: "alpha"
    });
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.synthetic).toBe(true);
    expect(text(".reinjection-message")).toContain(
      "Synthetic COMMAND update injected through the captured listener."
    );
    expect(text(".command-update-list")).toContain("UPDATE");
    expect(text(".command-detail-pane")).toContain("Latest synthetic UPDATE");
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
    expect(text(".new-command-editor")).toContain(
      "Select a captured COMMAND subscription and item, then create a synthetic update from that context."
    );
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

  it("keeps COMMAND detail editors open and focused when new events arrive", () => {
    clickCommandState();
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

    store.append(event("event-8", { mode: "MERGE", key: "merge-key" }));

    const nextKeyInput = control(".command-draft-key") as HTMLInputElement;
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

    expect(reinjectDraft).toHaveBeenCalledTimes(1);
    expect(store.list().filter((entry) => entry.synthetic)).toHaveLength(2);
    expect(text(".reinjection-message")).toContain(
      "Synthetic COMMAND update injected through the captured listener."
    );
    expect(text(".command-current-rows")).toContain("bravo");
    clickRowByText(".command-current-row", "bravo");
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
