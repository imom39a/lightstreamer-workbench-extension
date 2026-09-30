import { describe, expect, it } from "vitest";
import { agentToolFailure, agentToolResult } from "../src/agent/companion/tool-result";

describe("MCP structured results", () => {
  it("preserves object JSON text while exposing the same structured result", () => {
    const value = { readPoint: { interval: "one" }, evidence: [] };
    expect(agentToolResult(value)).toEqual({ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
  });
  it("wraps legacy arrays and null as valid structured objects without changing their text", () => {
    expect(agentToolResult([{ panelSessionId: "one" }]).structuredContent).toEqual({ items: [{ panelSessionId: "one" }] });
    expect(agentToolResult(null)).toEqual({ content: [{ type: "text", text: "null" }], structuredContent: { value: null } });
  });
  it.each(["CURSOR_EXPIRED", "TARGET_CHANGED", "TARGET_RETIRED", "ACCESS_REVOKED", "OPERATION_BUDGET_EXCEEDED", "COMPANION_INCOMPATIBLE"])("exposes stable recoverable %s errors without authorizing effects", code => {
    expect(agentToolFailure(new Error(`${code}: inspect and deliberately recover`)).structuredContent.error).toMatchObject({ code, automaticRetry: false });
  });
  it("exposes canonical errors without permitting automatic execution retries", () => {
    expect(agentToolFailure(new Error("READ_POINT_UNAVAILABLE: retention advanced")).structuredContent.error).toEqual({ code: "READ_POINT_UNAVAILABLE", message: "READ_POINT_UNAVAILABLE: retention advanced", automaticRetry: false });
    expect(agentToolFailure(new Error("Unrecognized: data")).structuredContent.error.code).toBe("WORKBENCH_OPERATION_FAILED");
    expect(agentToolFailure(new Error("Bad request"), "INVALID_ARGUMENT").isError).toBe(true);
  });
});
