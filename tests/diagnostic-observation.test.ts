import { describe, expect, it } from "vitest";

import {
  DIAGNOSTIC_OBSERVATION_SCHEMA_VERSION,
  createMemoryDiagnosticObservationJournal
} from "../src/core/diagnostic-observation";

describe("normalized Diagnostic Observation contract", () => {
  it("commits a versioned occurrence with stable identity and exact Evidence boundary", async () => {
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: "panel-1" });
    const observation = await journal.observe({
      code: "ls.subscription.error",
      severity: "error",
      lifecycle: { kind: "occurrence", occurrenceId: "evidence-7" },
      affected: {
        kind: "subscription",
        pageId: "page-1",
        clientId: "client-1",
        sessionId: "session-1",
        subscriptionId: "subscription-1"
      },
      observedAt: 1_700_000_000_000,
      evidenceBoundary: { intervalId: "panel-1:interval-1", sequence: 7, eventId: "evidence-7" },
      observed: "SubscriptionListener reported an error.",
      limitation: "The callback does not prove the Subscription stopped.",
      consequence: "Updates for this Subscription may be unavailable.",
      route: "Inspect the affected Subscription and supporting Evidence.",
      originalCode: 41,
      safeMessage: "adapter refused the subscription"
    });

    expect(observation).toMatchObject({
      schemaVersion: DIAGNOSTIC_OBSERVATION_SCHEMA_VERSION,
      id: "diag:ls.subscription.error:occurrence:evidence-7:subscription:page-1:client-1:session-1:subscription-1",
      code: "ls.subscription.error",
      severity: "error",
      lifecycle: { kind: "occurrence", occurrenceId: "evidence-7", state: "observed" },
      observationBoundary: { intervalId: "panel-1:diagnostics:interval-1", sequence: 1 },
      evidenceBoundary: { intervalId: "panel-1:interval-1", sequence: 7, eventId: "evidence-7" },
      originalCode: 41,
      safeMessage: "adapter refused the subscription"
    });
    expect(Object.isFrozen(observation)).toBe(true);
  });
});
