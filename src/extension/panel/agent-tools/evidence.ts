import { AGENT_READ_CONTRACT, AGENT_RESPONSE_CONTRACT, type AgentArguments } from "../../../agent/protocol";
import { agentToolFailure, agentToolResultBytes } from "../../../agent/tool-result";
import { createFilter, type DeterministicEvidenceRecord, type EvidenceReadPoint } from "../../../core/evidence-filter-contract";
import { reanchorFacetDiscoveryCursor } from "../../../core/evidence-filter-discovery";
import { describeAgentStreams } from "../agent-stream-description";
import { waitForAgentEvidence } from "../agent-evidence-wait";
import type { AgentQueryInput } from "../agent-runtime";
import { projectAgentStatus } from "./compaction";
import { DEFAULT_QUERY_WORK, SEARCH_CURSOR_LIFETIME_MS, assertNotCancelled, beginAgentWait, type AgentServiceContext, type AgentToolHandlers } from "./context";
import { fitAgentPrefix, makeQuery, makeReadQuery, omissions, shortenedEvidenceCursor } from "./query";
import { boundedRecords, cloneCredentialSafe, compactWaitEvidence, projectReadRecord, safeMatchExplanation, safeRecord } from "./redaction";

const BUNDLE_TOOLS = { evidence: "query_evidence", summary: "summarize_evidence", aggregate: "aggregate_evidence", "command-key": "query_command_state", "command-keys": "query_command_keys", "command-rows": "query_command_rows" } as const;

/** Read-only Evidence queries, searches, summaries, profiles and waits. */
export function createEvidenceHandlers(context: AgentServiceContext): AgentToolHandlers {
  const { runtime, panelSessionId, state, guardedQuery, saveNextCursor, dispatch } = context;
  const { cursors, evidenceSearches, summaries, commandRowCursors, waits } = state;
  return {
    async read_bundle(args, signal) {
      const budget = args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes;
      const operations = args.operations;
      const epoch = args.pageEpoch;
      const checkPage = () => { assertNotCancelled(signal); if (runtime.status().pageEpoch !== epoch) throw new Error("TARGET_CHANGED: The inspected page changed during this read bundle."); };
      checkPage();
      const frozen = await guardedQuery({ at: args.at ?? "LATEST_COMMITTED", scope: { kind: "NONE" }, filter: createFilter(), size: 1, includePayload: false }, signal);
      const readPoint = frozen.readPoint;
      const sameBoundary = (point: EvidenceReadPoint) => JSON.stringify([point.interval, point.committedEvidenceBoundary]) === JSON.stringify([readPoint.interval, readPoint.committedEvidenceBoundary]);
      const perRead = Math.max(4096, Math.floor((budget - 2048) / operations.length));
      const createdCursors: string[] = [];
      const results: { id: string; kind: string; status: string; result?: unknown; error?: unknown }[] = [];
      const started = performance.now();
      const workBudget = args.workBudget ?? DEFAULT_QUERY_WORK;
      try {
        for (const operation of operations) {
          checkPage();
          const deadlineMs = (workBudget.deadlineMs ?? DEFAULT_QUERY_WORK.deadlineMs) - (performance.now() - started);
          if (deadlineMs < 1) throw new Error("QUERY_WORK_BUDGET_EXCEEDED: The read bundle reached its elapsed work limit.");
          const name = BUNDLE_TOOLS[operation.kind];
          if (!name) throw new Error("INVALID_ARGUMENT: Unsupported operation in read-only bundle.");
          const options: AgentArguments = { ...operation.args, panelSessionId, maxBytes: perRead,
            ...(operation.kind.startsWith("command-") ? { pageEpoch: epoch } : { at: readPoint, workBudget: { ...workBudget, deadlineMs: Math.max(1, Math.floor(deadlineMs)) } }) };
          try {
            const result = await dispatch(name, options, signal) as { readPoint?: EvidenceReadPoint; nextCursor?: unknown };
            checkPage();
            if (typeof result.nextCursor === "string") createdCursors.push(result.nextCursor);
            if (!result.readPoint || !sameBoundary(result.readPoint)) {
              if (typeof result.nextCursor === "string" && result.nextCursor) { commandRowCursors.delete(result.nextCursor); cursors.delete(result.nextCursor); summaries.delete(result.nextCursor); }
              results.push({ id: operation.id, kind: operation.kind, status: "ALIGNMENT_UNAVAILABLE", error: { code: "READ_BOUNDARY_UNALIGNED", message: "The live projection does not represent this frozen Evidence boundary. Read it separately or start a fresh bundle." } });
            } else results.push({ id: operation.id, kind: operation.kind, status: "OK", result });
          } catch (error) {
            checkPage();
            results.push({ id: operation.id, kind: operation.kind, status: "ERROR", error: agentToolFailure(error).structuredContent.error });
          }
        }
        const response = { status: results.every(result => result.status === "OK") ? "COMPLETE" : "LIMITED", readPoint, pageEpoch: epoch, results,
          work: { maxReads: operations.length, perRead: workBudget }, limitations: ["Every successful result shares this frozen committed Evidence boundary. A live projection that cannot align returns no state.", "Reads are sequential and bounded; the bundle performs no document, Capture or delivery operation."] };
        if (agentToolResultBytes(response) > budget) throw new Error("RESULT_BUDGET_EXCEEDED: The complete read bundle exceeds maxBytes. Use fewer operations/fields or a larger bounded budget.");
        return response;
      } catch (error) {
        for (const cursor of createdCursors) { commandRowCursors.delete(cursor); cursors.delete(cursor); summaries.delete(cursor); }
        throw error;
      }
    },
    async search_evidence(args, signal) {
      const saved = args.cursor ? evidenceSearches.get(args.cursor) : undefined;
      if (args.cursor && (!saved || saved.expiresAt <= Date.now())) throw new Error("CURSOR_EXPIRED: Search cursor expired. Start a new search.");
      const pageEpoch = runtime.status().pageEpoch;
      if (saved && saved.pageEpoch !== pageEpoch) throw new Error("CURSOR_EXPIRED: Search cursor expired after page change. Start a new search.");
      const within = saved?.within ?? (args.within === "current-investigation" ? "current-investigation" : "page");
      if (!saved && within === "current-investigation" && args.where !== undefined) throw new Error("INVALID_ARGUMENT: current-investigation already owns its Filter; start fresh with an explicit scopeId or within:page to add where.");
      const boundary = saved?.boundary ?? structuredClone(runtime.queryBoundary(args.scopeId, within === "current-investigation"));
      // Without a cursor, validateAgentCall requires non-blank search text.
      const text = saved?.text ?? args.text!.trim();
      const size = saved?.size ?? args.limit ?? 25;
      const includePayload = saved?.includePayload ?? args.includePayload === true;
      const fields = saved?.fields ?? args.fields;
      const maxBytes = saved?.maxBytes ?? args.maxBytes ?? AGENT_READ_CONTRACT.defaultMaxBytes;
      const readFilter = saved ? boundary.filter : makeReadQuery(runtime, within === "current-investigation" ? { ...args, text: undefined } : args).filter ?? boundary.filter;
      const searchBoundary = { ...boundary, filter: readFilter };
      const at: EvidenceReadPoint | "LATEST_COMMITTED" = saved?.at ?? args.at ?? "LATEST_COMMITTED";
      const queryOptions = saved?.queryOptions ?? { sequenceWindow: args.sequenceWindow, workBudget: args.workBudget };
      const result = await guardedQuery({ ...searchBoundary, ...queryOptions, at, size: 1, includePayload: includePayload || Boolean(fields?.length), find: { text, scopeToFilter: true, reveal: false, size, ...(saved ? { after: saved.after } : {}) } }, signal);
      if (result.evaluation !== "COMPLETE") throw new Error("UNSUPPORTED_FILTER: Evidence search cannot evaluate this investigation. Remove the unsupported Filter criterion or explicitly search within: page.");
      const found = result.find;
      if (!found) throw new Error("Evidence search is unavailable at this read point.");
      const records = found.results ?? [];
      const evidence = records.map(record => { const projected = projectReadRecord(record, includePayload, fields); return { ...projected, match: safeMatchExplanation(projected, text, fields?.length ? "NO_MATCH_IN_REQUESTED_FIELDS" : includePayload ? "NO_MATCH_IN_SHAREABLE_REPRESENTATION" : "PAYLOAD_NOT_REQUESTED") }; });
      const hasMore = (count: number) => found.hasMore || count < records.length;
      const scopeId = saved?.scopeId ?? args.scopeId;
      const response = (count: number) => ({ search: { text, within, ...(scopeId ? { scopeId } : {}), match: "CASE_INSENSITIVE_SUBSTRING", order: "OLDEST_FIRST" }, matchExplanation: "Excerpts inspect returned fields only. No excerpt does not establish redaction or identity. Use get_evidence with selected fields, or prepare_local_injection from the exact identity to inspect its editable Draft.", readPoint: result.readPoint, total: found.total, totals: result.totals, coverage: result.coverage, evaluation: result.evaluation, storage: result.storage, nextCursor: hasMore(count) && count > 0 ? "00000000-0000-0000-0000-000000000000" : null, evidence: evidence.slice(0, count) });
      // Storage already latched the complete count/read point and one bounded
      // match page. Fit its longest permitted prefix in memory; shrinking the
      // response must never rescan history or advance past unreturned matches.
      let count = evidence.length;
      if (agentToolResultBytes(response(count)) > maxBytes) {
        let low = 1, high = count, fitted = 0;
        while (low <= high) {
          assertNotCancelled(signal);
          const middle = Math.floor((low + high) / 2);
          if (agentToolResultBytes(response(middle)) <= maxBytes) { fitted = middle; low = middle + 1; }
          else high = middle - 1;
        }
        if (!fitted) throw new Error("RESULT_BUDGET_EXCEEDED: One search match or search metadata exceeds maxBytes. Request fewer fields or narrow the search; start fresh without cursor to change options.");
        count = fitted;
      }
      assertNotCancelled(signal);
      let nextCursor: string | null = null;
      if (hasMore(count) && count > 0) {
        nextCursor = crypto.randomUUID();
        evidenceSearches.set(nextCursor, { boundary: searchBoundary, queryOptions, within, scopeId, text, size, includePayload, fields, maxBytes, pageEpoch, at: result.readPoint, after: records[count - 1]!.identity, expiresAt: saved?.expiresAt ?? Date.now() + SEARCH_CURSOR_LIFETIME_MS });
      }
      return { ...response(count), nextCursor };
    },
    async query_evidence(args, signal) {
      let query = makeReadQuery(runtime, args);
      let fields = args.fields;
      let maxBytes = args.maxBytes ?? AGENT_READ_CONTRACT.defaultMaxBytes;
      if (args.cursor) {
        const suppliedQueryKeys = Object.keys(args).filter(key => !["panelSessionId", "cursor"].includes(key));
        if (suppliedQueryKeys.length) throw new Error("Continue a query with only its cursor; query arguments are bound to the first page.");
        const saved = cursors.get(args.cursor);
        if (!saved) throw new Error("CURSOR_EXPIRED: Query cursor expired. Start a new query.");
        if (saved.pageEpoch !== runtime.status().pageEpoch) throw new Error("CURSOR_EXPIRED: Query cursor expired after page change. Start fresh without cursor.");
        query = { ...saved.query!, at: saved.at, cursor: saved.cursor };
        fields = saved.fields;
        maxBytes = saved.maxBytes ?? maxBytes;
      }
      const result = await guardedQuery({ ...query, includePayload: query.includePayload || Boolean(fields?.length) }, signal);
      if (args.within === "current-investigation" && result.evaluation !== "COMPLETE") throw new Error("UNSUPPORTED_FILTER: The current investigation cannot be evaluated completely. Start fresh with within:page or an exact scopeId before making a count or absence claim.");
      const records = result.page.evidence.map(record => projectReadRecord(record, query.includePayload, fields));
      const metadata = { readPoint: result.readPoint, totals: result.totals, coverage: result.coverage, evaluation: result.evaluation, storage: result.storage,
        ...(result.fieldEvaluation ? { fieldEvaluation: result.fieldEvaluation } : {}), ...(result.aggregate ? { aggregate: cloneCredentialSafe(result.aggregate) } : {}),
        ...(query.sequenceWindow ? { sequenceWindow: { after: query.sequenceWindow.after, through: query.sequenceWindow.through ?? result.readPoint.committedEvidenceBoundary?.sequence ?? 0 } } : {}),
        discoveries: cloneCredentialSafe(Object.fromEntries([...result.discoveries].map(([key, value]) => { const { resumeCursor: _resume, ...visible } = value as typeof value & { resumeCursor?: string }; return [key, visible]; }))), omissions: omissions(query.includePayload) };
      const response = (count: number) => ({ ...metadata, evidence: records.slice(0, count), nextCursor: count < records.length || result.page.nextCursor ? "00000000-0000-0000-0000-000000000000" : null });
      const count = fitAgentPrefix(records.length, maxBytes, response, "One Evidence record or query metadata exceeds maxBytes. Narrow the query or request fewer fields.");
      const canonical = shortenedEvidenceCursor(result, count);
      return { ...response(count), nextCursor: saveNextCursor(query, result.readPoint, canonical, fields, maxBytes) };
    },
    async summarize_evidence(args, signal) {
      const saved = args.cursor ? summaries.get(args.cursor) : undefined;
      if (args.cursor && (!saved || saved.pageEpoch !== runtime.status().pageEpoch)) throw new Error("CURSOR_EXPIRED: Summary cursor expired. Start fresh without cursor.");
      const query = saved?.query ?? makeReadQuery(runtime, args);
      const facet = saved?.facet ?? args.facet;
      const maxBytes = saved?.maxBytes ?? args.maxBytes ?? AGENT_READ_CONTRACT.defaultMaxBytes;
      const effective = saved ? { ...query, at: saved.at } : query;
      const size = saved?.limit ?? args.limit ?? 25;
      const discovery = facet ? [{ facet, size, scopeToFilter: true, ...(saved ? { cursor: saved.cursor } : {}) }] : undefined;
      const result = await guardedQuery({ ...effective, size: 1, includePayload: false, ...(discovery ? { discover: discovery } : {}) }, signal);
      if (args.within === "current-investigation" && result.evaluation !== "COMPLETE") throw new Error("UNSUPPORTED_FILTER: The current investigation cannot be evaluated completely. Start fresh with within:page or an exact scopeId before making a count or absence claim.");
      const found = facet ? result.discoveries.get(facet) : undefined;
      const values = found?.values.map(entry => ({ value: { facet: entry.value.facet, type: entry.value.type, value: entry.value.value, label: entry.value.label }, count: entry.count })) ?? [];
      const response = (count: number) => ({ readPoint: result.readPoint, totals: result.totals, coverage: result.coverage, evaluation: result.evaluation, storage: result.storage,
        countMeaning: "Evidence records, not current COMMAND rows", values: values.slice(0, count), distinctTotal: found?.distinctTotal ?? null,
        ...(facet ? { facet, discoveryState: found?.state ?? "UNAVAILABLE", baseEvidenceCount: found?.baseEvidenceCount ?? null, ...(found?.state === "UNAVAILABLE" ? { reason: found.reason } : {}) } : {}), nextCursor: count < values.length || found?.nextCursor ? "00000000-0000-0000-0000-000000000000" : null as string | null });
      const count = fitAgentPrefix(values.length, maxBytes, response, "One summary value or its metadata exceeds maxBytes. Narrow the query or request fewer facet values.");
      let continuation = found?.nextCursor ?? null;
      if (count < values.length && found?.state === "AVAILABLE") {
        const resume = found.resumeCursor ?? found.nextCursor;
        if (!resume) throw new Error("UNSUPPORTED_CAPABILITY: This history build cannot fit terminal summary pages without losing values.");
        continuation = reanchorFacetDiscoveryCursor(resume, found.values.slice(0, count), values.length - count);
      }
      const fitted = response(count);
      if (continuation) {
        fitted.nextCursor = crypto.randomUUID();
        summaries.set(fitted.nextCursor, { query: effective, facet: facet!, cursor: continuation, limit: size, maxBytes, at: result.readPoint, pageEpoch: runtime.status().pageEpoch });
      }
      return fitted;
    },
    async describe_stream(args, signal) {
      const query = makeQuery(args, 100, true, "NEWEST_FIRST");
      const budget = args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes;
      if (query.size > 100) throw new Error("Stream descriptions are limited to 100 Evidence records per read point.");
      if ((args as AgentArguments).cursor) throw new Error("describe_stream summarizes one bounded sample; use query_evidence to continue pages.");
      const result = await guardedQuery(query, signal);
      const allRecords = boundedRecords(result.page.evidence) as DeterministicEvidenceRecord[];
      const response = (count: number) => {
        const records = allRecords.slice(0, count);
        const sampled = records.length;
        const completeSample = count === allRecords.length && result.evaluation === "COMPLETE" && result.coverage === "COMPLETE" && sampled >= result.totals.matching && result.page.nextCursor === null && records.every(record => record.payload !== undefined);
        const profile = describeAgentStreams({ records, limit: Math.max(1, count), readPoint: result.readPoint, completeness: completeSample ? "COMPLETE" : "LIMITED", window: query.order ?? "NEWEST_FIRST" });
        const current = projectAgentStatus(runtime.status());
        return { ...profile, readPoint: result.readPoint, matchingTotal: result.totals.matching, sampled, completeness: profile.completeness,
          nextCursor: count < allRecords.length || result.page.nextCursor ? "00000000-0000-0000-0000-000000000000" : null,
          observationCoverage: current.capture.coverage,
          history: { phase: current.history.phase, retained: current.history.retained, retention: current.history.retention, continuity: current.history.continuity },
          omissions: [...omissions(true), ...(completeSample ? [] : ["The sample or its payload budget is incomplete. Use query_evidence with nextCursor when present, or narrow the query to inspect omitted payloads."])] };
      };
      const minimumBytes = agentToolResultBytes(response(Math.min(1, allRecords.length)));
      if (minimumBytes > budget) {
        const recovery = minimumBytes <= AGENT_READ_CONTRACT.maxBytes
          ? `Retry describe_stream with maxBytes:${Math.ceil(minimumBytes / 1024) * 1024}, or read selected fields with query_evidence.`
          : "Profile exceeds 65536 bytes. Narrow to one item or read selected fields with query_evidence.";
        throw new Error(`RESULT_BUDGET_EXCEEDED: Minimum profile requires ${minimumBytes} bytes; budget ${budget}. ${recovery}`);
      }
      const count = fitAgentPrefix(allRecords.length, budget, response, "One stream description exceeds maxBytes. Inspect selected fields with query_evidence.");
      return { ...response(count), nextCursor: saveNextCursor({ ...query, includePayload: false }, result.readPoint, shortenedEvidenceCursor(result, count)) };
    },
    async wait_for_evidence(args, signal) {
      const budget = args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes;
      if (!runtime.subscribeEvidence) throw new Error("Evidence observation is unavailable in this panel build.");
      if (waits.size >= 4) throw new Error("REQUEST_CAPACITY: At most four Evidence or operation waits may run concurrently per Panel Session.");
      const wait = beginAgentWait(state, signal, true);
      try {
        const query = makeQuery({ ...args, order: "NEWEST_FIRST" });
        const result = await waitForAgentEvidence({
          status: () => runtime.status(),
          subscribe: listener => runtime.subscribeEvidence!(listener),
          query: (readSignal, sequenceWindow) => runtime.query({ ...query, at: "LATEST_COMMITTED", sequenceWindow, workBudget: query.workBudget ?? DEFAULT_QUERY_WORK, signal: readSignal })
        }, { after: args.after, pageEpoch: args.pageEpoch, timeoutMs: args.timeoutMs ?? 10000, signal: wait.controller.signal });
        let evidence = result.evidence.map(record => query.includePayload ? safeRecord(record, 64 * 1024) : compactWaitEvidence(record, args));
        let response = { ...result, evidence, omissions: omissions(query.includePayload) };
        while (agentToolResultBytes(response) > budget && evidence.length > 1) {
          evidence = evidence.slice(0, Math.max(1, Math.floor(evidence.length / 2)));
          response = { ...response, evidence, mayHaveMoreMatches: true };
        }
        if (agentToolResultBytes(response) > budget && query.includePayload && evidence.length) {
          const first = result.evidence[0]!;
          evidence = [compactWaitEvidence(first, args)];
          response = { ...response, evidence, mayHaveMoreMatches: true,
            omissions: [...response.omissions, "Matched Evidence payload exceeded the response budget. Use get_evidence with an explicit maxBytes for this identity."] };
        }
        if (agentToolResultBytes(response) > budget && evidence.length) {
          const first = result.evidence[0]!;
          response = { ...response, evidence: [{ identity: first.identity, timestamp: first.timestamp, facets: {} }], mayHaveMoreMatches: true,
            omissions: [...response.omissions, "Matched Evidence facets exceeded the response budget. Use get_evidence for this identity."] };
        }
        return response;
      } finally { wait.end(); }
    },
    async aggregate_evidence(args, signal) {
      const query = makeReadQuery(runtime, { ...args, limit: 1 });
      const result = await guardedQuery({ ...query, aggregate: args.aggregate, discover: [], includePayload: false }, signal);
      if (result.evaluation !== "COMPLETE") throw new Error("UNSUPPORTED_FILTER: Field aggregation requires a completely evaluable Filter.");
      return cloneCredentialSafe({ readPoint: result.readPoint, totals: result.totals, coverage: result.coverage,
        evaluation: result.evaluation, storage: result.storage, fieldEvaluation: result.fieldEvaluation, aggregate: result.aggregate,
        ...(query.sequenceWindow ? { sequenceWindow: { after: query.sequenceWindow.after, through: query.sequenceWindow.through ?? result.readPoint.committedEvidenceBoundary?.sequence ?? 0 } } : {}),
        limitations: ["Counts cover retained matching Evidence through this boundary, subject to reported Coverage.", "Only declared Item Update fields are evaluated. Credential fields and ambiguous/unavailable values never compare as concrete.", "Distinct logical updates exclude Item Updates with missing logicalEventId; missingLogicalIds reports their Evidence-record count."] });
    },
    async get_evidence(args, signal) {
      const includePayload = args.includePayload === true;
      const fields = args.fields;
      const result = await guardedQuery({ at: "LATEST_COMMITTED", size: 1, includePayload: includePayload || Boolean(fields?.length), lookup: args.evidence }, signal);
      const response = { readPoint: result.readPoint, coverage: result.coverage, lookup: result.lookup?.state === "RETAINED" ? { state: "RETAINED", evidence: projectReadRecord(result.lookup.evidence, includePayload, fields) } : result.lookup };
      const requiredBytes = agentToolResultBytes(response);
      const budget = args.maxBytes ?? AGENT_READ_CONTRACT.defaultMaxBytes;
      if (requiredBytes > budget) {
        const recovery = requiredBytes <= AGENT_READ_CONTRACT.maxBytes
          ? `Retry get_evidence with maxBytes:${Math.ceil(requiredBytes / 1024) * 1024}, or select fewer fields.`
          : "Select fewer fields or omit payload; this exceeds the maximum 65536-byte response. Inspect the exact Evidence in Workbench.";
        throw new Error(`RESULT_BUDGET_EXCEEDED: Exact Evidence requires ${requiredBytes} bytes; budget ${budget}. ${recovery}`);
      }
      return response;
    }
  };
}
