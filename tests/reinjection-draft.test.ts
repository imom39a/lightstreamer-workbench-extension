import { describe, expect, it } from "vitest";

import {
  createDraftFromEvent,
  setManualChangedFieldsOverride,
  updateDraftField,
  validateEditableDraft,
  validateReinjectionDraft
} from "../src/core/reinjection-draft";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";

function itemUpdate(overrides: Partial<LightstreamerEventEnvelope> = {}): LightstreamerEventEnvelope {
  return {
    id: "event-1",
    timestamp: 1,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    subscription: { id: "subscription-1", mode: "COMMAND" },
    listener: { id: "listener-1" },
    item: { name: "scenario.snapshot-basic", position: 1 },
    update: {
      isSnapshot: true,
      fields: { command: "ADD", key: "alpha", qty: 10, status: "open" },
      changedFields: { command: "ADD", key: "alpha" },
      command: "ADD",
      key: "alpha"
    },
    ...overrides
  };
}

describe("reinjection drafts", () => {
  it("clones source event id, target ids, command, key, and fields", () => {
    const draft = createDraftFromEvent(itemUpdate());

    expect(draft?.sourceEventId).toBe("event-1");
    expect(draft?.target.subscriptionId).toBe("subscription-1");
    expect(draft?.target.listenerId).toBe("listener-1");
    expect(draft?.command).toBe("ADD");
    expect(draft?.key).toBe("alpha");
    expect(draft?.fields).toEqual({ command: "ADD", key: "alpha", qty: 10, status: "open" });
    expect(draft?.isSnapshot).toBe(true);
  });

  it("auto-populates changedFields when edited fields differ from the source", () => {
    const draft = createDraftFromEvent(itemUpdate());
    if (!draft) {
      throw new Error("missing draft");
    }

    const edited = updateDraftField(draft, "qty", 11);

    expect(edited.changedFields).toEqual({ qty: 11 });
  });

  it("preserves manual changed-fields override when active", () => {
    const draft = createDraftFromEvent(itemUpdate());
    if (!draft) {
      throw new Error("missing draft");
    }

    const overridden = setManualChangedFieldsOverride(draft, { status: "manual" });
    const edited = updateDraftField(overridden, "qty", 12);

    expect(edited.manualChangedFieldsOverride).toBe(true);
    expect(edited.changedFields).toEqual({ status: "manual" });
  });

  it("allows editing without a listener but keeps reinjection validation strict", () => {
    const draft = createDraftFromEvent(
      itemUpdate({
        listener: undefined,
        update: {
          isSnapshot: true,
          fields: { command: "ADD", key: "alpha" },
          changedFields: {},
          command: "ADD",
          key: "alpha"
        }
      })
    );

    expect(validateEditableDraft(draft).valid).toBe(true);

    const result = validateReinjectionDraft(draft);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing original listener target.");
  });

  it("fails editable validation for empty field names", () => {
    const draft = createDraftFromEvent(
      itemUpdate({
        update: {
          isSnapshot: true,
          fields: { "": "bad", command: "ADD", key: "alpha" },
          changedFields: {},
          command: "ADD",
          key: "alpha"
        }
      })
    );

    const result = validateEditableDraft(draft);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Field names must be non-empty.");
  });

  it("does not create a draft for non-item-update events", () => {
    expect(createDraftFromEvent(itemUpdate({ kind: "client-status" }))).toBeNull();
  });
});
