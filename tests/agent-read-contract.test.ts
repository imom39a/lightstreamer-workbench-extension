import { describe, expect, it } from "vitest";
import { AGENT_TOOLS, validateAgentCall } from "../src/agent/protocol";

describe("agent read contract", () => {
  it("requires a deliberate scope and accepts a small composable read request", () => {
    expect(() => validateAgentCall("query_evidence", { panelSessionId: "p" })).toThrow("SCOPE_REQUIRED");
    expect(() => validateAgentCall("query_evidence", {
      panelSessionId: "p", scopeId: "item-1", where: { key: ["row-1"], operation: ["UPDATE"] }, fields: ["quantity"], maxBytes: 8192
    })).not.toThrow();
    expect(AGENT_TOOLS.find(tool => tool.name === "summarize_evidence")?.annotations.readOnlyHint).toBe(true);
  });

  it("keeps cursor continuations separate from fresh queries and rejects ambiguous projection", () => {
    for (const name of ["query_evidence", "search_evidence", "summarize_evidence"]) {
      expect(() => validateAgentCall(name, { panelSessionId: "p", cursor: "c" })).not.toThrow();
      expect(() => validateAgentCall(name, { panelSessionId: "p", cursor: "c", where: { key: ["k"] } })).toThrow("QUERY_OPTIONS_CHANGED");
    }
    expect(() => validateAgentCall("query_evidence", { panelSessionId: "p", within: "page", fields: ["quantity"], includePayload: true })).toThrow("choose fields");
    expect(() => validateAgentCall("query_evidence", { panelSessionId: "p", within: "page", where: { key: [] } })).toThrow("invalid array size");
    expect(() => validateAgentCall("query_evidence", { panelSessionId: "p", within: "page", maxBytes: 65537 })).toThrow("invalid integer");
  });

  it("pins text search to a read point and rejects competing Scope sources", () => {
    expect(() => validateAgentCall("search_evidence", {
      panelSessionId: "p", scopeId: "s", text: "row", at: "LATEST_COMMITTED"
    })).not.toThrow();
    for (const name of ["query_evidence", "search_evidence", "summarize_evidence"]) {
      expect(() => validateAgentCall(name, { panelSessionId: "p", within: "current-investigation", scopeId: "s", ...(name === "search_evidence" ? { text: "row" } : {}) })).toThrow("already defines Scope");
    }
  });
});
