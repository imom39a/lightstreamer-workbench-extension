import type { EvidenceRef } from "../../core/event-history-authoritative";
import type { LocalInjectionDocument } from "../../core/local-injection-document";
import { createSyntheticEventFromDraft } from "../../core/synthetic-event";
import {
  validateDraftForExecutionTarget,
  type ReinjectionDraft,
  type ReinjectionExecutionTarget
} from "../../core/reinjection-draft";

export type LocalInjectionExecutionResult = Readonly<{
  requestId: string;
  ok: boolean;
  status:
    | "success"
    | "stale-target"
    | "listener-error"
    | "wire-error"
    | "bridge-error"
    | "acknowledgement-unknown";
  timestamp: number;
  error?: string;
  attemptedCount?: number;
  deliveredCount?: number;
  failedCount?: number;
}>;

export type LocalInjectionExecutionRequest = Readonly<{
  executionId: string;
  preflightFingerprint: string;
  executionTarget: ReinjectionExecutionTarget;
  document: Readonly<LocalInjectionDocument>;
  draft: ReinjectionDraft;
}>;

export type LocalInjectionExecutor = Readonly<{
  execute(request: LocalInjectionExecutionRequest): Promise<LocalInjectionExecutionResult>;
}>;

export type LocalInjectionOutcome = Readonly<{
  disposition: "delivered" | "blocked" | "failed" | "partial" | "acknowledgement-unknown";
  headline: "DELIVERED LOCALLY" | "NOT RUN" | "DELIVERY FAILED" | "PARTIALLY DELIVERED" | "DELIVERY UNKNOWN";
  status: LocalInjectionExecutionResult["status"];
  executionId: string;
  requestId: string | null;
  timestamp: number;
  detail: string;
  attemptedCount?: number;
  deliveredCount?: number;
  failedCount?: number;
}>;

export type LocalInjectionScenarioCorrelation = Readonly<{
  scenarioId?: string;
  runId?: string;
  stepId?: string;
  ordinal?: number;
  injectionId?: string;
  targetId?: string;
}>;

export type LocalInjectionReviewedExecution = Readonly<{
  kind: "reviewed";
  fingerprint: string;
  executionTarget: ReinjectionExecutionTarget;
  document: Readonly<LocalInjectionDocument>;
  draft: ReinjectionDraft;
  correlation: LocalInjectionScenarioCorrelation;
}>;

export type LocalInjectionReview = LocalInjectionReviewedExecution | Readonly<{
  kind: "refused";
  reason: string;
}>;

export type LocalInjectionTerminalRecord = Readonly<{
  outcome: LocalInjectionOutcome;
  evidence:
    | Readonly<{ state: "not-created" }>
    | Readonly<{ state: "delivered-unretained" }>
    | Readonly<{ state: "committed"; reference: EvidenceRef }>;
  correlation: Readonly<LocalInjectionScenarioCorrelation & {
    executionId: string;
    requestId: string | null;
    sourceEventId: string | null;
  }>;
}>;

export type LocalInjectionCoordinatorExecution =
  | Readonly<{ kind: "review-invalidated" }>
  | Readonly<{ kind: "terminal"; record: LocalInjectionTerminalRecord }>;

type EvidenceAdmission =
  | Readonly<{ retained: true; evidence: EvidenceRef }>
  | Readonly<{ retained: false }>;

export type LocalInjectionExecutionCoordinator = Readonly<{
  review(input: Omit<LocalInjectionReviewedExecution, "kind">): LocalInjectionReview;
  check(review: LocalInjectionReviewedExecution):
    | Readonly<{ kind: "current" }>
    | Readonly<{ kind: "review-invalidated" }>
    | Readonly<{ kind: "stale-target"; reason: string }>;
  refusedOutcome(executionId: string, reason: string): LocalInjectionOutcome;
  execute(
    review: LocalInjectionReviewedExecution,
    facts: Readonly<{
      executionId: string;
      onTerminal?: (record: LocalInjectionTerminalRecord) => void;
    }>
  ): Promise<LocalInjectionCoordinatorExecution>;
}>;

export function createLocalInjectionExecutionCoordinator(adapters: Readonly<{
  execute(request: LocalInjectionExecutionRequest): Promise<LocalInjectionExecutionResult>;
  admitEvidence(event: ReturnType<typeof createSyntheticEventFromDraft>): Promise<EvidenceAdmission>;
  readExecutionFacts: (review: LocalInjectionReviewedExecution) => Readonly<{
    fingerprint: string;
    targetProblem?: string;
  }>;
  canAcceptEvidence?: (review: LocalInjectionReviewedExecution) => boolean;
  now?: () => number;
}>): LocalInjectionExecutionCoordinator {
  const now = adapters.now ?? Date.now;
  const check = (review: LocalInjectionReviewedExecution): ReturnType<LocalInjectionExecutionCoordinator["check"]> => {
    let facts: ReturnType<typeof adapters.readExecutionFacts>;
    try {
      facts = adapters.readExecutionFacts(review);
    } catch {
      return Object.freeze({
        kind: "stale-target",
        reason: "The protected Local Injection target could not be validated."
      });
    }
    if (facts.targetProblem) return Object.freeze({ kind: "stale-target", reason: facts.targetProblem });
    return facts.fingerprint === review.fingerprint
      ? Object.freeze({ kind: "current" })
      : Object.freeze({ kind: "review-invalidated" });
  };
  return {
    review(input) {
      const validation = validateDraftForExecutionTarget(
        {
          ...input.draft,
          fieldValueStates: Object.fromEntries(
            Object.entries(input.draft.fieldValueStates).filter(([field]) =>
              Object.prototype.hasOwnProperty.call(input.draft.fields, field)
            )
          )
        },
        input.executionTarget
      );
      if (!validation.valid) {
        return Object.freeze({ kind: "refused", reason: validation.errors[0] ?? "The Local Injection Draft is not executable." });
      }
      const nonConcrete = Object.entries(input.draft.fieldValueStates).find(
        ([field, state]) =>
          Object.prototype.hasOwnProperty.call(input.draft.fields, field) &&
          state !== "concrete"
      );
      if (nonConcrete) {
        return Object.freeze({
          kind: "refused",
          reason: `Captured Source field "${nonConcrete[0]}" requires an explicit concrete replacement.`
        });
      }
      return Object.freeze({
        kind: "reviewed",
        fingerprint: input.fingerprint,
        executionTarget: input.executionTarget,
        document: cloneAndFreeze(input.document),
        draft: cloneAndFreeze(input.draft),
        correlation: Object.freeze({ ...input.correlation })
      });
    },
    check,
    refusedOutcome(executionId, reason) {
      return blockedOutcome(executionId, reason, now());
    },
    async execute(review, facts) {
      const finish = (result: Readonly<{ kind: "terminal"; record: LocalInjectionTerminalRecord }>) => {
        try {
          facts.onTerminal?.(result.record);
        } catch {
          // A publication observer cannot erase an already established terminal fact.
        }
        return result;
      };
      const current = check(review);
      if (current.kind === "review-invalidated") {
        return Object.freeze({ kind: "review-invalidated" });
      }
      if (current.kind === "stale-target") {
        return finish(terminal(review, facts.executionId, blockedOutcome(facts.executionId, current.reason, now()), { state: "not-created" }));
      }
      const request = Object.freeze({
        executionId: facts.executionId,
        preflightFingerprint: review.fingerprint,
        executionTarget: review.executionTarget,
        document: review.document,
        draft: review.draft
      });
      let execution: Promise<LocalInjectionExecutionResult>;
      try {
        execution = adapters.execute(request);
      } catch (error) {
        execution = Promise.resolve({
          requestId: facts.executionId,
          ok: false,
          status: "bridge-error",
          timestamp: now(),
          error: errorMessage(error)
        });
      }
      let executionResult: LocalInjectionExecutionResult;
      try {
        executionResult = await execution;
      } catch (error) {
        executionResult = {
          requestId: facts.executionId,
          ok: false,
          status: "acknowledgement-unknown",
          timestamp: now(),
          error: errorMessage(error)
        };
      }
      const outcome = outcomeFromResult(facts.executionId, executionResult);
      if (outcome.disposition !== "delivered") {
        return finish(terminal(review, facts.executionId, outcome, { state: "not-created" }));
      }
      let acceptingEvidence = true;
      try {
        acceptingEvidence = adapters.canAcceptEvidence?.(review) ?? true;
      } catch {
        acceptingEvidence = false;
      }
      if (!acceptingEvidence) {
        return finish(terminal(
          review,
          facts.executionId,
          deliveredOutcome(facts.executionId, executionResult, "Delivered locally, but the synthetic Evidence could not be retained in session history."),
          { state: "delivered-unretained" }
        ));
      }
      const synthetic = createSyntheticEventFromDraft(
        review.draft,
        { requestId: executionResult.requestId, ok: true, status: "success", timestamp: executionResult.timestamp },
        review.executionTarget
      );
      let admission: EvidenceAdmission;
      try {
        admission = await adapters.admitEvidence(
          withCorrelation(synthetic, review.correlation, facts.executionId)
        );
      } catch {
        admission = { retained: false };
      }
      if (!admission.retained) {
        return finish(terminal(
          review,
          facts.executionId,
          deliveredOutcome(facts.executionId, executionResult, "Delivered locally, but the synthetic Evidence could not be retained in session history."),
          { state: "delivered-unretained" }
        ));
      }
      return finish(terminal(review, facts.executionId, outcome, { state: "committed", reference: admission.evidence }));
    }
  };
}

function terminal(
  review: LocalInjectionReviewedExecution,
  executionId: string,
  outcome: LocalInjectionOutcome,
  evidence: LocalInjectionTerminalRecord["evidence"]
): Readonly<{ kind: "terminal"; record: LocalInjectionTerminalRecord }> {
  return Object.freeze({
    kind: "terminal",
    record: Object.freeze({
      outcome: Object.freeze(outcome),
      evidence: freezeEvidence(evidence),
      correlation: Object.freeze({
        ...review.correlation,
        executionId,
        requestId: outcome.requestId,
        sourceEventId: review.draft.provenance.source === "new-command"
          ? null
          : review.draft.sourceEventId
      })
    })
  });
}

function freezeEvidence(
  evidence: LocalInjectionTerminalRecord["evidence"]
): LocalInjectionTerminalRecord["evidence"] {
  return evidence.state === "committed"
    ? Object.freeze({
        state: "committed",
        reference: Object.freeze({ ...evidence.reference })
      })
    : Object.freeze({ ...evidence });
}

function withCorrelation(
  event: ReturnType<typeof createSyntheticEventFromDraft>,
  correlation: LocalInjectionScenarioCorrelation,
  executionId: string
): ReturnType<typeof createSyntheticEventFromDraft> {
  return Object.freeze({
    ...event,
    raw: Object.freeze({ ...event.raw, ...correlation, executionId })
  });
}

function confirmsFullDelivery(result: LocalInjectionExecutionResult): boolean {
  if (result.status !== "success" || !result.ok) return false;
  const hasCounts = result.attemptedCount !== undefined || result.deliveredCount !== undefined || result.failedCount !== undefined;
  if (!hasCounts) return true;
  return Number.isSafeInteger(result.attemptedCount) &&
    Number.isSafeInteger(result.deliveredCount) &&
    Number.isSafeInteger(result.failedCount) &&
    result.attemptedCount! > 0 &&
    result.deliveredCount === result.attemptedCount &&
    result.failedCount === 0;
}

function counts(result: LocalInjectionExecutionResult): Pick<LocalInjectionOutcome, "attemptedCount" | "deliveredCount" | "failedCount"> {
  return {
    ...(result.attemptedCount !== undefined ? { attemptedCount: result.attemptedCount } : {}),
    ...(result.deliveredCount !== undefined ? { deliveredCount: result.deliveredCount } : {}),
    ...(result.failedCount !== undefined ? { failedCount: result.failedCount } : {})
  };
}

function deliveredOutcome(executionId: string, result: LocalInjectionExecutionResult, detail = "The update was delivered through the protected local page target. No server was contacted."): LocalInjectionOutcome {
  return Object.freeze({ disposition: "delivered", headline: "DELIVERED LOCALLY", status: "success", executionId, requestId: result.requestId, timestamp: result.timestamp, detail, ...counts(result) });
}

function blockedOutcome(executionId: string, detail: string, timestamp: number): LocalInjectionOutcome {
  return Object.freeze({ disposition: "blocked", headline: "NOT RUN", status: "stale-target", executionId, requestId: null, timestamp, detail: `BLOCKED · ${detail}` });
}

function outcomeFromResult(executionId: string, result: LocalInjectionExecutionResult): LocalInjectionOutcome {
  if (confirmsFullDelivery(result)) return deliveredOutcome(executionId, result);
  const deliveryCounts = counts(result);
  if (result.status === "success") {
    return Object.freeze({ disposition: "failed", headline: "DELIVERY FAILED", status: result.status, executionId, requestId: result.requestId, timestamp: result.timestamp, detail: result.error ?? "The reported success result did not confirm any listener delivery and was rejected as invalid.", ...deliveryCounts });
  }
  if (result.status === "stale-target") {
    return Object.freeze({ disposition: "blocked", headline: "NOT RUN", status: result.status, executionId, requestId: result.requestId, timestamp: result.timestamp, detail: `BLOCKED · ${result.error ?? "The protected target is stale."}`, ...deliveryCounts });
  }
  if (result.status === "acknowledgement-unknown") {
    return Object.freeze({ disposition: "acknowledgement-unknown", headline: "DELIVERY UNKNOWN", status: result.status, executionId, requestId: result.requestId, timestamp: result.timestamp, detail: result.error ?? "The page may have executed the request, but Workbench did not receive a trustworthy acknowledgement. No retry was attempted.", ...deliveryCounts });
  }
  if (result.status === "listener-error" && (result.deliveredCount ?? 0) > 0) {
    return Object.freeze({ disposition: "partial", headline: "PARTIALLY DELIVERED", status: result.status, executionId, requestId: result.requestId, timestamp: result.timestamp, detail: result.error ?? "Some captured listeners received the update and at least one listener failed.", ...deliveryCounts });
  }
  return Object.freeze({ disposition: "failed", headline: "DELIVERY FAILED", status: result.status, executionId, requestId: result.requestId, timestamp: result.timestamp, detail: result.error ?? "The local delivery target rejected the update.", ...deliveryCounts });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => cloneAndFreeze(entry))) as T;
  }
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneAndFreeze(entry)])
    )) as T;
  }
  return value;
}
