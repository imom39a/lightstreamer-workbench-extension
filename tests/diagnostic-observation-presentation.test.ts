import { describe, expect, it } from "vitest";

import { presentDiagnosticObservation } from "../src/core/diagnostic-observation-presentation";

describe("Diagnostic Observation presentation adapter", () => {
  it("keeps stable semantics and routing independent of React and footer placement", () => {
    expect(presentDiagnosticObservation({
      code: "ls.client.server-error",
      severity: "warning",
      lifecycle: { kind: "occurrence", occurrenceId: "error-1" },
      affected: { kind: "session", pageId: "page-1", clientId: "client-1", sessionId: "S-1" },
      observedAt: 1,
      observed: "ClientListener reported server error code -7.",
      limitation: "Non-positive codes can be application-specific.",
      consequence: "The callback does not prove the complete server-side cause.",
      route: { kind: "inspect-evidence", evidence: { intervalId: "interval-1", sequence: 4, eventId: "error-1" } },
      originalCode: -7,
      safeMessage: "Application denied the operation"
    })).toEqual({
      id: "error-1",
      code: "ls.client.server-error",
      severity: "Warning",
      title: "Server error -7",
      affected: "Session S-1",
      observed: "ClientListener reported server error code -7. Message: Application denied the operation",
      limitation: "Non-positive codes can be application-specific.",
      consequence: "The callback does not prove the complete server-side cause.",
      route: { kind: "inspect-evidence", evidence: { intervalId: "interval-1", sequence: 4, eventId: "error-1" }, label: "Inspect supporting Evidence" }
    });
  });

  it.each([
    ["ls.sub.raw-snapshot-unavailable", "RAW snapshot unavailable"],
    ["ls.sub.buffer-not-applicable-mode", "Buffer request not applicable"],
    ["ls.sub.nonraw-mode-overlap", "Non-RAW mode overlap"],
    ["ls.subscription.exact-duplicate", "Exact duplicate Subscriptions"],
    ["ls.subscription.semantic-overlap", "Semantic Subscription overlap"],
    ["ls.listener.registration-churn", "Listener registration churn"],
    ["workbench.capture.late-attachment", "Capture attached late"],
    ["ls.subscription.snapshot.phase-incomplete", "Snapshot phase incomplete"],
    ["ls.subscription.snapshot.resubscribed", "Subscription resubscribed"],
    ["ls.command.unknown-key-update", "Unknown COMMAND key update"],
    ["ls.subscription.lost-updates", "Subscription updates lost"]
  ])("presents %s with a concise renderer-neutral title", (code, title) => {
    expect(presentDiagnosticObservation({
      code,
      severity: "information",
      lifecycle: { kind: "condition", conditionId: "condition" },
      affected: { kind: "page", pageId: "page-1" },
      observedAt: 1,
      observed: "Observed fact.",
      limitation: "Bounded limitation.",
      consequence: "Bounded consequence.",
      route: { kind: "inspect-affected" }
    }).title).toBe(title);
  });

  it("preserves an exact affected-object route independently of the renderer", () => {
    const affected = { kind: "subscription" as const, pageId: "page-1", clientId: "client-1", sessionId: "session-1", subscriptionId: "sub-1" };
    expect(presentDiagnosticObservation({
      code: "ls.sub.raw-snapshot-unavailable",
      severity: "information",
      lifecycle: { kind: "condition", conditionId: "raw-sub-1" },
      affected,
      observedAt: 1,
      observed: "RAW snapshot was requested.",
      limitation: "RAW does not support snapshots.",
      consequence: "No snapshot is expected.",
      route: { kind: "inspect-affected" }
    }).route).toEqual({ kind: "inspect-affected", affected, label: "Inspect affected Scope" });
  });
});
