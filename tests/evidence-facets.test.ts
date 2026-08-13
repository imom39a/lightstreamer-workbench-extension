import { describe, expect, it } from "vitest";
import {
  FACET_DESCRIPTORS,
  canonicalEvidenceSearchText,
  extractEvidenceFacets,
  type EvidenceFacetContext
} from "../src/core/evidence-facets";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";

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
  it("exports exactly twelve frozen descriptors in canonical order", () => {
    expect(FACET_DESCRIPTORS.map((descriptor) => descriptor.key)).toEqual([
      "client", "session", "subscription", "mode", "kind", "item", "listener",
      "key", "operation", "phase", "provenance", "observationPath"
    ]);
    expect(Object.isFrozen(FACET_DESCRIPTORS)).toBe(true);
    for (const descriptor of FACET_DESCRIPTORS) {
      expect(Object.isFrozen(descriptor)).toBe(true);
      expect(Object.keys(descriptor).sort()).toEqual(["extract", "key", "label", "valueType"]);
    }
  });

  it("extracts each facet from its own accepted Evidence fact", () => {
    const extracted = extractEvidenceFacets(event(), context);
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
  });

  it("qualifies identities by their owners and keeps labels out of identity", () => {
    const a = extractEvidenceFacets(event(), context).facets;
    const b = extractEvidenceFacets(event({ client: { id: "client-main", sessionId: "session-main" } }), { ...context, pageId: "page-b" }).facets;
    expect(a.client?.identity).not.toBe(b.client?.identity);
    expect(a.session?.identity).not.toBe(b.session?.identity);
    expect(a.subscription?.identity).not.toBe(b.subscription?.identity);
    expect(a.item?.identity).not.toBe(b.item?.identity);
    expect(a.listener?.identity).toBe(b.listener?.identity);
    for (const value of Object.values(a)) {
      if (value) expect(value.identity).toBe(JSON.stringify(["v1", value.facet, value.type, value.value]));
    }
  });

  it("does not fabricate missing values or collapse item null", () => {
    const missing = extractEvidenceFacets(event({ item: undefined, update: { key: undefined, command: undefined } }), context).facets;
    const literalNull = extractEvidenceFacets(event({ item: { name: "null" } }), context).facets;
    expect(missing.item).toBeUndefined();
    expect(literalNull.item).toBeDefined();
    expect(missing.key).toBeUndefined();
    expect(missing.operation).toBeUndefined();
    expect(extractEvidenceFacets(event({ subscription: { id: "sub-main" } }), context).facets.mode).toBeUndefined();
  });

  it("uses immutable accepted identity only for missing ownership context", () => {
    const extracted = extractEvidenceFacets(event(), {
      identity: { intervalId: "interval-1", pageId: "page-identity", ownerId: "listener-owner", sequence: 1, eventId: "evidence-1" }
    });
    expect(extracted.facets.client?.value).toContain("page-identity");
    expect(extracted.facets.listener?.value).toContain("listener-owner");
    expect(extractEvidenceFacets(event(), {}).facets.client).toBeUndefined();
  });

  it("does not expose semantic unknown, unavailable, redacted, or not-applicable states as values", () => {
    for (const state of ["unknown", "unavailable", "redacted", "not-applicable"] as const) {
      const extracted = extractEvidenceFacets(event({
        subscription: { id: "sub-main", mode: "COMMAND", semanticValueStates: { mode: { state } } }
      }), context);
      expect(extracted.facets.mode).toBeUndefined();
      expect(extracted.selectableValues).not.toContainEqual(expect.objectContaining({ value: state }));
    }
  });

  it("keeps kind, operation, provenance, and path independent", () => {
    const local = extractEvidenceFacets(event({ source: "synthetic", synthetic: true, captureSource: "wire" }), context).facets;
    expect(local.kind?.value).toBe("item-update");
    expect(local.operation?.value).toBe("ADD");
    expect(local.provenance?.value).toBe("LOCAL");
    expect(local.observationPath).toBeUndefined();
    expect(extractEvidenceFacets(event({ captureSource: "wire" }), context).facets.observationPath?.value).toBe("WIRE");
  });

  it("uses strict snapshot tri-state and explicit end-of-snapshot", () => {
    expect(extractEvidenceFacets(event({ update: { isSnapshot: true } }), context).facets.phase?.value).toBe("SNAPSHOT");
    expect(extractEvidenceFacets(event({ update: { isSnapshot: false } }), context).facets.phase?.value).toBe("LIVE");
    expect(extractEvidenceFacets(event({ update: {} }), context).facets.phase).toBeUndefined();
    expect(extractEvidenceFacets(event({ kind: "end-of-snapshot", update: {} }), context).facets.phase?.value).toBe("END OF SNAPSHOT");
  });

  it("produces stable canonical search text without raw JSON or absent live state", () => {
    const first = event({ update: { key: "ABC", command: "UPDATE", fields: { b: "  x  ", a: 1 } } });
    const second = event({ update: { fields: { a: 1, b: "  x  " }, command: "UPDATE", key: "ABC" }, raw: { irrelevant: "changed" } });
    const a = canonicalEvidenceSearchText(first, context);
    const b = canonicalEvidenceSearchText(second, context);
    expect(a).toBe(b);
    expect(a).toContain("client");
    expect(a).toContain("command");
    expect(a).not.toContain("live");
    expect(a).not.toContain("irrelevant");
    expect(a).toContain("  ".trim());
  });
});
