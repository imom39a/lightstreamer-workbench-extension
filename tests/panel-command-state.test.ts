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
  } = {}
): LightstreamerEventEnvelope {
  const command: string | null = Object.prototype.hasOwnProperty.call(overrides, "command")
    ? overrides.command ?? null
    : "ADD";
  const key: string | null = Object.prototype.hasOwnProperty.call(overrides, "key")
    ? overrides.key ?? null
    : "alpha";
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
      fields: ["command", "key", "name", "qty", "html", "status"]
    },
    listener: { id: "listener-1" },
    item: {
      name: overrides.itemName ?? "item-a",
      position: overrides.itemPosition ?? 1
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

  it("keeps Timeline available and renders COMMAND subscription/item/active-key grouping", () => {
    expect(text(".view-selector")).toContain("Timeline");
    expect(text(".view-selector")).toContain("COMMAND State");
    expect(document.querySelector(".event-feed")).not.toBeNull();

    clickCommandState();

    expect(document.querySelector('[aria-label="COMMAND state workbench"]')).not.toBeNull();
    expect(text(".command-group-pane")).toContain("sub-command");
    expect(text(".command-group-pane")).toContain("item-a");
    expect(text(".command-group-pane")).toContain("1 active");
    expect(text(".command-group-pane")).toContain("1 deleted");
    expect(text(".command-group-pane")).toContain("Choose a subscription and item.");
    expect(text(".command-group-pane")).not.toContain("sub-merge");
    expect(text(".command-current-table")).toContain("Active keys");
    expect(text(".command-current-table")).toContain("Current COMMAND state for the selected item.");
    expect(text(".command-current-table")).toContain("Key");
    expect(text(".command-current-table")).toContain("Origin");
    expect(text(".command-current-table")).toContain("Latest");
    expect(text(".command-current-table")).toContain("Command");
    expect(text(".command-current-table")).toContain("Fields");
    expect(text(".command-current-table")).toContain("Updates");
    expect(text(".command-current-table")).toContain("Last seen");
    expect(text(".command-current-table")).toContain("Diagnostics");
    expect(text(".command-current-rows")).toContain("alpha");
    expect(text(".command-current-rows")).toContain("snapshot server");
    expect(text(".command-current-rows")).toContain("synthetic UPDATE");
    expect(text(".command-current-rows")).not.toContain("beta");
    expect(text(".command-lifecycle-results")).toContain("Matching keys, deleted keys, and diagnostics");
    expect(text(".command-lifecycle-results")).toContain(
      "matches across active keys, deleted keys, and diagnostics for this item."
    );
    expect(
      document.querySelector<HTMLButtonElement>('.command-help-icon[aria-label^="Origin:"]')?.title
    ).toBe("The event that created this active COMMAND key.");
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
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("strong")).toBeNull();
  });

  it("finds deleted keys through lifecycle search without putting them back in active rows", () => {
    clickCommandState();

    input(".command-search", "event-4");

    expect(text(".command-current-rows")).not.toContain("beta");
    expect(text(".command-lifecycle-results")).toContain("Matching keys, deleted keys, and diagnostics");
    expect(text(".command-lifecycle-results")).toContain("beta");
    expect(text(".command-lifecycle-results")).toContain("deleted");

    clickRowByText(".command-lifecycle-result", "beta");

    expect(text(".command-current-rows")).not.toContain("beta");
    expect(text(".command-detail-pane")).toContain("Key beta - deleted");
    expect(text(".command-detail-pane")).toContain("event-3");
    expect(text(".command-detail-pane")).toContain("event-4");
    expect(text(".command-detail-pane")).toContain("DELETE");
  });

  it("reconciles selected COMMAND detail against the current visible results", () => {
    clickCommandState();
    clickRowByText(".command-current-row", "alpha");

    expect(text(".command-detail-pane")).toContain("Key alpha - active");

    input(".command-filter-key", "beta");

    expect(text(".command-current-rows")).not.toContain("alpha");
    expect(text(".command-lifecycle-results")).toContain("beta");
    expect(text(".command-detail-pane")).toContain("Key beta - deleted");
    expect(text(".command-detail-pane")).not.toContain("Key alpha - active");
  });

  it("applies COMMAND search and compact filters with AND semantics across all required fields", () => {
    clickCommandState();

    input(".command-search", "sub-command item-a alpha UPDATE synthetic-value event-5");
    expect(text(".command-current-table")).toContain("alpha");
    expect(text(".command-lifecycle-results")).toContain("alpha");
    expect(text(".command-detail-pane")).toContain("Key alpha - active");

    input(".command-search", "");
    input(".command-filter-subscription", "sub-command");
    input(".command-filter-item", "item-a");
    input(".command-filter-key", "alpha");
    input(".command-filter-command", "UPDATE");
    input(".command-filter-source", "synthetic");
    input(".command-filter-snapshot", "live");
    input(".command-filter-synthetic", "synthetic");
    input(".command-filter-diagnostics", "none");

    expect(text(".command-current-rows")).toContain("alpha");
    expect(text(".command-current-rows")).not.toContain("beta");

    input(".command-filter-key", "");
    input(".command-filter-command", "");
    input(".command-filter-source", "");
    input(".command-filter-snapshot", "");
    input(".command-filter-synthetic", "");
    input(".command-filter-diagnostics", "unknown-key-delete");

    expect(text(".command-current-rows")).not.toContain("alpha");
    expect(text(".command-lifecycle-results")).toContain("ghost");
    expect(text(".command-lifecycle-results")).toContain("diagnostic");
    expect(text(".command-detail-pane")).toContain("COMMAND diagnostic");
    expect(text(".command-detail-pane")).toContain("unknown-key-delete");

    clickRowByText(".command-lifecycle-result", "ghost");

    expect(text(".command-detail-pane")).toContain("event-6");
    expect(document.querySelector('.command-lifecycle-result[data-selected="true"]')?.textContent).toContain(
      "ghost"
    );
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
    expect(text(".command-current-rows")).toContain("synthetic ADD");
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
