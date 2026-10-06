import { describe, expect, it } from "vitest";
import { createDraftFromEvent, createNewCommandDraftFromContext, validateDraftForExecutionTarget } from "../src/core/reinjection-draft";
import { applyLocalInjectionDocumentToDraft, createLocalInjectionDocumentFromDraft } from "../src/core/local-injection-document";
import { deriveNativeDraftChanges, nativeBaselineFromDraft } from "../src/core/local-injection-change-semantics";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";

const source = () => createNewCommandDraftFromContext({ subscriptionId: "sub", mode: "COMMAND", listenerId: "listener", itemName: "item", itemPosition: 1, fields: ["key", "nullable", "command", "quantity"] })!;
const document = (command: string, quantity = 10) => ({ command, key: "new-key", isSnapshot: false, fields: { key: "new-key", nullable: null, command, quantity } });

describe("native generated changed fields", () => {
  it("establishes null and every declared field on ADD, then compares ordered UPDATEs for the same key", () => {
    const add = applyLocalInjectionDocumentToDraft(source(), document("ADD"));
    expect(add.changedFields).toEqual(add.fields);
    const first = applyLocalInjectionDocumentToDraft(source(), document("UPDATE"), new Set(), { baseline: nativeBaselineFromDraft(add, "planned ADD") });
    expect(first.changedFields).toEqual({ command: "UPDATE" });
    expect(first.changeSemantics).toMatchObject({ version: 1, policy: "native-mode", basis: "planned ADD" });
    const repeated = applyLocalInjectionDocumentToDraft(source(), document("UPDATE"), new Set(), { baseline: nativeBaselineFromDraft(first, "planned first UPDATE") });
    expect(repeated.changedFields).toEqual({});
    const changed = applyLocalInjectionDocumentToDraft(source(), document("UPDATE", 11), new Set(), { baseline: nativeBaselineFromDraft(repeated, "planned repeated UPDATE") });
    expect(changed.changedFields).toEqual({ quantity: 11 });
  });

  it("clears DELETE values while keeping the key unchanged and the command valued", () => {
    const deleted = applyLocalInjectionDocumentToDraft(source(), document("DELETE"));
    expect(deleted.fields).toEqual({ key: "new-key", nullable: null, command: "DELETE", quantity: null });
    expect(deleted.changedFields).toEqual({ nullable: null, command: "DELETE", quantity: null });
  });

  it("preserves captured bitmap and fixes a captured UPDATE edited into an ADD for a new key", () => {
    const captured = createDraftFromEvent({ id: "source", kind: "item-update", source: "server", direction: "inbound", synthetic: false, timestamp: 1,
      subscription: { id: "sub", mode: "COMMAND" }, listener: { id: "listener" }, item: { name: "item", position: 1 },
      update: { command: "UPDATE", key: "old-key", isSnapshot: false, fields: { command: "UPDATE", key: "old-key", quantity: 10 }, changedFields: { quantity: 10 } }
    } satisfies LightstreamerEventEnvelope)!;
    const replay = applyLocalInjectionDocumentToDraft(captured, createLocalInjectionDocumentFromDraft(captured));
    expect(replay.changedFields).toEqual({ quantity: 10 });
    expect(replay.changeSemantics?.policy).toBe("captured-bitmap");
    const add = applyLocalInjectionDocumentToDraft(captured, { ...document("ADD"), fields: { command: "ADD", key: "new-key", quantity: 10 } });
    expect(add.changedFields).toEqual(add.fields);
    expect(captured.fields.key).toBe("old-key");
  });

  it("refuses incomplete, uncertain and other-key baselines rather than comparing the Source", () => {
    const update = applyLocalInjectionDocumentToDraft(source(), document("UPDATE"));
    expect(validateDraftForExecutionTarget(update, "captured-listener").valid).toBe(false);
    const add = applyLocalInjectionDocumentToDraft(source(), document("ADD"));
    const baseline = nativeBaselineFromDraft(add, "retained same-key row");
    expect(deriveNativeDraftChanges(update, { baseline: { ...baseline, fields: { ...baseline.fields, key: "other" } } }).changeSemantics?.refusal).toContain("different key");
    expect(deriveNativeDraftChanges(update, { baseline: { ...baseline, fieldValueStates: { ...baseline.fieldValueStates, nullable: "ambiguous-null" } } }).changeSemantics?.refusal).toContain("ambiguous");
    expect(deriveNativeDraftChanges(update, { baseline: { ...baseline, fields: { key: "new-key" } } }).changeSemantics?.refusal).toContain("absent");
  });

  it("uses the previous item update for MERGE and DISTINCT, with explicit first-update semantics", () => {
    for (const mode of ["MERGE", "DISTINCT"]) {
      const draft = { ...source(), subscriptionMode: mode, command: null, key: null, fields: { value: null } };
      expect(deriveNativeDraftChanges(draft).changeSemantics?.refusal).toBeTruthy();
      const first = deriveNativeDraftChanges(draft, { firstUpdate: true });
      expect(first.changedFields).toEqual({ value: null });
      expect(deriveNativeDraftChanges(draft, { baseline: nativeBaselineFromDraft(first, "previous item") }).changedFields).toEqual({});
    }
  });

  it("refuses generated second-level behavior and discloses JSON-patch fidelity", () => {
    const add = applyLocalInjectionDocumentToDraft(source(), document("ADD"), new Set(), { secondLevelFields: ["second"] });
    expect(add.changeSemantics?.refusal).toContain("second-level");
    expect(add.changeSemantics?.limitations[0]).toContain("JSON Patch");
  });
});
