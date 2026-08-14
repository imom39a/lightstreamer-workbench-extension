import { describe, expect, it } from "vitest";

import type { EventUpdate } from "../src/core/event-envelope";
import {
  classifyItemUpdateReplayability,
  evaluateItemUpdateAssertionValue
} from "../src/core/item-update-value-semantics";

describe("Item Update value semantics", () => {
  it("classifies concrete Source fields as executable without reading display copy", () => {
    const update: EventUpdate = {
      fields: { status: "[redacted]", count: 2 },
      fieldValueStates: { status: "concrete", count: "concrete" }
    };

    expect(classifyItemUpdateReplayability(update)).toEqual([
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

    expect(classifyItemUpdateReplayability(update)).toEqual([
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

    expect(evaluateItemUpdateAssertionValue(update, "missing", null)).toEqual({
      result: "not-equal",
      observed: { state: "missing" }
    });
    expect(evaluateItemUpdateAssertionValue(update, "count", 2)).toEqual({
      result: "equal",
      observed: { state: "concrete", value: 2 }
    });
    expect(evaluateItemUpdateAssertionValue(update, "nullable", null)).toEqual({
      result: "not-evaluable",
      observed: { state: "ambiguous", reason: "ambiguous-null" }
    });
    expect(evaluateItemUpdateAssertionValue(update, "hidden", "[redacted]")).toEqual({
      result: "not-evaluable",
      observed: { state: "unavailable", reason: "redacted" }
    });
  });

  it("compares concrete primitives by type and value without coercion", () => {
    const update: EventUpdate = {
      fields: { count: 2, nullable: null },
      fieldValueStates: { count: "concrete", nullable: "concrete" }
    };

    expect(evaluateItemUpdateAssertionValue(update, "count", "2").result).toBe(
      "not-equal"
    );
    expect(evaluateItemUpdateAssertionValue(update, "nullable", null).result).toBe(
      "equal"
    );
  });
});
