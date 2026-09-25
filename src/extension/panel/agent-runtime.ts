import type { EvidenceIdentity, EvidenceReadPoint, EvidenceSnapshot } from "../../core/evidence-filter-contract";
import type { DiagnosticObservationBoundary, DiagnosticObservationRead } from "../../core/diagnostic-observation";
import type { WorkbenchLocalInjectionSnapshot, WorkbenchScenarioSnapshot } from "./workbench-runtime";

export type AgentDraftInput = { scopeId?: string; evidence?: EvidenceIdentity; document?: string; delayMs?: number };
/** Narrow internal seam. Transport validation and grant enforcement live outside the runtime. */
export interface AgentRuntime {
  status(): unknown;
  scopes(offset: number, limit: number): unknown;
  scope(id: string): unknown;
  query(input: { scopeId?: string; text?: string; size: number; at: "LATEST_COMMITTED" | EvidenceReadPoint; cursor?: string; includePayload: boolean; lookup?: EvidenceIdentity }): Promise<EvidenceSnapshot>;
  diagnostics(after?: DiagnosticObservationBoundary): Promise<DiagnosticObservationRead>;
  prepare(steps: AgentDraftInput[], scenario: boolean, pageEpoch: string, stillAuthorized: () => boolean): Promise<void>;
  edit(document: string, stepId?: string): void;
  local(): WorkbenchLocalInjectionSnapshot;
  scenario(): Pick<NonNullable<WorkbenchScenarioSnapshot>, "phase" | "scenario" | "run" | "runner" | "membershipError"> | null;
  execute(): void;
  control(action: "step" | "play" | "pause" | "stop" | "re-review"): void;
  finish(): void;
}
