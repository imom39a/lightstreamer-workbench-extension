import { type EventFilterState, createEventSearchText, matchesEventFilters } from "./event-filter";
import { type LightstreamerEventEnvelope } from "./event-envelope";
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
        id: event.id,
        envelope: event
      } satisfies EventRecord)
    );
    const numericSeq = Number(seq);
    eventMeta.put(createEventMetaRecord(numericSeq, event));
    for (const token of eventSearchTokens(event)) {
      searchTokens.put({ token, seq: numericSeq } satisfies EventSearchTokenRecord);
    }
    await transactionDone(transaction);
    return event;
  }

  async queryEvents(query: EventQuery = {}): Promise<EventQueryResult> {
    const filters = query.filters ?? {};
    const metas = await this.queryEventMeta(filters);
    const matched = metas
      .filter((meta) => metaMatchesResidualFilters(meta, filters))
      .sort((left, right) => left.seq - right.seq);
    const total = matched.length;
    const paged = pageEventMeta(matched, query);
    const events = await Promise.all(paged.map((meta) => this.getEventBySeq(meta.seq)));
    return {
      events: events.filter((event): event is LightstreamerEventEnvelope => Boolean(event)),
      total
    };
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

  private async queryEventMeta(filters: EventFilterState): Promise<EventMetaRecord[]> {
    const tokenSeqs = await this.querySearchTokenSeqs(filters.query);
    const transaction = this.database.db.transaction(EVENT_STORE_NAMES.eventMeta, "readonly");
    const eventMeta = transaction.objectStore(EVENT_STORE_NAMES.eventMeta);
    const indexedFilter = selectIndexedFilter(filters);
    let records: EventMetaRecord[];

    if (indexedFilter) {
      records = await requestToPromise<EventMetaRecord[]>(
        eventMeta.index(String(indexedFilter.index)).getAll(indexedFilter.value)
      );
    } else if (tokenSeqs) {
      records = await Promise.all(
        Array.from(tokenSeqs, (seq) => requestToPromise<EventMetaRecord | undefined>(eventMeta.get(seq)))
      ).then((metas) => metas.filter((meta): meta is EventMetaRecord => Boolean(meta)));
    } else {
      records = await requestToPromise<EventMetaRecord[]>(eventMeta.getAll());
    }

    if (!tokenSeqs) {
      return records;
    }
    return records.filter((record) => tokenSeqs.has(record.seq));
  }

  private async querySearchTokenSeqs(
    query: string | undefined
  ): Promise<Set<number> | null> {
    const tokens = searchTokensFromQuery(query);
    if (tokens.length === 0) {
      return null;
    }

    let intersection: Set<number> | null = null;
    for (const token of tokens) {
      const transaction = this.database.db.transaction(EVENT_STORE_NAMES.eventSearchTokens, "readonly");
      const searchTokens = transaction.objectStore(EVENT_STORE_NAMES.eventSearchTokens);
      const records = await requestToPromise<EventSearchTokenRecord[]>(
        searchTokens.index("token").getAll(token)
      );
      const current = new Set(records.map((record) => record.seq));
      if (!intersection) {
        intersection = current;
        continue;
      }
      intersection = new Set(Array.from(intersection, (seq) => seq).filter((seq) => current.has(seq)));
    }
    return intersection ?? new Set<number>();
  }

  private async getEventBySeq(seq: number): Promise<LightstreamerEventEnvelope | null> {
    const transaction = this.database.db.transaction(EVENT_STORE_NAMES.events, "readonly");
    const record = await requestToPromise<EventRecord | undefined>(
      transaction.objectStore(EVENT_STORE_NAMES.events).get(seq)
    );
    return record?.envelope ?? null;
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
