import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForAgentEvidence, type AgentEvidenceWaitSource } from "../src/extension/panel/agent-evidence-wait";
import type { EvidenceIdentity, EvidenceReadPoint, EvidenceSnapshot } from "../src/core/evidence-filter-contract";
import type { HistoryStatus } from "../src/core/event-history-authoritative";

const identity = (sequence: number): EvidenceIdentity => ({ intervalId: "interval", pageId: "page", ownerId: "owner", sequence, eventId: `event-${sequence}` });
const point = (sequence: number): EvidenceReadPoint => ({ interval: { id: "interval", ordinal: 1 }, committedEvidenceBoundary: sequence ? identity(sequence) : null, retainedRange: sequence ? { first: identity(1), last: identity(sequence) } : null });
const snapshot = (sequence: number, rows: number[] = []): EvidenceSnapshot => ({ readPoint: point(sequence), page: { evidence: rows.map(value => ({ identity: identity(value), timestamp: value, summary: "", searchText: "", facets: {} })), nextCursor: null }, totals: { matching: rows.length, inScope: sequence }, discoveries: new Map(), lookup: null, find: null, evaluation: "COMPLETE", coverage: "COMPLETE", storage: "MEMORY_FALLBACK" });
function fixture() {
  let sequence = 2, epoch = "page";
  let history = { phase: "RUNNING", interval: point(2).interval, committedEvidenceBoundary: identity(2), retainedRange: point(2).retainedRange } as unknown as HistoryStatus;
  const listeners = new Set<() => void>();
  const query = vi.fn(async () => snapshot(sequence, [sequence]));
  const source: AgentEvidenceWaitSource = { status: () => ({ pageEpoch: epoch, history }), subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, query };
  const notify = () => listeners.forEach(listener => listener());
  return { source, listeners, query, notify, setHistory(update: Partial<HistoryStatus>) { history = { ...history, ...update }; notify(); }, advance(value: number) { sequence = value; history = { ...history, committedEvidenceBoundary: identity(value), retainedRange: point(value).retainedRange }; notify(); }, changePage() { epoch = "new-page"; notify(); } };
}
afterEach(() => vi.useRealTimers());
describe("bounded agent Evidence observation", () => {
  it("finds only committed Evidence strictly after the supplied boundary and unsubscribes", async () => {
    const f = fixture(); f.advance(3);
    const result = await waitForAgentEvidence(f.source, { after: point(2), pageEpoch: "page", timeoutMs: 1000 });
    expect(result.status).toBe("MATCHED"); expect(result.evidence.map(row => row.identity.sequence)).toEqual([3]); expect(f.listeners.size).toBe(0);
  });
  it("subscribes before reading and catches a commit during an in-flight read", async () => {
    vi.useFakeTimers(); const f = fixture();
    let release!: (value: EvidenceSnapshot) => void;
    f.query.mockImplementationOnce(() => new Promise(resolve => { expect(f.listeners.size).toBe(1); release = resolve; }));
    const waiting = waitForAgentEvidence(f.source, { after: point(2), pageEpoch: "page", timeoutMs: 1000 });
    f.advance(3); release(snapshot(2, [2]));
    await vi.advanceTimersByTimeAsync(110);
    expect((await waiting).status).toBe("MATCHED"); expect(f.query).toHaveBeenCalledTimes(2);
  });
  it("coalesces notifications without querying unchanged boundaries or overlapping reads", async () => {
    vi.useFakeTimers(); const f = fixture();
    const waiting = waitForAgentEvidence(f.source, { after: point(2), pageEpoch: "page", timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1);
    for (let i = 0; i < 100; i++) f.notify();
    await vi.advanceTimersByTimeAsync(200); expect(f.query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); expect((await waiting).status).toBe("TIMED_OUT"); expect(f.listeners.size).toBe(0);
  });
  it("performs one immediate query for a zero-duration observation", async () => {
    const f = fixture();
    expect((await waitForAgentEvidence(f.source, { after: point(2), pageEpoch: "page", timeoutMs: 0 })).status).toBe("TIMED_OUT");
    expect(f.query).toHaveBeenCalledTimes(1); expect(f.listeners.size).toBe(0);
  });
  it("queries only unseen suffixes after each complete no-match read", async () => {
    vi.useFakeTimers(); const f = fixture();
    f.query.mockImplementation(async () => snapshot((f.source.status().history.committedEvidenceBoundary?.sequence ?? 0), []));
    const waiting = waitForAgentEvidence(f.source, { after: point(2), pageEpoch: "page", timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1);
    f.advance(10); await vi.advanceTimersByTimeAsync(110);
    f.advance(20); await vi.advanceTimersByTimeAsync(110);
    expect(f.query.mock.calls.map(call => (call as unknown[])[1])).toEqual([{ after: 2, through: 2 }, { after: 2, through: 10 }, { after: 10, through: 20 }]);
    await vi.advanceTimersByTimeAsync(1000); expect((await waiting).status).toBe("TIMED_OUT");
  });
  it("reports a last-moment target change before the coalesced recheck reaches the timeout", async () => {
    vi.useFakeTimers(); const f = fixture();
    const waiting = waitForAgentEvidence(f.source, { after: point(2), pageEpoch: "page", timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(80);
    f.changePage();
    await vi.advanceTimersByTimeAsync(20);
    expect((await waiting).status).toBe("TARGET_CHANGED"); expect(f.listeners.size).toBe(0);
  });
  it("cancels an outstanding storage read without waiting for it", async () => {
    const f = fixture(), abort = new AbortController(); let querySignal: AbortSignal | undefined;
    vi.spyOn(f.source, "query").mockImplementation(async signal => { querySignal = signal; return new Promise(() => {}); });
    const waiting = waitForAgentEvidence(f.source, { after: point(2), pageEpoch: "page", timeoutMs: 1000, signal: abort.signal });
    abort.abort(); expect((await waiting).status).toBe("CANCELLED"); expect(querySignal?.aborted).toBe(true); expect(f.listeners.size).toBe(0);
  });
  it.each(["interval", "retention", "gap", "closed", "page"])("reports %s changes separately from timeout", async kind => {
    vi.useFakeTimers(); const f = fixture();
    const waiting = waitForAgentEvidence(f.source, { after: point(2), pageEpoch: "page", timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1);
    if (kind === "interval") f.setHistory({ interval: { id: "new-interval", ordinal: 2 } });
    if (kind === "retention") f.setHistory({ retainedRange: { first: identity(4), last: identity(4) } });
    if (kind === "gap") f.setHistory({ continuity: { state: "GAPPED", gapCount: 1, firstGap: null, latestGap: null } });
    if (kind === "closed") f.setHistory({ phase: "CLOSED" });
    if (kind === "page") f.changePage();
    await vi.advanceTimersByTimeAsync(110);
    const expected = { interval: "HISTORY_CHANGED", retention: "HISTORY_INCOMPLETE", gap: "HISTORY_INCOMPLETE", closed: "HISTORY_UNAVAILABLE", page: "TARGET_CHANGED" };
    expect((await waiting).status).toBe(expected[kind as keyof typeof expected]); expect(f.listeners.size).toBe(0);
  });
});
