import { describe, expect, it } from "vitest";

import type { EventUpdate, LightstreamerEventEnvelope } from "../src/core/event-envelope";
import {
  classifyInjectionSourceFieldExecutability,
  evaluateItemUpdateAssertionValue
} from "../src/core/item-update-value-semantics";

describe("Item Update value semantics", () => {
  it("classifies concrete Source fields as executable without reading display copy", () => {
    const update: EventUpdate = {
      fields: { status: "[redacted]", count: 2 },
      fieldValueStates: { status: "concrete", count: "concrete" }
    };

    expect(classifyInjectionSourceFieldExecutability(update)).toEqual([
      { field: "status", classification: "executable", value: "[redacted]" },
      { field: "count", classification: "executable", value: 2 }
    ]);
  });

  it("keeps ambiguous and replacement-required Source fields non-executable", () => {
    const update: EventUpdate = {
      fields: { nullable: null, secret: "[redacted]", patch: "raw-diff" },
      fieldValueStates: {
        nullable: "ambiguous-null",
        secret: "redacted",
        patch: "unresolved-wire-difference",
        missingAtCapture: "unavailable"
      }
    };

    expect(classifyInjectionSourceFieldExecutability(update)).toEqual([
      { field: "nullable", classification: "ambiguous", reason: "ambiguous-null" },
      { field: "secret", classification: "replacement-required", reason: "redacted" },
      {
        field: "patch",
        classification: "replacement-required",
        reason: "unresolved-wire-difference"
      },
      {
        field: "missingAtCapture",
        classification: "replacement-required",
        reason: "unavailable"
      }
    ]);
  });

  it("distinguishes missing, concrete, ambiguous, and unavailable assertion values", () => {
    const update: EventUpdate = {
      fields: { nullable: null, count: 2, hidden: "[redacted]" },
      fieldValueStates: {
        nullable: "ambiguous-null",
        count: "concrete",
        hidden: "redacted"
      }
    };

    const event = serverEvent(update, "listener");
    expect(evaluateItemUpdateAssertionValue(event, "missing", null)).toEqual({
      result: "not-equal",
      observed: { state: "missing" },
      provenance: { source: "server", observationPath: "listener" }
    });
    expect(evaluateItemUpdateAssertionValue(event, "count", 2)).toEqual({
      result: "equal",
      observed: { state: "concrete", value: 2 },
      provenance: { source: "server", observationPath: "listener" }
    });
    expect(evaluateItemUpdateAssertionValue(event, "nullable", null)).toEqual({
      result: "not-evaluable",
      observed: { state: "ambiguous", reason: "ambiguous-null" },
      provenance: { source: "server", observationPath: "listener" }
    });
    expect(evaluateItemUpdateAssertionValue(event, "hidden", "[redacted]")).toEqual({
      result: "not-evaluable",
      observed: { state: "unavailable", reason: "redacted" },
      provenance: { source: "server", observationPath: "listener" }
    });
  });

  it("compares concrete primitives by type and value without coercion", () => {
    const update: EventUpdate = {
      fields: { count: 2, nullable: null },
      fieldValueStates: { count: "concrete", nullable: "concrete" }
    };

    const event = serverEvent(update, "wire");
    expect(evaluateItemUpdateAssertionValue(event, "count", "2")).toMatchObject({
      result: "not-equal",
      provenance: { source: "server", observationPath: "wire" }
    });
    expect(evaluateItemUpdateAssertionValue(event, "nullable", null).result).toBe(
      "equal"
    );
  });

  it("records correlated Local Evidence provenance separately from server paths", () => {
    const event: LightstreamerEventEnvelope = {
      ...serverEvent({
        fields: { nullable: null },
        fieldValueStates: { nullable: "concrete" }
      }, "listener"),
      id: "synthetic-request-7",
      source: "synthetic",
      synthetic: true,
      raw: { requestId: "request-7" }
    };

    expect(evaluateItemUpdateAssertionValue(event, "nullable", null)).toEqual({
      result: "equal",
      observed: { state: "concrete", value: null },
      provenance: { source: "local", requestId: "request-7" }
    });
  });
});

function serverEvent(
  update: EventUpdate,
  captureSource: "listener" | "wire"
): LightstreamerEventEnvelope {
  return {
    id: "event-1",
    timestamp: 1,
    direction: "inbound",
    source: "server",
    captureSource,
    synthetic: false,
    kind: "item-update",
    update
  };
}
