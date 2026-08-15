import { describe, expect, it } from "vitest";

import {
  adaptCommittedEvidenceFinding,
  adaptProjectionFinding,
  adaptWorkbenchConditionFinding
} from "../src/core/diagnostic-observation-adapters";
import {
  DIAGNOSTIC_SAFE_MESSAGE_MAX_LENGTH,
  createMemoryDiagnosticObservationJournal,
  diagnosticObservationRef
} from "../src/core/diagnostic-observation";

const affectedPage = { kind: "page" as const, pageId: "page" };
const affectedSubscription = {
  kind: "subscription" as const,
  pageId: "page",
  clientId: "client",
  sessionId: "session",
  subscriptionId: "subscription"
};

describe("Diagnostic Observation adapters", () => {
  it("normalizes existing Workbench and Lightstreamer finding families without using display copy as identity", () => {
    const common = {
      severity: "warning" as const,
      lifecycle: { kind: "condition" as const, conditionId: "current" },
      observedAt: 100,
      observed: "Workbench observed the condition.",
      limitation: "Only committed Workbench state is considered.",
      consequence: "The current conclusion is limited.",
      route: { kind: "inspect-affected" as const }
    };
    const adapters = [
      adaptWorkbenchConditionFinding({ ...common, family: "history", localCode: "near-capacity", affected: affectedPage }),
      adaptWorkbenchConditionFinding({ ...common, family: "storage", localCode: "lower-capacity", affected: affectedPage }),
      adaptWorkbenchConditionFinding({ ...common, family: "capture", localCode: "coverage-limited", affected: affectedPage }),
      adaptWorkbenchConditionFinding({ ...common, family: "session", localCode: "recovering", affected: { kind: "session", pageId: "page", clientId: "client", sessionId: "session" } }),
      adaptProjectionFinding({ ...common, family: "command", localCode: "unknown-key-update", affected: affectedSubscription, resultRef: { kind: "projection", projection: "observed-server-command-state", key: "subscription:item:key" } }),
      adaptCommittedEvidenceFinding({ ...common, family: "subscription-error", lifecycle: { kind: "occurrence", occurrenceId: "event-9" }, affected: affectedSubscription, evidenceBoundary: { intervalId: "history-1", sequence: 9, eventId: "event-9" }, originalCode: 41 }),
      adaptCommittedEvidenceFinding({ ...common, family: "lost-updates", lifecycle: { kind: "occurrence", occurrenceId: "event-10" }, affected: affectedSubscription, evidenceBoundary: { intervalId: "history-1", sequence: 10, eventId: "event-10" } })
    ];

    expect(adapters.map(({ observation }) => observation.code)).toEqual([
      "workbench.history.near-capacity",
      "workbench.storage.lower-capacity",
      "workbench.capture.coverage-limited",
      "ls.session.recovering",
      "ls.command.unknown-key-update",
      "ls.subscription.error",
      "ls.subscription.lost-updates"
    ]);
    expect(adapters.every(({ observation }) => !("title" in observation) && !("display" in observation))).toBe(true);
  });

  it("allowlists bounded safe evidence before persistence and keeps compact refs free of messages", async () => {
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: "privacy" });
    const adapter = adaptCommittedEvidenceFinding({
      family: "subscription-error",
      severity: "error",
      lifecycle: { kind: "occurrence", occurrenceId: "event-private" },
      affected: affectedSubscription,
      observedAt: 100,
      observed: "SubscriptionListener reported an error.",
      limitation: "The callback provides no server-side application state.",
      consequence: "Subscription updates may be unavailable.",
      route: { kind: "inspect-evidence", evidence: { intervalId: "history", sequence: 1, eventId: "event-private" } },
      evidenceBoundary: { intervalId: "history", sequence: 1, eventId: "event-private" },
      safeMessage: "safe summary",
      rawMessage: "Bearer secret-must-never-cross"
    } as Parameters<typeof adaptCommittedEvidenceFinding>[0] & { rawMessage: string });
    const observation = await journal.observe(adapter.observation);

    expect(JSON.stringify(observation)).not.toContain("secret-must-never-cross");
    expect(diagnosticObservationRef(observation)).not.toHaveProperty("safeMessage");
    expect(JSON.stringify(diagnosticObservationRef(observation)).length).toBeLessThan(4_096);
    await expect(journal.observe({
      ...adapter.observation,
      lifecycle: { kind: "occurrence", occurrenceId: "too-large" },
      safeMessage: "x".repeat(DIAGNOSTIC_SAFE_MESSAGE_MAX_LENGTH + 1)
    })).rejects.toThrow(/safe diagnostic message/);
  });
});
