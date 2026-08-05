import { describe, expect, it } from "vitest";

import {
  createDraftFromEvent,
  createSourceReplayDraft,
  setManualChangedFieldsOverride,
  updateDraftField,
  validateDraftForExecutionTarget,
  validateEditableDraft,
  validateReinjectionDraft
} from "../src/core/reinjection-draft";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import {
  analyzeLocalInjectionDocument,
  applyLocalInjectionDocumentToDraft,
  createLocalInjectionDocumentFromDraft,
  serializeLocalInjectionDocument,
  validateLocalInjectionDocument
} from "../src/core/local-injection-document";
import { reduceCommandState } from "../src/core/command-state";

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
  it("uses the exact raw Local Injection document and preserves every JSON primitive", () => {
    const source = createDraftFromEvent(
      itemUpdate({
        update: {
          isSnapshot: false,
          fields: {
            command: "ADD",
            key: "primitive-key",
            nullable: null,
            empty: "",
            disabled: false,
            zero: 0
          },
          changedFields: {},
          command: "ADD",
          key: "primitive-key"
        }
      })
    );
    if (!source) throw new Error("missing source");

    const document = createLocalInjectionDocumentFromDraft(source);
    const text = serializeLocalInjectionDocument(document);
    const analyzed = analyzeLocalInjectionDocument(text, {
      mode: "COMMAND",
      schemaFields: Object.keys(document.fields),
      commandState: reduceCommandState([]),
      subscriptionId: "subscription-1",
      itemName: "scenario.snapshot-basic",
      itemPosition: 1
    });

    expect(Object.keys(document)).toEqual(["command", "key", "isSnapshot", "fields"]);
    expect(analyzed.ready).toBe(true);
    expect(analyzed.document?.fields).toMatchObject({ nullable: null, empty: "", disabled: false, zero: 0 });
    expect(applyLocalInjectionDocumentToDraft(source, analyzed.document!)).toMatchObject({
      command: "ADD",
      key: "primitive-key",
      isSnapshot: false,
      fields: { nullable: null, empty: "", disabled: false, zero: 0 }
    });
  });

  it("expands captured JSON-container strings for editing and restores string delivery semantics", () => {
    const exactSource = '{\n  "passenger": { "selected": false, "priority": false }\n}';
    const source = createDraftFromEvent(
      itemUpdate({
        update: {
          isSnapshot: false,
          fields: {
            command: "UPDATE",
            key: "alpha",
            modelValues: exactSource,
            legs: '[{"from":"ATL","to":"JAN"}]',
            malformed: '{"passenger":',
            scalar: "true",
            ordinary: "customer"
          },
          changedFields: { modelValues: exactSource },
          command: "UPDATE",
          key: "alpha"
        }
      })
    );
    if (!source) throw new Error("missing JSON-string source");

    const document = createLocalInjectionDocumentFromDraft(source);
    expect(document.fields).toMatchObject({
      modelValues: { passenger: { selected: false, priority: false } },
      legs: [{ from: "ATL", to: "JAN" }],
      malformed: '{"passenger":',
      scalar: "true",
      ordinary: "customer"
    });

    const context = {
      mode: "COMMAND",
      schemaFields: Object.keys(source.fields),
      jsonStringFields: ["modelValues", "legs"],
      commandState: reduceCommandState([
        itemUpdate({
          update: {
            isSnapshot: false,
            fields: { command: "ADD", key: "alpha" },
            changedFields: { command: "ADD", key: "alpha" },
            command: "ADD",
            key: "alpha"
          }
        })
      ]),
      subscriptionId: "subscription-1",
      itemName: "scenario.snapshot-basic",
      itemPosition: 1
    } as const;
    const analyzed = analyzeLocalInjectionDocument(
      serializeLocalInjectionDocument(document),
      context
    );
    expect(analyzed.ready).toBe(true);

    const unchanged = applyLocalInjectionDocumentToDraft(source, analyzed.document!);
    expect(unchanged.fields.modelValues).toBe(exactSource);
    expect(typeof unchanged.fields.legs).toBe("string");
    expect(JSON.parse(String(unchanged.fields.legs))).toEqual([{ from: "ATL", to: "JAN" }]);

    const editedText = serializeLocalInjectionDocument({
      ...analyzed.document!,
      fields: {
        ...analyzed.document!.fields,
        modelValues: { passenger: { selected: true, priority: false } }
      }
    });
    const edited = analyzeLocalInjectionDocument(editedText, context);
    expect(edited.ready).toBe(true);
    const execution = applyLocalInjectionDocumentToDraft(source, edited.document!);
    expect(typeof execution.fields.modelValues).toBe("string");
    expect(JSON.parse(String(execution.fields.modelValues))).toEqual({
      passenger: { selected: true, priority: false }
    });
    expect(execution.changedFields.modelValues).toBe(execution.fields.modelValues);
    expect(source.fields.modelValues).toBe(exactSource);

    const scalarReplacement = analyzeLocalInjectionDocument(
      serializeLocalInjectionDocument({
        ...analyzed.document!,
        fields: { ...analyzed.document!.fields, modelValues: "false" }
      }),
      context
    );
    expect(scalarReplacement.ready).toBe(false);
    expect(scalarReplacement.diagnostics).toContainEqual(
      expect.objectContaining({ code: "encoded-json-field-type", path: "fields.modelValues" })
    );
  });

  it("validates a captured MERGE document without applying COMMAND-only semantics", () => {
    const source = createDraftFromEvent(
      itemUpdate({
        subscription: {
          id: "subscription-merge",
          mode: "MERGE",
          fields: ["price", "halted"]
        },
        update: {
          isSnapshot: false,
          fields: { price: 101, halted: false },
          changedFields: { price: 101, halted: false }
        }
      })
    );
    if (!source) throw new Error("missing MERGE source");
    const analyzed = analyzeLocalInjectionDocument(
      serializeLocalInjectionDocument(createLocalInjectionDocumentFromDraft(source)),
      {
        mode: "MERGE",
        commandSemantics: "not-applicable",
        schemaFields: ["price", "halted"],
        commandState: reduceCommandState([]),
        subscriptionId: "subscription-merge",
        itemName: "scenario.snapshot-basic",
        itemPosition: 1
      }
    );

    expect(analyzed).toMatchObject({
      ready: true,
      diagnostics: [],
      document: {
        command: null,
        key: null,
        isSnapshot: false,
        fields: { price: 101, halted: false }
      }
    });
  });

  it("blocks JSON syntax, duplicate keys, and unknown or missing top-level keys", () => {
    const context = {
      mode: "COMMAND",
      schemaFields: ["command", "key"],
      commandState: reduceCommandState([]),
      subscriptionId: "subscription-1",
      itemName: "orders",
      itemPosition: 1
    } as const;

    expect(analyzeLocalInjectionDocument('{"command":"ADD",', context)).toMatchObject({
      ready: false,
      diagnostics: [expect.objectContaining({ category: "syntax", code: "invalid-json" })]
    });
    expect(
      analyzeLocalInjectionDocument(
        '{"command":"ADD","command":"UPDATE","key":"a","isSnapshot":false,"fields":{"command":"ADD","key":"a"}}',
        context
      ).diagnostics
    ).toContainEqual(expect.objectContaining({ category: "syntax", code: "duplicate-key", path: "command" }));
    expect(
      analyzeLocalInjectionDocument(
        '{"command":"ADD","key":"a","fields":{"command":"ADD","key":"a"},"extra":true}',
        context
      ).diagnostics.map(({ code }) => code)
    ).toEqual(expect.arrayContaining(["missing-top-level-key", "unknown-top-level-key"]));
  });

  it("blocks non-primitive fields, non-finite programmatic numbers, empty names, schema mismatch, and COMMAND state errors", () => {
    const state = reduceCommandState([
      itemUpdate({
        update: {
          isSnapshot: false,
          fields: { command: "ADD", key: "known", qty: 1 },
          changedFields: { qty: 1 },
          command: "ADD",
          key: "known"
        }
      })
    ]);
    const context = {
      mode: "COMMAND",
      schemaFields: ["command", "key", "qty"],
      commandState: state,
      subscriptionId: "subscription-1",
      itemName: "scenario.snapshot-basic",
      itemPosition: 1
    } as const;
    const analyzed = analyzeLocalInjectionDocument(
      '{"command":"UPDATE","key":"missing","isSnapshot":false,"fields":{"command":"UPDATE","key":"missing","":1,"extra":{},"qty":2}}',
      context
    );

    expect(analyzed.ready).toBe(false);
    expect(analyzed.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["non-primitive-field", "empty-field-name", "schema-mismatch", "unknown-key-update"])
    );
    const nonFinite = createLocalInjectionDocumentFromDraft(createDraftFromEvent(itemUpdate())!);
    nonFinite.fields.qty = Number.POSITIVE_INFINITY;
    expect(validateLocalInjectionDocument(nonFinite, context)).toContainEqual(
      expect.objectContaining({ category: "schema", code: "non-finite-number" })
    );
  });

  it("blocks contradictory COMMAND/key field copies and accepts the corrected document", () => {
    const context = {
      mode: "COMMAND",
      commandSemantics: "required",
      schemaFields: ["command", "key", "qty"],
      commandState: reduceCommandState([]),
      subscriptionId: "subscription-1",
      itemName: "orders",
      itemPosition: 1
    } as const;
    const contradictory = analyzeLocalInjectionDocument(
      '{"command":"ADD","key":"top-key","isSnapshot":false,"fields":{"command":"UPDATE","key":"field-key","qty":1}}',
      context
    );
    expect(contradictory.ready).toBe(false);
    expect(contradictory.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["command-field-mismatch", "key-field-mismatch"])
    );

    const corrected = analyzeLocalInjectionDocument(
      '{"command":"ADD","key":"top-key","isSnapshot":false,"fields":{"command":"ADD","key":"top-key","qty":1}}',
      context
    );
    expect(corrected).toMatchObject({ ready: true, diagnostics: [] });
  });

  it("clones source event id, target ids, command, key, and fields", () => {
    const draft = createDraftFromEvent(itemUpdate());

    expect(draft?.sourceEventId).toBe("event-1");
    expect(draft?.target.subscriptionId).toBe("subscription-1");
    expect(draft?.target.listenerId).toBe("listener-1");
    expect(draft?.subscriptionMode).toBe("COMMAND");
    expect(draft?.captureSource).toBe("listener");
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

  it("creates an unchanged source replay after the staged draft has been edited", () => {
    const source = createDraftFromEvent(itemUpdate());
    if (!source) {
      throw new Error("missing draft");
    }
    const edited = updateDraftField(source, "qty", 11);
    edited.command = "UPDATE";
    edited.key = "different";
    edited.isSnapshot = false;

    const replay = createSourceReplayDraft(edited);

    expect(replay.fields).toEqual(source.sourceFields);
    expect(replay.changedFields).toEqual(source.originalChangedFields);
    expect(replay.command).toBe("ADD");
    expect(replay.key).toBe("alpha");
    expect(replay.isSnapshot).toBe(true);
    expect(edited.fields.qty).toBe(11);
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

  it("targets a captured Subscription without requiring source listener provenance", () => {
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

    expect(validateReinjectionDraft(draft).valid).toBe(true);
    expect(validateDraftForExecutionTarget(draft, "captured-listener").valid).toBe(true);
    expect(validateDraftForExecutionTarget(draft, "captured-wire").valid).toBe(false);
  });

  it("validates listener and wire execution targets independently", () => {
    const listenerDraft = createDraftFromEvent(itemUpdate());
    const wireDraft = createDraftFromEvent(
      itemUpdate({
        captureSource: "wire",
        listener: undefined
      })
    );

    expect(
      validateDraftForExecutionTarget(listenerDraft, "captured-listener", {
        bridgeAvailable: true
      }).valid
    ).toBe(true);
    expect(
      validateDraftForExecutionTarget(listenerDraft, "captured-listener", {
        bridgeAvailable: false
      }).errors
    ).toContain("Subscription listener bridge is unavailable.");
    expect(validateDraftForExecutionTarget(wireDraft, "captured-listener").valid).toBe(true);
    expect(
      validateDraftForExecutionTarget(wireDraft, "captured-wire", {
        bridgeAvailable: true
      }).valid
    ).toBe(true);
    expect(
      validateDraftForExecutionTarget(wireDraft, "captured-wire", {
        bridgeAvailable: false
      }).errors
    ).toContain("Captured wire bridge is unavailable.");
  });

  it("requires command and key only for COMMAND-mode drafts", () => {
    const mergeDraft = createDraftFromEvent(
      itemUpdate({
        subscription: { id: "subscription-1", mode: "MERGE" },
        update: {
          isSnapshot: false,
          fields: { price: 101 },
          changedFields: { price: 101 }
        }
      })
    );
    const commandDraft = createDraftFromEvent(
      itemUpdate({
        update: {
          isSnapshot: false,
          fields: { price: 101 },
          changedFields: { price: 101 }
        }
      })
    );

    expect(validateDraftForExecutionTarget(mergeDraft, "captured-listener").valid).toBe(true);
    expect(validateDraftForExecutionTarget(commandDraft, "captured-listener").errors).toEqual([
      "Missing COMMAND command value.",
      "Missing COMMAND key value."
    ]);
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
