import type { EvidenceAggregateRequest } from "../../../core/evidence-field-analytics";
import { canonicalizeFilter, createFilter, createTypedFilterValue, type EvidenceSnapshot } from "../../../core/evidence-filter-contract";
import type { FilterCriterionSet } from "../../../core/filter-algebra";
import { reanchorEvidenceQueryCursor } from "../../../core/evidence-filter-cursor";
import { FACET_DESCRIPTORS } from "../../../core/evidence-facets";
import type { AgentQueryArguments } from "../../../agent/tool-arguments";
import { agentToolResultBytes } from "../../../agent/tool-result";
import type { AgentQueryInput, AgentRuntime } from "../agent-runtime";

/** Any validated Evidence tool's query options; each tool accepts a subset. */
export type AgentQueryOptions = AgentQueryArguments & Readonly<{ aggregate?: EvidenceAggregateRequest }>;

export function makeQuery(args: AgentQueryOptions, defaultLimit = 25, forcePayload = false, defaultOrder: AgentQueryInput["order"] = "OLDEST_FIRST"): AgentQueryInput {
  const inputFilter = args.filter;
  const text = inputFilter?.text ?? args.text ?? "";
  const criteria: Record<string, { include: ReturnType<typeof createTypedFilterValue>[]; exclude: ReturnType<typeof createTypedFilterValue>[] }> = {};
  for (const entry of inputFilter?.criteria ?? []) {
    const bucket = criteria[entry.facet] ??= { include: [], exclude: [] };
    bucket[entry.polarity].push(createTypedFilterValue(entry.facet, entry.type, entry.value, entry.label ?? String(entry.value)));
  }
  const queryFilter = canonicalizeFilter({ ...createFilter(), text, criteria, around: inputFilter?.around ?? null });
  const discoveries = args.discover?.map(request => ({ facet: request.facet, ...(request.search === undefined ? {} : { search: request.search }), size: request.limit ?? 25, ...(request.cursor ? { cursor: request.cursor } : {}) }));
  return {
    ...(typeof args.scopeId === "string" ? { scopeId: args.scopeId } : {}),
    size: args.limit ?? defaultLimit,
    adaptivePage: true,
    at: args.at ?? "LATEST_COMMITTED",
    ...(typeof args.cursor === "string" ? { cursor: args.cursor } : {}),
    includePayload: forcePayload || args.includePayload === true,
    order: args.order ?? defaultOrder,
    filter: queryFilter,
    ...(discoveries ? { discover: discoveries } : {}),
    ...(args.sequenceWindow ? { sequenceWindow: args.sequenceWindow } : {}),
    ...(args.fieldPredicates ? { fieldPredicates: args.fieldPredicates } : {}),
    ...(args.aggregate ? { aggregate: args.aggregate } : {}),
    ...(args.workBudget ? { workBudget: args.workBudget } : {})
  };
}

export function makeReadQuery(runtime: AgentRuntime, args: AgentQueryOptions): AgentQueryInput {
  const query = makeQuery(args);
  if (args.within === undefined && args.where === undefined) return query;
  if (args.within === "current-investigation" && (args.where !== undefined || args.filter !== undefined || args.text !== undefined)) throw new Error("INVALID_ARGUMENT: current-investigation already owns its Filter; start fresh with an explicit scopeId or within:page to change filtering.");
  const boundary = structuredClone(runtime.queryBoundary(args.scopeId, args.within === "current-investigation"));
  const criteria: Record<string, FilterCriterionSet> = { ...boundary.filter.criteria, ...query.filter?.criteria };
  for (const [facet, values] of Object.entries(args.where ?? {})) {
    if (!values) continue; // Validated JSON never carries an undefined facet list.
    const descriptor = FACET_DESCRIPTORS.find(candidate => candidate.key === facet);
    if (!descriptor) throw new Error(`Unsupported Evidence facet: ${facet}`);
    criteria[facet] = { include: values.map(value => createTypedFilterValue(facet, descriptor.valueType, value, value)), exclude: [] };
  }
  const filter = canonicalizeFilter({ ...boundary.filter, text: args.text !== undefined || args.filter?.text !== undefined ? query.filter!.text : boundary.filter.text, criteria, around: args.filter?.around ?? boundary.filter.around });
  return { ...query, scope: boundary.scope, filter };
}

export function fitAgentPrefix(size: number, budget: number, response: (count: number) => unknown, message: string): number {
  if (agentToolResultBytes(response(size)) <= budget) return size;
  let low = 1, high = size - 1, fitted = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (agentToolResultBytes(response(middle)) <= budget) { fitted = middle; low = middle + 1; }
    else high = middle - 1;
  }
  if (!fitted) throw new Error(`RESULT_BUDGET_EXCEEDED: ${message}`);
  return fitted;
}

export function shortenedEvidenceCursor(result: EvidenceSnapshot, count: number): string | null {
  if (count >= result.page.evidence.length) return result.page.nextCursor;
  const resume = result.page.resumeCursor ?? result.page.nextCursor;
  if (!resume || !count) throw new Error("UNSUPPORTED_CAPABILITY: This history build cannot fit terminal Evidence pages without losing records.");
  return reanchorEvidenceQueryCursor(resume, result.page.evidence[count - 1]!.identity);
}

export function omissions(payloadRequested: boolean): string[] {
  return payloadRequested
    ? ["Client Message bodies are redacted; raw transport text is omitted."]
    : ["Item Update payloads were not requested; Client Message bodies and raw transport text are omitted."];
}
