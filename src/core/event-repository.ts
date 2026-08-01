import { type EventFilterState, createEventSearchText, matchesEventFilters } from "./event-filter";
import {
  type LightstreamerEventEnvelope,
  toPersistableEventEnvelope
} from "./event-envelope";
import {
  EVENT_STORE_NAMES,
  type EventDatabase,
  type EventDatabaseOpenResult,
  eventDatabaseName,
  openEventDatabase
} from "./indexeddb/event-db";

export type EventQuery = {
  filters?: EventFilterState;
  limit?: number;
  offset?: number;
  order?: "asc" | "desc";
};

export type EventQueryResult = {
  events: LightstreamerEventEnvelope[];
  total: number;
};

export type EventRepository = {
  appendEvent(event: LightstreamerEventEnvelope): Promise<LightstreamerEventEnvelope>;
  queryEvents(query?: EventQuery): Promise<EventQueryResult>;
  getEventById(id: string): Promise<LightstreamerEventEnvelope | null>;
  countEvents(): Promise<number>;
  clear(): Promise<void>;
  close(): void;
};

type EventRecord = {
  seq?: number;
  id: string;
  envelope: LightstreamerEventEnvelope;
};

type EventMetaRecord = {
  seq: number;
  id: string;
  timestamp: number;
  kind: string;
  direction: string;
  source: string;
  captureSource: string | null;
  synthetic: number;
  clientId: string | null;
  subscriptionId: string | null;
  subscriptionMode: string | null;
  itemName: string | null;
  itemPosition: number | null;
  commandKey: string | null;
  commandValue: string | null;
  isSnapshot: number;
};

type EventSearchTokenRecord = {
  token: string;
  seq: number;
};

const FILTER_INDEXES: Array<{
  filter: keyof EventFilterState;
  index: keyof EventMetaRecord;
  value: (filters: EventFilterState) => IDBValidKey | undefined;
}> = [
  { filter: "subscriptionId", index: "subscriptionId", value: (filters) => filters.subscriptionId },
  { filter: "key", index: "commandKey", value: (filters) => filters.key },
  { filter: "command", index: "commandValue", value: (filters) => filters.command },
  { filter: "mode", index: "subscriptionMode", value: (filters) => filters.mode },
  { filter: "item", index: "itemName", value: (filters) => filters.item },
  { filter: "kind", index: "kind", value: (filters) => filters.kind },
  { filter: "snapshot", index: "isSnapshot", value: (filters) => booleanKey(filters.snapshot) },
  { filter: "synthetic", index: "synthetic", value: (filters) => booleanKey(filters.synthetic) }
];

export async function createIndexedDbEventRepository(
  sessionId?: string | number | null
): Promise<EventRepository> {
  const result = await openEventDatabase(eventDatabaseName(sessionId));
  if (!result.ok) {
    throw result.error;
  }
  return createRepositoryFromOpenDatabase(result);
}

export function createRepositoryFromOpenDatabase(result: EventDatabaseOpenResult): EventRepository {
  if (!result.ok) {
    throw result.error;
  }
  return new IndexedDbEventRepository(result.database);
}

class IndexedDbEventRepository implements EventRepository {
  constructor(private readonly database: EventDatabase) {}

  async appendEvent(event: LightstreamerEventEnvelope): Promise<LightstreamerEventEnvelope> {
    const persistable = toPersistableEventEnvelope(event);
    const transaction = this.database.db.transaction(
      [
        EVENT_STORE_NAMES.events,
        EVENT_STORE_NAMES.eventMeta,
        EVENT_STORE_NAMES.eventSearchTokens
      ],
      "readwrite"
    );
    const events = transaction.objectStore(EVENT_STORE_NAMES.events);
    const eventMeta = transaction.objectStore(EVENT_STORE_NAMES.eventMeta);
    const searchTokens = transaction.objectStore(EVENT_STORE_NAMES.eventSearchTokens);

    const seq = await requestToPromise<IDBValidKey>(
      events.add({
        id: persistable.id,
        envelope: persistable
      } satisfies EventRecord)
    );
    const numericSeq = Number(seq);
    eventMeta.put(createEventMetaRecord(numericSeq, persistable));
    for (const token of eventSearchTokens(persistable)) {
      searchTokens.put({ token, seq: numericSeq } satisfies EventSearchTokenRecord);
    }
    await transactionDone(transaction);
    return persistable;
  }

  async queryEvents(query: EventQuery = {}): Promise<EventQueryResult> {
    const filters = query.filters ?? {};
    if (!hasActiveFilters(filters) && query.limit !== undefined) {
      return this.queryUnfilteredPage(query);
    }

    return this.queryFilteredEvents(filters, query);
  }

  async getEventById(id: string): Promise<LightstreamerEventEnvelope | null> {
    const transaction = this.database.db.transaction(EVENT_STORE_NAMES.events, "readonly");
    const events = transaction.objectStore(EVENT_STORE_NAMES.events);
    const index = events.index("id");
    const record = await requestToPromise<EventRecord | undefined>(index.get(id));
    return record?.envelope ?? null;
  }

  async countEvents(): Promise<number> {
    const transaction = this.database.db.transaction(EVENT_STORE_NAMES.events, "readonly");
    return requestToPromise<number>(transaction.objectStore(EVENT_STORE_NAMES.events).count());
  }

  async clear(): Promise<void> {
    const transaction = this.database.db.transaction(
      [
        EVENT_STORE_NAMES.events,
        EVENT_STORE_NAMES.eventMeta,
        EVENT_STORE_NAMES.eventSearchTokens
      ],
      "readwrite"
    );
    transaction.objectStore(EVENT_STORE_NAMES.events).clear();
    transaction.objectStore(EVENT_STORE_NAMES.eventMeta).clear();
    transaction.objectStore(EVENT_STORE_NAMES.eventSearchTokens).clear();
    await transactionDone(transaction);
  }

  close(): void {
    this.database.db.close();
  }

  private async queryFilteredEvents(
    filters: EventFilterState,
    query: EventQuery
  ): Promise<EventQueryResult> {
    const transaction = this.database.db.transaction(
      [EVENT_STORE_NAMES.events, EVENT_STORE_NAMES.eventMeta],
      "readonly"
    );
    const completed = transactionDone(transaction);
    const eventsStore = transaction.objectStore(EVENT_STORE_NAMES.events);
    const eventMeta = transaction.objectStore(EVENT_STORE_NAMES.eventMeta);
    const metas = await this.queryEventMeta(filters, eventMeta);

    let result: EventQueryResult;
    if (hasSearchQuery(filters)) {
      result = await this.queryEventsWithFullTextFilter(metas, query, eventsStore);
    } else {
      const matched = metas.filter((meta) => metaMatchesResidualFilters(meta, filters)).sort(bySeq);
      const total = matched.length;
      const paged = pageEventMeta(matched, query);
      const events = await this.getEventsBySeq(
        paged.map((meta) => meta.seq),
        eventsStore
      );
      result = {
        events: events.filter((event): event is LightstreamerEventEnvelope => Boolean(event)),
        total
      };
    }

    await completed;
    return result;
  }

  private async queryEventMeta(
    filters: EventFilterState,
    eventMeta: IDBObjectStore
  ): Promise<EventMetaRecord[]> {
    const indexedFilter = selectIndexedFilter(filters);

    if (indexedFilter) {
      return requestToPromise<EventMetaRecord[]>(
        eventMeta.index(String(indexedFilter.index)).getAll(indexedFilter.value)
      );
    }

    return requestToPromise<EventMetaRecord[]>(eventMeta.getAll());
  }

  private async queryEventsWithFullTextFilter(
    metas: EventMetaRecord[],
    query: EventQuery,
    eventsStore: IDBObjectStore
  ): Promise<EventQueryResult> {
    const sorted = metas.sort(bySeq);
    const hydrated = await this.getEventsBySeq(
      sorted.map((meta) => meta.seq),
      eventsStore
    );
    const candidates = sorted.map((meta, index) => ({
      meta,
      event: hydrated[index] ?? null
    }));
    const matched = candidates.filter(
      (entry): entry is { meta: EventMetaRecord; event: LightstreamerEventEnvelope } => {
        if (!entry.event) {
          return false;
        }
        return matchesEventFilters(entry.event, query.filters);
      }
    );
    const total = matched.length;
    const eventBySeq = new Map(matched.map((entry) => [entry.meta.seq, entry.event]));
    return {
      events: pageEventMeta(
        matched.map((entry) => entry.meta),
        query
      )
        .map((meta) => eventBySeq.get(meta.seq))
        .filter((event): event is LightstreamerEventEnvelope => Boolean(event)),
      total
    };
  }

  private async queryUnfilteredPage(query: EventQuery): Promise<EventQueryResult> {
    const transaction = this.database.db.transaction(
      [EVENT_STORE_NAMES.events, EVENT_STORE_NAMES.eventMeta],
      "readonly"
    );
    const completed = transactionDone(transaction);
    const eventsStore = transaction.objectStore(EVENT_STORE_NAMES.events);
    const eventMeta = transaction.objectStore(EVENT_STORE_NAMES.eventMeta);
    const totalPromise = requestToPromise<number>(eventsStore.count());
    const metas = await readCursorPage(eventMeta, query);
    const events = await this.getEventsBySeq(
      metas.map((meta) => meta.seq),
      eventsStore
    );
    const total = await totalPromise;
    await completed;
    return {
      events: events.filter((event): event is LightstreamerEventEnvelope => Boolean(event)),
      total
    };
  }

  private async getEventsBySeq(
    sequences: readonly number[],
    existingStore?: IDBObjectStore
  ): Promise<Array<LightstreamerEventEnvelope | null>> {
    if (sequences.length === 0) {
      return [];
    }
    const transaction = existingStore
      ? null
      : this.database.db.transaction(EVENT_STORE_NAMES.events, "readonly");
    const events = existingStore ?? transaction?.objectStore(EVENT_STORE_NAMES.events);
    if (!events) {
      return sequences.map(() => null);
    }
    const records = await Promise.all(
      sequences.map((seq) => requestToPromise<EventRecord | undefined>(events.get(seq)))
    );
    return records.map((record) => record?.envelope ?? null);
  }
}

function createEventMetaRecord(seq: number, event: LightstreamerEventEnvelope): EventMetaRecord {
  return {
    seq,
    id: event.id,
    timestamp: event.timestamp,
    kind: event.kind,
    direction: event.direction,
    source: event.source,
    captureSource: event.captureSource ?? null,
    synthetic: booleanKey(event.synthetic) ?? 0,
    clientId: event.client?.id ?? null,
    subscriptionId: event.subscription?.id ?? null,
    subscriptionMode: event.subscription?.mode ?? null,
    itemName: event.item?.name ?? null,
    itemPosition: event.item?.position ?? null,
    commandKey: event.update?.key ?? null,
    commandValue: event.update?.command ?? null,
    isSnapshot: booleanKey(Boolean(event.update?.isSnapshot)) ?? 0
  };
}

function eventSearchTokens(event: LightstreamerEventEnvelope): string[] {
  return searchTokensFromQuery(createEventSearchText(event));
}

function searchTokensFromQuery(query: string | undefined): string[] {
  return Array.from(
    new Set(
      query
        ?.trim()
        .toLowerCase()
        .split(/[^a-z0-9_.:-]+/i)
        .filter((token) => token.length > 0) ?? []
    )
  );
}

function selectIndexedFilter(
  filters: EventFilterState
): { index: keyof EventMetaRecord; value: IDBValidKey } | null {
  for (const candidate of FILTER_INDEXES) {
    if (filters[candidate.filter] === undefined || filters[candidate.filter] === "") {
      continue;
    }
    const value = candidate.value(filters);
    if (value !== undefined) {
      return { index: candidate.index, value };
    }
  }
  return null;
}

function hasSearchQuery(filters: EventFilterState): boolean {
  return Boolean(filters.query?.trim());
}

function hasActiveFilters(filters: EventFilterState): boolean {
  return Object.values(filters).some((value) => value !== undefined && value !== "");
}

function booleanKey(value: boolean | undefined): number | undefined {
  return value === undefined ? undefined : value ? 1 : 0;
}

function captureSourceFromMeta(value: string | null): LightstreamerEventEnvelope["captureSource"] {
  return value === "wire" || value === "listener" ? value : undefined;
}

function metaMatchesResidualFilters(meta: EventMetaRecord, filters: EventFilterState): boolean {
  return matchesEventFilters(
    {
      id: meta.id,
      timestamp: meta.timestamp,
      direction: meta.direction as LightstreamerEventEnvelope["direction"],
      source: meta.source as LightstreamerEventEnvelope["source"],
      captureSource: captureSourceFromMeta(meta.captureSource),
      synthetic: Boolean(meta.synthetic),
      kind: meta.kind as LightstreamerEventEnvelope["kind"],
      subscription: meta.subscriptionId
        ? { id: meta.subscriptionId, mode: meta.subscriptionMode }
        : undefined,
      item:
        meta.itemName || meta.itemPosition !== null
          ? { name: meta.itemName, position: meta.itemPosition }
          : undefined,
      update: {
        key: meta.commandKey,
        command: meta.commandValue,
        isSnapshot: Boolean(meta.isSnapshot)
      }
    },
    {
      ...filters,
      query: undefined
    }
  );
}

function pageEventMeta(records: EventMetaRecord[], query: EventQuery): EventMetaRecord[] {
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const limit = query.limit === undefined ? records.length : Math.max(0, Math.floor(query.limit));
  const ordered = query.order === "desc" ? [...records].reverse() : records;
  if (query.limit === undefined) {
    return ordered.slice(offset);
  }
  if (query.order === "desc") {
    return ordered.slice(offset, offset + limit);
  }
  const end = Math.max(0, records.length - offset);
  const start = Math.max(0, end - limit);
  return records.slice(start, end);
}

function bySeq(left: EventMetaRecord, right: EventMetaRecord): number {
  return left.seq - right.seq;
}

function readCursorPage(store: IDBObjectStore, query: EventQuery): Promise<EventMetaRecord[]> {
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const limit = Math.max(0, Math.floor(query.limit ?? 0));

  return new Promise((resolve, reject) => {
    if (limit === 0) {
      resolve([]);
      return;
    }

    const records: EventMetaRecord[] = [];
    let skipped = 0;
    const request = store.openCursor(null, "prev");
    request.onerror = () => reject(request.error ?? new Error("IndexedDB cursor failed."));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || records.length >= limit) {
        resolve(query.order === "desc" ? records : records.reverse());
        return;
      }

      if (skipped < offset) {
        skipped += 1;
        cursor.continue();
        return;
      }

      records.push(cursor.value as EventMetaRecord);
      cursor.continue();
    };
  });
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
