import type { AgentCommandRowsInput, AgentCommandRowsResult } from "./agent-command-rows";
import type { AgentCommandStateInput, AgentCommandStateResult } from "./agent-command-state";
import type { EvidenceFindRequest, EvidenceIdentity, EvidenceReadPoint, EvidenceSnapshot, FacetDiscoveryRequest, EvidenceQueryWorkBudget, EvidenceSequenceWindow } from "../../core/evidence-filter-contract";
import type { DiagnosticObservationBoundary, DiagnosticObservationRead } from "../../core/diagnostic-observation";
import type { ScopeSearchNode } from "../../core/scope-search";
import type { Filter } from "../../core/filter-algebra";
import type { ScenarioAssertion } from "../../core/local-injection-scenario";
import type { StructuralEvidenceScope } from "./evidence-investigation-query";
import type { WorkbenchLocalInjectionSnapshot, WorkbenchScenarioSnapshot } from "./workbench-runtime";
import type { LocalInjectionTerminalRecord } from "./local-injection-execution-coordinator";
import type { LocalInjectionCandidateMatrixInput } from "../../core/local-injection-candidate-matrix";
import type { EvidenceFieldPredicate, EvidenceAggregateRequest } from "../../core/evidence-field-analytics";
import type { ServerInjectionDraft, ServerInjectionExecutionResult } from "../../core/server-injection";
export type AgentLocalSettlement = Omit<LocalInjectionTerminalRecord, "evidence"> & Readonly<{
  evidence: LocalInjectionTerminalRecord["evidence"] & Readonly<{ identity?: EvidenceIdentity | null; limitation?: string }>;
}>;

export type AgentDraftInput = { scopeId?: string; evidence?: EvidenceIdentity; document?: string; delayMs?: number };
export type AgentQueryBoundary = Readonly<{ scope: StructuralEvidenceScope; filter: Filter }>;
export type AgentScopeSearchSnapshot = Readonly<{
  pageEpoch: string | null;
  structureRevision: number;
  nodes: readonly ScopeSearchNode[];
  history: Readonly<{ intervalId: string; committedSequence: number | null; retainedFirstSequence: number | null }>;
}>;
export type AgentScenarioMember =
  | Readonly<{ kind: "step"; id: string; scopeId?: string; evidence?: EvidenceIdentity; document?: string; delayMs?: number }>
  | Readonly<{ kind: "checkpoint"; id: string; name: string; assertions: readonly ScenarioAssertion[] }>;
export type AgentScenarioReplacement = Readonly<{ scenarioId: string; revision: number }>;
export type AgentScenarioPlanInput = Readonly<{ members: readonly AgentScenarioMember[]; replace?: AgentScenarioReplacement }>;
export type AgentServerInjectionInput = Readonly<ServerInjectionDraft>;
export type AgentCandidateInput = Readonly<{ kind: "draft"; draft: AgentDraftInput }> | Readonly<{ kind: "scenario"; plan: AgentScenarioPlanInput }>;
export type AgentCandidateMatrixInput = Pick<LocalInjectionCandidateMatrixInput, "key" | "keys" | "commands" | "assignments" | "delaysMs"> & Readonly<{ base: AgentDraftInput }>;
export type AgentQueryInput = Readonly<{
  scopeId?: string;
  scope?: StructuralEvidenceScope;
  text?: string;
  size: number;
  adaptivePage?: boolean;
  at: "LATEST_COMMITTED" | EvidenceReadPoint;
  cursor?: string;
  includePayload: boolean;
  lookup?: EvidenceIdentity;
  find?: EvidenceFindRequest;
  order?: "NEWEST_FIRST" | "OLDEST_FIRST";
  filter?: Filter;
  discover?: readonly FacetDiscoveryRequest[];
  signal?: AbortSignal;
  workBudget?: EvidenceQueryWorkBudget;
  sequenceWindow?: EvidenceSequenceWindow;
  fieldPredicates?: readonly EvidenceFieldPredicate[];
  aggregate?: EvidenceAggregateRequest;
}>;
/** Narrow internal seam. Transport validation and grant enforcement live outside the runtime. */
export interface AgentRuntime {
  status(): unknown;
  commandState?(input: AgentCommandStateInput): AgentCommandStateResult;
  commandRows?(input: AgentCommandRowsInput): AgentCommandRowsResult;
  scopes(offset: number, limit: number): unknown;
  scopeSearchSnapshot(): AgentScopeSearchSnapshot;
  scope(id: string): unknown;
  queryBoundary(scopeId?: string, useCurrentInvestigation?: boolean): AgentQueryBoundary;
  query(input: AgentQueryInput): Promise<EvidenceSnapshot>;
  validateCandidate(input: AgentCandidateInput, pageEpoch: string, stillAuthorized: () => boolean): Promise<unknown>;
  generateCandidates?(input: AgentCandidateMatrixInput, pageEpoch: string, stillAuthorized: () => boolean): Promise<unknown>;
  prepareScenarioPlan(input: AgentScenarioPlanInput, pageEpoch: string, stillAuthorized: () => boolean): Promise<void>;
  subscribeEvidence?(listener: () => void): () => void;
  subscribeOperations?(listener: () => void): () => void;
  diagnostics(after?: DiagnosticObservationBoundary, signal?: AbortSignal): Promise<DiagnosticObservationRead>;
  prepare(steps: AgentDraftInput[], scenario: boolean, pageEpoch: string, stillAuthorized: () => boolean): Promise<void>;
  edit(document: string, stepId?: string): void;
  local(): WorkbenchLocalInjectionSnapshot;
  scenario(): Pick<NonNullable<WorkbenchScenarioSnapshot>, "phase" | "scenario" | "run" | "runner" | "membershipError"> | null;
  execute(): void;
  localSettlement?(executionId: string): AgentLocalSettlement | null;
  control(action: "step" | "play" | "pause" | "stop" | "re-review"): void;
  finish(): void;
  /** Service guards the exact unchanged, unexecuted agent-owned version first. */
  abortDocument?(): void;
  /** Publishes an agent-owned Server Injection draft; this never approves or sends it. */
  prepareServerInjection?(draft: AgentServerInjectionInput, requestId: string): void;
  serverInjection?(): unknown;
  /** Executes only after a separate panel click approved the current exact fingerprint. */
  executeApprovedServerInjection?(requestId: string): Promise<ServerInjectionExecutionResult>;
  abortServerInjection?(requestId: string): void;
  revokeServerInjectionApproval?(): void;
}
