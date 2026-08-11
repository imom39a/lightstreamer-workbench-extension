import { describe, expect, it } from "vitest";

import { type LightstreamerEventEnvelope } from "../../src/core/event-envelope";
import { type EvidenceRead, type Outcome } from "../../src/core/event-history-authoritative";
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
