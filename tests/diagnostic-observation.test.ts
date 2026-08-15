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
      route: { kind: "inspect-affected" as const },
      resultRef: { kind: "evidence" as const, intervalId: "panel-1:interval-1", sequence: 7, eventId: "evidence-7" },
      originalCode: 41,
      safeMessage: "adapter refused the subscription"
    });

    expect(observation).toMatchObject({
      schemaVersion: DIAGNOSTIC_OBSERVATION_SCHEMA_VERSION,
      ruleVersion: 1,
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

  it("deduplicates, updates, resolves, and replays conditions at committed observation boundaries", async () => {
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: "panel-2" });
    const base = {
      code: "workbench.capture.coverage-limited",
      severity: "warning" as const,
      lifecycle: { kind: "condition" as const, conditionId: "late-attach" },
      affected: { kind: "page" as const, pageId: "page-2" },
      observedAt: 100,
      observed: "Capture attached after application startup.",
      limitation: "Earlier Lightstreamer activity was not observed.",
      consequence: "The current topology may be incomplete.",
      route: { kind: "recover" as const, action: "reload-with-devtools-open" }
    };

    const created = await journal.observe(base);
    const duplicate = await journal.observe(base);
    const updated = await journal.observe({
      ...base,
      observedAt: 120,
      consequence: "The current topology and Snapshot evidence may be incomplete."
    });
    const resolved = await journal.resolveCondition({
      code: base.code,
      conditionId: "late-attach",
      affected: base.affected,
      observedAt: 130
    });

    expect(duplicate).toBe(created);
    expect(updated.id).toBe(created.id);
    expect(updated.observationBoundary.sequence).toBe(2);
    expect(resolved).toMatchObject({
      id: created.id,
      lifecycle: { kind: "condition", conditionId: "late-attach", state: "resolved" },
      observationBoundary: { sequence: 3 }
    });
    expect(await journal.query({
      after: created.observationBoundary,
      through: resolved?.observationBoundary,
      codes: [base.code],
      minimumSeverity: "warning",
      affected: base.affected
    })).toMatchObject({
      coverage: "complete",
      retention: "complete",
      observations: [updated, resolved]
    });
    expect(await journal.replay()).toEqual([created, updated, resolved]);
  });

  it("feeds every normalized observation strictly after an immutable cursor, including non-Evidence observations", async () => {
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: "panel-3" });
    const lower = journal.currentBoundary();
    const publications: string[] = [];
    const unsubscribe = journal.subscribe(lower, (observation) => publications.push(observation.code));

    const observation = await journal.observe({
      code: "workbench.storage.lower-capacity",
      ruleVersion: 2,
      severity: "information",
      lifecycle: { kind: "condition", conditionId: "memory-fallback" },
      affected: { kind: "page", pageId: "page-3" },
      observedAt: 200,
      observed: "Event History is using memory storage.",
      limitation: "The lower storage tier has smaller capacity.",
      consequence: "Retained Evidence remains complete through its committed boundary.",
      route: { kind: "recover", action: "reopen-after-storage-restored" }
    });
    const upper = journal.currentBoundary();
    unsubscribe();

    expect(observation.evidenceBoundary).toBeUndefined();
    expect(publications).toEqual(["workbench.storage.lower-capacity"]);
    expect((await journal.query({ after: lower, through: upper })).observations).toEqual([observation]);
  });
});
