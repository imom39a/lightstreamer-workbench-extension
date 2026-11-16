import type { EvidenceIdentity, EvidenceQueryWorkBudget, EvidenceReadPoint, EvidenceSequenceWindow } from "../core/evidence-filter-contract";
import type { EvidenceAggregateRequest, EvidenceFieldPredicate } from "../core/evidence-field-analytics";
import type { FilterAround } from "../core/filter-algebra";
import type { ScenarioAssertion } from "../core/local-injection-scenario";
import type { DiagnosticObservationBoundary } from "../core/diagnostic-observation";
import type { ExpandedJsonStringFieldValue } from "../core/json-string-fields";

/**
 * Static argument shapes for each MCP tool. They mirror the JSON Schemas in
 * protocol.ts: validateAgentCall() proves a value matches the schema (and its
 * cross-field rules) before a handler sees these types. Keep both in step.
 */
export type AgentScalarArgument = string | number | boolean | null;
export type AgentTypedDocumentArgument = Readonly<{ command: string | null; key: string | null; isSnapshot: boolean; fields: Readonly<Record<string, unknown>> }>;
export type AgentDocumentArgument = string | AgentTypedDocumentArgument;
export type AgentReadPointArgument = "LATEST_COMMITTED" | EvidenceReadPoint;
export type AgentFilterCriterionArgument = Readonly<{ facet: string; polarity: "include" | "exclude"; type: string; value: AgentScalarArgument; label?: string }>;
export type AgentFilterArgument = Readonly<{ text?: string; criteria?: readonly AgentFilterCriterionArgument[]; around?: FilterAround }>;
export type AgentDiscoveryArgument = Readonly<{ facet: string; search?: string; limit?: number; cursor?: string }>;
export type AgentWhereFacet = "kind" | "mode" | "key" | "operation" | "phase" | "provenance";
export type AgentWhereArgument = Readonly<Partial<Record<AgentWhereFacet, readonly string[]>>>;
export type AgentWithinArgument = "page" | "current-investigation";
export type AgentOrderArgument = "NEWEST_FIRST" | "OLDEST_FIRST";
export type AgentItemArgument = Readonly<{ name: string | null; position: number | null }>;
export type AgentProjectionArgument = "observed-server" | "local-effective";
export type AgentSourceArgument = Readonly<{ scopeId?: string; evidence?: EvidenceIdentity; document?: AgentDocumentArgument }>;
export type AgentStepArgument = AgentSourceArgument & Readonly<{ delayMs?: number }>;
export type AgentScenarioMemberArgument =
  | (AgentStepArgument & Readonly<{ kind: "step"; id: string }>)
  | Readonly<{ kind: "checkpoint"; id: string; name: string; assertions: readonly ScenarioAssertion[] }>;
export type AgentScenarioReplaceArgument = Readonly<{ scenarioId: string; revision: number }>;
export type AgentFacetArgument = string;

type Session = Readonly<{ panelSessionId: string }>;
type Budget = Readonly<{ maxBytes?: number }>;
type Paged = Readonly<{ offset?: number; limit?: number }>;

/** Every query option accepted by query_evidence. Other Evidence tools accept subsets. */
export type AgentQueryArguments = Readonly<{
  scopeId?: string;
  within?: AgentWithinArgument;
  text?: string;
  filter?: AgentFilterArgument;
  where?: AgentWhereArgument;
  fields?: readonly string[];
  workBudget?: EvidenceQueryWorkBudget;
  sequenceWindow?: EvidenceSequenceWindow;
  fieldPredicates?: readonly EvidenceFieldPredicate[];
  limit?: number;
  cursor?: string;
  includePayload?: boolean;
  order?: AgentOrderArgument;
  at?: AgentReadPointArgument;
  discover?: readonly AgentDiscoveryArgument[];
}> & Budget;

type CommandTarget = Readonly<{ scopeId?: string; pageEpoch?: string; projection?: AgentProjectionArgument; item?: AgentItemArgument; fields?: readonly string[] }> & Budget;
type ExactCommandTarget = Readonly<{ scopeId: string; pageEpoch: string; projection: AgentProjectionArgument; item: AgentItemArgument; fields?: readonly string[] }> & Budget;

type BundleQuery = Omit<AgentQueryArguments, "at" | "cursor" | "workBudget" | "maxBytes" | "discover">;
type BundleCommand = Readonly<{ scopeId: string; projection: AgentProjectionArgument; item: AgentItemArgument; fields?: readonly string[] }>;
export type AgentBundleOperationArgument =
  | Readonly<{ id: string; kind: "evidence"; args: BundleQuery }>
  | Readonly<{ id: string; kind: "summary"; args: Omit<BundleQuery, "fields" | "includePayload" | "order"> & Readonly<{ facet?: AgentFacetArgument }> }>
  | Readonly<{ id: string; kind: "aggregate"; args: Omit<BundleQuery, "fields" | "includePayload" | "order" | "limit"> & Readonly<{ aggregate: EvidenceAggregateRequest }> }>
  | Readonly<{ id: string; kind: "command-key"; args: BundleCommand & Readonly<{ key: string }> }>
  | Readonly<{ id: string; kind: "command-keys"; args: BundleCommand & Readonly<{ keys: readonly string[] }> }>
  | Readonly<{ id: string; kind: "command-rows"; args: BundleCommand & Readonly<{ limit?: number }> }>;

export type AgentToolArgumentMap = {
  list_panel_sessions: Paged & Budget;
  get_pairing_requests: Paged & Budget;
  confirm_pairing: Readonly<{ requestId: string; code: string }>;
  get_status: Session;
  list_scope: Session & Paged & Budget;
  search_scope: Session & Budget & Readonly<{ text?: string; kind?: "page" | "client" | "session" | "subscription" | "item" | "listener"; parentScopeId?: string; limit?: number; cursor?: string }>;
  get_scope: Session & Budget & Readonly<{ scopeId: string; fieldOffset?: number; fieldLimit?: number }>;
  read_bundle: Session & Budget & Readonly<{ pageEpoch: string; at?: AgentReadPointArgument; operations: readonly AgentBundleOperationArgument[]; workBudget?: EvidenceQueryWorkBudget }>;
  generate_agent_candidates: Session & Budget & Readonly<{
    pageEpoch: string; base: AgentSourceArgument; key?: string; keys?: readonly string[];
    commands?: readonly ("ADD" | "UPDATE" | "DELETE")[]; assignments?: Readonly<Record<string, readonly ExpandedJsonStringFieldValue[]>>; delaysMs?: readonly number[];
  }>;
  query_command_state: Session & ExactCommandTarget & Readonly<{ key: string }>;
  query_command_rows: Session & CommandTarget & Readonly<{ limit?: number; cursor?: string }>;
  query_command_keys: Session & ExactCommandTarget & Readonly<{ keys: readonly string[] }>;
  query_evidence: Session & AgentQueryArguments;
  search_evidence: Session & Budget & Pick<AgentQueryArguments, "text" | "within" | "scopeId" | "where" | "fields" | "workBudget" | "sequenceWindow" | "at" | "limit" | "cursor" | "includePayload">;
  summarize_evidence: Session & Omit<AgentQueryArguments, "discover" | "includePayload" | "fields" | "order"> & Readonly<{ facet?: AgentFacetArgument }>;
  aggregate_evidence: Session & Omit<AgentQueryArguments, "fields" | "includePayload" | "cursor" | "limit" | "discover" | "order"> & Readonly<{ aggregate: EvidenceAggregateRequest }>;
  describe_stream: Session & Omit<AgentQueryArguments, "cursor" | "discover" | "includePayload" | "within" | "where" | "fields">;
  wait_for_evidence: Session & Budget & Readonly<{
    after: EvidenceReadPoint; pageEpoch: string; timeoutMs?: number; scopeId?: string; text?: string; filter?: AgentFilterArgument;
    limit?: number; includePayload?: boolean; workBudget?: EvidenceQueryWorkBudget;
  }>;
  get_evidence: Session & Budget & Readonly<{ evidence: EvidenceIdentity; fields?: readonly string[]; includePayload?: boolean }>;
  query_diagnostics: Session & Budget & Readonly<{ after?: DiagnosticObservationBoundary; limit?: number }>;
  update_agent_document: Session & Budget & Readonly<{ token: string; document: AgentDocumentArgument; stepId?: string; requestId?: string }>;
  prepare_local_injection: Session & Budget & AgentSourceArgument & Readonly<{ pageEpoch: string; requestId?: string }>;
  prepare_server_injection: Session & Budget & Readonly<{
    pageEpoch: string; clientId: string; sessionId: string; message: string; sequence: string;
    delayTimeout: number | null; enqueueWhileDisconnected: boolean; requestId: string;
  }>;
  execute_server_injection: Session & Readonly<{ token: string; requestId: string }>;
  recover_server_injection: Session & Budget & Readonly<{ requestId?: string }>;
  abort_server_injection: Session & Readonly<{ token: string }>;
  execute_local_injection: Session & Readonly<{ token: string; requestId: string }>;
  get_operation: Session & Budget & Readonly<{ requestId: string }>;
  wait_for_operation: Session & Budget & Readonly<{ requestId: string; timeoutMs?: number }>;
  wait_for_scenario: Session & Budget & Readonly<{ runId: string; pageEpoch: string; afterRevision?: number; timeoutMs?: number }>;
  validate_agent_candidate: Session & Budget & Readonly<{ pageEpoch: string; draft?: AgentSourceArgument; members?: readonly AgentScenarioMemberArgument[]; replace?: AgentScenarioReplaceArgument }>;
  prepare_scenario: Session & Budget & Readonly<{ pageEpoch: string; members?: readonly AgentScenarioMemberArgument[]; steps?: readonly AgentStepArgument[]; replace?: AgentScenarioReplaceArgument; requestId?: string }>;
  recover_agent_document: Session & Budget & Readonly<{ requestId?: string }>;
  abort_agent_document: Session & Readonly<{ token: string }>;
  control_scenario: Session & Readonly<{ runId: string; requestId: string; action: "step" | "play" | "pause" | "stop" | "re-review" }>;
  get_scenario_trace: Session & Paged & Budget;
  finish_agent_document: Session & Readonly<{ token: string }>;
};

export type AgentToolArgumentName = keyof AgentToolArgumentMap;
export type AgentToolArguments<N extends AgentToolArgumentName> = AgentToolArgumentMap[N];
