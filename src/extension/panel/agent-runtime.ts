import type { EvidenceFindRequest, EvidenceIdentity, EvidenceReadPoint, EvidenceSnapshot } from "../../core/evidence-filter-contract";
import type { DiagnosticObservationBoundary, DiagnosticObservationRead } from "../../core/diagnostic-observation";
import type { Filter } from "../../core/filter-algebra";
import type { StructuralEvidenceScope } from "./evidence-investigation-query";
import type { WorkbenchLocalInjectionSnapshot, WorkbenchScenarioSnapshot, WorkbenchScopeNode } from "./workbench-runtime";

export type AgentDraftInput = { scopeId?: string; evidence?: EvidenceIdentity; document?: string; delayMs?: number };
export type AgentQueryBoundary = Readonly<{ scope: StructuralEvidenceScope; filter: Filter }>;
export type AgentScopeSearchSnapshot = Readonly<{
  pageEpoch: string | null;
  structureRevision: number;
  nodes: readonly WorkbenchScopeNode[];
  history: Readonly<{ intervalId: string; committedSequence: number | null; retainedFirstSequence: number | null }>;
}>;
/** Narrow internal seam. Transport validation and grant enforcement live outside the runtime. */
export interface AgentRuntime {
  status(): unknown;
  scopes(offset: number, limit: number): unknown;
  scopeSearchSnapshot(): AgentScopeSearchSnapshot;
  scope(id: string): unknown;
  queryBoundary(scopeId?: string, useCurrentInvestigation?: boolean): AgentQueryBoundary;
  query(input: { scopeId?: string; text?: string; scope?: StructuralEvidenceScope; filter?: Filter; find?: EvidenceFindRequest; size: number; at: "LATEST_COMMITTED" | EvidenceReadPoint; cursor?: string; includePayload: boolean; lookup?: EvidenceIdentity }): Promise<EvidenceSnapshot>;
  diagnostics(after?: DiagnosticObservationBoundary): Promise<DiagnosticObservationRead>;
  prepare(steps: AgentDraftInput[], scenario: boolean, pageEpoch: string, stillAuthorized: () => boolean): Promise<void>;
  edit(document: string, stepId?: string): void;
  local(): WorkbenchLocalInjectionSnapshot;
  scenario(): Pick<NonNullable<WorkbenchScenarioSnapshot>, "phase" | "scenario" | "run" | "runner" | "membershipError"> | null;
  execute(): void;
  control(action: "step" | "play" | "pause" | "stop" | "re-review"): void;
  finish(): void;
}
