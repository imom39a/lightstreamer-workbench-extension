import { describe, expect, it } from "vitest";
import {
  EVIDENCE_FACET_KEYS,
  FACET_DESCRIPTORS,
  canonicalEvidenceSearchText,
  extractEvidenceFacets,
  type EvidenceFacetContext
} from "../src/core/evidence-facets";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createDraftFromEvent } from "../src/core/reinjection-draft";
import { createSyntheticEventFromDraft } from "../src/core/synthetic-event";

const context: EvidenceFacetContext = { pageId: "page-a", listenerOwner: "owner-a" };

function event(overrides: Partial<LightstreamerEventEnvelope> = {}): LightstreamerEventEnvelope {
  return {
    id: "event-1",
    timestamp: 100,
    direction: "inbound",
    source: "server",
    captureSource: "listener",
    synthetic: false,
    kind: "item-update",
    client: { id: "client-main", sessionId: "session-main" },
    subscription: { id: "sub-main", mode: "COMMAND" },
    listener: { id: "listener-main" },
    item: { name: "orders", position: 1 },
    update: { isSnapshot: true, key: "ABC", command: "ADD", fields: { price: 42 } },
    ...overrides
  };
}

describe("canonical Evidence facets", () => {
  it("exports exactly twelve frozen keys and frozen per-descriptor contracts", () => {
    expect(EVIDENCE_FACET_KEYS).toEqual([
      "client", "session", "subscription", "mode", "kind", "item", "listener",
      "key", "operation", "phase", "provenance", "observationPath"
    ]);
    expect(Object.isFrozen(EVIDENCE_FACET_KEYS)).toBe(true);
    expect(FACET_DESCRIPTORS.map((descriptor) => descriptor.key)).toEqual(EVIDENCE_FACET_KEYS);
    expect(Object.isFrozen(FACET_DESCRIPTORS)).toBe(true);
    for (const descriptor of FACET_DESCRIPTORS) {
      expect(Object.isFrozen(descriptor)).toBe(true);
      expect(Object.keys(descriptor).sort()).toEqual(["extract", "key", "label", "valueType"]);
      expect(descriptor.label).toBeTruthy();
      expect(descriptor.valueType).toMatch(/^(string|enum|number|boolean|null|client|session|subscription|item|listener)$/);
    }
  });

  it("extracts each descriptor from its accepted concrete Evidence fact", () => {
    const extracted = extractEvidenceFacets(event(), context);
    expect(Object.keys(extracted.facets)).toEqual(EVIDENCE_FACET_KEYS);
    expect(extracted.facets.client?.value).toBeDefined();
    expect(extracted.facets.session?.value).toBeDefined();
    expect(extracted.facets.subscription?.value).toBeDefined();
    expect(extracted.facets.mode?.value).toBe("COMMAND");
    expect(extracted.facets.kind?.value).toBe("item-update");
    expect(extracted.facets.item?.value).toBeDefined();
    expect(extracted.facets.listener?.value).toBeDefined();
    expect(extracted.facets.key?.value).toBe("ABC");
    expect(extracted.facets.operation?.value).toBe("ADD");
    expect(extracted.facets.phase?.value).toBe("SNAPSHOT");
    expect(extracted.facets.provenance?.value).toBe("SERVER");
    expect(extracted.facets.observationPath?.value).toBe("LISTENER");
    expect(extracted.unavailable).toEqual([]);
  });

  it("normalizes protocol enum values and their identities", () => {
    const lower = extractEvidenceFacets(event({ subscription: { id: "sub-main", mode: "command" }, update: { command: "update" } }), context).facets;
    const upper = extractEvidenceFacets(event({ subscription: { id: "sub-main", mode: "COMMAND" }, update: { command: "UPDATE" } }), context).facets;
    expect(lower.mode?.value).toBe("COMMAND");
    expect(lower.operation?.value).toBe("UPDATE");
    expect(lower.mode?.identity).toBe(upper.mode?.identity);
    expect(lower.operation?.identity).toBe(upper.operation?.identity);
  });

  it("only exposes operation when a concrete COMMAND mode applies", () => {
    expect(extractEvidenceFacets(event({ subscription: { id: "sub-main", mode: "MERGE" } }), context).facets.operation).toBeUndefined();
    expect(extractEvidenceFacets(event({ subscription: { id: "sub-main", mode: null } }), context).facets.operation).toBeUndefined();
    expect(extractEvidenceFacets(event({ subscription: { id: "sub-main", mode: "COMMAND", semanticValueStates: { mode: { state: "unknown" } } } }), context).facets.operation).toBeUndefined();
  });

  it("fails closed for unknown capture sources and separates Local provenance from observation", () => {
    const unknown = extractEvidenceFacets(event({ captureSource: "mystery" as never }), context).facets;
    expect(unknown.observationPath).toBeUndefined();
    const draft = createDraftFromEvent(event({ captureSource: "listener" }));
    expect(draft).not.toBeNull();
    const synthetic = createSyntheticEventFromDraft(draft!, { requestId: "local-1", ok: true, status: "success", timestamp: 123 });
    const local = extractEvidenceFacets(synthetic, context).facets;
    expect(local.provenance?.value).toBe("LOCAL");
    expect(local.observationPath).toBeUndefined();
  });

  it("treats unknown, unavailable, redacted, and not-applicable semantic facts as unavailable", () => {
    for (const state of ["unknown", "unavailable", "redacted", "not-applicable"] as const) {
      const extracted = extractEvidenceFacets(event({
        client: { id: "client-main", sessionId: "session-main", semanticValueStates: { id: { state } } },
        subscription: { id: "sub-main", mode: "COMMAND", semanticValueStates: { id: { state }, mode: { state } } }
      }), context);
      expect(extracted.facets.client).toBeUndefined();
      expect(extracted.facets.session).toBeUndefined();
      expect(extracted.facets.subscription).toBeUndefined();
      expect(extracted.facets.mode).toBeUndefined();
      expect(extracted.facets.item).toBeUndefined();
      expect(extracted.facets.operation).toBeUndefined();
    }
  });

  it("qualifies collisions, preserves missing/null distinctions, and ignores raw payloads", () => {
    const a = extractEvidenceFacets(event(), context).facets;
    const b = extractEvidenceFacets(event({ client: { id: "client-main", sessionId: "session-main" } }), { ...context, pageId: "page-b" }).facets;
    expect(a.client?.identity).not.toBe(b.client?.identity);
    expect(a.session?.identity).not.toBe(b.session?.identity);
    expect(a.subscription?.identity).not.toBe(b.subscription?.identity);
    expect(a.item?.identity).not.toBe(b.item?.identity);
    expect(a.listener?.identity).toBe(b.listener?.identity);
    const missing = extractEvidenceFacets(event({ item: undefined, update: { key: undefined, command: undefined } }), context).facets;
    const literalNull = extractEvidenceFacets(event({ item: { name: "null" } }), context).facets;
    expect(missing.item).toBeUndefined();
    expect(literalNull.item).toBeDefined();
    expect(missing.key).toBeUndefined();
    expect(missing.operation).toBeUndefined();
    const first = canonicalEvidenceSearchText(event({ update: { fields: { b: "x", a: 1 }, command: "UPDATE", key: "ABC" }, raw: { irrelevant: "one" } }), context);
    const second = canonicalEvidenceSearchText(event({ update: { fields: { a: 1, b: "x" }, key: "ABC", command: "UPDATE" }, raw: { irrelevant: "two" } }), context);
    expect(first).toBe(second);
    expect(first).not.toContain("irrelevant");
  });

  it("uses strict snapshot tri-state and explicit end-of-snapshot", () => {
    expect(extractEvidenceFacets(event({ update: { isSnapshot: true } }), context).facets.phase?.value).toBe("SNAPSHOT");
    expect(extractEvidenceFacets(event({ update: { isSnapshot: false } }), context).facets.phase?.value).toBe("LIVE");
    expect(extractEvidenceFacets(event({ update: {} }), context).facets.phase).toBeUndefined();
    expect(extractEvidenceFacets(event({ kind: "end-of-snapshot", update: {} }), context).facets.phase?.value).toBe("END OF SNAPSHOT");
  });
});
