import { AGENT_PROTOCOL_VERSION, AGENT_READ_CONTRACT, AGENT_RESPONSE_CONTRACT, AGENT_TOOLS } from "../../../agent/protocol";
import { agentToolResultBytes } from "../../../agent/tool-result";
import { createScopeSearchIndex, searchScopes, type ScopeSearchNode } from "../../../core/scope-search";
import { projectAgentStatus } from "./compaction";
import { SEARCH_CURSOR_LIFETIME_MS, type AgentServiceContext, type AgentToolHandlers, type ScopeSearch } from "./context";
import { cloneCredentialSafe } from "./redaction";

/** Status, structural Scope reads and Diagnostic Observations. */
export function createScopeHandlers(context: AgentServiceContext): AgentToolHandlers {
  const { runtime, panelSessionId, permission, state, fingerprint } = context;
  const { requests, documentRequests, waits, scopeSearches, scopeCursors } = state;
  return {
    get_status() {
      const prepared = state.prepared;
      return { protocolVersion: AGENT_PROTOCOL_VERSION, readContract: AGENT_READ_CONTRACT, responseContract: AGENT_RESPONSE_CONTRACT, panelSessionId, permission: permission(), ...projectAgentStatus(runtime.status()),
        serviceCapacity: { operations: { limit: 256, remaining: Math.max(0, 256 - requests.size), emergencyPauseStop: 2 }, documents: { limit: 128, remaining: 128 - documentRequests.size, byteLimit: 8 * 1024 * 1024, bytes: state.documentRequestBytes }, waits: { limit: 4, remaining: 4 - waits.size }, documentPreparing: state.busy, document: prepared ? { kind: prepared.kind, consumed: prepared.consumed, unchanged: prepared.fingerprint === fingerprint(prepared.kind === "scenario") } : null },
        capabilities: AGENT_TOOLS.filter(tool => !["list_panel_sessions", "get_pairing_requests", "confirm_pairing"].includes(tool.name) && (!tool.mutation || permission() === "local") &&
          (!(["recover_agent_document", "recover_server_injection"].includes(tool.name)) || permission() === "local") &&
          (tool.name !== "validate_agent_candidate" || typeof runtime.validateCandidate === "function") &&
          (tool.name !== "prepare_scenario" || typeof runtime.prepareScenarioPlan === "function") &&
          (tool.name !== "query_command_state" || typeof runtime.commandState === "function") &&
          (tool.name !== "query_command_rows" || typeof runtime.commandRows === "function") &&
          (tool.name !== "query_command_keys" || typeof runtime.commandState === "function") &&
          (tool.name !== "generate_agent_candidates" || typeof runtime.generateCandidates === "function") &&
          (tool.name !== "wait_for_scenario" || typeof runtime.subscribeOperations === "function") &&
          (tool.name !== "wait_for_evidence" || typeof runtime.subscribeEvidence === "function") &&
          (tool.name !== "abort_agent_document" || typeof runtime.abortDocument === "function") &&
          (tool.name !== "prepare_server_injection" || typeof runtime.prepareServerInjection === "function") &&
          (tool.name !== "execute_server_injection" || typeof runtime.executeApprovedServerInjection === "function") &&
          (tool.name !== "recover_server_injection" || typeof runtime.serverInjection === "function") &&
          (tool.name !== "abort_server_injection" || typeof runtime.abortServerInjection === "function")).map(tool => tool.name) };
    },
    list_scope(args) {
      const offset = args.offset ?? 0;
      const requested = args.limit ?? 50;
      const budget = args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes;
      let size = requested;
      for (;;) {
        const page = runtime.scopes(offset, size);
        const response = { ...page, nextOffset: offset + page.nodes.length < page.total ? offset + page.nodes.length : null };
        if (agentToolResultBytes(response) <= budget) return response;
        if (size <= 1) throw new Error("RESULT_BUDGET_EXCEEDED: One Scope exceeds maxBytes. Use search_scope to locate an exact Scope.");
        size = Math.max(1, Math.floor(size / 2));
      }
    },
    search_scope(args) {
      const saved = args.cursor ? scopeCursors.get(args.cursor) : undefined;
      if (args.cursor && !saved) throw new Error("CURSOR_EXPIRED: Search cursor expired. Start a new search.");
      const searchId = saved?.searchId ?? crypto.randomUUID();
      let search: ScopeSearch | undefined = saved ? scopeSearches.get(searchId) : undefined;
      if (saved) {
        if (!search || search.expiresAt <= Date.now()) throw new Error("CURSOR_EXPIRED: Search cursor expired. Start a new search.");
        const status = runtime.status();
        const first = search.snapshot.history.retainedFirstSequence;
        if (status.pageEpoch !== search.snapshot.pageEpoch || status.history.interval.id !== search.snapshot.history.intervalId
          || (first !== null && (status.history.retainedRange === null || status.history.retainedRange.first.sequence > first))) {
          throw new Error("CURSOR_EXPIRED: Scope search snapshot expired after page change, Clear or retention. Start a new search.");
        }
      } else {
        const { nodes, ...snapshot } = runtime.scopeSearchSnapshot();
        const cache = state.scopeIndexCache;
        if (!cache || cache.pageEpoch !== snapshot.pageEpoch || cache.structureRevision !== snapshot.structureRevision || cache.nodes !== nodes) {
          state.scopeIndexCache = { pageEpoch: snapshot.pageEpoch, structureRevision: snapshot.structureRevision, nodes,
            index: createScopeSearchIndex(cloneCredentialSafe(nodes) as readonly ScopeSearchNode[]) };
        }
        const index = state.scopeIndexCache!.index;
        const entries = args.kind === undefined && args.parentScopeId === undefined ? index.entries : index.entries.filter(entry => (args.kind === undefined || entry.node.kind === args.kind) && (args.parentScopeId === undefined || entry.node.parentId === args.parentScopeId));
        search = { index: { entries, totalNodes: entries.length }, snapshot, text: args.text!.trim(), size: args.limit ?? 25, maxBytes: args.maxBytes ?? AGENT_READ_CONTRACT.defaultMaxBytes, kind: args.kind, parentScopeId: args.parentScopeId, expiresAt: Date.now() + SEARCH_CURSOR_LIFETIME_MS };
      }
      const active = search;
      let size = active.size;
      let result = searchScopes(active.index, active.text, { offset: saved?.offset ?? 0, limit: size });
      const response = () => ({ snapshot: active.snapshot, boundary: "ALL_STRUCTURAL_TOPOLOGY", match: "CASE_INSENSITIVE_SUBSTRING", text: active.text, kind: active.kind, parentScopeId: active.parentScopeId, total: result.total, offset: result.offset, nextCursor: result.hasNext ? "00000000-0000-0000-0000-000000000000" : null, scopes: result.matches.map(({ node, path, ancestorIds, matchedFields }) => ({ scopeId: node.id, kind: node.kind, label: node.label, detail: node.detail, lifecycle: node.lifecycle, retired: node.retired, path, ancestorIds, matchedFields })) });
      while (agentToolResultBytes(response()) > active.maxBytes) {
        if (size <= 1) throw new Error("RESULT_BUDGET_EXCEEDED: One Scope match exceeds maxBytes. Narrow search or start fresh without cursor to change options.");
        size = Math.max(1, Math.floor(size / 2));
        result = searchScopes(active.index, active.text, { offset: saved?.offset ?? 0, limit: size });
      }
      active.size = size;
      let nextCursor: string | null = null;
      if (result.hasNext) {
        scopeSearches.set(searchId, active);
        nextCursor = crypto.randomUUID();
        scopeCursors.set(nextCursor, { searchId, offset: result.offset + result.matches.length });
      }
      return { ...response(), nextCursor };
    },
    get_scope(args) {
      return cloneCredentialSafe(runtime.scope(args.scopeId, { fieldOffset: args.fieldOffset ?? 0, fieldLimit: args.fieldLimit ?? 32 }));
    },
    async query_diagnostics(args, signal) {
      const result = await runtime.diagnostics(args.after, signal);
      const budget = args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes;
      let size = args.limit ?? 50;
      for (;;) {
        const observations = result.observations.slice(0, size);
        const truncated = observations.length < result.observations.length;
        const response = cloneCredentialSafe({ ...result, observations, truncated, nextAfter: truncated && observations.length ? observations.at(-1)!.observationBoundary : null });
        if (agentToolResultBytes(response) <= budget) return response;
        if (size <= 1) throw new Error("RESULT_BUDGET_EXCEEDED: One Diagnostic Observation exceeds the response budget.");
        size = Math.max(1, Math.floor(size / 2));
      }
    }
  };
}
