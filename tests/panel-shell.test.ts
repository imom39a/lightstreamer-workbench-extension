import { beforeEach, describe, expect, it } from "vitest";

import { createCaptureMessage } from "../src/bridge/messages";
import { type ReinjectionResult } from "../src/bridge/messages";
import { createEventStore } from "../src/core/event-store";
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

function editDraftJson(mutator: (draft: Record<string, unknown>) => void): void {
  const textarea = document.querySelector<HTMLTextAreaElement>(".draft-json");
  if (!textarea) {
    throw new Error("missing draft JSON textarea");
  }
  const draft = JSON.parse(textarea.value) as Record<string, unknown>;
  mutator(draft);
  input(".draft-json", JSON.stringify(draft, null, 2));
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
      }
    })
  );
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
    expect(text(".status-badge")).toBe("idle");
    expect(text(".event-count")).toBe("0");
    expect(document.querySelector(".event-count")?.getAttribute("aria-label")).toBe("0 captured events");
    expect(document.querySelector<HTMLInputElement>(".search-input")?.placeholder).toBe(
      "Search events, fields, ids, command, key, or JSON"
    );
    expect(text(".clear-button")).toBe("Clear events");
  });

  it("renders the empty feed and detail placeholder", () => {
    expect(text(".empty-heading")).toBe("Waiting for Lightstreamer activity");
    expect(text(".empty-body")).toContain("Captured clients, subscriptions, and item updates will appear here");
    expect(text(".detail-placeholder")).toBe("Select an event to inspect its envelope.");
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
    expect(text(".event-marker")).toBe("server snapshot");
    expect(text(".event-command")).toBe("ADD/alpha");
    expect(text(".detail-pane")).toContain('"synthetic": false');
    expect(text(".detail-pane")).toContain('"key": "alpha"');
    expect(text(".detail-pane")).toContain("Listener");
    expect(text(".editor-placeholder")).toBe(
      "Clone a captured item update to edit and reinject it locally."
    );
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

  it("realigns detail with newest visible event when filters hide the selected row", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    appendCommandUpdate(panel, "beta", { qty: 2 });

    const firstRow = document.querySelectorAll<HTMLButtonElement>(".event-row")[0];
    firstRow.click();
    expect(text(".detail-pane")).toContain('"key": "alpha"');

    input(".filter-key", "beta");

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
    expect(text(".detail-pane")).toContain("Synthetic Provenance");
    expect(text(".detail-pane")).toContain('"sourceEventId": "event-1"');
  });

  it("renders captured HTML-like field values as inert text", () => {
    appendCommandUpdate(panel, "alpha", { html: "<img src=x onerror=alert(1)>" });

    expect(document.querySelector("img")).toBeNull();
    expect(text(".detail-pane")).toContain("<img src=x onerror=alert(1)>");
  });

  it("disables Clone event for non-item-update rows", () => {
    panel.appendCaptureMessage(
      createCaptureMessage("client-status", {
        client: { id: "client-1", status: "CONNECTED:WS-STREAMING" }
      })
    );

    expect(text(".clone-button")).toBe("Clone event");
    expect(document.querySelector<HTMLButtonElement>(".clone-button")?.disabled).toBe(true);
  });

  it("allows cloning wire-captured updates while keeping reinjection disabled", () => {
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
    expect(document.querySelector<HTMLButtonElement>(".clone-button")?.disabled).toBe(false);

    document.querySelector<HTMLButtonElement>(".clone-button")?.click();

    expect(text(".draft-source-context")).toContain("Listener-");
    expect(text(".draft-validation-error")).toBe(
      "This draft came from wire-level capture, so it can be inspected and edited but cannot be reinjected through an original listener."
    );
    expect(document.querySelector<HTMLButtonElement>(".reinject-button")?.disabled).toBe(true);
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
    expect(text(".draft-source-fields")).toContain('"qty": 1');
  });

  it("derives changed fields from draft JSON edits without remounting the editor", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();
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

  it("clears the cloned draft when selecting a different captured event", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    appendCommandUpdate(panel, "beta", { qty: 2 });

    const rows = document.querySelectorAll<HTMLButtonElement>(".event-row");
    rows[0].click();
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();
    editDraftJson((draft) => {
      const fields = draft.fields as Record<string, unknown>;
      fields.qty = "11";
    });

    expect(text(".draft-source-context")).toContain("event-1");
    expect(text(".draft-changed-fields-preview")).toContain('"qty": "11"');

    document.querySelectorAll<HTMLButtonElement>(".event-row")[1].click();

    expect(document.querySelector<HTMLTextAreaElement>(".draft-json")).toBeNull();
    expect(text(".editor-placeholder")).toBe(
      "Clone a captured item update to edit and reinject it locally."
    );
    expect(document.querySelector<HTMLButtonElement>(".clone-button")?.disabled).toBe(false);
    expect(text(".draft-source-context")).toBe("");
    expect(text(".reinjection-message")).toBe("");
  });

  it("shows validation and disables reinjection when the draft key is cleared", () => {
    appendCommandUpdate(panel, "alpha", { qty: 1 });
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();

    editDraftJson((draft) => {
      draft.key = "";
    });

    expect(text(".draft-validation-error")).toBe(
      "Draft is missing required COMMAND values. Add a captured subscription, item, command/key, and valid field names before reinjecting."
    );
    expect(document.querySelector<HTMLButtonElement>(".reinject-button")?.disabled).toBe(true);
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
    document.querySelector<HTMLButtonElement>(".clone-button")?.click();
    editDraftJson((draft) => {
      draft.isSnapshot = false;
      const fields = draft.fields as Record<string, unknown>;
      fields.qty = "12";
    });

    const button = document.querySelector<HTMLButtonElement>(".reinject-button");
    expect(button?.disabled).toBe(false);
    button?.click();

    expect(text(".reinject-button")).toBe("Reinjecting...");
    await flushPromises();

    const receivedDraft = receivedDrafts[0];
    expect(receivedDraft).toBeDefined();
    expect(receivedDraft?.sourceEventId).toBe("event-1");
    expect(receivedDraft?.fields.qty).toBe("12");
    expect(receivedDraft?.changedFields.qty).toBe("12");
    expect(receivedDraft?.isSnapshot).toBe(false);
    expect(text(".reinjection-message")).toBe("Synthetic update reinjected through the original listener.");
    expect(text(".event-count")).toBe("2");
    expect(Array.from(document.querySelectorAll(".event-marker")).map((marker) => marker.textContent)).toContain(
      "synthetic live"
    );
    expect(document.querySelectorAll<HTMLButtonElement>(".event-row")[0].dataset.selected).toBe("true");
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
