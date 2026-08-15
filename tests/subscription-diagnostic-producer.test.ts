import { describe, expect, it } from "vitest";

import { createSubscriptionDiagnosticProducer } from "../src/core/subscription-diagnostic-producer";
import type { CommittedEvidence } from "../src/core/event-history-authoritative";
import type { EventUpdate } from "../src/core/event-envelope";

function committed(sequence: number, candidate: CommittedEvidence["candidate"]): CommittedEvidence {
  return { intervalId: "history-1", sequence, eventId: candidate.id, candidate };
}

describe("subscription diagnostic producer", () => {
  it("normalizes one first-level callback as one exact Evidence occurrence", () => {
    const producer = createSubscriptionDiagnosticProducer();
    const proposals = producer.applyCommittedEvidence(committed(1, {
      id: "error-1",
      timestamp: 100,
      direction: "inbound",
      source: "server",
      synthetic: false,
      kind: "subscription-error",
      client: { id: "client-1", sessionId: "session-1" },
      subscription: { id: "sub-1", mode: "COMMAND" },
      raw: { callback: "onSubscriptionError", args: [26, "[redacted]"] }
    }));

    expect(proposals).toEqual([
      expect.objectContaining({
        kind: "observe",
        observation: expect.objectContaining({
          code: "ls.subscription.unfiltered-refused",
          lifecycle: { kind: "occurrence", occurrenceId: expect.stringMatching(/^evidence:[0-9a-f]{16}$/) },
          affected: { kind: "evidence", intervalId: "history-1", sequence: 1, eventId: "error-1" },
          evidenceBoundary: { intervalId: "history-1", sequence: 1, eventId: "error-1" },
          originalCode: 26,
          resultRef: { kind: "evidence", intervalId: "history-1", sequence: 1, eventId: "error-1" }
        })
      })
    ]);
  });

  it("uses only committed topology checkpoints to attribute second-level errors to the exact key", () => {
    const producer = createSubscriptionDiagnosticProducer();
    producer.applyCommittedEvidence(committed(1, {
      kind: "topology-checkpoint",
      id: "checkpoint-1",
      checkpoint: {
        pageEpoch: "page-1",
        coverage: { status: "complete", getters: {} },
        records: [
          { kind: "client", id: "client-1", pageEpoch: "page-1", captureSequence: 1 },
          { kind: "session", id: "session:client-1:S-1", parentId: "client-1", clientId: "client-1", pageEpoch: "page-1", captureSequence: 1, values: { sessionId: { state: "real", value: "S-1" } } },
          { kind: "subscription", id: "sub-1", parentId: "client-1", clientId: "client-1", subscriptionId: "sub-1", pageEpoch: "page-1", captureSequence: 1 }
        ]
      }
    }));
    const event = {
      id: "second-error",
      timestamp: 200,
      direction: "inbound" as const,
      source: "server" as const,
      synthetic: false,
      kind: "item-update" as const,
      client: { id: "client-1", sessionId: "S-1" },
      subscription: { id: "sub-1", mode: "COMMAND" },
      // This uncommitted value must never override the committed page identity.
      topology: { pageEpoch: "uncommitted-page" } as never,
      raw: { callback: "onCommandSecondLevelSubscriptionError", args: [17, "[redacted]", "key-7"] }
    };

    const proposals = producer.applyCommittedEvidence(committed(2, event));

    expect(proposals).toEqual([
      expect.objectContaining({
        kind: "observe",
        observation: expect.objectContaining({
          code: "ls.subscription.second-level.data-adapter-refused",
          affected: { kind: "item", pageId: "page-1", clientId: "client-1", subscriptionId: "sub-1", item: "key-7" },
          originalCode: 17,
          evidenceBoundary: { intervalId: "history-1", sequence: 2, eventId: "second-error" }
        })
      })
    ]);
  });

  it("keeps every first- and second-level loss callback as a distinct counted occurrence without copying unsafe messages", () => {
    const producer = createSubscriptionDiagnosticProducer();
    const first = {
      id: "loss-repeat",
      timestamp: 300,
      direction: "inbound" as const,
      source: "server" as const,
      synthetic: false,
      kind: "lost-updates" as const,
      client: { id: "client-1" },
      subscription: { id: "sub-1", mode: "RAW" },
      item: { name: "prices", position: 1 },
      update: { lostUpdates: 4 },
      raw: { message: "Bearer private-token" }
    };
    const second = {
      ...first,
      id: "second-loss",
      kind: "item-update" as const,
      update: { lostUpdates: 2 },
      raw: { callback: "onCommandSecondLevelItemLostUpdates", args: [2, "key-9"], safeMessage: "Two updates were reported lost." }
    };

    const proposals = [
      ...producer.applyCommittedEvidence(committed(3, first)),
      ...producer.applyCommittedEvidence(committed(4, first)),
      ...producer.applyCommittedEvidence(committed(5, second))
    ].filter((proposal) => proposal.kind === "observe");

    expect(proposals.map((proposal) => proposal.observation.code)).toEqual([
      "ls.subscription.lost-updates",
      "ls.subscription.lost-updates",
      "ls.subscription.second-level.lost-updates"
    ]);
    expect(proposals.map((proposal) => proposal.observation.lifecycle)).toEqual([
      { kind: "occurrence", occurrenceId: expect.stringMatching(/^evidence:[0-9a-f]{16}$/) },
      { kind: "occurrence", occurrenceId: expect.stringMatching(/^evidence:[0-9a-f]{16}$/) },
      { kind: "occurrence", occurrenceId: expect.stringMatching(/^evidence:[0-9a-f]{16}$/) }
    ]);
    expect(new Set(proposals.map((proposal) => proposal.observation.lifecycle.kind === "occurrence" && proposal.observation.lifecycle.occurrenceId)).size).toBe(3);
    expect(proposals[0]?.observation.observed).toContain("4");
    expect(proposals[0]?.observation.limitation).toContain("does not enumerate");
    expect(JSON.stringify(proposals)).not.toContain("private-token");
    expect(proposals[2]?.observation.safeMessage).toBe("Two updates were reported lost.");
  });

  it("describes snapshot phases without manufacturing an unseen server sequence and resolves phase conditions", () => {
    const producer = createSubscriptionDiagnosticProducer();
    producer.applyCommittedEvidence(committed(5, {
      kind: "topology-checkpoint",
      id: "checkpoint-snapshot",
      checkpoint: {
        pageEpoch: "page-1",
        coverage: { status: "complete", getters: {} },
        records: [{ kind: "subscription", id: "sub-1", clientId: "client-1", pageEpoch: "page-1", captureSequence: 5 }]
      }
    }));
    const snapshotEvent = (id: string, sequence: number, kind: "item-update" | "end-of-snapshot" | "clear-snapshot", isSnapshot?: boolean) =>
      producer.applyCommittedEvidence(committed(sequence, {
        id,
        timestamp: 400 + sequence,
        direction: "inbound",
        source: "server",
        synthetic: false,
        kind,
        client: { id: "client-1", sessionId: "S-1" },
        subscription: { id: "sub-1", mode: "MERGE" },
        item: { name: "prices", position: 1 },
        update: isSnapshot === undefined ? undefined : { isSnapshot }
      }));

    expect(snapshotEvent("snapshot", 6, "item-update", true)).toEqual([]);
    const incomplete = snapshotEvent("live-before-end", 7, "item-update", false);
    expect(incomplete).toEqual([
      expect.objectContaining({ kind: "observe", observation: expect.objectContaining({
        code: "ls.subscription.snapshot.phase-incomplete",
        lifecycle: expect.objectContaining({ kind: "condition" })
      }) })
    ]);
    const completed = snapshotEvent("end", 8, "end-of-snapshot");
    expect(completed.map((proposal) => proposal.kind)).toEqual(["observe", "resolve"]);
    expect(completed[0]).toMatchObject({ observation: { code: "ls.subscription.snapshot.completed" } });
    expect(completed[1]).toMatchObject({ resolution: { code: "ls.subscription.snapshot.phase-incomplete", evidenceBoundary: { eventId: "end" } } });

    const late = snapshotEvent("late-snapshot", 9, "item-update", true);
    expect(late).toEqual([expect.objectContaining({ observation: expect.objectContaining({ code: "ls.subscription.snapshot.phase-inconsistent" }) })]);

    const insufficient = snapshotEvent("clear-unknown", 10, "clear-snapshot");
    expect(insufficient.map((proposal) => proposal.kind === "observe" ? proposal.observation.code : "resolve")).toEqual([
      "ls.subscription.snapshot.cleared",
      "resolve"
    ]);
  });

  it("normalizes COMMAND anomalies at the observed or local-effective boundary and resolves reducer incompleteness", () => {
    const producer = createSubscriptionDiagnosticProducer();
    const checkpoint = (id: string, sequence: number, status: "partial" | "complete") => producer.applyCommittedEvidence(committed(sequence, {
      kind: "topology-checkpoint",
      id,
      checkpoint: {
        pageEpoch: "page-command",
        coverage: { status, getters: {}, ...(status === "partial" ? { reason: "limit-exceeded" } : {}) },
        records: [{ kind: "subscription", id: "command-sub", clientId: "command-client", pageEpoch: "page-command", captureSequence: sequence }]
      }
    }));
    checkpoint("partial", 11, "partial");
    const command = producer.applyCommittedEvidence(committed(12, {
      id: "unknown-update",
      timestamp: 500,
      direction: "inbound",
      source: "server",
      synthetic: false,
      kind: "item-update",
      client: { id: "command-client", sessionId: "S-command" },
      subscription: { id: "command-sub", mode: "COMMAND" },
      item: { name: "orders", position: 1 },
      update: { isSnapshot: false, command: "UPDATE", key: "missing", fields: { command: "UPDATE", key: "missing", qty: 2 }, changedFields: { qty: 2 } }
    }));

    expect(command.filter((proposal) => proposal.kind === "observe").map((proposal) => proposal.observation.code)).toEqual([
      "ls.command.unknown-key-update",
      "ls.command.reducer-incomplete"
    ]);
    expect(command[0]).toMatchObject({ observation: {
      evidenceBoundary: { eventId: "unknown-update" },
      resultRef: { kind: "projection", projection: "observed-server-command-state", key: "command-sub:orders:missing" }
    } });
    const resolved = checkpoint("complete", 13, "complete");
    expect(resolved).toEqual([expect.objectContaining({ kind: "resolve", resolution: expect.objectContaining({ code: "ls.command.reducer-incomplete" }) })]);

    const local = producer.applyCommittedEvidence(committed(14, {
      id: "local-invalid",
      timestamp: 510,
      direction: "inbound",
      source: "synthetic",
      synthetic: true,
      kind: "item-update",
      client: { id: "command-client", sessionId: "S-command" },
      subscription: { id: "command-sub", mode: "COMMAND" },
      item: { name: "orders", position: 1 },
      update: { isSnapshot: false, command: "INVALID", key: "k", fields: { command: "INVALID", key: "k" }, changedFields: { command: "INVALID" } }
    }));
    expect(local).toEqual([expect.objectContaining({ observation: expect.objectContaining({
      code: "ls.command.unsupported-command",
      resultRef: expect.objectContaining({ projection: "local-effective-command-state" })
    }) })]);
  });

  it("keeps the subscription-error catalog and COMMAND reducer codes stable", () => {
    const errorCode = (callback: "onSubscriptionError" | "onCommandSecondLevelSubscriptionError", code: number) => {
      const producer = createSubscriptionDiagnosticProducer();
      const second = callback === "onCommandSecondLevelSubscriptionError";
      const proposals = producer.applyCommittedEvidence(committed(20, {
        id: `${callback}-${code}`,
        timestamp: 600,
        direction: "inbound",
        source: "server",
        synthetic: false,
        kind: second ? "item-update" : "subscription-error",
        client: { id: "client" },
        subscription: { id: "sub", mode: "COMMAND" },
        raw: { callback, args: second ? [code, "[redacted]", "key"] : [code, "[redacted]"] }
      }));
      return proposals[0]?.kind === "observe" ? proposals[0].observation.code : null;
    };
    expect([
      errorCode("onSubscriptionError", 15),
      errorCode("onSubscriptionError", 16),
      errorCode("onSubscriptionError", -1),
      errorCode("onCommandSecondLevelSubscriptionError", 14),
      errorCode("onCommandSecondLevelSubscriptionError", 21),
      errorCode("onCommandSecondLevelSubscriptionError", 24),
      errorCode("onCommandSecondLevelSubscriptionError", 28)
    ]).toEqual([
      "ls.subscription.command-key-missing",
      "ls.subscription.command-field-missing",
      "ls.subscription.application-refused",
      "ls.subscription.second-level.invalid-item",
      "ls.subscription.second-level.group-schema-refused",
      "ls.subscription.second-level.mode-refused",
      "ls.subscription.second-level.unfiltered-refused"
    ]);

    const commandCode = (id: string, update: EventUpdate) => {
      const producer = createSubscriptionDiagnosticProducer();
      const proposals = producer.applyCommittedEvidence(committed(21, {
        id,
        timestamp: 610,
        direction: "inbound",
        source: "server",
        synthetic: false,
        kind: "item-update",
        client: { id: "client" },
        subscription: { id: "sub", mode: "COMMAND" },
        item: { name: "orders", position: 1 },
        update
      }));
      return proposals.filter((proposal) => proposal.kind === "observe").map((proposal) => proposal.observation.code);
    };
    expect(commandCode("missing-command", { isSnapshot: false, command: null, key: "k", fields: { key: "k" } })).toContain("ls.command.missing-command");
    expect(commandCode("missing-key", { isSnapshot: false, command: "ADD", key: null, fields: { command: "ADD" } })).toContain("ls.command.missing-key");
    expect(commandCode("unknown-delete", { isSnapshot: false, command: "DELETE", key: "k", fields: { command: "DELETE", key: "k" } })).toContain("ls.command.unknown-key-delete");
    expect(commandCode("snapshot-update", { isSnapshot: true, command: "UPDATE", key: "k", fields: { command: "UPDATE", key: "k" } })).toContain("ls.command.snapshot-update");
  });

  it("marks phase evidence as insufficient after late attachment and records resubscription without replaying old phases", () => {
    const producer = createSubscriptionDiagnosticProducer();
    const event = (id: string, sequence: number, kind: "subscription-started" | "end-of-snapshot") => producer.applyCommittedEvidence(committed(sequence, {
      id,
      timestamp: 700 + sequence,
      direction: "inbound",
      source: "server",
      synthetic: false,
      kind,
      client: { id: "client" },
      subscription: { id: "sub", mode: "MERGE" },
      item: kind === "end-of-snapshot" ? { name: "prices", position: 1 } : undefined
    }));
    expect(event("first-establishment", 30, "subscription-started")).toEqual([]);
    const insufficient = event("late-end", 31, "end-of-snapshot");
    expect(insufficient.filter((proposal) => proposal.kind === "observe").map((proposal) => proposal.observation.code)).toEqual([
      "ls.subscription.snapshot.completed",
      "ls.subscription.snapshot.phase-insufficient"
    ]);
    expect(insufficient[1]).toMatchObject({ observation: { limitation: expect.stringContaining("late attachment") } });
    const resubscribed = event("second-establishment", 32, "subscription-started");
    expect(resubscribed).toEqual([expect.objectContaining({ observation: expect.objectContaining({ code: "ls.subscription.snapshot.resubscribed" }) })]);
  });

  it("fails diagnostic production closed without throwing into committed-Evidence processing", () => {
    const producer = createSubscriptionDiagnosticProducer();
    const oversized = "x".repeat(300);
    expect(() => producer.applyCommittedEvidence({
      intervalId: "history",
      sequence: 40,
      eventId: oversized,
      candidate: {
        id: oversized,
        timestamp: Number.NaN,
        direction: "inbound",
        source: "server",
        synthetic: false,
        kind: "lost-updates",
        subscription: { id: oversized },
        update: { lostUpdates: 1 }
      }
    })).not.toThrow();
    expect(producer.applyCommittedEvidence({
      intervalId: "history",
      sequence: 40,
      eventId: oversized,
      candidate: {
        id: oversized,
        timestamp: Number.NaN,
        direction: "inbound",
        source: "server",
        synthetic: false,
        kind: "lost-updates",
        subscription: { id: oversized },
        update: { lostUpdates: 1 }
      }
    })).toEqual([]);
  });
});
