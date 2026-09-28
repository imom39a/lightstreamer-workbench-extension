/** Complete structural Topology, independent of the panel's expanded or mounted tree rows. */
export type ScopeSearchStructureNode = Readonly<{
  id: string;
  kind: string;
  label: string;
  parentId: string | null;
}>;

export type ScopeSearchNode = ScopeSearchStructureNode & Readonly<{
  lifecycle?: string;
  retired?: boolean;
  detail?: string;
}>;

export type ScopeSearchField = "label" | "kind" | "identity" | "path" | "lifecycle" | "detail";

export type ScopeSearchMatch = Readonly<{
  node: ScopeSearchNode;
  path: string;
  ancestorIds: readonly string[];
  matchedFields: readonly ScopeSearchField[];
}>;

type ScopeSearchEntry = Readonly<{
  node: ScopeSearchNode;
  path: string;
  ancestorIds: readonly string[];
  fields: readonly Readonly<{ field: ScopeSearchField; text: string }>[];
}>;

export type ScopeSearchIndex = Readonly<{
  entries: readonly ScopeSearchEntry[];
  totalNodes: number;
}>;

export type ScopeSearchPage = Readonly<{
  query: string;
  total: number;
  offset: number;
  limit: number;
  matches: readonly ScopeSearchMatch[];
  hasPrevious: boolean;
  hasNext: boolean;
}>;

/**
 * Callers own the snapshot and privacy boundary. In particular, the companion
 * must pass credential-safe strings before indexing, never redact only after
 * matching: counts and matched field names can otherwise disclose omitted data.
 */
export function createScopeSearchIndex(nodes: readonly ScopeSearchNode[]): ScopeSearchIndex {
  const snapshots = nodes.map((node): ScopeSearchNode => Object.freeze({
    id: node.id,
    kind: node.kind,
    label: node.label,
    parentId: node.parentId,
    ...(node.lifecycle !== undefined ? { lifecycle: node.lifecycle } : {}),
    ...(node.retired !== undefined ? { retired: node.retired } : {}),
    ...(node.detail !== undefined ? { detail: node.detail } : {})
  }));
  const byId = new Map(snapshots.map((node) => [node.id, node]));
  const entries = snapshots.map((node): ScopeSearchEntry => {
    const ancestors: ScopeSearchNode[] = [];
    const seen = new Set([node.id]);
    let parent = node.parentId === null ? undefined : byId.get(node.parentId);
    while (parent && !seen.has(parent.id)) {
      ancestors.push(parent);
      seen.add(parent.id);
      parent = parent.parentId === null ? undefined : byId.get(parent.parentId);
    }
    ancestors.reverse();
    const path = [...ancestors.map((ancestor) => ancestor.label), node.label].join(" / ");
    const values: readonly [ScopeSearchField, string][] = [
      ["label", node.label],
      ["kind", node.kind],
      ["identity", node.id],
      ["path", path],
      ["lifecycle", [node.lifecycle, node.retired ? "retired historical read-only" : null].filter(Boolean).join(" ")],
      ["detail", node.detail ?? ""]
    ];
    return Object.freeze({
      node,
      path,
      ancestorIds: Object.freeze(ancestors.map((ancestor) => ancestor.id)),
      fields: Object.freeze(values.map(([field, text]) => Object.freeze({ field, text: text.toLowerCase() })))
    });
  });
  return Object.freeze({ entries: Object.freeze(entries), totalNodes: entries.length });
}

/** Count all matches while materializing at most one bounded result page. */
export function searchScopes(
  index: ScopeSearchIndex,
  query: string,
  options: Readonly<{ offset?: number; limit?: number }> = {}
): ScopeSearchPage {
  const normalized = query.trim().toLowerCase();
  const offset = Number.isFinite(options.offset) ? Math.max(0, Math.floor(options.offset!)) : 0;
  const limit = Number.isFinite(options.limit) ? Math.min(100, Math.max(1, Math.floor(options.limit!))) : 50;
  const matches: ScopeSearchMatch[] = [];
  let total = 0;
  if (normalized) for (const entry of index.entries) {
    if (!entry.fields.some(({ text }) => text.includes(normalized))) continue;
    if (total >= offset && matches.length < limit) matches.push(Object.freeze({
      node: entry.node,
      path: entry.path,
      ancestorIds: entry.ancestorIds,
      matchedFields: Object.freeze(entry.fields.filter(({ text }) => text.includes(normalized)).map(({ field }) => field))
    }));
    total += 1;
  }
  return Object.freeze({
    query: query.trim(),
    total,
    offset,
    limit,
    matches: Object.freeze(matches),
    hasPrevious: total > 0 && offset > 0,
    hasNext: offset + matches.length < total
  });
}
