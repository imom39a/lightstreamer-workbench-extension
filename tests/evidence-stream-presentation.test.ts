import { describe, expect, it } from "vitest";

import {
  EVIDENCE_CODE_DEFINITIONS,
  evidenceStreamPresentation
} from "../src/extension/panel/evidence-stream-presentation";
import type { WorkbenchEvidence } from "../src/extension/panel/workbench-runtime";

function evidence(overrides: Partial<WorkbenchEvidence["raw"]> = {}): WorkbenchEvidence {
  const raw: WorkbenchEvidence["raw"] = {
    id: "event-1",
    timestamp: 1,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    item: { name: "item-1", position: 1 },
    update: { fields: { key: "alpha", value: "1" }, command: "UPDATE", key: "alpha" },
    ...overrides
  };
  return { id: raw.id, sequence: 1, time: "00:00:00.001", source: "SERVER", phase: "LIVE", command: "UPDATE", commandKey: "alpha", kind: "Item Update", object: "item-1", summary: "2 fields", raw };
}

describe("evidenceStreamPresentation", () => {
  it("does not invent a server error for an unknown capture kind", () => {
    const event = evidence();
    const unknown = { ...event, raw: { ...event.raw, kind: "future-kind" } } as unknown as WorkbenchEvidence;
    expect(evidenceStreamPresentation(unknown, "raw")).toMatchObject({ code: "?", codeFamily: "workbench" });
  });
  it("restores all historical definitions and maps current envelope kinds explicitly", () => {
    expect(EVIDENCE_CODE_DEFINITIONS.slice(0, 15).map(({ code }) => code)).toEqual([
      "U", "SUBOK", "SUBCMD", "UNSUB", "EOS", "CS", "OV", "C+", "C~", "S+", "S~", "SF", "S!", "L+", "L−"
    ]);
    expect(evidenceStreamPresentation(evidence(), "raw").code).toBe("U");
    expect(evidenceStreamPresentation(evidence({ update: { command: "ADD", fields: {} } }), "raw").code).toBe("U");
    expect(evidenceStreamPresentation(evidence({ update: { command: "DELETE", fields: {} } }), "raw").code).toBe("U");
    expect(evidenceStreamPresentation(evidence({ kind: "subscription-started", subscription: { id: "sub", mode: "COMMAND" }, update: undefined }), "raw").code).toBe("SUBCMD");
    expect(evidenceStreamPresentation(evidence({ kind: "client-message-processed", clientMessage: { id: "m1", pageEpoch: "p", message: "secret", messageState: "redacted", sequence: "2", delayTimeout: null, enqueueWhileDisconnected: false, listenerProvided: true, outcome: "processed", outcomeAvailability: "available" } }), "raw")).toMatchObject({ code: "M✓", codeFamily: "workbench" });
    expect(evidenceStreamPresentation(evidence({ kind: "server-error", serverError: { code: 21, message: "safe", messageState: "safe" } }), "raw").code).toBe("ERR");
  });

  it.each([
    ["item-update", "U"], ["subscription-started", "SUBOK"], ["subscription-ended", "UNSUB"],
    ["end-of-snapshot", "EOS"], ["clear-snapshot", "CS"], ["lost-updates", "OV"],
    ["client-created", "C+"], ["client-status", "C~"], ["subscription-created", "S+"],
    ["subscription-snapshot", "S~"], ["subscription-frequency", "SF"], ["subscription-error", "S!"],
    ["listener-added", "L+"], ["listener-removed", "L−"]
  ] as const)("maps historical kind %s to %s", (kind, code) => {
    expect(evidenceStreamPresentation(evidence({ kind, update: undefined }), "raw").code).toBe(code);
  });

  it("keeps SF and S! data tied to their captured fields", () => {
    expect(evidenceStreamPresentation(evidence({ kind: "subscription-frequency", subscription: { id: "sub", requestedMaxFrequency: 4, realMaxFrequency: 2 }, update: undefined }), "raw").data.fields).toMatchObject({ realMaxFrequency: 2 });
    expect(evidenceStreamPresentation(evidence({ kind: "subscription-error", subscription: { id: "sub" }, serverError: { code: 21, message: "bad", messageState: "safe" }, update: undefined }), "raw").data.fields).toMatchObject({ error: "bad", errorCode: 21 });
  });

  it("uses the exact COMMAND key, then explicit item and lifecycle identities", () => {
    expect(evidenceStreamPresentation(evidence(), "raw").identity).toBe("alpha");
    expect(evidenceStreamPresentation(evidence({ update: { fields: { value: "1" } }, item: { name: "item-2", position: 2 } }), "raw").identity).toBe("item-2");
    expect(evidenceStreamPresentation(evidence({ kind: "subscription-started", subscription: { id: "sub-1", mode: "MERGE" }, update: undefined }), "raw").identity).toBe("sub-1");
    expect(evidenceStreamPresentation(evidence({ kind: "client-status", client: { id: "client-1", status: "CONNECTED" }, subscription: undefined, update: undefined }), "raw").identity).toBe("client-1");
    expect(evidenceStreamPresentation(evidence({ kind: "client-status", update: undefined, client: undefined, subscription: undefined }), "raw").identity).toBeNull();
  });

  it("keeps raw strings and explicitly reports readable JSON decoding", () => {
    const event = evidence({ update: { fields: { plain: "{not json", json: '{"nested":true}', array: "[1,2]" } } });
    const raw = evidenceStreamPresentation(event, "raw");
    expect(raw.data.fields).toEqual({ plain: "{not json", json: '{"nested":true}', array: "[1,2]" });
    expect(raw.data.decodedJsonFields).toEqual([]);
    const readable = evidenceStreamPresentation(event, "readable");
    expect(readable.data.fields).toEqual({ plain: "{not json", json: { nested: true }, array: [1, 2] });
    expect(readable.data.decodedJsonFields).toEqual(["json", "array"]);
    expect(readable.jsonString).toBe('{"plain":"{not json","json":{"nested":true},"array":[1,2]}');
  });

  it("bounds the serialized preview without truncating identity or mutating the event", () => {
    const fields = { key: "exact-key", value: "x".repeat(9_000) };
    const event = evidence({ update: { fields, key: "exact-key" } });
    const before = JSON.stringify(event.raw.update);
    const presentation = evidenceStreamPresentation(event, "readable");
    expect(presentation.previewTruncated).toBe(true);
    expect(presentation.jsonString.length).toBeLessThanOrEqual(8 * 1024);
    expect(presentation.identity).toBe("exact-key");
    expect(JSON.stringify(event.raw.update)).toBe(before);
  });

  it("bounds wide, deep, cyclic, and empty payloads without throwing", () => {
    const cyclic: Record<string, unknown> = { empty: null, huge: "x".repeat(2_000_000) };
    cyclic.self = cyclic;
    const presentation = evidenceStreamPresentation(evidence({ update: { fields: cyclic as never, key: null } }), "raw");
    expect(presentation.previewTruncated).toBe(true);
    expect(presentation.jsonString.length).toBeLessThanOrEqual(8 * 1024);
    expect(evidenceStreamPresentation(evidence({ update: undefined, item: undefined, subscription: undefined, client: undefined }), "raw").data.fields).toEqual({});
    expect(evidenceStreamPresentation({ raw: {} as WorkbenchEvidence["raw"] } as WorkbenchEvidence, "raw").identity).toBeNull();
  });

  it("reports omitted fields, protects own-property names, and bounds malformed JSON work", () => {
    const wide: Record<string, string> = Object.create({ inherited: "ignore" }) as Record<string, string>;
    for (let index = 0; index < 129; index += 1) wide[`field-${index}`] = String(index);
    Object.defineProperty(wide, "__proto__", { value: "captured", enumerable: true, writable: true });
    const widePresentation = evidenceStreamPresentation(evidence({ update: { fields: wide as never } }), "raw");
    expect(widePresentation.previewTruncated).toBe(true);
    expect(widePresentation.data.fields).not.toHaveProperty("inherited");
    const protoFields: Record<string, string> = Object.create(null) as Record<string, string>;
    Object.defineProperty(protoFields, "__proto__", { value: "captured", enumerable: true, writable: true });
    expect(evidenceStreamPresentation(evidence({ update: { fields: protoFields as never } }), "raw").data.fields["__proto__"]).toBe("captured");

    const hugeName = "n".repeat(2_000_000);
    const nested = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(nested, hugeName, { value: true, enumerable: true });
    const nestedPresentation = evidenceStreamPresentation(evidence({ update: { fields: { nested } as never } }), "raw");
    expect(nestedPresentation.previewTruncated).toBe(true);
    expect(nestedPresentation.jsonString.length).toBeLessThanOrEqual(8 * 1024);

    const malformed: Record<string, string> = {};
    for (let index = 0; index < 20; index += 1) malformed[`bad-${index}`] = `{${"x".repeat(1022)}}`;
    malformed.good = '{"parsed":true}';
    const malformedPresentation = evidenceStreamPresentation(evidence({ update: { fields: malformed as never } }), "readable");
    expect(malformedPresentation.data.decodedJsonFields).not.toContain("good");
  });

  it("preserves client-message redaction boundaries", () => {
    const presentation = evidenceStreamPresentation(evidence({
      kind: "client-message-sent",
      source: "application",
      direction: "outbound",
      clientMessage: { id: "message-1", pageEpoch: "page-1", message: "private body", messageState: "available", sequence: "7", delayTimeout: null, enqueueWhileDisconnected: false, listenerProvided: true, outcome: "submitted", outcomeAvailability: "pending", response: "private response", error: "private error" }
    }), "readable");
    expect(presentation.data.fields).not.toHaveProperty("message");
    expect(presentation.data.fields).not.toHaveProperty("response");
    expect(presentation.data.fields).not.toHaveProperty("error");
    expect(presentation.data.fields).toMatchObject({ id: "message-1", messageState: "available", outcome: "submitted" });
  });
});
