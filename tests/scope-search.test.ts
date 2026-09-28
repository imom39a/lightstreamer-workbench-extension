import { describe, expect, it } from "vitest";

import { createScopeSearchIndex, searchScopes, type ScopeSearchNode } from "../src/core/scope-search";

const nodes: readonly ScopeSearchNode[] = [
  { id: "page", kind: "page", label: "Inspected page", parentId: null, lifecycle: "active" },
  { id: "client-a", kind: "client", label: "Trading A", parentId: "page", lifecycle: "active" },
  { id: "session-a", kind: "session", label: "Session Alpha", parentId: "client-a", lifecycle: "active" },
  { id: "subscription-a", kind: "subscription", label: "Orders", parentId: "session-a", lifecycle: "active", detail: "COMMAND · 12 items" },
  { id: "item-a", kind: "item", label: "Portfolio", parentId: "subscription-a", lifecycle: "active" },
  { id: "client-b", kind: "client", label: "Trading B", parentId: "page", lifecycle: "retired", retired: true },
  { id: "subscription-b", kind: "subscription", label: "Orders", parentId: "client-b", lifecycle: "retired", retired: true }
];

describe("Scope search", () => {
  it("searches every structural node independent of tree expansion or mounted rows", () => {
    const result = searchScopes(createScopeSearchIndex(nodes), "FOL");
    expect(result.total).toBe(1);
    expect(result.matches[0]?.node.id).toBe("item-a");
    expect(result.matches[0]?.path).toBe("Inspected page / Trading A / Session Alpha / Orders / Portfolio");
    expect(result.matches[0]?.ancestorIds).toEqual(["page", "client-a", "session-a", "subscription-a"]);
  });

  it("matches substring labels, kind, exact identity, complete path, lifecycle and facts", () => {
    const index = createScopeSearchIndex(nodes);
    expect(searchScopes(index, "  SuBSCRiPTion  ").matches.map(({ node }) => node.id)).toEqual(["subscription-a", "subscription-b"]);
    expect(searchScopes(index, "item-a").matches[0]?.matchedFields).toContain("identity");
    expect(searchScopes(index, "alpha / orders / port").matches[0]?.node.id).toBe("item-a");
    expect(searchScopes(index, "retired").matches.map(({ node }) => node.id)).toEqual(["client-b", "subscription-b"]);
    expect(searchScopes(index, "12 items").matches[0]?.node.id).toBe("subscription-a");
    expect(searchScopes(index, "read-only").matches.map(({ node }) => node.id)).toEqual(["client-b", "subscription-b"]);
  });

  it("disambiguates duplicate names with complete ancestor paths and identities", () => {
    const result = searchScopes(createScopeSearchIndex(nodes), "orders");
    const subscriptions = result.matches.filter(({ node }) => node.kind === "subscription");
    expect(subscriptions.map(({ node, path }) => [node.id, path])).toEqual([
      ["subscription-a", "Inspected page / Trading A / Session Alpha / Orders"],
      ["subscription-b", "Inspected page / Trading B / Orders"]
    ]);
  });

  it("counts and pages the complete match set beyond 1,000 without materializing it", () => {
    const index = createScopeSearchIndex(Array.from({ length: 1_203 }, (_, position) => ({
      id: `item-${position}`, kind: "item", label: `portfolio-${position}`, parentId: null
    })));
    const first = searchScopes(index, "portfolio", { limit: 50 });
    expect(first.total).toBe(1_203);
    expect(first.matches).toHaveLength(50);
    expect(first.hasPrevious).toBe(false);
    expect(first.hasNext).toBe(true);
    const end = searchScopes(index, "portfolio", { offset: 1_200, limit: 50 });
    expect(end.total).toBe(1_203);
    expect(end.matches.map(({ node }) => node.id)).toEqual(["item-1200", "item-1201", "item-1202"]);
    expect(end.hasPrevious).toBe(true);
    expect(end.hasNext).toBe(false);
    expect(searchScopes(index, "portfolio", { limit: 10_000 }).matches).toHaveLength(100);
  });

  it("does not search omitted data or mutate a caller's redacted snapshot", () => {
    const safe = [{ id: "page", kind: "page", label: "[redacted]", parentId: null }];
    const before = JSON.stringify(safe);
    const index = createScopeSearchIndex(safe);
    expect(searchScopes(index, "secret").total).toBe(0);
    expect(JSON.stringify(safe)).toBe(before);
  });

  it("has explicit empty query and no-match results and tolerates missing parents", () => {
    const index = createScopeSearchIndex([{ id: "orphan", kind: "item", label: "Only item", parentId: "missing" }]);
    expect(searchScopes(index, " ").total).toBe(0);
    expect(searchScopes(index, "unknown").matches).toEqual([]);
    expect(searchScopes(index, "item").matches[0]?.path).toBe("Only item");
  });
});
