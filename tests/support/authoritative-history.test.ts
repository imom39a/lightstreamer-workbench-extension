import { describe, expect, it } from "vitest";

import { type LightstreamerEventEnvelope } from "../../src/core/event-envelope";
import { type EvidenceRead, type Outcome } from "../../src/core/event-history-authoritative";
import { type EvidenceQueryRequest } from "../../src/core/evidence-filter-contract";
import { createAuthoritativeHistory } from "./authoritative-history";

function event(id: string): LightstreamerEventEnvelope {
  return {
    id,
    timestamp: 1_700_000_000_000,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    subscription: { id: "orders", mode: "COMMAND" },
    update: { command: "ADD", key: id, fields: { command: "ADD", key: id } }
  };
}

describe("authoritative EventHistory test support", () => {
  it("preserves payloads on requested page, Find and lookup Evidence across repeated queries", async () => {
    const history = createAuthoritativeHistory({ precommitted: [event("first"), event("second")] });
    const request: EvidenceQueryRequest = {
      at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 },
      filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] },
      find: { text: "second", reveal: false, includeMatchPayload: true }
    };
    try {
      const first = await history.query!(request);
      if (!first.ok) throw new Error(first.problem.message);
      expect(first.value.page.evidence[0]?.payload).toMatchObject({ id: "first" });
      expect(first.value.find?.results?.[0]?.payload).toMatchObject({ id: "second" });
      expect(first.value.find?.match?.payload).toMatchObject({ id: "second", update: { key: "second" } });
      const selected = first.value.find!.first!;

      await history.offer(event("third")).settled;
      const hydrated = await history.query!({ ...request, at: first.value.readPoint, includePayload: true, lookup: selected });
      if (!hydrated.ok) throw new Error(hydrated.problem.message);
      expect(hydrated.value.totals).toEqual({ matching: 2, inScope: 2 });
      expect(hydrated.value.page.evidence[0]?.payload).toMatchObject({ id: "first" });
      expect(hydrated.value.find?.results?.[0]?.payload).toMatchObject({ id: "second" });
      expect(hydrated.value.lookup).toMatchObject({ state: "RETAINED", evidence: { payload: { id: "second" } } });
      const again = await history.query!({ ...request, at: first.value.readPoint, find: { ...request.find!, reveal: true, includeMatchPayload: false } });
      if (!again.ok) throw new Error(again.problem.message);
      expect(again.value.page.evidence[0]?.payload).toMatchObject({ id: "first" });
      expect(again.value.find?.results?.[0]?.payload).toMatchObject({ id: "second" });
      expect(again.value.find?.page?.evidence[0]?.payload).toMatchObject({ id: "second" });
      expect(again.value.find?.window?.[0]?.payload).toMatchObject({ id: "second" });
      expect(again.value.page.evidence[0]?.payload).not.toBe(first.value.page.evidence[0]?.payload);
      expect(again.value.find?.match).toBeUndefined();

      await history.clear();
      await history.offer(event("after-clear")).settled;
      const cleared = await history.query!({ ...request, find: undefined, includePayload: true });
      expect(cleared).toMatchObject({ ok: true, value: { totals: { matching: 1, inScope: 1 }, page: { evidence: [{ payload: { id: "after-clear" } }] } } });
    } finally { await history.close(); }
  });

  it("constructs with ordered evidence, replays once, follows now, and controls receipts", async () => {
    const history = createAuthoritativeHistory({
      intervalId: "support-session:interval-1",
      precommitted: [
        event("seed-event"),
        {
          kind: "topology-checkpoint",
          id: "seed-checkpoint",
          checkpoint: { pageEpoch: "page-1" }
        }
      ],
      offerDecisions: ["commit", "refuse"]
    });
    expect(history).not.toBeInstanceOf(Promise);
    expect(history.storage).toEqual({ mode: "memory" });

    const replayed: string[] = [];
    history.follow({ from: "CURRENT_INTERVAL_START" }, (publication) => {
      if (publication.type === "committed-evidence") {
        replayed.push(...publication.evidence.map(({ eventId }) => eventId));
      }
    });
    expect(replayed).toEqual(["seed-event", "seed-checkpoint"]);

    const followedNow: string[] = [];
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "committed-evidence") {
        followedNow.push(...publication.evidence.map(({ eventId }) => eventId));
      }
    });
    expect(followedNow).toEqual([]);

    const committed = history.offer(event("accepted"));
    const refused = history.offer(event("refused"));
    expect(committed.intake).toBe("QUEUED");
    expect(refused.intake).toBe("REFUSED");
    await expect(committed.settled).resolves.toEqual({
      outcome: "BECAME_EVIDENCE",
      evidence: {
        intervalId: "support-session:interval-1",
        sequence: 3,
        eventId: "accepted"
      }
    });
    await expect(refused.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      committedEvidenceBoundary: { sequence: 3, eventId: "accepted" }
    });
    expect(replayed).toEqual(["seed-event", "seed-checkpoint", "accepted"]);
    expect(followedNow).toEqual(["accepted"]);

    const read: Promise<Outcome<EvidenceRead>> = history.read({});
    expect(read).toBeInstanceOf(Promise);
    await expect(read).resolves.toMatchObject({
      ok: true,
      value: {
        interval: { id: "support-session:interval-1", ordinal: 1 },
        total: 3,
        evidence: [
          { sequence: 1, eventId: "seed-event" },
          { sequence: 2, eventId: "seed-checkpoint" },
          { sequence: 3, eventId: "accepted" }
        ],
        committedEvidenceBoundary: { sequence: 3, eventId: "accepted" }
      }
    });
    await expect(history.read({ candidateKind: "lightstreamer", order: "asc", limit: 1 })).resolves.toMatchObject({
      ok: true,
      value: {
        total: 2,
        evidence: [{ sequence: 1, eventId: "seed-event" }]
      }
    });

    const cleared = history.clear();
    expect(cleared).toBeInstanceOf(Promise);
    await expect(cleared).resolves.toEqual({
      ok: true,
      value: {
        previousInterval: { id: "support-session:interval-1", ordinal: 1 },
        interval: { id: "support-session:interval-2", ordinal: 2 }
      }
    });
    await expect(history.offer(event("after-clear")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { intervalId: "support-session:interval-2", sequence: 4 }
    });

    const invalid = history.offer({ kind: "invalid" } as never);
    expect(invalid.intake).toBe("REFUSED");
    await expect(invalid.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "INVALID_CANDIDATE" },
      committedEvidenceBoundary: { sequence: 4, eventId: "after-clear" }
    });

    const closed = history.close();
    expect(closed).toBeInstanceOf(Promise);
    await expect(closed).resolves.toMatchObject({
      ok: true,
      value: { finalCommittedEvidenceBoundary: { sequence: 4, eventId: "after-clear" } }
    });
    await expect(history.clear()).resolves.toMatchObject({
      ok: false,
      problem: { code: "HISTORY_CLOSED" }
    });
    await expect(history.read({})).resolves.toMatchObject({
      ok: false,
      problem: { code: "HISTORY_CLOSED" }
    });
    const afterClose = history.offer(event("after-close"));
    expect(afterClose.intake).toBe("REFUSED");
    await expect(afterClose.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "HISTORY_CLOSED" },
      committedEvidenceBoundary: { sequence: 4, eventId: "after-clear" }
    });
  });
});
