import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import {
  commitSubscriptionDiagnosticProposalsAdvisory,
  createSubscriptionDiagnosticProducer
} from "../src/core/subscription-diagnostic-producer";
import {
  createMemoryDiagnosticObservationJournal,
  openIndexedDbDiagnosticObservationJournal,
  type DiagnosticObservationJournal
} from "../src/core/diagnostic-observation";
import type { CommittedEvidence } from "../src/core/event-history-authoritative";

function loss(sequence: number): CommittedEvidence {
  return {
    intervalId: "history-replay",
    sequence,
    eventId: `loss-${sequence}`,
    candidate: {
      id: `loss-${sequence}`,
      timestamp: 1_000 + sequence,
      direction: "inbound",
      source: "server",
      synthetic: false,
      kind: "lost-updates",
      client: { id: "client" },
      subscription: { id: "subscription", mode: "RAW" },
      item: { name: "prices", position: 1 },
      update: { lostUpdates: sequence }
    }
  };
}

describe("subscription diagnostic persistence adapter", () => {
  it("preserves exact occurrences across memory replay and starts cleanly after Clear", async () => {
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: "producer-memory" });
    const producer = createSubscriptionDiagnosticProducer();
    const inputs = [loss(1), loss(2)];
    for (const input of inputs) {
      await commitSubscriptionDiagnosticProposalsAdvisory(journal, producer.applyCommittedEvidence(input));
    }
    const initialBoundary = journal.currentBoundary();
    expect((await journal.query()).observations.map(({ evidenceBoundary }) => evidenceBoundary?.eventId)).toEqual(["loss-1", "loss-2"]);

    const replayProducer = createSubscriptionDiagnosticProducer();
    for (const input of inputs) {
      await commitSubscriptionDiagnosticProposalsAdvisory(journal, replayProducer.applyCommittedEvidence(input));
    }
    expect(journal.currentBoundary()).toEqual(initialBoundary);

    await journal.clear();
    replayProducer.clear();
    await commitSubscriptionDiagnosticProposalsAdvisory(journal, replayProducer.applyCommittedEvidence(loss(1)));
    expect((await journal.query()).observations).toHaveLength(1);
    expect(journal.currentBoundary()).toMatchObject({ sequence: 1 });
  });

  it("restores producer observations from IndexedDB and keeps diagnostic failure advisory", async () => {
    const panelSessionId = `producer-idb-${Date.now()}-${Math.random()}`;
    const producer = createSubscriptionDiagnosticProducer();
    const journal = await openIndexedDbDiagnosticObservationJournal({ panelSessionId });
    await commitSubscriptionDiagnosticProposalsAdvisory(journal, producer.applyCommittedEvidence(loss(1)));
    await journal.close();

    const reopened = await openIndexedDbDiagnosticObservationJournal({ panelSessionId });
    expect((await reopened.replay()).map(({ code, evidenceBoundary }) => [code, evidenceBoundary?.eventId])).toEqual([
      ["ls.subscription.lost-updates", "loss-1"]
    ]);
    await reopened.close();

    const failure = new Error("diagnostic store unavailable");
    const failures: Error[] = [];
    const unavailable = {
      observe: async () => { throw failure; },
      resolveCondition: async () => { throw failure; }
    } as unknown as DiagnosticObservationJournal;
    const outcome = await commitSubscriptionDiagnosticProposalsAdvisory(
      unavailable,
      producer.applyCommittedEvidence(loss(2)),
      (error) => failures.push(error instanceof Error ? error : new Error(String(error)))
    );
    expect(outcome).toEqual({ committed: 0, failed: 1 });
    expect(failures).toEqual([failure]);
  });
});
