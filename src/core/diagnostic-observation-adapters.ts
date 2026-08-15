import type {
  DiagnosticAffectedIdentity,
  DiagnosticEvidenceBoundary,
  DiagnosticInspectionRoute,
  DiagnosticObservationInput,
  DiagnosticResultRef,
  DiagnosticSeverity
} from "./diagnostic-observation";
import { normalizeDiagnosticObservationInput } from "./diagnostic-observation";

type DiagnosticSemantics = Readonly<{
  severity: DiagnosticSeverity;
  affected: DiagnosticAffectedIdentity;
  observedAt: number;
  observed: string;
  limitation: string;
  consequence: string;
  route: DiagnosticInspectionRoute;
  safeMessage?: string;
  originalCode?: number;
}>;

type WorkbenchConditionFamily = "history" | "storage" | "capture" | "session";

export type WorkbenchConditionFinding = DiagnosticSemantics & Readonly<{
  family: WorkbenchConditionFamily;
  localCode: string;
  lifecycle: Readonly<{ kind: "condition"; conditionId: string }>;
  evidenceBoundary?: DiagnosticEvidenceBoundary;
}>;

export type ProjectionFinding = DiagnosticSemantics & Readonly<{
  family: "command";
  localCode: string;
  lifecycle: Readonly<{ kind: "occurrence"; occurrenceId: string }> | Readonly<{ kind: "condition"; conditionId: string }>;
  evidenceBoundary?: DiagnosticEvidenceBoundary;
  resultRef: Extract<DiagnosticResultRef, Readonly<{ kind: "projection" }>>;
}>;

export type CommittedEvidenceFinding = DiagnosticSemantics & Readonly<{
  family: "subscription-error" | "lost-updates";
  lifecycle: Readonly<{ kind: "occurrence"; occurrenceId: string }>;
  evidenceBoundary: DiagnosticEvidenceBoundary;
}>;

export type AdaptedDiagnosticFinding = Readonly<{ observation: DiagnosticObservationInput }>;

export function adaptWorkbenchConditionFinding(finding: WorkbenchConditionFinding): AdaptedDiagnosticFinding {
  const prefix = finding.family === "session" ? "ls.session" : `workbench.${finding.family}`;
  return adapted(finding, `${prefix}.${finding.localCode}`);
}

export function adaptProjectionFinding(finding: ProjectionFinding): AdaptedDiagnosticFinding {
  return adapted(finding, `ls.command.${finding.localCode}`, finding.resultRef);
}

export function adaptCommittedEvidenceFinding(finding: CommittedEvidenceFinding): AdaptedDiagnosticFinding {
  return adapted(
    finding,
    finding.family === "subscription-error" ? "ls.subscription.error" : "ls.subscription.lost-updates",
    { kind: "evidence", ...finding.evidenceBoundary }
  );
}

function adapted(
  finding: DiagnosticSemantics & Readonly<{
    lifecycle: DiagnosticObservationInput["lifecycle"];
    evidenceBoundary?: DiagnosticEvidenceBoundary;
  }>,
  code: string,
  resultRef?: DiagnosticResultRef
): AdaptedDiagnosticFinding {
  return Object.freeze({
    observation: normalizeDiagnosticObservationInput({
      code,
      ruleVersion: 1,
      severity: finding.severity,
      lifecycle: finding.lifecycle,
      affected: finding.affected,
      observedAt: finding.observedAt,
      evidenceBoundary: finding.evidenceBoundary ? Object.freeze({ ...finding.evidenceBoundary }) : undefined,
      observed: finding.observed,
      limitation: finding.limitation,
      consequence: finding.consequence,
      route: finding.route,
      resultRef,
      originalCode: finding.originalCode,
      safeMessage: finding.safeMessage
    })
  });
}
