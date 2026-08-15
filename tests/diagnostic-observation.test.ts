import { describe, expect, it } from "vitest";

import {
  DIAGNOSTIC_OBSERVATION_SCHEMA_VERSION,
  createMemoryDiagnosticObservationJournal,
  createUnavailableDiagnosticObservationJournal,
  openIndexedDbDiagnosticObservationJournal
} from "../src/core/diagnostic-observation";
import { IDBFactory } from "fake-indexeddb";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

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
      id: "diag:ls.subscription.error:v1:occurrence:evidence-7:subscription:page-1:client-1:session-1:subscription-1",
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
    const unsubscribe = journal.subscribe(lower, (publication) => {
      if (publication.type === "observation") publications.push(publication.observation.code);
    });

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
    expect((await journal.query({ after: lower, through: upper, ruleVersion: 2, lifecycle: "condition" })).observations).toEqual([observation]);
    const replayedByFeed: string[] = [];
    journal.subscribe(lower, (publication) => {
      if (publication.type === "observation") replayedByFeed.push(publication.observation.id);
    })();
    expect(replayedByFeed).toEqual([observation.id]);
  });

  it("isolates feed observers after an observation is committed", async () => {
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: "panel-observers" });
    const cursor = journal.currentBoundary();
    journal.subscribe(cursor, () => { throw new Error("observer failed"); });
    const delivered: string[] = [];
    journal.subscribe(cursor, (publication) => {
      if (publication.type === "observation") delivered.push(publication.observation.code);
    });
    await expect(journal.observe({
      code: "workbench.capture.disconnected",
      severity: "error",
      lifecycle: { kind: "condition", conditionId: "bridge" },
      affected: { kind: "page", pageId: "page" },
      observedAt: 1,
      observed: "The bridge disconnected.",
      limitation: "Later activity is unavailable.",
      consequence: "Capture is unavailable.",
      route: { kind: "recover", action: "reconnect" }
    })).resolves.toMatchObject({ observationBoundary: { sequence: 1 } });
    expect(delivered).toEqual(["workbench.capture.disconnected"]);
  });

  it("does not advance a condition cursor for a timestamp-only repeat", async () => {
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: "panel-dedup" });
    const input = {
      code: "workbench.capture.disconnected",
      severity: "error" as const,
      lifecycle: { kind: "condition" as const, conditionId: "bridge" },
      affected: { kind: "page" as const, pageId: "page" },
      observedAt: 10,
      observed: "The bridge disconnected.",
      limitation: "Later activity is not observable.",
      consequence: "Capture is unavailable.",
      route: { kind: "recover" as const, action: "reconnect" }
    };
    const first = await journal.observe(input);
    const repeated = await journal.observe({ ...input, observedAt: 20 });
    expect(repeated).toBe(first);
    expect(journal.currentBoundary().sequence).toBe(1);
  });

  it("treats a newer rule version as a new stable diagnostic identity", async () => {
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: "panel-version" });
    const input = {
      code: "ls.subscription.error",
      severity: "error" as const,
      lifecycle: { kind: "occurrence" as const, occurrenceId: "event-1" },
      affected: { kind: "evidence" as const, intervalId: "history", sequence: 1, eventId: "event-1" },
      observedAt: 10,
      observed: "SubscriptionListener reported an error.",
      limitation: "The callback does not expose server state.",
      consequence: "Updates may be unavailable.",
      route: { kind: "inspect-affected" as const }
    };
    const version1 = await journal.observe(input);
    const version2 = await journal.observe({ ...input, ruleVersion: 2 });
    expect(version2.id).not.toBe(version1.id);
    expect(version2.observationBoundary.sequence).toBe(2);
    expect((await journal.query({ ruleVersion: 2 })).observations).toEqual([version2]);
  });

  it.each(["memory", "indexeddb"] as const)("keeps %s lifecycle identity after observation retention loss", async (tier) => {
    const indexedDB = new IDBFactory();
    const panelSessionId = `retained-lifecycle-${tier}`;
    let journal = tier === "memory"
      ? createMemoryDiagnosticObservationJournal({ panelSessionId })
      : await openIndexedDbDiagnosticObservationJournal({ panelSessionId, indexedDB });
    const occurrenceInput = {
      code: "ls.subscription.error",
      severity: "error" as const,
      lifecycle: { kind: "occurrence" as const, occurrenceId: "event-1" },
      affected: { kind: "evidence" as const, intervalId: "history", sequence: 1, eventId: "event-1" },
      observedAt: 10,
      observed: "SubscriptionListener reported an error.",
      limitation: "The callback does not expose server state.",
      consequence: "Updates may be unavailable.",
      route: { kind: "inspect-affected" as const }
    };
    const occurrence = await journal.observe(occurrenceInput);
    const condition = await journal.observe({
      ...occurrenceInput,
      code: "workbench.capture.disconnected",
      lifecycle: { kind: "condition", conditionId: "bridge" },
      affected: { kind: "page", pageId: "page" },
      observed: "The bridge disconnected."
    });
    await journal.discardRetainedThrough(condition.observationBoundary);
    if (tier === "indexeddb") {
      await journal.close();
      journal = await openIndexedDbDiagnosticObservationJournal({ panelSessionId, indexedDB });
    }
    expect(await journal.observe(occurrenceInput)).toMatchObject({ id: occurrence.id, observationBoundary: occurrence.observationBoundary });
    expect(journal.currentBoundary().sequence).toBe(2);
    expect(await journal.resolveCondition({
      code: condition.code,
      conditionId: "bridge",
      affected: condition.affected,
      observedAt: 20
    })).toMatchObject({ lifecycle: { kind: "condition", state: "resolved" }, observationBoundary: { sequence: 3 } });
  });

  it("serializes concurrent duplicate offers into one committed occurrence", async () => {
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: "panel-concurrent" });
    const input = {
      code: "ls.subscription.error",
      severity: "error" as const,
      lifecycle: { kind: "occurrence" as const, occurrenceId: "event-1" },
      affected: { kind: "evidence" as const, intervalId: "history", sequence: 1, eventId: "event-1" },
      observedAt: 10,
      observed: "SubscriptionListener reported an error.",
      limitation: "The callback does not expose server state.",
      consequence: "Updates may be unavailable.",
      route: { kind: "inspect-affected" as const }
    };
    const [first, duplicate] = await Promise.all([journal.observe(input), journal.observe(input)]);
    expect(duplicate).toBe(first);
    expect(journal.currentBoundary().sequence).toBe(1);
    expect(await journal.replay()).toEqual([first]);
  });

  it("applies bounded retention before persistence and reports the lost cursor range", async () => {
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: "panel-capacity", maxRetainedObservations: 2 });
    const lower = journal.currentBoundary();
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      await journal.observe({
        code: "ls.subscription.error",
        severity: "error",
        lifecycle: { kind: "occurrence", occurrenceId: `event-${sequence}` },
        affected: { kind: "evidence", intervalId: "history", sequence, eventId: `event-${sequence}` },
        observedAt: sequence,
        observed: "SubscriptionListener reported an error.",
        limitation: "The callback does not expose server state.",
        consequence: "Updates may be unavailable.",
        route: { kind: "inspect-affected" }
      });
    }
    expect(await journal.replay()).toHaveLength(2);
    expect(await journal.query({ after: lower })).toMatchObject({ status: "retention-gap", retention: "limited" });
  });

  it.each(["memory", "indexeddb"] as const)("keeps %s replay, retention, Clear, and close semantics deterministic", async (tier) => {
    const indexedDB = new IDBFactory();
    const journal = tier === "memory"
      ? createMemoryDiagnosticObservationJournal({ panelSessionId: `panel-${tier}` })
      : await openIndexedDbDiagnosticObservationJournal({ panelSessionId: `panel-${tier}`, indexedDB });
    const initial = journal.currentBoundary();
    const occurrence = await journal.observe({
      code: "ls.subscription.lost-updates",
      severity: "warning",
      lifecycle: { kind: "occurrence", occurrenceId: "lost-1" },
      affected: { kind: "subscription", pageId: "page", clientId: "client", subscriptionId: "sub" },
      observedAt: 300,
      observed: "The client reported lost updates.",
      limitation: "The callback reports a count, not the missing values.",
      consequence: "The local view may omit updates.",
      route: { kind: "inspect-affected" }
    });
    expect(await journal.observe({ ...occurrence, lifecycle: { kind: "occurrence", occurrenceId: "lost-1" } })).toBe(occurrence);
    const condition = await journal.observe({
      code: "workbench.capture.disconnected",
      severity: "error",
      lifecycle: { kind: "condition", conditionId: "bridge" },
      affected: { kind: "page", pageId: "page" },
      observedAt: 310,
      observed: "The inspected-page bridge disconnected.",
      limitation: "Workbench cannot observe later page activity.",
      consequence: "No later activity can become Evidence.",
      route: { kind: "recover", action: "reconnect-inspected-page" }
    });
    const resolved = await journal.resolveCondition({
      code: condition.code,
      conditionId: "bridge",
      affected: condition.affected,
      observedAt: 320
    });
    expect(journal.currentBoundary().sequence).toBe(3);
    expect(await journal.replay()).toEqual([occurrence, condition, resolved]);
    expect(journal.currentBoundary().sequence).toBe(3);
    if (tier === "indexeddb") {
      const reopened = await openIndexedDbDiagnosticObservationJournal({ panelSessionId: `panel-${tier}`, indexedDB });
      expect(await reopened.replay()).toEqual([occurrence, condition, resolved]);
      expect(reopened.currentBoundary()).toEqual(journal.currentBoundary());
      await reopened.close();
    }

    const feedStatuses: string[] = [];
    journal.subscribe(initial, (publication) => {
      if (publication.type === "status") feedStatuses.push(publication.status);
    });
    await journal.discardRetainedThrough(occurrence.observationBoundary);
    expect(feedStatuses).toContain("retention-gap");
    expect(await journal.query({ after: initial })).toMatchObject({
      status: "retention-gap",
      coverage: "limited",
      retention: "limited",
      observations: [condition, resolved]
    });
    const beforeClear = journal.currentBoundary();
    await journal.clear();
    expect(feedStatuses).toContain("cleared");
    expect(await journal.query({ after: beforeClear })).toMatchObject({
      status: "cleared",
      coverage: "limited",
      retention: "cleared",
      observations: []
    });
    await journal.close();
    expect(await journal.query()).toMatchObject({ status: "closed", coverage: "unavailable", observations: [] });
  });

  it.each(["unsupported", "unavailable"] as const)("reports %s query coverage without renderer state", async (status) => {
    const journal = createUnavailableDiagnosticObservationJournal({ panelSessionId: `panel-${status}`, status });
    expect(await journal.query({ after: journal.currentBoundary() })).toMatchObject({
      status,
      coverage: "unavailable",
      observations: []
    });
    await expect(journal.observe({} as never)).rejects.toThrow(status);
  });

  it("fails closed for future, reversed, and future feed cursors", async () => {
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: "panel-cursors" });
    const current = journal.currentBoundary();
    const future = { ...current, sequence: 2 };
    expect(await journal.query({ after: current, through: future })).toMatchObject({ status: "unavailable", coverage: "unavailable" });
    expect(await journal.query({ after: future, through: current })).toMatchObject({ status: "unsupported", coverage: "unavailable" });
    const statuses: string[] = [];
    journal.subscribe(future, (publication) => {
      if (publication.type === "status") statuses.push(publication.status);
    });
    expect(statuses).toEqual(["unavailable"]);
  });

  it("reports unsupported newer IndexedDB schema and rejects malformed persisted observations", async () => {
    const newerFactory = new IDBFactory();
    const newerRequest = newerFactory.open("lsew-diagnostics-v1-newer", 2);
    newerRequest.onupgradeneeded = () => newerRequest.result.createObjectStore("diagnosticState");
    (await requestResult(newerRequest)).close();
    const newer = await openIndexedDbDiagnosticObservationJournal({ panelSessionId: "newer", indexedDB: newerFactory });
    expect(await newer.query()).toMatchObject({ status: "unsupported", coverage: "unavailable" });

    const malformedFactory = new IDBFactory();
    const malformedRequest = malformedFactory.open("lsew-diagnostics-v1-malformed", 1);
    malformedRequest.onupgradeneeded = () => malformedRequest.result.createObjectStore("diagnosticState");
    const malformedDatabase = await requestResult(malformedRequest);
    const transaction = malformedDatabase.transaction("diagnosticState", "readwrite");
    transaction.objectStore("diagnosticState").put({ intervalOrdinal: 1, sequence: 1, retainedThrough: 0, records: [{ rawMessage: "secret" }] }, "state");
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    malformedDatabase.close();
    const malformed = await openIndexedDbDiagnosticObservationJournal({ panelSessionId: "malformed", indexedDB: malformedFactory });
    expect(await malformed.query()).toMatchObject({ status: "unavailable", coverage: "unavailable", observations: [] });

    const discontinuousFactory = new IDBFactory();
    const source = createMemoryDiagnosticObservationJournal({ panelSessionId: "discontinuous" });
    const base = {
      code: "ls.subscription.error",
      severity: "error" as const,
      affected: { kind: "page" as const, pageId: "page" },
      observedAt: 1,
      observed: "An error occurred.",
      limitation: "Only the callback is known.",
      consequence: "Updates may be unavailable.",
      route: { kind: "inspect-affected" as const }
    };
    await source.observe({ ...base, lifecycle: { kind: "occurrence", occurrenceId: "one" } });
    const second = await source.observe({ ...base, lifecycle: { kind: "occurrence", occurrenceId: "two" } });
    const discontinuousRequest = discontinuousFactory.open("lsew-diagnostics-v1-discontinuous", 1);
    discontinuousRequest.onupgradeneeded = () => discontinuousRequest.result.createObjectStore("diagnosticState");
    const discontinuousDatabase = await requestResult(discontinuousRequest);
    const discontinuousTransaction = discontinuousDatabase.transaction("diagnosticState", "readwrite");
    discontinuousTransaction.objectStore("diagnosticState").put({ intervalOrdinal: 1, sequence: 2, retainedThrough: 0, records: [second], current: [second] }, "state");
    await new Promise<void>((resolve, reject) => {
      discontinuousTransaction.oncomplete = () => resolve();
      discontinuousTransaction.onerror = () => reject(discontinuousTransaction.error);
    });
    discontinuousDatabase.close();
    const discontinuous = await openIndexedDbDiagnosticObservationJournal({ panelSessionId: "discontinuous", indexedDB: discontinuousFactory });
    expect(await discontinuous.query()).toMatchObject({ status: "unavailable", observations: [] });
  });
});
