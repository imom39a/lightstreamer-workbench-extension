import { type EventFilterState, filterEvents } from "./event-filter";
import { type LightstreamerEventEnvelope } from "./event-envelope";
import {
  type EventQuery,
  type EventQueryResult,
  type EventRepository,
  createIndexedDbEventRepository
} from "./event-repository";

export type MaybePromise<T> = T | Promise<T>;

export type EventStoreStats = {
  retained: number;
  totalAppended: number;
  warningThreshold: number;
  warningActive: boolean;
};

export type EventStoreChange =
  | {
      type: "init";
    }
  | {
      type: "append";
      event: LightstreamerEventEnvelope;
    }
  | {
      type: "clear";
    };

export type EventStoreListener = (
  change: EventStoreChange,
  stats: EventStoreStats
) => void;

export type EventStore = {
  append(event: LightstreamerEventEnvelope): MaybePromise<LightstreamerEventEnvelope>;
  queryEvents(query?: EventQuery): MaybePromise<EventQueryResult>;
  getEventById(id: string): MaybePromise<LightstreamerEventEnvelope | null>;
  list(filters?: EventFilterState): MaybePromise<LightstreamerEventEnvelope[]>;
  count(): MaybePromise<number>;
  stats(): MaybePromise<EventStoreStats>;
  clear(): MaybePromise<void>;
  subscribe(listener: EventStoreListener): () => void;
  close?(): void;
};

export type InMemoryEventStore = Omit<
  EventStore,
  "append" | "queryEvents" | "getEventById" | "list" | "count" | "stats" | "clear"
> & {
  append(event: LightstreamerEventEnvelope): LightstreamerEventEnvelope;
  queryEvents(query?: EventQuery): EventQueryResult;
  getEventById(id: string): LightstreamerEventEnvelope | null;
  list(filters?: EventFilterState): LightstreamerEventEnvelope[];
  count(): number;
  stats(): EventStoreStats;
  clear(): void;
};

export type EventStoreOptions = {
  warningThreshold?: number;
};

export type IndexedDbEventStoreOptions = EventStoreOptions & {
  sessionId?: string | number | null;
  reset?: boolean;
};

export const DEFAULT_EVENT_WARNING_THRESHOLD = 10_000;

export function createEventStore(options: EventStoreOptions = {}): InMemoryEventStore {
  const warningThreshold = normalizeWarningThreshold(options.warningThreshold);
  const events: LightstreamerEventEnvelope[] = [];
  const listeners = new Set<EventStoreListener>();
  let totalAppended = 0;

  function snapshot(filters?: EventFilterState): LightstreamerEventEnvelope[] {
    const source = filters ? filterEvents(events, filters) : events;
    return [...source];
  }

  function currentStats(): EventStoreStats {
    return {
      retained: events.length,
      totalAppended,
      warningThreshold,
      warningActive: events.length > warningThreshold
    };
  }

  function notify(change: EventStoreChange): void {
    const stats = currentStats();
    for (const listener of listeners) {
      listener(change, stats);
    }
  }

  return {
    append(event) {
      events.push(event);
      totalAppended += 1;
      notify({ type: "append", event });
      return event;
    },

    queryEvents(query = {}) {
      const visibleEvents = filterEvents(events, query.filters ?? {});
      const total = visibleEvents.length;
      return {
        events: pageEvents(visibleEvents, query),
        total
      };
    },

    getEventById(id) {
      return events.find((event) => event.id === id) ?? null;
    },

    list(filters) {
      return snapshot(filters);
    },

    count() {
      return events.length;
    },

    stats() {
      return currentStats();
    },

    clear() {
      events.length = 0;
      totalAppended = 0;
      notify({ type: "clear" });
    },

    subscribe(listener) {
      listeners.add(listener);
      listener({ type: "init" }, currentStats());
      return () => {
        listeners.delete(listener);
      };
    }
  };
}

export async function createIndexedDbEventStore(
  options: IndexedDbEventStoreOptions = {}
): Promise<EventStore> {
  const repository = await createIndexedDbEventRepository(options.sessionId);
  if (options.reset) {
    await repository.clear();
  }
  return createRepositoryEventStore(repository, options);
}

export function createRepositoryEventStore(
  repository: EventRepository,
  options: EventStoreOptions = {}
): EventStore {
  const warningThreshold = normalizeWarningThreshold(options.warningThreshold);
  const listeners = new Set<EventStoreListener>();
  let totalAppended = 0;
  let retained = 0;

  async function currentStats(): Promise<EventStoreStats> {
    retained = await repository.countEvents();
    return {
      retained,
      totalAppended,
      warningThreshold,
      warningActive: retained > warningThreshold
    };
  }

  async function notify(change: EventStoreChange): Promise<void> {
    const stats = await currentStats();
    for (const listener of listeners) {
      listener(change, stats);
    }
  }

  return {
    async append(event) {
      const appended = await repository.appendEvent(event);
      totalAppended += 1;
      await notify({ type: "append", event: appended });
      return appended;
    },

    queryEvents(query) {
      return repository.queryEvents(query);
    },

    getEventById(id) {
      return repository.getEventById(id);
    },

    async list(filters) {
      const result = await repository.queryEvents({ filters });
      return result.events;
    },

    count() {
      return repository.countEvents();
    },

    stats() {
      return currentStats();
    },

    async clear() {
      await repository.clear();
      totalAppended = 0;
      retained = 0;
      await notify({ type: "clear" });
    },

    subscribe(listener) {
      listeners.add(listener);
      void notify({ type: "init" });
      return () => {
        listeners.delete(listener);
      };
    },

    close() {
      repository.close();
    }
  };
}

function normalizeWarningThreshold(value: number | undefined): number {
  return Math.max(1, Math.floor(value ?? DEFAULT_EVENT_WARNING_THRESHOLD));
}

function pageEvents(
  events: readonly LightstreamerEventEnvelope[],
  query: EventQuery
): LightstreamerEventEnvelope[] {
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const limit = query.limit === undefined ? events.length : Math.max(0, Math.floor(query.limit));
  if (query.order === "desc") {
    return [...events].reverse().slice(offset, offset + limit);
  }
  if (query.limit === undefined) {
    return events.slice(offset);
  }
  const end = Math.max(0, events.length - offset);
  const start = Math.max(0, end - limit);
  return events.slice(start, end);
}
