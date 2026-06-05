import { describe, expect, it } from "vitest";

import {
  createNewCommandDraftFromContext,
  updateDraftCommand,
  updateDraftField,
  updateDraftKey,
  updateDraftSnapshot,
  validateNewCommandDraft,
  type CommandItemContext
} from "../src/core/reinjection-draft";
import { reduceCommandState } from "../src/core/command-state";
import { createSyntheticEventFromDraft } from "../src/core/synthetic-event";
import { isReinjectionDraftPayload } from "../src/bridge/messages";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";

describe("new context-bound COMMAND drafts", () => {
  it("creates schema-derived empty drafts only from captured COMMAND subscription, item, listener, and fields", () => {
    const draft = createNewCommandDraftFromContext(commandContext());

    expect(draft).toMatchObject({
      sourceEventId: "new-command:sub-command:listener-1:item-a",
      target: {
        subscriptionId: "sub-command",
        listenerId: "listener-1"
      },
      item: {
        name: "item-a",
        position: 1
      },
      command: null,
      key: null,
      isSnapshot: false,
      provenance: {
        source: "new-command",
        sourceSynthetic: true
      }
    });
    expect(draft?.fields).toEqual({
      command: null,
      key: null,
      name: null,
      qty: null,
      status: null
    });
    expect(draft?.sourceFields).toEqual(draft?.fields);
    expect(draft?.changedFields).toEqual({});
  });

  it("returns null when captured subscription, item, listener, or COMMAND field schema context is missing", () => {
    expect(createNewCommandDraftFromContext(commandContext({ subscriptionId: "" }))).toBeNull();
    expect(createNewCommandDraftFromContext(commandContext({ itemName: null, itemPosition: null }))).toBeNull();
    expect(createNewCommandDraftFromContext(commandContext({ listenerId: null }))).toBeNull();
    expect(createNewCommandDraftFromContext(commandContext({ mode: "MERGE" }))).toBeNull();
    expect(createNewCommandDraftFromContext(commandContext({ fields: ["command", "name"] }))).toBeNull();
    expect(createNewCommandDraftFromContext(commandContext({ fields: ["key", "name"] }))).toBeNull();
    expect(createNewCommandDraftFromContext(commandContext({ fields: [] }))).toBeNull();
  });

  it("reports blocking validation diagnostics for arbitrary fabrication and malformed draft values", () => {
    const state = reduceCommandState([capturedAdd()]);
    const draft = createNewCommandDraftFromContext(commandContext());
    if (!draft) {
      throw new Error("missing draft");
    }

    const invalidContext = validateNewCommandDraft(draft, state, commandContext({ subscriptionId: "" }));
    expect(invalidContext.valid).toBe(false);
    expect(invalidContext.diagnostics.map((diagnostic) => diagnostic.code)).toContain("missing-context");

    const missingValues = validateNewCommandDraft(draft, state, commandContext());
    expect(missingValues.valid).toBe(false);
    expect(missingValues.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["missing-command", "missing-key"])
    );

    const unsupported = validateNewCommandDraft(
      updateDraftKey(updateDraftCommand(draft, "UPSERT"), "alpha"),
      state,
      commandContext()
    );
    expect(unsupported.valid).toBe(false);
    expect(unsupported.diagnostics.map((diagnostic) => diagnostic.code)).toContain("unsupported-command");

    const invalidField = validateNewCommandDraft(
      updateDraftField(updateDraftKey(updateDraftCommand(draft, "ADD"), "bravo"), "", "bad"),
      state,
      commandContext()
    );
    expect(invalidField.valid).toBe(false);
    expect(invalidField.diagnostics.map((diagnostic) => diagnostic.code)).toContain("invalid-field-name");
  });

  it("suggests COMMAND semantic corrections without mutating command, key, snapshot, or fields", () => {
    const state = reduceCommandState([capturedAdd()]);
    const draft = createNewCommandDraftFromContext(commandContext());
    if (!draft) {
      throw new Error("missing draft");
    }

    const updateUnknown = updateDraftField(
      updateDraftKey(updateDraftCommand(draft, "UPDATE"), "ghost"),
      "qty",
      "9"
    );
    const beforeUpdate = structuredClone(updateUnknown);
    const updateResult = validateNewCommandDraft(updateUnknown, state, commandContext());

    expect(updateResult.valid).toBe(true);
    expect(updateResult.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "unknown-key-update",
          suggestion: expect.stringContaining("Use ADD")
        })
      ])
    );
    expect(updateUnknown).toEqual(beforeUpdate);

    const deleteUnknown = updateDraftSnapshot(
      updateDraftKey(updateDraftCommand(draft, "DELETE"), "ghost"),
      true
    );
    const beforeDelete = structuredClone(deleteUnknown);
    const deleteResult = validateNewCommandDraft(deleteUnknown, state, commandContext());

    expect(deleteResult.valid).toBe(true);
    expect(deleteResult.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["unknown-key-delete", "snapshot-delete"])
    );
    expect(deleteUnknown).toEqual(beforeDelete);
  });

  it("serializes new COMMAND drafts with new-command provenance and valid bridge payload shape", () => {
    const draft = createNewCommandDraftFromContext(commandContext());
    if (!draft) {
      throw new Error("missing draft");
    }

    const ready = updateDraftField(
      updateDraftKey(updateDraftCommand(draft, "ADD"), "bravo"),
      "name",
      "Bravo"
    );

    expect(isReinjectionDraftPayload(ready)).toBe(true);

    const event = createSyntheticEventFromDraft(ready, {
      requestId: "request-1",
      ok: true,
      status: "success",
      timestamp: 123
    });

    expect(event.source).toBe("synthetic");
    expect(event.synthetic).toBe(true);
    expect(event.raw).toMatchObject({
      sourceEventId: "new-command:sub-command:listener-1:item-a",
      clonedSourceEventId: null,
      targetSubscriptionId: "sub-command",
      targetListenerId: "listener-1",
      requestId: "request-1",
      status: "success",
      provenance: {
        source: "new-command"
      }
    });
  });
});

function commandContext(overrides: Partial<CommandItemContext> = {}): CommandItemContext {
  return {
    subscriptionId: "sub-command",
    mode: "COMMAND",
    listenerId: "listener-1",
    itemName: "item-a",
    itemPosition: 1,
    fields: ["command", "key", "name", "qty", "status"],
    ...overrides
  };
}

function capturedAdd(): LightstreamerEventEnvelope {
  return {
    id: "event-1",
    timestamp: 1,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    subscription: {
      id: "sub-command",
      mode: "COMMAND",
      fields: ["command", "key", "name", "qty", "status"]
    },
    listener: { id: "listener-1" },
    item: {
      name: "item-a",
      position: 1
    },
    update: {
      isSnapshot: true,
      command: "ADD",
      key: "alpha",
      fields: {
        command: "ADD",
        key: "alpha",
        name: "Alpha",
        qty: "1",
        status: "open"
      },
      changedFields: {
        command: "ADD",
        key: "alpha"
      }
    }
  };
}
