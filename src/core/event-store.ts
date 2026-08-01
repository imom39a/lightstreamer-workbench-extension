import { type EventFilterState, filterEvents } from "./event-filter";
import {
  type LightstreamerEventEnvelope,
  toPersistableEventEnvelope
} from "./event-envelope";
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
      type: "append-batch";
      events: readonly LightstreamerEventEnvelope[];
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
  close?(): MaybePromise<void>;
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
  batchSize?: number;
};

export type IndexedDbEventStoreOptions = EventStoreOptions & {
  sessionId?: string | number | null;
  reset?: boolean;
  clearOnClose?: boolean;
};

type RepositoryEventStoreOptions = EventStoreOptions & {
  clearOnClose?: boolean;
  initialRetained?: number;
};

export const DEFAULT_EVENT_WARNING_THRESHOLD = 10_000;
export const DEFAULT_EVENT_BATCH_SIZE = 256;

export function createEventStore(options: EventStoreOptions = {}): InMemoryEventStore {
  const warningThreshold = normalizeWarningThreshold(options.warningThreshold);
  const batchSize = normalizeBatchSize(options.batchSize);
  const events: LightstreamerEventEnvelope[] = [];
  const listeners = new Set<EventStoreListener>();
  const pendingNotifications: LightstreamerEventEnvelope[] = [];
  let totalAppended = 0;
  let notificationScheduled = false;
  let notificationGeneration = 0;
  let closed = false;

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

  function notifyAppended(appended: readonly LightstreamerEventEnvelope[]): void {
    const change = appendChange(appended);
    if (change) {
      notify(change);
    }
  }

  function flushPendingNotifications(): void {
    while (pendingNotifications.length > 0) {
      notifyAppended(pendingNotifications.splice(0, batchSize));
    }
  }

  function scheduleNotificationFlush(): void {
    if (notificationScheduled) {
      return;
    }
    notificationScheduled = true;
    const generation = notificationGeneration;
    queueMicrotask(() => {
      if (generation !== notificationGeneration) {
        notificationScheduled = false;
        return;
      }
      notificationScheduled = false;
      const batch = pendingNotifications.splice(0, batchSize);
      notifyAppended(batch);
      if (pendingNotifications.length > 0) {
        scheduleNotificationFlush();
      }
    });
  }

  function notifyAppend(event: LightstreamerEventEnvelope): void {
    if (listeners.size === 0) {
      return;
    }
    if (!notificationScheduled && pendingNotifications.length === 0) {
      scheduleNotificationFlush();
      notifyAppended([event]);
      return;
    }
    pendingNotifications.push(event);
    scheduleNotificationFlush();
  }

  function settleNotifications(): void {
    notificationGeneration += 1;
    notificationScheduled = false;
    flushPendingNotifications();
  }

  return {
    append(event) {
      if (closed) {
        throw new Error("Event store is closed.");
      }
      events.push(event);
      totalAppended += 1;
      notifyAppend(event);
      return event;
    },

    queryEvents(query = {}) {
      settleNotifications();
      const visibleEvents = filterEvents(events, query.filters ?? {});
      const total = visibleEvents.length;
      return {
        events: pageEvents(visibleEvents, query),
        total
      };
    },

    getEventById(id) {
      settleNotifications();
      return events.find((event) => event.id === id) ?? null;
    },

    list(filters) {
      settleNotifications();
      return snapshot(filters);
    },

    count() {
      settleNotifications();
      return events.length;
    },

    stats() {
      settleNotifications();
      return currentStats();
    },

    clear() {
      if (closed) {
        return;
      }
      settleNotifications();
      events.length = 0;
      totalAppended = 0;
      pendingNotifications.length = 0;
      notify({ type: "clear" });
    },

    subscribe(listener) {
      settleNotifications();
      listeners.add(listener);
      listener({ type: "init" }, currentStats());
      return () => {
        listeners.delete(listener);
      };
    },

    close() {
      if (closed) {
        return;
      }
      settleNotifications();
      closed = true;
      pendingNotifications.length = 0;
      listeners.clear();
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
  const initialRetained = await repository.countEvents();
  return createRepositoryEventStore(repository, {
    ...options,
    initialRetained
  });
}

export function createRepositoryEventStore(
  repository: EventRepository,
  options: RepositoryEventStoreOptions = {}
): EventStore {
  const warningThreshold = normalizeWarningThreshold(options.warningThreshold);
  const batchSize = normalizeBatchSize(options.batchSize);
  const listeners = new Set<EventStoreListener>();
  const pendingAppends: PendingAppend[] = [];
  let totalAppended = 0;
  let retained = Math.max(0, Math.floor(options.initialRetained ?? 0));
  let closed = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let operationTail = Promise.resolve();
  let closePromise: Promise<void> | null = null;

  function currentStats(): EventStoreStats {
    return {
      retained,
      totalAppended,
      warningThreshold,
      warningActive: retained > warningThreshold
    };
  }

  function notify(change: EventStoreChange): void {
    const stats = currentStats();
    for (const listener of listeners) {
      listener(change, stats);
    }
  }

  function notifyAppended(events: readonly LightstreamerEventEnvelope[]): void {
    const change = appendChange(events);
    if (change) {
      notify(change);
    }
  }

  function enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const next = operationTail.then(operation, operation);
    operationTail = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  function scheduleFlush(): void {
    if (flushTimer !== null || pendingAppends.length === 0) {
      return;
    }
    flushTimer = globalThis.setTimeout(() => {
      flushTimer = null;
      if (pendingAppends.length > 0) {
        void enqueueOperation(flushPendingAppends);
      }
    }, 0);
  }

  function cancelScheduledFlush(): void {
    if (flushTimer !== null) {
      globalThis.clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  async function appendRepositoryBatch(
    events: readonly LightstreamerEventEnvelope[]
  ): Promise<LightstreamerEventEnvelope[]> {
    if (repository.appendEvents) {
      return repository.appendEvents(events);
    }
    const appended: LightstreamerEventEnvelope[] = [];
    for (const event of events) {
      appended.push(await repository.appendEvent(event));
    }
    return appended;
  }

  async function flushPendingAppends(): Promise<void> {
    while (pendingAppends.length > 0) {
      const batch = pendingAppends.splice(0, batchSize);
      try {
        const appended = await appendRepositoryBatch(batch.map((entry) => entry.persistable));
        if (appended.length !== batch.length) {
          throw new Error("Event repository appended an incomplete batch.");
        }
        retained += batch.length;
        totalAppended += batch.length;
        notifyAppended(batch.map((entry) => entry.event));
        for (const [index, entry] of batch.entries()) {
          const persisted = appended[index];
          if (persisted) {
            entry.resolve(persisted);
          } else {
            entry.reject(new Error("Event repository returned an incomplete batch."));
          }
        }
      } catch (error) {
        for (const entry of batch) {
          entry.reject(error);
        }
      }
    }
  }

  function drain(): Promise<void> {
    if (pendingAppends.length > 0) {
      cancelScheduledFlush();
      return enqueueOperation(flushPendingAppends);
    }
    return operationTail;
  }

  return {
    append(event) {
      if (closed) {
        return Promise.reject(new Error("Event store is closed."));
      }
      return new Promise<LightstreamerEventEnvelope>((resolve, reject) => {
        pendingAppends.push({
          event,
          persistable: toPersistableEventEnvelope(event),
          resolve,
          reject
        });
        scheduleFlush();
      });
    },

    queryEvents(query) {
      return drain().then(() => repository.queryEvents(query));
    },

    getEventById(id) {
      return drain().then(() => repository.getEventById(id));
    },

    async list(filters) {
      await drain();
      const result = await repository.queryEvents({ filters });
      return result.events;
    },

    count() {
      return drain().then(async () => {
        retained = await repository.countEvents();
        return retained;
      });
    },

    stats() {
      return drain().then(() => currentStats());
    },

    clear() {
      if (closed) {
        return Promise.resolve();
      }
      cancelScheduledFlush();
      return enqueueOperation(async () => {
        await flushPendingAppends();
        await repository.clear();
        totalAppended = 0;
        retained = 0;
        notify({ type: "clear" });
      });
    },

    subscribe(listener) {
      listeners.add(listener);
      listener({ type: "init" }, currentStats());
      return () => {
        listeners.delete(listener);
      };
    },

    close() {
      if (closed) {
        return closePromise ?? Promise.resolve();
      }
      closed = true;
      cancelScheduledFlush();
      closePromise = enqueueOperation(async () => {
        try {
          await flushPendingAppends();
          if (options.clearOnClose) {
            await repository.clear();
          }
        } finally {
          listeners.clear();
          repository.close();
        }
      });
      return closePromise;
    }
  };
}

type PendingAppend = {
  event: LightstreamerEventEnvelope;
  persistable: LightstreamerEventEnvelope;
  resolve: (event: LightstreamerEventEnvelope) => void;
  reject: (error: unknown) => void;
};

function appendChange(
  events: readonly LightstreamerEventEnvelope[]
): EventStoreChange | null {
  if (events.length === 1) {
    const event = events[0];
    return event ? { type: "append", event } : null;
  }
  return events.length > 1 ? { type: "append-batch", events: [...events] } : null;
}

function normalizeWarningThreshold(value: number | undefined): number {
  return Math.max(1, Math.floor(value ?? DEFAULT_EVENT_WARNING_THRESHOLD));
}

function normalizeBatchSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_EVENT_BATCH_SIZE;
  }
  return Math.max(1, Math.floor(value));
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
