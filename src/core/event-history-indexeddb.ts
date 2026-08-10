import {
  AUTHORITATIVE_EVENT_CONTROL_KEY,
  AUTHORITATIVE_EVENT_STORE_NAMES,
  authoritativeEventDatabaseName,
  AUTHORITATIVE_EVENT_DB_STARTUP_RECORD_LIMIT,
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
  type CloseResult,
  pageEvidence,
  selectEvidence
} from "./event-history-authoritative";

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
  try {
    const loaded = await loadJournal(database, panelSessionId);
    return createHistory(database, loaded);
  } catch (error) {
    database.db.close();
    throw error;
  }
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
    const intervalSnapshot = committed.filter((entry) => entry.intervalId === (query.intervalId ?? interval.id));
    const selected = selectEvidence(intervalSnapshot, query);
    const evidence = pageEvidence(selected, query);
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
  try {
    const control = await requestToPromise<ControlRecord | undefined>(transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).get(AUTHORITATIVE_EVENT_CONTROL_KEY), "loading history control");
    const records = await readEvidenceRecords(transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence));
    await transactionDone(transaction, "loading Event History");
    validateJournalRecords(panelSessionId, control, records);
    if (!control) {
      const interval = Object.freeze({ id: `${panelSessionId}:interval-1`, ordinal: 1 });
      await writeControl(database, createControl(panelSessionId, interval, 1, null, null, 0, 0));
      return { panelSessionId, interval, committed: [], nextSequence: 1, retainedBytes: 0, committedEvidenceBoundary: null };
    }
    const committed = records.sort((left, right) => left.sequence - right.sequence).map(toCommittedEvidenceFromRecord);
    return { panelSessionId, interval: control.interval, committed, nextSequence: control.nextSequence, retainedBytes: control.replayPayloadBytes, committedEvidenceBoundary: control.committedEvidenceBoundary };
  } catch (error) {
    try { transaction.abort(); } catch { /* the transaction may already be complete */ }
    throw error;
  }
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
  await transactionDone(transaction, "committing Evidence");
}

async function clearJournal(database: AuthoritativeEventDatabase, panelSessionId: string, interval: HistoryInterval, nextSequence: number, boundary: EvidenceRef | null): Promise<void> {
  const transaction = database.db.transaction([AUTHORITATIVE_EVENT_STORE_NAMES.historyControl, AUTHORITATIVE_EVENT_STORE_NAMES.evidence], "readwrite");
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.evidence).clear();
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).put(createControl(panelSessionId, interval, nextSequence, boundary, null, 0, 0));
  await transactionDone(transaction, "clearing Event History");
}

function readEvidenceRecords(store: IDBObjectStore): Promise<EvidenceRecord[]> {
  return new Promise((resolve, reject) => {
    const records: EvidenceRecord[] = [];
    const request = store.openCursor();
    const timeout = globalThis.setTimeout(() => reject(new Error("Timed out while loading Event History evidence.")), 2_000);
    const settle = (callback: () => void) => {
      globalThis.clearTimeout(timeout);
      callback();
    };
    request.onerror = () => settle(() => reject(request.error ?? new Error("IndexedDB evidence load failed.")));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        settle(() => resolve(records));
        return;
      }
      records.push(cursor.value as EvidenceRecord);
      if (records.length > AUTHORITATIVE_EVENT_DB_STARTUP_RECORD_LIMIT) {
        settle(() => reject(new Error("IndexedDB Event History exceeds the bounded startup load.")));
        return;
      }
      cursor.continue();
    };
  });
}

function validateJournalRecords(panelSessionId: string, control: ControlRecord | undefined, records: readonly EvidenceRecord[]): void {
  if (!control) {
    if (records.length > 0) throw new Error("Evidence residue exists without a history control record.");
    return;
  }
  assertExactKeys(control, ["committedEvidenceBoundary", "interval", "key", "nextSequence", "panelSessionId", "recordVersion", "retainedCount", "retainedRange", "replayPayloadBytes", "schemaVersion"]);
  if (control.key !== AUTHORITATIVE_EVENT_CONTROL_KEY || control.schemaVersion !== 2 || control.recordVersion !== 1 || control.panelSessionId !== panelSessionId) {
    throw new Error("The history control record does not match the authoritative schema or Panel Session.");
  }
  if (!isInterval(control.interval) || control.interval.id !== `${panelSessionId}:interval-${control.interval.ordinal}`) {
    throw new Error("The history control interval is incoherent.");
  }
  if (!Number.isSafeInteger(control.nextSequence) || control.nextSequence < 1 || !Number.isSafeInteger(control.retainedCount) || control.retainedCount < 0 || !Number.isSafeInteger(control.replayPayloadBytes) || control.replayPayloadBytes < 0) {
    throw new Error("The history control counters are incoherent.");
  }

  const ordered = [...records].sort((left, right) => left.sequence - right.sequence);
  let payloadBytes = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const record = ordered[index];
    assertExactKeys(record, ["eventId", "facets", "intervalId", "replayPayload", "sequence", "serializedBytes"]);
    if (record.intervalId !== control.interval.id || typeof record.eventId !== "string" || record.eventId.length === 0 || !Number.isSafeInteger(record.sequence) || record.sequence < 1 || (index > 0 && record.sequence !== ordered[index - 1].sequence + 1) || typeof record.replayPayload !== "string" || !Number.isSafeInteger(record.serializedBytes) || record.serializedBytes < 0 || !Array.isArray(record.facets) || record.facets.some((facetValue) => typeof facetValue !== "string")) {
      throw new Error("An evidence record is incoherent with the history control record.");
    }
    const candidate = copyCandidate(deserializeJournalEvidenceCandidate(record.replayPayload));
    const serialized = serializeJournalEvidenceCandidate(candidate);
    if (candidate.id !== record.eventId || serialized.payload !== record.replayPayload || serialized.bytes !== record.serializedBytes || JSON.stringify(exactFacets(candidate)) !== JSON.stringify(record.facets)) {
      throw new Error("An evidence record does not match its replay payload or facets.");
    }
    payloadBytes += record.serializedBytes;
  }
  if (control.retainedCount !== ordered.length || control.replayPayloadBytes !== payloadBytes) {
    throw new Error("The history control totals do not match its evidence records.");
  }
  const last = ordered.at(-1);
  const expectedNext = last ? last.sequence + 1 : control.committedEvidenceBoundary ? control.committedEvidenceBoundary.sequence + 1 : 1;
  if (control.nextSequence !== expectedNext) throw new Error("The history control next sequence is incoherent.");
  const expectedRange = ordered.length ? { first: evidenceRef(ordered[0]), last: evidenceRef(last!) } : null;
  if (control.committedEvidenceBoundary !== null) assertRef(control.committedEvidenceBoundary);
  if (control.retainedRange !== null) {
    assertRef(control.retainedRange.first);
    assertRef(control.retainedRange.last);
  }
  if (!sameRange(control.retainedRange, expectedRange)) throw new Error("The history control retained range is incoherent.");
  if (last) {
    if (!sameRef(control.committedEvidenceBoundary, evidenceRef(last))) throw new Error("The history control committed boundary is incoherent.");
  }
}

function assertExactKeys(value: object, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error("An authoritative IndexedDB record has an unexpected schema.");
}

function isInterval(value: unknown): value is HistoryInterval {
  return Boolean(value && typeof value === "object" && Object.keys(value).sort().join(",") === "id,ordinal" && typeof (value as HistoryInterval).id === "string" && Number.isSafeInteger((value as HistoryInterval).ordinal) && (value as HistoryInterval).ordinal > 0);
}

function assertRef(value: EvidenceRef): void {
  if (!value || Object.keys(value).sort().join(",") !== "eventId,intervalId,sequence" || typeof value.intervalId !== "string" || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || typeof value.eventId !== "string" || value.eventId.length === 0) throw new Error("An Evidence reference is incoherent.");
}

function evidenceRef(record: EvidenceRecord): EvidenceRef {
  return { intervalId: record.intervalId, sequence: record.sequence, eventId: record.eventId };
}

function sameRef(left: EvidenceRef | null, right: EvidenceRef | null): boolean {
  return left === null || right === null ? left === right : left.intervalId === right.intervalId && left.sequence === right.sequence && left.eventId === right.eventId;
}

function sameRange(left: { first: EvidenceRef; last: EvidenceRef } | null, right: { first: EvidenceRef; last: EvidenceRef } | null): boolean {
  return left === null || right === null ? left === right : sameRef(left.first, right.first) && sameRef(left.last, right.last);
}

function createControl(panelSessionId: string, interval: HistoryInterval, nextSequence: number, boundary: EvidenceRef | null, range: { first: EvidenceRef; last: EvidenceRef } | null, retainedCount: number, replayPayloadBytes: number): ControlRecord {
  return { key: AUTHORITATIVE_EVENT_CONTROL_KEY, schemaVersion: 2, recordVersion: 1, panelSessionId, interval, nextSequence, committedEvidenceBoundary: boundary, retainedRange: range, retainedCount, replayPayloadBytes };
}

async function writeControl(database: AuthoritativeEventDatabase, control: ControlRecord): Promise<void> {
  const transaction = database.db.transaction(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl, "readwrite");
  transaction.objectStore(AUTHORITATIVE_EVENT_STORE_NAMES.historyControl).put(control);
  await transactionDone(transaction, "initializing Event History");
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

function requestToPromise<T>(request: IDBRequest<T>, operation: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => reject(new Error(`Timed out while ${operation}.`)), 2_000);
    const settle = (callback: () => void) => {
      globalThis.clearTimeout(timeout);
      callback();
    };
    request.onsuccess = () => settle(() => resolve(request.result));
    request.onerror = () => settle(() => reject(request.error ?? new Error("IndexedDB request failed.")));
  });
}

function transactionDone(transaction: IDBTransaction, operation: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      try { transaction.abort(); } catch { /* the transaction may already be complete */ }
      reject(new Error(`Timed out while ${operation}.`));
    }, 2_000);
    const settle = (callback: () => void) => {
      globalThis.clearTimeout(timeout);
      callback();
    };
    transaction.oncomplete = () => settle(resolve);
    transaction.onerror = () => settle(() => reject(transaction.error ?? new Error("IndexedDB transaction failed.")));
    transaction.onabort = () => settle(() => reject(transaction.error ?? new Error("IndexedDB transaction aborted.")));
  });
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}
