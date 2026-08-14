import { describe, expect, it, vi } from "vitest";

import type { LocalInjectionDocument } from "../src/core/local-injection-document";
import type { ReinjectionDraft } from "../src/core/reinjection-draft";
import {
  createLocalInjectionExecutionCoordinator as createCoordinator,
  type LocalInjectionExecutionResult
} from "../src/extension/panel/local-injection-execution-coordinator";

type CoordinatorOptions = Parameters<typeof createCoordinator>[0];

function createLocalInjectionExecutionCoordinator(
  options: Omit<CoordinatorOptions, "readExecutionFacts"> &
    Partial<Pick<CoordinatorOptions, "readExecutionFacts">>
) {
  return createCoordinator({
    ...options,
    readExecutionFacts: options.readExecutionFacts ?? ((review) => ({ fingerprint: review.fingerprint }))
  });
}

const document: LocalInjectionDocument = {
  command: "UPDATE",
  key: "order-1",
  isSnapshot: false,
  fields: { command: "UPDATE", key: "order-1", qty: 2 }
};

function draft(
  fieldValueStates: ReinjectionDraft["fieldValueStates"] = {
    command: "concrete",
    key: "concrete",
    qty: "concrete"
  }
): ReinjectionDraft {
  return {
    sourceEventId: "source-6",
    subscriptionMode: "COMMAND",
    captureSource: "listener",
    sourceClient: { id: "client-1", sessionId: "session-1" },
    sourceSubscription: { id: "sub-1", mode: "COMMAND" },
    target: { subscriptionId: "sub-1", listenerId: "listener-1" },
    item: { name: "orders", position: 1 },
    command: "UPDATE",
    key: "order-1",
    sourceCommand: "ADD",
    sourceKey: "order-1",
    fields: { command: "UPDATE", key: "order-1", qty: 2 },
    sourceFields: { command: "ADD", key: "order-1", qty: 1 },
    fieldValueStates,
    sourceFieldValueStates: { command: "concrete", key: "concrete", qty: "concrete" },
    changedFields: { command: "UPDATE", qty: 2 },
    originalChangedFields: { command: "ADD", key: "order-1", qty: 1 },
    isSnapshot: false,
    sourceIsSnapshot: false,
    manualChangedFieldsOverride: false,
    provenance: { source: "clone", sourceEventKind: "item-update", sourceSynthetic: false }
  };
}

function success(overrides: Partial<LocalInjectionExecutionResult> = {}): LocalInjectionExecutionResult {
  return {
    requestId: "request-1",
    ok: true,
    status: "success",
    timestamp: 100,
    attemptedCount: 1,
    deliveredCount: 1,
    failedCount: 0,
    ...overrides
  };
}

describe("Local Injection execution coordinator", () => {
  it("bounds every executor-controlled Trace string before settling the immutable outcome", async () => {
    const coordinator = createLocalInjectionExecutionCoordinator({
      execute: vi.fn(async () => success({ ok: false, status: "listener-error", requestId: "r".repeat(20_000), error: "e".repeat(20_000), attemptedCount: 1, deliveredCount: 0, failedCount: 1 })),
      admitEvidence: vi.fn()
    });
    const review = coordinator.review({ fingerprint: "fp", executionTarget: "captured-listener", document, draft: draft(), correlation: {} });
    if (review.kind !== "reviewed") throw new Error(review.reason);
    const settled = await coordinator.execute(review, { executionId: "execution-bounded" });
    if (settled.kind !== "terminal") throw new Error("Expected a terminal outcome.");
    expect(settled.record.outcome.requestId).toHaveLength(1_024);
    expect(new TextEncoder().encode(settled.record.outcome.detail).byteLength).toBeLessThanOrEqual(8 * 1024);
    expect(settled.record.outcome.limitations).toEqual([
      { field: "requestId", originalBytes: 20_000, retainedBytes: 1_024 },
      { field: "detail", originalBytes: 20_000, retainedBytes: 8 * 1024 }
    ]);
  });

  it("executes one reviewed concrete source and settles committed Evidence before completing", async () => {
    let settleEvidence!: (value: { retained: true; evidence: { intervalId: string; sequence: number; eventId: string } }) => void;
    const evidence = new Promise<{ retained: true; evidence: { intervalId: string; sequence: number; eventId: string } }>((resolve) => {
      settleEvidence = resolve;
    });
    const executor = vi.fn(async () => success());
    const coordinator = createLocalInjectionExecutionCoordinator({
      execute: executor,
      admitEvidence: vi.fn(() => evidence),
      now: () => 101
    });
    const review = coordinator.review({
      fingerprint: "fingerprint-1",
      executionTarget: "captured-listener",
      document,
      draft: draft(),
      correlation: {
        scenarioId: "scenario-1",
        runId: "run-1",
        stepId: "step-1",
        ordinal: 1,
        injectionId: "injection-1",
        targetId: "sub-1"
      }
    });
    expect(review.kind).toBe("reviewed");
    if (review.kind !== "reviewed") return;

    let completed = false;
    const pending = coordinator.execute(review, {
      executionId: "execution-1"
    }).then((value) => {
      completed = true;
      return value;
    });
    await Promise.resolve();
    expect(executor).toHaveBeenCalledTimes(1);
    expect(completed).toBe(false);

    const evidenceReference = { intervalId: "interval-1", sequence: 7, eventId: "synthetic-request-1" };
    settleEvidence({
      retained: true,
      evidence: evidenceReference
    });
    const result = await pending;
    expect(result).toMatchObject({
      kind: "terminal",
      record: {
        evidence: {
          state: "committed",
          reference: { eventId: "synthetic-request-1" }
        },
        correlation: {
          scenarioId: "scenario-1",
          runId: "run-1",
          stepId: "step-1",
          ordinal: 1,
          injectionId: "injection-1",
          executionId: "execution-1",
          requestId: "request-1",
          targetId: "sub-1",
          sourceEventId: "source-6"
        }
      }
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.kind === "terminal" && result.record.evidence.state === "committed") {
      evidenceReference.eventId = "mutated-after-settlement";
      expect(result.record.evidence.reference.eventId).toBe("synthetic-request-1");
      expect(Object.isFrozen(result.record.evidence.reference)).toBe(true);
    }
  });

  it("invalidates fingerprint drift without invoking the executor", async () => {
    const executor = vi.fn(async () => success());
    const coordinator = createLocalInjectionExecutionCoordinator({
      execute: executor,
      admitEvidence: vi.fn(),
      readExecutionFacts: () => ({ fingerprint: "changed" })
    });
    const review = coordinator.review({
      fingerprint: "reviewed",
      executionTarget: "captured-listener",
      document,
      draft: draft(),
      correlation: {}
    });
    if (review.kind !== "reviewed") throw new Error("expected review");

    await expect(coordinator.execute(review, {
      executionId: "execution-2"
    })).resolves.toEqual({ kind: "review-invalidated" });
    expect(executor).not.toHaveBeenCalled();
  });

  it("returns a stale target as terminal NOT RUN without invoking the executor", async () => {
    const executor = vi.fn(async () => success());
    const coordinator = createLocalInjectionExecutionCoordinator({
      execute: executor,
      admitEvidence: vi.fn(),
      readExecutionFacts: () => ({
        fingerprint: "reviewed",
        targetProblem: "The protected Subscription retired."
      }),
      now: () => 200
    });
    const review = coordinator.review({
      fingerprint: "reviewed",
      executionTarget: "captured-listener",
      document,
      draft: draft(),
      correlation: {}
    });
    if (review.kind !== "reviewed") throw new Error("expected review");

    await expect(coordinator.execute(review, {
      executionId: "execution-3"
    })).resolves.toMatchObject({
      kind: "terminal",
      record: { outcome: { disposition: "blocked", headline: "NOT RUN", requestId: null } }
    });
    expect(executor).not.toHaveBeenCalled();
  });

  it("fails closed when live target observation throws", async () => {
    const executor = vi.fn(async () => success());
    const coordinator = createLocalInjectionExecutionCoordinator({
      execute: executor,
      admitEvidence: vi.fn(),
      readExecutionFacts: () => { throw new Error("topology unavailable"); }
    });
    const review = coordinator.review({ fingerprint: "reviewed", executionTarget: "captured-listener", document, draft: draft(), correlation: {} });
    if (review.kind !== "reviewed") throw new Error("expected review");

    await expect(coordinator.execute(review, { executionId: "target-observer-error" })).resolves.toMatchObject({
      record: { outcome: { disposition: "blocked", headline: "NOT RUN" } }
    });
    expect(executor).not.toHaveBeenCalled();
  });

  it.each(["ambiguous-null", "redacted", "unavailable", "unresolved-wire-difference"] as const)(
    "refuses an unchanged %s Source field until an explicit concrete replacement exists",
    (state) => {
      const coordinator = createLocalInjectionExecutionCoordinator({
        execute: vi.fn(async () => success()),
        admitEvidence: vi.fn()
      });
      const refused = coordinator.review({
        fingerprint: "reviewed",
        executionTarget: "captured-listener",
        document,
        draft: draft({ command: "concrete", key: "concrete", qty: state }),
        correlation: {}
      });
      expect(refused).toMatchObject({ kind: "refused", reason: expect.stringContaining("explicit concrete replacement") });

      const replacement = coordinator.review({
        fingerprint: "reviewed",
        executionTarget: "captured-listener",
        document,
        draft: draft(),
        correlation: {}
      });
      expect(replacement.kind).toBe("reviewed");
    }
  );

  it("records a non-executable Review as distinctly blocked with full correlation", async () => {
    const executor = vi.fn(async () => success());
    const coordinator = createLocalInjectionExecutionCoordinator({
      execute: executor,
      admitEvidence: vi.fn()
    });
    const refused = coordinator.review({
      fingerprint: "reviewed",
      executionTarget: "captured-listener",
      document,
      draft: draft({ command: "concrete", key: "concrete", qty: "redacted" }),
      correlation: {
        scenarioId: "scenario-1",
        runId: "run-1",
        stepId: "step-1",
        ordinal: 2,
        injectionId: "injection-2",
        targetId: "sub-1"
      }
    });
    if (refused.kind !== "refused") throw new Error("expected refusal");

    await expect(coordinator.execute(refused, { executionId: "review-blocked-1" })).resolves.toMatchObject({
      kind: "terminal",
      record: {
        outcome: { disposition: "blocked", headline: "NOT RUN", status: "review-blocked" },
        evidence: { state: "not-created" },
        correlation: {
          scenarioId: "scenario-1",
          runId: "run-1",
          stepId: "step-1",
          ordinal: 2,
          injectionId: "injection-2",
          executionId: "review-blocked-1",
          requestId: null,
          targetId: "sub-1",
          sourceEventId: "source-6"
        },
        executionResult: null
      }
    });
    expect(executor).not.toHaveBeenCalled();
  });

  it("treats a literal sanitizer marker as concrete application data", () => {
    const coordinator = createLocalInjectionExecutionCoordinator({
      execute: vi.fn(async () => success()),
      admitEvidence: vi.fn()
    });
    const concreteMarker = draft();
    concreteMarker.fields.qty = "[redacted]";

    expect(coordinator.review({
      fingerprint: "reviewed",
      executionTarget: "captured-listener",
      document: { ...document, fields: { ...document.fields, qty: "[redacted]" } },
      draft: concreteMarker,
      correlation: {}
    }).kind).toBe("reviewed");
  });

  it("allows a non-concrete Source field to be removed when the execution payload permits omission", () => {
    const coordinator = createLocalInjectionExecutionCoordinator({
      execute: vi.fn(async () => success()),
      admitEvidence: vi.fn()
    });
    const withoutQty = draft({ command: "concrete", key: "concrete", qty: "redacted" });
    delete withoutQty.fields.qty;

    expect(coordinator.review({
      fingerprint: "reviewed",
      executionTarget: "captured-listener",
      document: { ...document, fields: { command: "UPDATE", key: "order-1" } },
      draft: withoutQty,
      correlation: {}
    }).kind).toBe("reviewed");
  });

  it("freezes the reviewed payload independently from later authoring mutations", () => {
    const coordinator = createLocalInjectionExecutionCoordinator({
      execute: vi.fn(async () => success()),
      admitEvidence: vi.fn()
    });
    const mutableDraft = draft();
    const mutableDocument = { ...document, fields: { ...document.fields } };
    const review = coordinator.review({
      fingerprint: "frozen",
      executionTarget: "captured-listener",
      document: mutableDocument,
      draft: mutableDraft,
      correlation: {}
    });
    if (review.kind !== "reviewed") throw new Error("expected review");

    mutableDraft.fields.qty = 99;
    mutableDocument.fields.qty = 99;
    expect(review.draft.fields.qty).toBe(2);
    expect(review.document.fields.qty).toBe(2);
    expect(Object.isFrozen(review.draft.fields)).toBe(true);
    expect(Object.isFrozen(review.document.fields)).toBe(true);
  });

  it("does not claim a captured Source correlation for a source-free authored command", async () => {
    const authored = draft();
    authored.sourceEventId = "new-command:sub-1:orders";
    authored.provenance = { source: "new-command", sourceEventKind: "item-update", sourceSynthetic: true };
    const coordinator = createLocalInjectionExecutionCoordinator({
      execute: vi.fn(async () => ({ ...success(), status: "wire-error" as const, ok: false })),
      admitEvidence: vi.fn()
    });
    const review = coordinator.review({ fingerprint: "f", executionTarget: "captured-listener", document, draft: authored, correlation: {} });
    if (review.kind !== "reviewed") throw new Error("expected review");

    await expect(coordinator.execute(review, { executionId: "authored" })).resolves.toMatchObject({
      record: { correlation: { sourceEventId: null } }
    });
  });

  it.each([
    [success(), "delivered", "committed"],
    [success({ attemptedCount: undefined, deliveredCount: undefined, failedCount: undefined }), "delivered", "committed"],
    [success({ attemptedCount: 0, deliveredCount: 0, failedCount: 0 }), "failed", "not-created"],
    [{ ...success(), ok: false }, "failed", "not-created"],
    [{ ...success(), status: "listener-error" as const, ok: false, attemptedCount: 2, deliveredCount: 1, failedCount: 1 }, "partial", "not-created"],
    [{ ...success(), status: "listener-error" as const, ok: false, attemptedCount: 1, deliveredCount: 0, failedCount: 1 }, "failed", "not-created"],
    [{ ...success(), status: "wire-error" as const, ok: false }, "failed", "not-created"],
    [{ ...success(), status: "acknowledgement-unknown" as const, ok: false }, "acknowledgement-unknown", "not-created"]
  ] as const)("normalizes delivery result %#", async (executionResult, disposition, evidenceState) => {
    const coordinator = createLocalInjectionExecutionCoordinator({
      execute: vi.fn(async () => executionResult),
      admitEvidence: vi.fn(async () => ({ retained: true, evidence: { intervalId: "i", sequence: 1, eventId: "e" } }))
    });
    const review = coordinator.review({ fingerprint: "f", executionTarget: "captured-listener", document, draft: draft(), correlation: {} });
    if (review.kind !== "reviewed") throw new Error("expected review");
    const result = await coordinator.execute(review, { executionId: "x" });
    expect(result).toMatchObject({ kind: "terminal", record: { outcome: { disposition }, evidence: { state: evidenceState } } });
  });

  it("keeps acknowledgement-unknown delivery counts only in the raw terminal result", async () => {
    const coordinator = createLocalInjectionExecutionCoordinator({
      execute: vi.fn(async () => ({
        ...success(),
        ok: false,
        status: "acknowledgement-unknown" as const,
        attemptedCount: 3,
        deliveredCount: 1,
        failedCount: 2
      })),
      admitEvidence: vi.fn()
    });
    const review = coordinator.review({ fingerprint: "f", executionTarget: "captured-listener", document, draft: draft(), correlation: {} });
    if (review.kind !== "reviewed") throw new Error("expected review");

    const result = await coordinator.execute(review, { executionId: "unknown-counts" });
    if (result.kind !== "terminal") throw new Error("expected terminal result");
    expect(result.record.outcome).not.toHaveProperty("attemptedCount");
    expect(result.record.outcome).not.toHaveProperty("deliveredCount");
    expect(result.record.outcome).not.toHaveProperty("failedCount");
    expect(result.record.executionResult).toMatchObject({
      attemptedCount: 3,
      deliveredCount: 1,
      failedCount: 2
    });
  });

  it("keeps synchronous bridge failure distinct from rejected acknowledgement", async () => {
    const execute = vi.fn<() => Promise<LocalInjectionExecutionResult>>()
      .mockImplementationOnce(() => { throw new Error("bridge unavailable"); })
      .mockRejectedValueOnce(new Error("result lost"));
    const coordinator = createLocalInjectionExecutionCoordinator({ execute, admitEvidence: vi.fn(), now: () => 300 });
    const review = coordinator.review({ fingerprint: "f", executionTarget: "captured-listener", document, draft: draft(), correlation: {} });
    if (review.kind !== "reviewed") throw new Error("expected review");

    await expect(coordinator.execute(review, { executionId: "sync" })).resolves.toMatchObject({
      record: { outcome: { status: "bridge-error", disposition: "failed" } }
    });
    await expect(coordinator.execute(review, { executionId: "reject" })).resolves.toMatchObject({
      record: { outcome: { status: "acknowledgement-unknown", disposition: "acknowledgement-unknown" } }
    });
  });

  it.each(["reject", "throw"] as const)("records delivered but unretained Evidence when admission %s", async (failure) => {
    const coordinator = createLocalInjectionExecutionCoordinator({
      execute: vi.fn(async () => success()),
      admitEvidence: failure === "reject"
        ? vi.fn(async () => { throw new Error("history unavailable"); })
        : vi.fn(() => { throw new Error("history unavailable"); })
    });
    const review = coordinator.review({ fingerprint: "f", executionTarget: "captured-listener", document, draft: draft(), correlation: {} });
    if (review.kind !== "reviewed") throw new Error("expected review");

    await expect(coordinator.execute(review, { executionId: failure })).resolves.toMatchObject({
      kind: "terminal",
      record: {
        outcome: { disposition: "delivered", headline: "DELIVERED LOCALLY", detail: expect.stringContaining("could not be retained") },
        evidence: { state: "delivered-unretained" }
      }
    });
  });

  it("does not offer synthetic Evidence after its execution owner is disposed", async () => {
    let accepting = true;
    let resolveExecution!: (result: LocalInjectionExecutionResult) => void;
    const execution = new Promise<LocalInjectionExecutionResult>((resolve) => { resolveExecution = resolve; });
    const admitEvidence = vi.fn(async () => ({ retained: false as const }));
    const coordinator = createLocalInjectionExecutionCoordinator({
      execute: vi.fn(() => execution),
      admitEvidence,
      canAcceptEvidence: () => accepting
    });
    const review = coordinator.review({ fingerprint: "f", executionTarget: "captured-listener", document, draft: draft(), correlation: {} });
    if (review.kind !== "reviewed") throw new Error("expected review");

    const pending = coordinator.execute(review, { executionId: "disposed" });
    accepting = false;
    resolveExecution(success());
    await expect(pending).resolves.toMatchObject({ record: { evidence: { state: "delivered-unretained" } } });
    expect(admitEvidence).not.toHaveBeenCalled();
  });

  it("keeps terminal truth when a publication observer throws", async () => {
    const coordinator = createLocalInjectionExecutionCoordinator({
      execute: vi.fn(async () => ({ ...success(), status: "wire-error" as const, ok: false })),
      admitEvidence: vi.fn()
    });
    const review = coordinator.review({ fingerprint: "f", executionTarget: "captured-listener", document, draft: draft(), correlation: {} });
    if (review.kind !== "reviewed") throw new Error("expected review");

    await expect(coordinator.execute(review, {
      executionId: "observer-throws",
      onTerminal: () => { throw new Error("renderer failed"); }
    })).resolves.toMatchObject({
      kind: "terminal",
      record: { outcome: { status: "wire-error", disposition: "failed" } }
    });
  });

  it("preserves Scenario correlations when the captured-wire boundary fails without Evidence", async () => {
    const execute = vi.fn(async () => ({ ...success(), status: "wire-error" as const, ok: false, error: "captured wire rejected" }));
    const coordinator = createLocalInjectionExecutionCoordinator({ execute, admitEvidence: vi.fn() });
    const wireDraft = { ...draft(), captureSource: "wire" as const, target: { subscriptionId: "sub-1", listenerId: null } };
    const review = coordinator.review({
      fingerprint: "wire-scenario", executionTarget: "captured-wire", document, draft: wireDraft,
      correlation: { scenarioId: "scenario-wire", runId: "run-wire", stepId: "step-1", ordinal: 1, injectionId: "injection-wire", targetId: "sub-1" }
    });
    if (review.kind !== "reviewed") throw new Error(`expected captured-wire Scenario review: ${review.reason}`);

    await expect(coordinator.execute(review, { executionId: "execution-wire" })).resolves.toMatchObject({
      kind: "terminal",
      record: {
        outcome: { status: "wire-error", disposition: "failed", headline: "DELIVERY FAILED" },
        evidence: { state: "not-created" },
        correlation: { scenarioId: "scenario-wire", runId: "run-wire", stepId: "step-1", ordinal: 1, injectionId: "injection-wire", executionId: "execution-wire" }
      }
    });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ executionTarget: "captured-wire" }));
  });
});
