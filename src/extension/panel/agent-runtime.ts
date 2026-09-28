import type { DiagnosticObservationBoundary, DiagnosticObservationRead } from "../../core/diagnostic-observation";
import type { WorkbenchLocalInjectionSnapshot, WorkbenchScenarioSnapshot } from "./workbench-runtime";
import type { EvidenceReadPoint, EvidenceIdentity, FacetDiscoveryRequest, EvidenceSnapshot } from "../../core/evidence-filter-contract";
import type { Filter } from "../../core/filter-algebra";
import type { ScenarioAssertion } from "../../core/local-injection-scenario";

export type AgentDraftInput = { scopeId?: string; evidence?: EvidenceIdentity; document?: string; delayMs?: number };
export type AgentScenarioMember =
  | Readonly<{ kind: "step"; id: string; scopeId?: string; evidence?: EvidenceIdentity; document?: string; delayMs?: number }>
  | Readonly<{ kind: "checkpoint"; id: string; name: string; assertions: readonly ScenarioAssertion[] }>;
export type AgentScenarioReplacement = Readonly<{ scenarioId: string; revision: number }>;
export type AgentScenarioPlanInput = Readonly<{ members: readonly AgentScenarioMember[]; replace?: AgentScenarioReplacement }>;
export type AgentCandidateInput = Readonly<{ kind: "draft"; draft: AgentDraftInput }> | Readonly<{ kind: "scenario"; plan: AgentScenarioPlanInput }>;
export type AgentQueryInput = Readonly<{
  scopeId?: string;
  text?: string;
  size: number;
  at: "LATEST_COMMITTED" | EvidenceReadPoint;
  cursor?: string;
  includePayload: boolean;
  lookup?: EvidenceIdentity;
  order?: "NEWEST_FIRST" | "OLDEST_FIRST";
  filter?: Filter;
  discover?: readonly FacetDiscoveryRequest[];
  signal?: AbortSignal;
}>;
/** Narrow internal seam. Transport validation and grant enforcement live outside the runtime. */
export interface AgentRuntime {
  status(): unknown;
  scopes(offset: number, limit: number): unknown;
  scope(id: string): unknown;
  query(input: AgentQueryInput): Promise<EvidenceSnapshot>;
  validateCandidate(input: AgentCandidateInput, pageEpoch: string, stillAuthorized: () => boolean): Promise<unknown>;
  prepareScenarioPlan(input: AgentScenarioPlanInput, pageEpoch: string, stillAuthorized: () => boolean): Promise<void>;
  subscribeEvidence?(listener: () => void): () => void;
  diagnostics(after?: DiagnosticObservationBoundary): Promise<DiagnosticObservationRead>;
  prepare(steps: AgentDraftInput[], scenario: boolean, pageEpoch: string, stillAuthorized: () => boolean): Promise<void>;
  edit(document: string, stepId?: string): void;
  local(): WorkbenchLocalInjectionSnapshot;
  scenario(): Pick<NonNullable<WorkbenchScenarioSnapshot>, "phase" | "scenario" | "run" | "runner" | "membershipError"> | null;
  execute(): void;
  control(action: "step" | "play" | "pause" | "stop" | "re-review"): void;
  finish(): void;
}
