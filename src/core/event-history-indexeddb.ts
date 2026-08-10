import {
  AUTHORITATIVE_EVENT_CONTROL_KEY,
  AUTHORITATIVE_EVENT_STORE_NAMES,
  authoritativeEventDatabaseName,
  openAuthoritativeEventDatabase,
  type AuthoritativeEventDatabase
} from "./indexeddb/authoritative-event-db";
import {
  deserializeJournalEvidenceCandidate,
  serializeJournalEvidenceCandidate
} from "./event-history-serialization";
import {
  type CaptureReceipt,
  type ClearResult,
  type CommittedEvidence,
  type EvidenceCandidate,
  type EvidenceQuery,
  type EvidenceRead,
  type EvidenceRef,
  type EventHistory,
  type HistoryInterval,
  type HistoryProblem,
  type HistoryPublication,
  type HistoryStatus,
  type Outcome,
  type CloseResult
} from "./event-history-authoritative";
import { createEventSearchText, matchesEventFilters } from "./event-filter";

export const AUTHORITATIVE_EVENT_HISTORY_BATCH_LIMIT = 256;
export const AUTHORITATIVE_EVENT_HISTORY_SOFT_BATCH_BYTES = 1_048_576;

type ControlRecord = {
  key: typeof AUTHORITATIVE_EVENT_CONTROL_KEY;
  schemaVersion: number;
  recordVersion: 1;
  panelSessionId: string;
  interval: HistoryInterval;
  nextSequence: number;
  committedEvidenceBoundary: EvidenceRef | null;
  retainedRange: { first: EvidenceRef; last: EvidenceRef } | null;
  retainedCount: number;
  replayPayloadBytes: number;
};

type EvidenceRecord = {
  intervalId: string;
  sequence: number;
  eventId: string;
  replayPayload: string;
  serializedBytes: number;
  facets: string[];
};

type Pending = {
  candidate: EvidenceCandidate;
  serialized: ReturnType<typeof serializeJournalEvidenceCandidate>;
  resolve: (result: ReceiptResult) => void;
};

type ReceiptResult =
  | Readonly<{ outcome: "BECAME_EVIDENCE"; evidence: EvidenceRef }>
  | Readonly<{
      outcome: "NOT_EVIDENCE";
      problem: HistoryProblem;
      committedEvidenceBoundary: EvidenceRef | null;
    }>;

type Subscriber = {
  observer: (publication: HistoryPublication) => void;
  replaying: boolean;
  pending: HistoryPublication[];
};

type IndexedDbEventHistoryOptions = Readonly<{
  panelSessionId?: string;
}>;

export async function createIndexedDbEventHistory(
  options: IndexedDbEventHistoryOptions = {}
): Promise<EventHistory> {
  const panelSessionId = options.panelSessionId ?? `session-${Math.random().toString(36).slice(2)}`;
  const database = await openAuthoritativeEventDatabase(authoritativeEventDatabaseName(panelSessionId));
  const loaded = await loadJournal(database, panelSessionId);
  return createHistory(database, loaded);
}

type LoadedJournal = {
  panelSessionId: string;
  interval: HistoryInterval;
  committed: CommittedEvidence[];
  nextSequence: number;
  retainedBytes: number;
  committedEvidenceBoundary: EvidenceRef | null;
};

function createHistory(database: AuthoritativeEventDatabase, loaded: LoadedJournal): EventHistory {
  const subscribers = new Set<Subscriber>();
  const pending: Pending[] = [];
  const idleWaiters: Array<() => void> = [];
  let interval = loaded.interval;
  let committed = loaded.committed;
  let nextSequence = loaded.nextSequence;
  let committedEvidenceBoundary = loaded.committedEvidenceBoundary;
  let retainedBytes = loaded.retainedBytes;
  let captured = committed.length;
  let accepted = committed.length;
  let notAccepted = 0;
  let processing = false;
  let scheduled = false;
  let closing = false;
  let phase: HistoryStatus["phase"] = "RUNNING";
  let clearPromise: Promise<Outcome<ClearResult>> | null = null;
  let lastClearResult: ClearResult | null = null;
  let closePromise: Promise<Outcome<CloseResult>> | null = null;

  function currentBoundary(): EvidenceRef | null {
    return committedEvidenceBoundary;
  }

  function currentRange(): { first: EvidenceRef; last: EvidenceRef } | null {
    return committed.length ? { first: toRef(committed[0]), last: toRef(committed.at(-1)!) } : null;
  }

  function status(problem?: HistoryProblem): HistoryStatus {
    const value: HistoryStatus = deepFreeze({
      phase,
      captureOperation: phase === "RUNNING" && !closing ? "RUNNING" : "STOPPED" as const,
      interval,
      committedEvidenceBoundary: currentBoundary(),
      retainedRange: currentRange(),
      capacity: { tier: "NORMAL" as const, state: phase === "STOPPED" ? "EXHAUSTED" as const : "AVAILABLE" as const },
      fallback: null,
      captured,
      awaitingAcceptance: pending.length,
      accepted,
      notAccepted,
      retained: committed.length
    });
    return problem ? deepFreeze({ ...value, problem }) as HistoryStatus : value;
  }

  function problem(code: HistoryProblem["code"], message: string): HistoryProblem {
    return deepFreeze({ code, message });
  }

  function refused(code: "HISTORY_STOPPED" | "HISTORY_CLOSED"): CaptureReceipt {
    notAccepted += 1;
    const issue = problem(code, code === "HISTORY_CLOSED" ? "Event History is closed." : "Event History stopped at its committed boundary.");
    return { intake: "REFUSED", settled: Promise.resolve({ outcome: "NOT_EVIDENCE", problem: issue, committedEvidenceBoundary: currentBoundary() }) };
  }

  function offer(candidate: EvidenceCandidate): CaptureReceipt {
    if (phase === "CLOSED" || closing) return refused("HISTORY_CLOSED");
    if (phase === "STOPPED") return refused("HISTORY_STOPPED");
    let copied: EvidenceCandidate;
    try {
      copied = copyCandidate(candidate);
    } catch (error) {
      notAccepted += 1;
      const issue = problem("INVALID_CANDIDATE", error instanceof Error ? error.message : "Candidate is not valid Evidence input.");
      return { intake: "REFUSED", settled: Promise.resolve({ outcome: "NOT_EVIDENCE", problem: issue, committedEvidenceBoundary: currentBoundary() }) };
    }
    let resolve!: (result: ReceiptResult) => void;
    const settled = new Promise<ReceiptResult>((finish) => { resolve = finish; });
    pending.push({ candidate: copied, serialized: serializeJournalEvidenceCandidate(copied), resolve });
    captured += 1;
    schedule();
    return { intake: "QUEUED", settled };
  }

  function schedule(): void {
    if (scheduled || processing || pending.length === 0) return;
    scheduled = true;
    globalThis.setTimeout(() => {
      scheduled = false;
      void processPending();
    }, 0);
  }

  async function processPending(): Promise<void> {
    if (processing) return;
    processing = true;
    try {
      while (pending.length > 0 && phase === "RUNNING") {
        const batch: Pending[] = [];
        let batchBytes = 0;
        while (pending.length > 0 && batch.length < AUTHORITATIVE_EVENT_HISTORY_BATCH_LIMIT) {
          const next = pending[0];
          if (batch.length > 0 && batchBytes + next.serialized.bytes > AUTHORITATIVE_EVENT_HISTORY_SOFT_BATCH_BYTES) break;
          batch.push(pending.shift()!);
          batchBytes += next.serialized.bytes;
        }
        const evidence = batch.map((entry, index) => toCommittedEvidence(entry.candidate, interval, nextSequence + index));
        try {
          await commitBatch(database, loaded.panelSessionId, interval, nextSequence, committed, evidence, retainedBytes + batchBytes);
        } catch (error) {
          const issue = problem("JOURNAL_COMMIT_FAILED", error instanceof Error ? error.message : "The Evidence journal could not commit the batch.");
          phase = "STOPPED";
          const rejected = [...batch, ...pending.splice(0)];
          notAccepted += rejected.length;
          for (const entry of rejected) entry.resolve({ outcome: "NOT_EVIDENCE", problem: issue, committedEvidenceBoundary: currentBoundary() });
          publish({ type: "status", status: status(issue), problem: issue });
          break;
        }
        committed = [...committed, ...evidence];
        nextSequence += evidence.length;
        committedEvidenceBoundary = toRef(evidence.at(-1)!);
        retainedBytes += batchBytes;
        accepted += evidence.length;
        const boundary = currentBoundary()!;
        publish(deepFreeze({ type: "committed-evidence" as const, interval, evidence, committedEvidenceBoundary: boundary }));
        for (const [index, entry] of batch.entries()) entry.resolve({ outcome: "BECAME_EVIDENCE", evidence: toRef(evidence[index]) });
      }
    } finally {
      processing = false;
      resolveIdleWaiters();
      if (pending.length > 0 && phase === "RUNNING") schedule();
    }
  }

  function read(query: EvidenceQuery): Promise<Outcome<EvidenceRead>> {
    if (phase === "CLOSED") return Promise.resolve({ ok: false, problem: problem("HISTORY_CLOSED", "Event History is closed.") });
    const intervalSnapshot = [...committed];
    const selected = intervalSnapshot.filter((entry) => {
      if (query.afterSequence !== undefined && entry.sequence <= query.afterSequence) return false;
      if (query.eventId !== undefined && entry.eventId !== query.eventId) return false;
      if (query.filters && entry.candidate.kind !== "topology-checkpoint" && !matchesEventFilters(entry.candidate, query.filters)) return false;
      const searchText = entry.candidate.kind === "topology-checkpoint"
        ? JSON.stringify(entry.candidate).toLowerCase()
        : createEventSearchText(entry.candidate).toLowerCase();
      if (query.find && !searchText.includes(query.find.trim().toLowerCase())) return false;
      return true;
    });
    const ordered = query.order === "desc" ? [...selected].reverse() : selected;
    const offset = Math.max(0, Math.floor(query.offsetFromNewest ?? 0));
    let evidence = ordered;
    if (query.offsetFromNewest !== undefined) {
      const end = ordered.length - offset;
      const start = Math.max(0, end - (query.limit ?? ordered.length));
      evidence = ordered.slice(start, query.limit === undefined ? end : Math.min(end, start + query.limit));
    } else if (query.limit !== undefined) {
      evidence = ordered.slice(0, Math.max(0, query.limit));
    }
    return Promise.resolve({ ok: true, value: deepFreeze({ interval, evidence: [...evidence], total: selected.length, committedEvidenceBoundary, retainedRange: intervalSnapshot.length ? { first: toRef(intervalSnapshot[0]), last: toRef(intervalSnapshot.at(-1)!) } : null }) });
  }

  function clear(): Promise<Outcome<ClearResult>> {
    if (clearPromise) return clearPromise;
    if (lastClearResult && committed.length === 0 && pending.length === 0) return Promise.resolve({ ok: true, value: lastClearResult });
    clearPromise = waitForIdle().then(async () => {
      if (phase === "CLOSED") return { ok: false, problem: problem("HISTORY_CLOSED", "Event History is closed.") };
      if (phase === "STOPPED") return { ok: false, problem: problem("HISTORY_STOPPED", "Stopped Event History cannot be cleared.") };
      const previousInterval = interval;
      const nextInterval = Object.freeze({ id: `${loaded.panelSessionId}:interval-${previousInterval.ordinal + 1}`, ordinal: previousInterval.ordinal + 1 });
      try {
        await clearJournal(database, loaded.panelSessionId, nextInterval, nextSequence, committedEvidenceBoundary);
      } catch (error) {
        const issue = problem("CLEAR_FAILED", error instanceof Error ? error.message : "The History Interval could not be cleared.");
        publish({ type: "status", status: status(issue), problem: issue });
        return { ok: false, problem: issue };
      }
      interval = nextInterval;
      committed = [];
      retainedBytes = 0;
      const result = deepFreeze({ previousInterval, interval });
      lastClearResult = result;
      publish(deepFreeze({ type: "interval-cleared" as const, previousInterval, interval, status: status() }));
      return { ok: true, value: result };
    });
    void clearPromise.finally(() => { clearPromise = null; });
    return clearPromise;
  }

  function close(): Promise<Outcome<CloseResult>> {
    if (closePromise) return closePromise;
    if (phase === "CLOSED") return Promise.resolve({ ok: true, value: closeResult() });
    closing = true;
    closePromise = waitForIdle().then(async () => {
      const finalCommittedEvidenceBoundary = currentBoundary();
      try {
        await clearJournal(database, loaded.panelSessionId, interval, nextSequence, committedEvidenceBoundary);
        database.db.close();
      } catch (error) {
        phase = "CLOSED";
        return { ok: false, problem: problem("CLOSE_FAILED", error instanceof Error ? error.message : "Event History cleanup could not be confirmed.") };
      }
      phase = "CLOSED";
      const result = deepFreeze({ finalCommittedEvidenceBoundary, dataDisposition: "ERASED" as const, cleanupDisposition: "COMPLETE" as const });
      publish({ type: "closed", result });
      return { ok: true, value: result };
    });
    return closePromise;
  }

  function follow(options: { from: "CURRENT_INTERVAL_START" | "NOW" }, observer: (publication: HistoryPublication) => void): () => void {
    const subscriber: Subscriber = { observer, replaying: options.from === "CURRENT_INTERVAL_START", pending: [] };
    subscribers.add(subscriber);
    invoke(subscriber, { type: "status", status: status() });
    if (subscriber.replaying && subscribers.has(subscriber)) {
      for (const evidence of committed) invoke(subscriber, deepFreeze({ type: "committed-evidence" as const, interval, evidence: [evidence], committedEvidenceBoundary: toRef(evidence) }));
      subscriber.replaying = false;
      for (const publication of subscriber.pending.splice(0)) invoke(subscriber, publication);
    }
    return () => subscribers.delete(subscriber);
  }

  function publish(publication: HistoryPublication): void {
    for (const subscriber of [...subscribers]) {
      if (subscriber.replaying) subscriber.pending.push(publication);
      else invoke(subscriber, publication);
    }
  }

  function invoke(subscriber: Subscriber, publication: HistoryPublication): void {
    if (!subscribers.has(subscriber)) return;
    try { subscriber.observer(publication); } catch { subscribers.delete(subscriber); subscriber.pending.length = 0; }
  }

  function waitForIdle(): Promise<void> {
    if (!processing && pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.push(resolve));
  }

  function resolveIdleWaiters(): void {
    if (processing || pending.length > 0) return;
    for (const resolve of idleWaiters.splice(0)) resolve();
  }

  function closeResult(): CloseResult {
    return deepFreeze({ finalCommittedEvidenceBoundary: currentBoundary(), dataDisposition: "ERASED" as const, cleanupDisposition: "COMPLETE" as const });
  }

  return { offer, read, clear, follow, close };
}

async function loadJournal(database: AuthoritativeEventDatabase, panelSessionId: string): Promise<LoadedJournal> {
  const transaction = database.db.transaction([AUTHORITATIVE_EVENT_STORE_NAMES.historyControl, AUTHORITATIVE_EVENT_STORE_NAMES.evidence], "readonly");
  const control = await requestToPromise<ControlRecord | undefined>(transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).get(AUTHORITATIVE_EVENT_CONTROL_KEY));
  const records = await requestToPromise<EvidenceRecord[]>(transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence).getAll());
  await transactionDone(transaction);
  if (!control) {
    const interval = Object.freeze({ id: `${panelSessionId}:interval-1`, ordinal: 1 });
    await writeControl(database, createControl(panelSessionId, interval, 1, null, null, 0, 0));
    return { panelSessionId, interval, committed: [], nextSequence: 1, retainedBytes: 0, committedEvidenceBoundary: null };
  }
  const committed = records.sort((left, right) => left.sequence - right.sequence).map(toCommittedEvidenceFromRecord);
  return { panelSessionId: control.panelSessionId, interval: control.interval, committed, nextSequence: control.nextSequence, retainedBytes: control.replayPayloadBytes, committedEvidenceBoundary: control.committedEvidenceBoundary };
}

async function commitBatch(database: AuthoritativeEventDatabase, panelSessionId: string, interval: HistoryInterval, nextSequence: number, previous: readonly CommittedEvidence[], evidence: readonly CommittedEvidence[], replayPayloadBytes: number): Promise<void> {
  const transaction = database.db.transaction([AUTHORITATIVE_EVENT_STORE_NAMES.historyControl, AUTHORITATIVE_EVENT_STORE_NAMES.evidence], "readwrite");
  const store = transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence);
  for (const entry of evidence) {
    const serialized = serializeJournalEvidenceCandidate(entry.candidate);
    store.add({ intervalId: entry.intervalId, sequence: entry.sequence, eventId: entry.eventId, replayPayload: serialized.payload, serializedBytes: serialized.bytes, facets: exactFacets(entry.candidate) } satisfies EvidenceRecord);
  }
  const next = evidence.at(-1) ? evidence.at(-1)!.sequence + 1 : nextSequence;
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).put(createControl(panelSessionId, interval, next, evidence.at(-1) ? toRef(evidence.at(-1)!) : previous.at(-1) ? toRef(previous.at(-1)!) : null, previous.length ? { first: toRef(previous[0]), last: toRef(evidence.at(-1) ?? previous.at(-1)!) } : evidence.length ? { first: toRef(evidence[0]), last: toRef(evidence.at(-1)!) } : null, previous.length + evidence.length, replayPayloadBytes));
  await transactionDone(transaction);
}

async function clearJournal(database: AuthoritativeEventDatabase, panelSessionId: string, interval: HistoryInterval, nextSequence: number, boundary: EvidenceRef | null): Promise<void> {
  const transaction = database.db.transaction([AUTHORITATIVE_EVENT_STORE_NAMES.historyControl, AUTHORITATIVE_EVENT_STORE_NAMES.evidence], "readwrite");
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence).clear();
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).put(createControl(panelSessionId, interval, nextSequence, boundary, null, 0, 0));
  await transactionDone(transaction);
}

function createControl(panelSessionId: string, interval: HistoryInterval, nextSequence: number, boundary: EvidenceRef | null, range: { first: EvidenceRef; last: EvidenceRef } | null, retainedCount: number, replayPayloadBytes: number): ControlRecord {
  return { key: AUTHORITATIVE_EVENT_CONTROL_KEY, schemaVersion: 2, recordVersion: 1, panelSessionId, interval, nextSequence, committedEvidenceBoundary: boundary, retainedRange: range, retainedCount, replayPayloadBytes };
}

async function writeControl(database: AuthoritativeEventDatabase, control: ControlRecord): Promise<void> {
  const transaction = database.db.transaction(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl, "readwrite");
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).put(control);
  await transactionDone(transaction);
}

function exactFacets(candidate: EvidenceCandidate): string[] {
  if (candidate.kind === "topology-checkpoint") return [facet("kind", candidate.kind)];
  return [
    facet("kind", candidate.kind), facet("clientId", candidate.client?.id ?? null),
    facet("sessionId", candidate.client?.sessionId ?? null), facet("subscriptionId", candidate.subscription?.id ?? null),
    facet("mode", candidate.subscription?.mode ?? null), facet("item", candidate.item?.name ?? null),
    facet("itemPosition", candidate.item?.position ?? null), facet("listenerId", candidate.listener?.id ?? null),
    facet("key", candidate.update?.key ?? null), facet("command", candidate.update?.command ?? null),
    facet("snapshot", Boolean(candidate.update?.isSnapshot)), facet("synthetic", candidate.synthetic)
  ];
}

function facet(name: string, value: unknown): string {
  return JSON.stringify(["v1", name, value]);
}

function toCommittedEvidence(candidate: EvidenceCandidate, interval: HistoryInterval, sequence: number): CommittedEvidence {
  return deepFreeze({ intervalId: interval.id, sequence, eventId: candidate.id, candidate });
}

function toCommittedEvidenceFromRecord(record: EvidenceRecord): CommittedEvidence {
  return deepFreeze({ intervalId: record.intervalId, sequence: record.sequence, eventId: record.eventId, candidate: deserializeJournalEvidenceCandidate(record.replayPayload) });
}

function toRef(evidence: CommittedEvidence): EvidenceRef {
  return deepFreeze({ intervalId: evidence.intervalId, sequence: evidence.sequence, eventId: evidence.eventId });
}

function copyCandidate(candidate: EvidenceCandidate): EvidenceCandidate {
  if (!candidate || typeof candidate !== "object" || typeof candidate.id !== "string" || candidate.id.length === 0) throw new Error("Candidate must have a stable event ID.");
  if (candidate.kind === "topology-checkpoint" && !candidate.checkpoint) throw new Error("Topology checkpoint candidate is incomplete.");
  return deepFreeze(structuredClone(candidate));
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}
