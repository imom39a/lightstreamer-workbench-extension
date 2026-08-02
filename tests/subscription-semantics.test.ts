import { describe, expect, it } from "vitest";

import { lintSubscriptionSemantics } from "../src/core/subscription-semantics";

describe("subscription semantics", () => {
  it("warns when a COMMAND field list omits key or command", () => {
    const diagnostics = lintSubscriptionSemantics({
      id: "subscription-1",
      mode: "COMMAND",
      fields: ["name", "price"]
    });

    expect(diagnostics.map(({ code }) => code)).toEqual([
      "command-key-field-missing",
      "command-command-field-missing"
    ]);
    expect(diagnostics.every(({ severity }) => severity === "warning")).toBe(true);
  });

  it("flags incompatible RAW snapshots and buffers", () => {
    const diagnostics = lintSubscriptionSemantics({
      id: "subscription-2",
      mode: "RAW",
      requestedSnapshot: "yes",
      requestedBufferSize: "10"
    });

    expect(diagnostics.map(({ code }) => code)).toEqual([
      "raw-snapshot-requested",
      "buffer-mode-unsupported"
    ]);
  });

  it("flags an unlimited MERGE frequency when a buffer is also requested", () => {
    expect(
      lintSubscriptionSemantics({
        id: "subscription-unfiltered",
        mode: "MERGE",
        requestedBufferSize: "10",
        requestedMaxFrequency: "unlimited"
      }).map(({ code }) => code)
    ).toEqual(["buffer-mode-unsupported"]);
  });

  it("flags second-level configuration outside COMMAND without guessing schemas", () => {
    const diagnostics = lintSubscriptionSemantics({
      id: "subscription-3",
      mode: "MERGE",
      fieldSchema: "quote",
      commandSecondLevelFields: ["item", "value"]
    });

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "second-level-requires-command",
        severity: "error"
      })
    ]);
  });

  it("does not warn when metadata cannot prove a violation", () => {
    expect(
      lintSubscriptionSemantics({
        id: "subscription-4",
        mode: "MERGE",
        fieldSchema: "commandSchema",
        requestedBufferSize: "10"
      })
    ).toEqual([]);
    expect(
      lintSubscriptionSemantics({
        id: "subscription-unknown-mode",
        requestedBufferSize: "10",
        commandSecondLevelFields: ["value"]
      })
    ).toEqual([]);
  });
});
