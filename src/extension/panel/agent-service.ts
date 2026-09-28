import { AGENT_MAX_BYTES, AGENT_PROTOCOL_VERSION, AGENT_READ_CONTRACT, AGENT_TOOLS, validateAgentCall, type AgentArguments, type AgentPermission } from "../../agent/protocol";
import { toBulkShareableEventEnvelope, type LightstreamerEventEnvelope } from "../../core/event-envelope";
import type { EvidenceIdentity, EvidenceReadPoint, DeterministicEvidenceRecord } from "../../core/evidence-filter-contract";
import { createScopeSearchIndex, searchScopes, type ScopeSearchIndex, type ScopeSearchNode } from "../../core/scope-search";
import { canonicalizeFilter, createFilter, createTypedFilterValue } from "../../core/evidence-filter-contract";
import type { Filter } from "../../core/filter-algebra";
import type { AgentRuntime, AgentDraftInput, AgentQueryBoundary, AgentScopeSearchSnapshot, AgentScenarioMember, AgentScenarioPlanInput, AgentQueryInput } from "./agent-runtime";
import { cloneCredentialSafe as omitCredentialFields } from "./topology-export";
import { describeAgentStreams } from "./agent-stream-description";
import { waitForAgentEvidence } from "./agent-evidence-wait";
import { FACET_DESCRIPTORS } from "../../core/evidence-facets";
import { agentToolResultBytes } from "../../agent/tool-result";
import type { HistoryStatus } from "../../core/event-history-authoritative";

const SEARCH_CURSOR_LIFETIME_MS = 5 * 60 * 1000;
type EvidenceSearch = { at: EvidenceReadPoint; after: EvidenceIdentity; boundary: AgentQueryBoundary; within: "page" | "current-investigation"; scopeId?: string; text: string; size: number; includePayload: boolean; fields?: string[]; maxBytes: number; pageEpoch: unknown; expiresAt: number };
type ScopeSearch = { index: ScopeSearchIndex; snapshot: Omit<AgentScopeSearchSnapshot, "nodes">; text: string; size: number; maxBytes: number; kind?: string; parentScopeId?: string; expiresAt: number };

export function createAgentService(runtime: AgentRuntime, panelSessionId: string, permission: () => AgentPermission) {
  const cursors = new Map<string, { at: EvidenceReadPoint; cursor: string; query?: Omit<AgentQueryInput, "cursor" | "at">; fields?: string[]; maxBytes?: number; pageEpoch?: unknown }>();
  const evidenceSearches = new Map<string, EvidenceSearch>();
  const summaries = new Map<string, { query: AgentQueryInput; facet: string; cursor: string; limit: number; maxBytes: number; at: EvidenceReadPoint; pageEpoch: unknown }>();
  // Multiple page cursors share one bounded Topology snapshot rather than copying it.
  const scopeSearches = new Map<string, ScopeSearch>();
  const scopeCursors = new Map<string, { searchId: string; offset: number }>();
  const requests = new Map<string, { signature: string; kind: "local" | "scenario"; draftId?: string; value: unknown }>();
  const waits = new Set<AbortController>();
  let prepared: { token: string; fingerprint: string; kind: "local" | "scenario"; consumed: boolean } | null = null;
  let busy = false;
  let grantGeneration = 0;
  const saveNextCursor = (query: AgentQueryInput, readPoint: EvidenceReadPoint, cursor: string | null, fields?: string[], maxBytes?: number): string | null => {
    if (!cursor) return null;
    const opaque = crypto.randomUUID();
    const { at: _at, cursor: _cursor, ...boundQuery } = query;
    cursors.set(opaque, { query: boundQuery, at: readPoint, cursor, fields, maxBytes, pageEpoch: (runtime.status() as { pageEpoch: unknown }).pageEpoch });
    if (cursors.size > 128) cursors.delete(cursors.keys().next().value!);
    return opaque;
  };
  const fingerprint = (scenario: boolean) => {
    if (!scenario) return JSON.stringify([runtime.local().draft?.id, runtime.local().draft?.rawText, runtime.local().draft?.anchor]);
    const definition = runtime.scenario()?.scenario;
    // Cursor, focus and validation presentation do not mutate the execution plan.
    return JSON.stringify(definition ? { id: definition.id, revision: definition.revision, target: definition.target, speed: definition.speed, members: definition.members.map(member => member.kind === "step" ? { id: member.id, rawText: member.draft.rawText, target: member.draft.target, item: member.draft.item, delayMs: member.draft.relativeDelayMs } : member) } : null);
  };
  const snapshot = () => ({ local: safeDraft(runtime.local()), scenario: safeScenario(runtime.scenario()) });
  function refreshOperations() {
    if (![...requests.values()].some(operation => operation.kind === "local" && (operation.value as { state?: string }).state === "pending")) return;
    const draft = runtime.local().draft;
    for (const operation of requests.values()) {
      if (operation.kind !== "local" || !draft || draft.id !== operation.draftId) continue;
      if (draft.outcome) operation.value = { state: "complete", outcome: cloneCredentialSafe(draft.outcome) };
      else if (draft.phase !== "pending") operation.value = { state: "not-run", validation: safeDraft(runtime.local()) };
    }
  }
  async function call(name: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
    validateAgentCall(name, input);
    const args = input as AgentArguments;
    if (permission() === "off" || args.panelSessionId !== panelSessionId) throw new Error("This Panel Session has not granted agent access.");
    const mutation = AGENT_TOOLS.find(tool => tool.name === name)!.mutation;
    if (mutation && permission() !== "local") throw new Error("This Panel Session grants inspection only.");
    if (busy && mutation && !(name === "control_scenario" && ["pause", "stop"].includes(String(args.action)))) throw new Error("Another agent operation is preparing a document. Try this mutation again after it settles.");
    refreshOperations();
    if (requests.size >= 256 && ["execute_local_injection", "control_scenario"].includes(name) && !(typeof args.requestId === "string" && requests.has(args.requestId)) && !["pause", "stop"].includes(String(args.action))) throw new Error("This Panel Session reached its 256-operation agent limit. Existing outcomes remain readable; pause and stop remain available.");
    switch (name) {
      case "get_status": return { protocolVersion: AGENT_PROTOCOL_VERSION, readContract: AGENT_READ_CONTRACT, panelSessionId, permission: permission(), ...runtime.status() as object, capabilities: AGENT_TOOLS.filter(tool => tool.name !== "list_panel_sessions" && (!tool.mutation || permission() === "local") && (tool.name !== "validate_agent_candidate" || typeof runtime.validateCandidate === "function") && (tool.name !== "prepare_scenario" || typeof runtime.prepareScenarioPlan === "function")).map(tool => tool.name) };
      case "list_scope": return runtime.scopes(Number(args.offset ?? 0), Number(args.limit ?? 50));
      case "search_scope": {
        const saved = args.cursor ? scopeCursors.get(String(args.cursor)) : undefined;
        if (args.cursor && !saved) throw new Error("Search cursor expired. Start a new search.");
        const searchId = saved?.searchId ?? crypto.randomUUID();
        let search = saved ? scopeSearches.get(searchId) : undefined;
        if (saved) {
          if (!search || search.expiresAt <= Date.now()) throw new Error("Search cursor expired. Start a new search.");
          const status = runtime.status() as { pageEpoch: string | null; history: { interval: { id: string }; retainedRange: { first: { sequence: number } } | null } };
          const first = search.snapshot.history.retainedFirstSequence;
          if (status.pageEpoch !== search.snapshot.pageEpoch || status.history.interval.id !== search.snapshot.history.intervalId
            || (first !== null && (status.history.retainedRange === null || status.history.retainedRange.first.sequence > first))) {
            throw new Error("Scope search snapshot expired after page change, Clear or retention. Start a new search.");
          }
        } else {
          const { nodes, ...snapshot } = runtime.scopeSearchSnapshot();
          const index = createScopeSearchIndex(cloneCredentialSafe(nodes) as readonly ScopeSearchNode[]);
          const entries = index.entries.filter(entry => (args.kind === undefined || entry.node.kind === args.kind) && (args.parentScopeId === undefined || entry.node.parentId === args.parentScopeId));
          search = { index: { entries, totalNodes: entries.length }, snapshot, text: String(args.text).trim(), size: Number(args.limit ?? 25), maxBytes: Number(args.maxBytes ?? AGENT_READ_CONTRACT.defaultMaxBytes), kind: args.kind as string | undefined, parentScopeId: args.parentScopeId as string | undefined, expiresAt: Date.now() + SEARCH_CURSOR_LIFETIME_MS };
        }
        let size = search!.size;
        let result = searchScopes(search!.index, search!.text, { offset: saved?.offset ?? 0, limit: size });
        const response = () => ({ snapshot: search!.snapshot, boundary: "ALL_STRUCTURAL_TOPOLOGY", match: "CASE_INSENSITIVE_SUBSTRING", text: search!.text, kind: search!.kind, parentScopeId: search!.parentScopeId, total: result.total, offset: result.offset, nextCursor: result.hasNext ? "00000000-0000-0000-0000-000000000000" : null, scopes: result.matches.map(({ node, path, ancestorIds, matchedFields }) => ({ scopeId: node.id, kind: node.kind, label: node.label, detail: node.detail, lifecycle: node.lifecycle, retired: node.retired, path, ancestorIds, matchedFields })) });
        while (agentToolResultBytes(response()) > search!.maxBytes) {
          if (size <= 1) throw new Error("RESULT_BUDGET_EXCEEDED: One Scope match exceeds maxBytes. Narrow search or start fresh without cursor to change options.");
          size = Math.max(1, Math.floor(size / 2));
          result = searchScopes(search!.index, search!.text, { offset: saved?.offset ?? 0, limit: size });
        }
        search!.size = size;
        let nextCursor: string | null = null;
        if (result.hasNext) {
          scopeSearches.set(searchId, search!);
          if (scopeSearches.size > 8) scopeSearches.delete(scopeSearches.keys().next().value!);
          nextCursor = crypto.randomUUID();
          scopeCursors.set(nextCursor, { searchId, offset: result.offset + result.matches.length });
          if (scopeCursors.size > 128) scopeCursors.delete(scopeCursors.keys().next().value!);
        }
        return { ...response(), nextCursor };
      }
      case "get_scope": return cloneCredentialSafe(runtime.scope(String(args.scopeId)));
      case "search_evidence": {
        const saved = args.cursor ? evidenceSearches.get(String(args.cursor)) : undefined;
        if (args.cursor && (!saved || saved.expiresAt <= Date.now())) throw new Error("Search cursor expired. Start a new search.");
        const pageEpoch = (runtime.status() as { pageEpoch: unknown }).pageEpoch;
        if (saved && saved.pageEpoch !== pageEpoch) throw new Error("Search cursor expired after page change. Start a new search.");
        const within = saved?.within ?? (args.within === "current-investigation" ? "current-investigation" : "page");
        if (!saved && within === "current-investigation" && args.where !== undefined) throw new Error("INVALID_ARGUMENT: current-investigation already owns its Filter; start fresh with an explicit scopeId or within:page to add where.");
        const boundary = saved?.boundary ?? structuredClone(runtime.queryBoundary(args.scopeId as string | undefined, within === "current-investigation"));
        const text = saved?.text ?? String(args.text).trim();
        const size = saved?.size ?? Number(args.limit ?? 25);
        const includePayload = saved?.includePayload ?? args.includePayload === true;
        const fields = saved?.fields ?? args.fields as string[] | undefined;
        const maxBytes = saved?.maxBytes ?? Number(args.maxBytes ?? AGENT_READ_CONTRACT.defaultMaxBytes);
        const readFilter = saved ? boundary.filter : makeReadQuery(runtime, within === "current-investigation" ? { ...args, text: undefined } : args).filter ?? boundary.filter;
        const searchBoundary = { ...boundary, filter: readFilter };
        let pageSize = size;
        let at: EvidenceReadPoint | "LATEST_COMMITTED" = saved?.at ?? (args.at as EvidenceReadPoint | "LATEST_COMMITTED" | undefined) ?? "LATEST_COMMITTED";
        for (;;) {
          const result = await runtime.query({ ...searchBoundary, at, size: 1, includePayload: includePayload || Boolean(fields?.length), find: { text, scopeToFilter: true, reveal: false, size: pageSize, ...(saved ? { after: saved.after } : {}) } });
          if (result.evaluation !== "COMPLETE") throw new Error("UNSUPPORTED_FILTER: Evidence search cannot evaluate this investigation. Remove the unsupported Filter criterion or explicitly search within: page.");
          if (!result.find) throw new Error("Evidence search is unavailable at this read point.");
          const records = result.find.results ?? [];
          const evidence = records.map(record => { const projected = projectReadRecord(record, includePayload, fields); return { ...projected, match: safeMatchExplanation(projected, text) }; });
          const response = { search: { text, within, ...((saved?.scopeId ?? args.scopeId) ? { scopeId: saved?.scopeId ?? args.scopeId } : {}), match: "CASE_INSENSITIVE_SUBSTRING", order: "OLDEST_FIRST" }, readPoint: result.readPoint, total: result.find.total, totals: result.totals, coverage: result.coverage, evaluation: result.evaluation, storage: result.storage, nextCursor: result.find.hasMore ? "00000000-0000-0000-0000-000000000000" : null, evidence };
          if (agentToolResultBytes(response) <= maxBytes) {
            let nextCursor: string | null = null;
            if (result.find.hasMore && records.length > 0) {
              nextCursor = crypto.randomUUID();
              evidenceSearches.set(nextCursor, { boundary: searchBoundary, within, scopeId: saved?.scopeId ?? args.scopeId as string | undefined, text, size: pageSize, includePayload, fields, maxBytes, pageEpoch, at: result.readPoint, after: records.at(-1)!.identity, expiresAt: saved?.expiresAt ?? Date.now() + SEARCH_CURSOR_LIFETIME_MS });
              if (evidenceSearches.size > 128) evidenceSearches.delete(evidenceSearches.keys().next().value!);
            }
            return { ...response, nextCursor };
          }
          if (pageSize <= 1) throw new Error("RESULT_BUDGET_EXCEEDED: One search match exceeds maxBytes. Request fewer fields or narrow the search; start fresh without cursor to change options.");
          pageSize = Math.max(1, Math.floor(pageSize / 2));
          at = result.readPoint;
        }
      }
      case "query_evidence": {
        let query = makeReadQuery(runtime, args);
        let fields = args.fields as string[] | undefined;
        let maxBytes = Number(args.maxBytes ?? AGENT_READ_CONTRACT.defaultMaxBytes);
        if (args.cursor) {
          const suppliedQueryKeys = Object.keys(args).filter(key => !["panelSessionId", "cursor"].includes(key));
          if (suppliedQueryKeys.length) throw new Error("Continue a query with only its cursor; query arguments are bound to the first page.");
          const saved = cursors.get(String(args.cursor));
          if (!saved) throw new Error("Query cursor expired. Start a new query.");
          if (saved.pageEpoch !== (runtime.status() as { pageEpoch: unknown }).pageEpoch) throw new Error("Query cursor expired after page change. Start fresh without cursor.");
          query = { ...saved.query!, at: saved.at, cursor: saved.cursor };
          fields = saved.fields;
          maxBytes = saved.maxBytes ?? maxBytes;
        }
        let size = query.size;
        for (;;) {
          const result = await runtime.query({ ...query, size, includePayload: query.includePayload || Boolean(fields?.length), signal });
          if (args.within === "current-investigation" && result.evaluation !== "COMPLETE") throw new Error("UNSUPPORTED_FILTER: The current investigation cannot be evaluated completely. Start fresh with within:page or an exact scopeId before making a count or absence claim.");
          const response = { readPoint: result.readPoint, totals: result.totals, coverage: result.coverage, evaluation: result.evaluation, storage: result.storage, discoveries: cloneCredentialSafe(Object.fromEntries(result.discoveries)), nextCursor: result.page.nextCursor ? "00000000-0000-0000-0000-000000000000" : null, evidence: result.page.evidence.map(record => projectReadRecord(record, query.includePayload, fields)), omissions: omissions(query.includePayload) };
          if (agentToolResultBytes(response) <= maxBytes) {
            return { ...response, nextCursor: saveNextCursor({ ...query, size }, result.readPoint, result.page.nextCursor, fields, maxBytes) };
          }
          if (size <= 1) throw new Error("RESULT_BUDGET_EXCEEDED: One Evidence record or query metadata exceeds maxBytes. Narrow the query or request fewer fields; start fresh without cursor to change options.");
          size = Math.max(1, Math.floor(size / 2));
          query = { ...query, at: result.readPoint };
        }
      }
      case "summarize_evidence": {
        const saved = args.cursor ? summaries.get(String(args.cursor)) : undefined;
        if (args.cursor && (!saved || saved.pageEpoch !== (runtime.status() as { pageEpoch: unknown }).pageEpoch)) throw new Error("Summary cursor expired. Start fresh without cursor.");
        const query = saved?.query ?? makeReadQuery(runtime, args);
        const facet = saved?.facet ?? args.facet as string | undefined;
        const maxBytes = saved?.maxBytes ?? Number(args.maxBytes ?? AGENT_READ_CONTRACT.defaultMaxBytes);
        const effective = saved ? { ...query, at: saved.at } : query;
        let size = saved?.limit ?? Number(args.limit ?? 25);
        let at = effective.at;
        for (;;) {
          const discovery = facet ? [{ facet, size, scopeToFilter: true, ...(saved ? { cursor: saved.cursor } : {}) }] : undefined;
          const result = await runtime.query({ ...effective, at, size: 1, includePayload: false, ...(discovery ? { discover: discovery } : {}), signal });
          if (args.within === "current-investigation" && result.evaluation !== "COMPLETE") throw new Error("UNSUPPORTED_FILTER: The current investigation cannot be evaluated completely. Start fresh with within:page or an exact scopeId before making a count or absence claim.");
          const found = facet ? result.discoveries.get(facet) : undefined;
          const response = { readPoint: result.readPoint, totals: result.totals, coverage: result.coverage, evaluation: result.evaluation, storage: result.storage,
            countMeaning: "Evidence records, not current COMMAND rows", values: found?.values.map(entry => ({ value: { facet: entry.value.facet, type: entry.value.type, value: entry.value.value, label: entry.value.label }, count: entry.count })) ?? [], distinctTotal: found?.distinctTotal ?? null,
            ...(facet ? { facet, discoveryState: found?.state ?? "UNAVAILABLE", baseEvidenceCount: found?.baseEvidenceCount ?? null, ...(found?.state === "UNAVAILABLE" ? { reason: found.reason } : {}) } : {}), nextCursor: found?.nextCursor ? "00000000-0000-0000-0000-000000000000" : null as string | null };
          if (agentToolResultBytes(response) <= maxBytes) {
            if (found?.nextCursor) {
              response.nextCursor = crypto.randomUUID();
              summaries.set(response.nextCursor, { query: effective, facet: facet!, cursor: found.nextCursor, limit: size, maxBytes, at: result.readPoint, pageEpoch: (runtime.status() as { pageEpoch: unknown }).pageEpoch });
              if (summaries.size > 128) summaries.delete(summaries.keys().next().value!);
            }
            return response;
          }
          if (size <= 1 || !facet) throw new Error("RESULT_BUDGET_EXCEEDED: Summary exceeds maxBytes. Narrow the query or request fewer facet values; start fresh without cursor to change options.");
          size = Math.max(1, Math.floor(size / 2));
          at = result.readPoint;
        }
      }
      case "describe_stream": {
        const query = makeQuery(args, 100, true, "NEWEST_FIRST");
        if (query.size > 100) throw new Error("Stream descriptions are limited to 100 Evidence records per read point.");
        if (args.cursor) throw new Error("describe_stream summarizes one bounded sample; use query_evidence to continue pages.");
        const result = await runtime.query({ ...query, signal });
        const records = boundedRecords(result.page.evidence) as DeterministicEvidenceRecord[];
        const sampled = records.length;
        const completeSample = result.evaluation === "COMPLETE" && result.coverage === "COMPLETE" && sampled >= result.totals.matching && result.page.nextCursor === null && records.every(record => record.payload !== undefined);
        const profile = describeAgentStreams({ records, limit: query.size, readPoint: result.readPoint, completeness: completeSample ? "COMPLETE" : "LIMITED", window: query.order ?? "NEWEST_FIRST" });
        const nextCursor = saveNextCursor({ ...query, includePayload: false }, result.readPoint, result.page.nextCursor);
        const current = runtime.status() as { capture?: { coverage?: string; operation?: string; firstMissingEventId?: string | null; detail?: string }; history?: { phase?: string; retained?: number; retention?: unknown; continuity?: unknown } };
        return { ...profile, readPoint: result.readPoint, matchingTotal: result.totals.matching, sampled, completeness: profile.completeness, nextCursor, observationCoverage: current.capture?.coverage ?? "UNAVAILABLE", history: { phase: current.history?.phase ?? "UNKNOWN", retained: current.history?.retained ?? 0, retention: current.history?.retention ?? null, continuity: current.history?.continuity ?? null }, omissions: [...omissions(true), ...(completeSample ? [] : ["The sample or its payload budget is incomplete. Use query_evidence with nextCursor when present, or narrow the query to inspect omitted payloads."])] };
      }
      case "wait_for_evidence": {
        if (!runtime.subscribeEvidence) throw new Error("Evidence observation is unavailable in this panel build.");
        if (waits.size >= 4) throw new Error("REQUEST_CAPACITY: At most four Evidence waits may run concurrently per Panel Session.");
        const controller = new AbortController();
        const cancel = () => controller.abort();
        waits.add(controller); signal?.addEventListener("abort", cancel, { once: true });
        if (signal?.aborted) cancel();
        try {
          const query = makeQuery({ ...args, order: "NEWEST_FIRST" });
          const result = await waitForAgentEvidence({
            status: () => runtime.status() as { pageEpoch: string | null; history: HistoryStatus },
            subscribe: listener => runtime.subscribeEvidence!(listener),
            query: readSignal => runtime.query({ ...query, at: "LATEST_COMMITTED", signal: readSignal })
          }, { after: args.after as EvidenceReadPoint, pageEpoch: String(args.pageEpoch), timeoutMs: Number(args.timeoutMs ?? 10000), signal: controller.signal });
          return { ...result, evidence: boundedRecords(result.evidence), omissions: omissions(query.includePayload) };
        } finally { signal?.removeEventListener("abort", cancel); waits.delete(controller); }
      }
      case "get_evidence": {
        const includePayload = args.includePayload === true;
        const fields = args.fields as string[] | undefined;
        const result = await runtime.query({ at: "LATEST_COMMITTED", size: 1, includePayload: includePayload || Boolean(fields?.length), lookup: args.evidence as EvidenceIdentity, signal });
        const response = { readPoint: result.readPoint, coverage: result.coverage, lookup: result.lookup?.state === "RETAINED" ? { state: "RETAINED", evidence: projectReadRecord(result.lookup.evidence, includePayload, fields) } : result.lookup };
        if (agentToolResultBytes(response) > Number(args.maxBytes ?? AGENT_READ_CONTRACT.defaultMaxBytes)) throw new Error("RESULT_BUDGET_EXCEEDED: Exact Evidence exceeds maxBytes. Request fewer fields or omit payload.");
        return response;
      }
      case "query_diagnostics": {
        const result = await runtime.diagnostics(args.after as Parameters<AgentRuntime["diagnostics"]>[0]);
        const observations = result.observations.slice(0, Number(args.limit ?? 50));
        const truncated = observations.length < result.observations.length;
        return cloneCredentialSafe({ ...result, observations, truncated, nextAfter: truncated ? observations.at(-1)!.observationBoundary : null });
      }
      case "update_agent_document": {
        if (!prepared || prepared.token !== args.token || prepared.consumed || prepared.fingerprint !== fingerprint(prepared.kind === "scenario")) throw new Error("Agent document was changed or executed. Inspect the document in Workbench.");
        runtime.edit(String(args.document), args.stepId as string | undefined);
        prepared = { ...prepared, token: crypto.randomUUID(), fingerprint: fingerprint(prepared.kind === "scenario") };
        return { token: prepared.token, ...snapshot() };
      }
      case "prepare_local_injection":
      case "prepare_scenario":
      case "validate_agent_candidate": {
        const ownsBusy = name !== "validate_agent_candidate";
        if (ownsBusy) busy = true;
        try {
          const generation = grantGeneration;
          const stillAuthorized = () => (name === "validate_agent_candidate" ? permission() !== "off" : permission() === "local") && generation === grantGeneration;
          if (name === "validate_agent_candidate") {
            const input = args.members
              ? { kind: "scenario" as const, plan: scenarioPlan(args) }
              : { kind: "draft" as const, draft: args.draft as AgentDraftInput };
            if (input.kind === "draft") validateDraftSource(input.draft);
            return cloneCredentialSafe(await runtime.validateCandidate(input, String(args.pageEpoch), stillAuthorized));
          }
          if (name === "prepare_scenario") {
            const plan = scenarioPlan(args);
            if (plan.replace) {
              const current = runtime.scenario()?.scenario;
              if (!prepared || prepared.kind !== "scenario" || prepared.fingerprint !== fingerprint(true) || current?.id !== plan.replace.scenarioId || current.revision !== plan.replace.revision) throw new Error("Only the unchanged agent-owned Scenario can be replaced.");
            }
            await runtime.prepareScenarioPlan(plan, String(args.pageEpoch), stillAuthorized);
            prepared = { token: crypto.randomUUID(), fingerprint: fingerprint(true), kind: "scenario", consumed: false };
            return { token: prepared.token, ...snapshot() };
          }
          const draft: AgentDraftInput = { scopeId: args.scopeId as string | undefined, evidence: args.evidence as EvidenceIdentity | undefined, document: args.document as string | undefined };
          validateDraftSource(draft);
          await runtime.prepare([draft], false, String(args.pageEpoch), stillAuthorized);
          prepared = { token: crypto.randomUUID(), fingerprint: fingerprint(false), kind: "local", consumed: false };
          return { token: prepared.token, ...snapshot() };
        } finally { if (ownsBusy) busy = false; }
      }
      case "execute_local_injection": {
        const id = String(args.requestId);
        const signature = JSON.stringify([name, args.token]);
        const previous = requests.get(id);
        if (previous) {
          if (previous.signature !== signature) throw new Error("requestId already belongs to a different operation.");
          return previous.value;
        }
        if (!prepared || prepared.kind !== "local" || prepared.token !== args.token || prepared.consumed || prepared.fingerprint !== fingerprint(false)) throw new Error("Prepared Draft changed, was consumed, or is unavailable. Inspect the current document in Workbench.");
        if (!(runtime.status() as { visible: boolean }).visible) throw new Error("Show the Workbench panel before injecting.");
        const draft = runtime.local().draft;
        if (!draft?.ready || draft.phase !== "edit") throw new Error("The Draft is not ready for delivery. Inspect its validation in Workbench.");
        prepared.consumed = true;
        const operation = { signature, kind: "local" as const, draftId: draft.id, value: { state: "pending", requestId: id } as unknown };
        requests.set(id, operation); // Reserve before the effect; never retry after a lost reply.
        runtime.execute();
        refreshOperations();
        if (!runtime.local().draft?.outcome && runtime.local().draft?.phase !== "pending") operation.value = { state: "not-run", validation: safeDraft(runtime.local()) };
        return operation.value;
      }
      case "get_operation": {
        const operation = requests.get(String(args.requestId));
        if (!operation) throw new Error("Operation is unknown in this Panel Session. This is not proof that delivery did not occur.");
        return operation.value;
      }
      case "control_scenario": {
        const id = String(args.requestId);
        const signature = JSON.stringify([name, args.runId, args.action]);
        const previous = requests.get(id);
        if (previous) {
          if (previous.signature !== signature) throw new Error("requestId already belongs to a different operation.");
          return previous.value;
        }
        const current = runtime.scenario();
        if (!prepared || prepared.kind !== "scenario" || prepared.fingerprint !== fingerprint(true) || !current?.run || current.run.id !== args.runId) throw new Error("Reviewed agent Scenario is unavailable or was edited.");
        if (["step", "play"].includes(String(args.action))) {
          if (!(runtime.status() as { visible: boolean }).visible || !["review", "paused"].includes(current.phase)) throw new Error("Scenario must be visible and reviewed or paused before dispatch.");
          prepared.consumed = true;
        }
        const operation = { signature, kind: "scenario" as const, value: { requestId: id, accepted: true } };
        if (requests.size < 256) requests.set(id, operation);
        runtime.control(args.action as Parameters<AgentRuntime["control"]>[0]);
        return operation.value;
      }
      case "get_scenario_trace": return safeScenario(runtime.scenario(), Number(args.offset ?? 0), Number(args.limit ?? 25));
      case "finish_agent_document": {
        if (!prepared || args.token !== prepared.token || prepared.fingerprint !== fingerprint(prepared.kind === "scenario")) throw new Error("Agent document is unavailable or was edited.");
        const complete = prepared.kind === "scenario" ? ["complete", "stopped"].includes(runtime.scenario()?.phase ?? "") : runtime.local().draft?.phase === "outcome";
        if (!complete) throw new Error("Only a completed agent document can be finished. Resolve or discard unfinished documents in Workbench.");
        runtime.finish(); prepared = null; return { finished: true };
      }
      default: throw new Error("Tool is unavailable on this Panel Session.");
    }
  }
  return {
    async call(name: string, args: unknown, options?: { signal?: AbortSignal }) {
      const generation = grantGeneration;
      const result = await call(name, args, options?.signal);
      // Grants can be revoked while a read awaits storage. Do not disclose its result.
      if (permission() === "off" || generation !== grantGeneration) throw new Error("Agent access was revoked.");
      if (new TextEncoder().encode(JSON.stringify(result)).byteLength > AGENT_MAX_BYTES) throw new Error("Response exceeds 512 KiB. Narrow the query, lower its limit, or omit payloads. Mutations are not retried; inspect their existing outcome.");
      return result;
    },
    refreshOperations,
    revoke() { grantGeneration++; cursors.clear(); evidenceSearches.clear(); summaries.clear(); scopeCursors.clear(); scopeSearches.clear(); for (const wait of waits) wait.abort(); if (prepared?.kind === "scenario") runtime.control("pause"); }
  };
}

function safeRecord(record: DeterministicEvidenceRecord, payloadBudget = 256 * 1024) {
  // searchText and summary can contain Client Message text; neither is exported.
  const payloadBytes = record.payload ? new TextEncoder().encode(JSON.stringify(record.payload)).byteLength : 0;
  if (payloadBytes > payloadBudget) return { identity: record.identity, timestamp: record.timestamp, facets: cloneCredentialSafe(record.facets), payloadBytes, payloadOmitted: "Payload exceeds the bounded response budget. Query this exact identity separately or inspect it in Workbench." };
  const payload = record.payload ? toBulkShareableEventEnvelope(record.payload as LightstreamerEventEnvelope) : null;
  // Raw transport text can duplicate a redacted Client Message or credential values.
  const { raw: _raw, ...semantic } = payload ?? {};
  return { identity: record.identity, timestamp: record.timestamp, facets: cloneCredentialSafe(record.facets), ...(payload ? { payload: cloneCredentialSafe(semantic) } : {}) };
}
/** Explain only the exported representation: canonical searchText/summary may contain secrets. */
function safeMatchExplanation(evidence: object, query: string) {
  const needle = query.toLowerCase();
  const fields: Array<{ field: string; excerpt: string }> = [];
  let remaining = 4096;
  function visit(value: unknown, path: string, depth = 0): void {
    if (fields.length >= 3 || depth > 16 || remaining-- <= 0) return;
    if (value !== null && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        visit(entry, path ? `${path}.${key}` : key, depth + 1);
        if (fields.length >= 3 || remaining <= 0) break;
      }
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const text = String(value);
      const found = text.toLowerCase().indexOf(needle);
      if (found < 0) return;
      const start = Math.max(0, found - 32), end = Math.min(text.length, start + 160);
      fields.push({ field: path.slice(0, 200), excerpt: `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}` });
    }
  }
  visit(evidence, "");
  return { state: fields.length > 0 ? "EXPLAINED" : "NO_SHAREABLE_EXCERPT", fields };
}

function boundedRecords(records: readonly DeterministicEvidenceRecord[]) {
  let remaining = 256 * 1024;
  return records.map(record => {
    const safe = safeRecord(record, Math.min(64 * 1024, remaining));
    if ("payload" in safe) remaining = Math.max(0, remaining - new TextEncoder().encode(JSON.stringify(safe.payload)).byteLength);
    return safe;
  });
}
function projectReadRecord(record: DeterministicEvidenceRecord, includePayload: boolean, fields?: readonly string[]) {
  const facets = Object.fromEntries(Object.entries(record.facets).map(([key, value]) => [key, ["client", "session", "subscription", "item", "listener"].includes(key) ? value?.label : value?.value]));
  const compact = { identity: record.identity, timestamp: record.timestamp, ...facets };
  if (fields?.length) {
    const original = record.payload as LightstreamerEventEnvelope | undefined;
    const safe = original ? toBulkShareableEventEnvelope(original) : undefined;
    const update = safe?.update;
    const projected = Object.fromEntries(fields.map(name => {
      const originalHasValue = original?.update?.fields && Object.hasOwn(original.update.fields, name);
      const safeHasValue = update?.fields && Object.hasOwn(update.fields, name);
      const state = originalHasValue && !safeHasValue ? "redacted" : original?.update?.fieldValueStates?.[name] ?? (safeHasValue ? "concrete" : "unavailable");
      const value = update?.fields?.[name];
      const sanitized = state === "concrete" && value !== undefined ? cloneCredentialSafe({ [name]: value }) as Record<string, unknown> : null;
      return [name, state === "concrete" && value !== undefined
        ? Object.hasOwn(sanitized!, name) ? { state, value: sanitized![name] } : { state: "redacted" }
        : { state }];
    }));
    return { ...compact, fields: projected };
  }
  if (includePayload) {
    const safe = safeRecord(record);
    return { ...compact, ...("payload" in safe ? { payload: safe.payload } : {}), ...("payloadOmitted" in safe ? { payloadOmitted: safe.payloadOmitted, payloadBytes: safe.payloadBytes } : {}) };
  }
  return compact;
}

function makeReadQuery(runtime: AgentRuntime, args: AgentArguments): AgentQueryInput {
  const query = makeQuery(args);
  if (args.within === undefined && args.where === undefined) return query;
  if (args.within === "current-investigation" && (args.where !== undefined || args.filter !== undefined || args.text !== undefined)) throw new Error("INVALID_ARGUMENT: current-investigation already owns its Filter; start fresh with an explicit scopeId or within:page to change filtering.");
  const boundary = structuredClone(runtime.queryBoundary(args.scopeId as string | undefined, args.within === "current-investigation"));
  const where = args.where as Record<string, string[]> | undefined;
  const criteria = { ...boundary.filter.criteria, ...query.filter?.criteria } as Record<string, { include: ReturnType<typeof createTypedFilterValue>[]; exclude: ReturnType<typeof createTypedFilterValue>[] }>;
  for (const [facet, values] of Object.entries(where ?? {})) {
    const descriptor = FACET_DESCRIPTORS.find(candidate => candidate.key === facet);
    if (!descriptor) throw new Error(`Unsupported Evidence facet: ${facet}`);
    criteria[facet] = { include: values.map(value => createTypedFilterValue(facet, descriptor.valueType, value, value)), exclude: [] };
  }
  const filter = canonicalizeFilter({ ...boundary.filter, text: args.text !== undefined || (args.filter as { text?: string } | undefined)?.text !== undefined ? query.filter!.text : boundary.filter.text, criteria, around: (args.filter as { around?: Filter["around"] } | undefined)?.around ?? boundary.filter.around });
  return { ...query, scope: boundary.scope, filter };
}
function safeDraft(local: ReturnType<AgentRuntime["local"]>) {
  if (!local.draft) return local;
  const { rawText: _raw, source: _source, preflightFingerprint: _fingerprint, ...draft } = local.draft;
  const documentBytes = new TextEncoder().encode(JSON.stringify(draft.document)).byteLength;
  return { ...local, draft: cloneCredentialSafe({ ...draft, ...(documentBytes > 64 * 1024 ? { document: null, documentOmitted: "Preview exceeds 64 KiB; inspect the visible Workbench Draft.", documentBytes } : {}) }), privacy: "Recognized credential fields are omitted; this is not a general secret detector. Captured redactions are not executable values." };
}
function safeScenario(state: ReturnType<AgentRuntime["scenario"]>, offset = 0, limit = 25) {
  if (!state) return null;
  // Source JSON text can contain credentials; expose reviewed documents, explicit membership and trace only.
  let remaining = 64 * 1024;
  const members = state.scenario.members.slice(offset, offset + limit).map(member => {
    if (member.kind === "checkpoint") return { kind: "checkpoint" as const, id: member.id, name: member.name, assertions: member.assertions };
    const step = member;
    const bytes = new TextEncoder().encode(JSON.stringify(step.draft.document)).byteLength;
    const include = bytes <= remaining;
    if (include) remaining -= bytes;
    return { kind: "step" as const, id: step.id, document: include ? step.draft.document : null, ...(include ? {} : { documentOmitted: "Preview budget exceeded; inspect the Workbench document or request a smaller page.", documentBytes: bytes }), diagnostics: step.draft.diagnostics, ready: step.draft.ready };
  });
  const steps = members.filter((member): member is Extract<typeof member, { kind: "step" }> => member.kind === "step");
  const run = state.run ? {
    id: state.run.id, target: state.run.target, committedEvidenceSeed: state.run.committedEvidenceSeed,
    status: state.run.status, nextOrdinal: state.run.nextOrdinal, trace: state.run.trace.slice(offset, offset + limit),
    controls: state.run.controls.slice(-25), drifts: state.run.drifts.slice(-25), controlsTotal: state.run.controls.length, driftsTotal: state.run.drifts.length
  } : null;
  const totalSteps = state.scenario.steps.length, totalMembers = state.scenario.members.length, totalTrace = state.run?.trace.length ?? 0;
  return cloneCredentialSafe({ phase: state.phase, scenarioId: state.scenario.id, revision: state.scenario.revision, offset, totalSteps, totalMembers, totalTrace, nextOffset: offset + limit < Math.max(totalMembers, totalTrace) ? offset + limit : null, members, steps, run, membershipError: state.membershipError, runner: state.runner ? { phase: state.runner.phase, pauseReason: state.runner.pauseReason, nextOrdinal: state.runner.nextOrdinal } : null });
}

function makeQuery(args: AgentArguments, defaultLimit = 25, forcePayload = false, defaultOrder: AgentQueryInput["order"] = "OLDEST_FIRST"): AgentQueryInput {
  const inputFilter = args.filter as { text?: string; criteria?: readonly { facet: string; polarity: "include" | "exclude"; type: string; value: string | number | boolean | null; label?: string }[]; around?: Filter["around"] } | undefined;
  const text = inputFilter?.text ?? args.text as string | undefined ?? "";
  const criteria: Record<string, { include: ReturnType<typeof createTypedFilterValue>[]; exclude: ReturnType<typeof createTypedFilterValue>[] }> = {};
  for (const entry of inputFilter?.criteria ?? []) {
    const bucket = criteria[entry.facet] ??= { include: [], exclude: [] };
    bucket[entry.polarity].push(createTypedFilterValue(entry.facet, entry.type, entry.value, entry.label ?? String(entry.value)));
  }
  const queryFilter = canonicalizeFilter({ ...createFilter(), text, criteria, around: inputFilter?.around ?? null });
  const discoveries = (args.discover as readonly { facet: string; search?: string; limit?: number; cursor?: string }[] | undefined)?.map(request => ({ facet: request.facet, ...(request.search === undefined ? {} : { search: request.search }), size: Number(request.limit ?? 25), ...(request.cursor ? { cursor: request.cursor } : {}) }));
  return {
    ...(typeof args.scopeId === "string" ? { scopeId: args.scopeId } : {}),
    size: Number(args.limit ?? defaultLimit),
    adaptivePage: true,
    at: (args.at as EvidenceReadPoint | "LATEST_COMMITTED" | undefined) ?? "LATEST_COMMITTED",
    ...(typeof args.cursor === "string" ? { cursor: args.cursor } : {}),
    includePayload: forcePayload || args.includePayload === true,
    order: (args.order as AgentQueryInput["order"] | undefined) ?? defaultOrder,
    filter: queryFilter,
    ...(discoveries ? { discover: discoveries } : {})
  };
}

function scenarioPlan(args: AgentArguments): AgentScenarioPlanInput {
  const members: AgentScenarioMember[] = args.members
    ? args.members as AgentScenarioMember[]
    : (args.steps as AgentDraftInput[]).map((step, index) => ({ kind: "step", id: `step-${index + 1}`, ...step }));
  const ids = new Set<string>();
  for (const member of members) {
    if (ids.has(member.id)) throw new Error("Scenario member ids must be unique.");
    ids.add(member.id);
    if (member.kind === "step") validateDraftSource(member);
  }
  return { members, ...(args.replace ? { replace: args.replace as AgentScenarioPlanInput["replace"] } : {}) };
}

function validateDraftSource(draft: AgentDraftInput): void {
  if (Boolean(draft.scopeId) === Boolean(draft.evidence)) throw new Error("Provide exactly one live scopeId or retained Evidence identity for each candidate Step.");
}

function omissions(payloadRequested: boolean): string[] {
  return payloadRequested
    ? ["Client Message bodies are redacted; raw transport text is omitted."]
    : ["Item Update payloads were not requested; Client Message bodies and raw transport text are omitted."];
}

function cloneCredentialSafe(value: unknown, depth = 0): unknown {
  if (depth > 16) return "[OMITTED:deeply-nested-data]";
  if (typeof value === "string" && /^[\s]*[\[{]/.test(value)) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object") return JSON.stringify(cloneCredentialSafe(parsed, depth + 1));
    } catch { /* Plain application text; no inferred secret detection. */ }
  }
  if (Array.isArray(value)) return value.map(entry => cloneCredentialSafe(entry, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(omitCredentialFields(value) as Record<string, unknown>).map(([key, entry]) => [key, cloneCredentialSafe(entry, depth + 1)]));
}
