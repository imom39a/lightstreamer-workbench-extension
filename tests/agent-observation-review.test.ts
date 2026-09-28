import { describe, expect, it } from "vitest";
import { AGENT_TOOLS, validateAgentCall } from "../src/agent/protocol";
import type { EvidenceReadPoint } from "../src/core/evidence-filter-contract";

const identity = (intervalId: string, sequence: number) => ({
  intervalId,
  pageId: "page-1",
  ownerId: "owner-1",
  sequence,
  eventId: `event-${sequence}`
});

const readPoint = (overrides: Partial<EvidenceReadPoint> = {}): EvidenceReadPoint => ({
  interval: { id: "interval-1", ordinal: 1 },
  committedEvidenceBoundary: identity("interval-1", 5),
  retainedRange: { first: identity("interval-1", 1), last: identity("interval-1", 5) },
  ...overrides
});

describe("agent Evidence observation contract", () => {
  it("rejects malformed after anchors before starting a wait", () => {
    const malformed: EvidenceReadPoint[] = [
      readPoint({ committedEvidenceBoundary: identity("other-interval", 5) }),
      readPoint({ retainedRange: { first: identity("other-interval", 1), last: identity("interval-1", 5) } }),
      readPoint({ committedEvidenceBoundary: identity("interval-1", 4) })
    ];

    for (const after of malformed) {
      expect(() => validateAgentCall("wait_for_evidence", {
        panelSessionId: "panel-1",
        pageEpoch: "epoch-1",
        after,
        timeoutMs: 1000
      })).toThrow();
    }
  });

  it("publishes a bounded result schema for observation status and read point", () => {
    const tool = AGENT_TOOLS.find(candidate => candidate.name === "wait_for_evidence");
    expect(tool).toBeDefined();
    expect((tool!.outputSchema as { anyOf: { required: string[] }[] }).anyOf[0]!.required).toEqual(expect.arrayContaining([
      "status", "after", "readPoint", "evidence", "mayHaveMoreMatches"
    ]));
  });
});
