import { type EventFilterState } from "./event-filter";
import { type LightstreamerEventEnvelope } from "./event-envelope";
import { type EventQuery, type EventQueryResult } from "./event-repository";
import {
  type EventStore,
  type EventStoreListener,
  type EventStoreOptions,
  type EventStoreStats,
  type IndexedDbEventStoreOptions,
  createEventStore,
  createIndexedDbEventStore
} from "./event-store";

/**
 * The storage-independent history seam used by the panel. Every operation has
 * one completion contract, regardless of whether the underlying history is
 * held in memory or IndexedDB. Appends retain capture order while storage and
 * subscriber work may complete in bounded batches; callers never branch on
 * the backend's return type.
 */
export type EventHistory = {
  append(event: LightstreamerEventEnvelope): HistoryOperation<LightstreamerEventEnvelope>;
  queryEvents(query?: EventQuery): HistoryOperation<EventQueryResult>;
  getEventById(id: string): HistoryOperation<LightstreamerEventEnvelope | null>;
  list(filters?: EventFilterState): HistoryOperation<LightstreamerEventEnvelope[]>;
  count(): HistoryOperation<number>;
  stats(): HistoryOperation<EventStoreStats>;
  clear(): HistoryOperation<void>;
  subscribe(listener: EventStoreListener): () => void;
  close(): HistoryOperation<void>;
};

export type HistoryOperation<T> = {
  receive(onValue: (value: T) => void, onError: (error: unknown) => void): void;
  toPromise(): Promise<T>;
};

export function createInMemoryEventHistory(
  options: EventStoreOptions = {}
): EventHistory {
  return createEventHistory(createEventStore(options));
}

export async function createIndexedDbEventHistory(
  options: IndexedDbEventStoreOptions = {}
): Promise<EventHistory> {
  return createEventHistory(await createIndexedDbEventStore(options));
}

export function createEventHistory(store: EventStore): EventHistory {
  return {
    append(event) {
      return createHistoryOperation(() => store.append(event));
    },

    queryEvents(query) {
      return createHistoryOperation(() => store.queryEvents(query));
    },

    getEventById(id) {
      return createHistoryOperation(() => store.getEventById(id));
    },

    list(filters) {
      return createHistoryOperation(() => store.list(filters));
    },

    count() {
      return createHistoryOperation(() => store.count());
    },

    stats() {
      return createHistoryOperation(() => store.stats());
    },

    clear() {
      return createHistoryOperation(() => store.clear());
    },

    subscribe(listener) {
      return store.subscribe(listener);
    },

    close() {
      return createHistoryOperation(() => store.close?.());
    }
  };
}

function createHistoryOperation<T>(operation: () => T | Promise<T>): HistoryOperation<T> {
  let result: T | Promise<T>;
  try {
    result = operation();
  } catch (error) {
    return rejectedHistoryOperation(error);
  }

  if (isPromiseLike(result)) {
    const promise = Promise.resolve(result);
    return {
      receive(onValue, onError) {
        void promise.then(onValue, onError);
      },
      toPromise() {
        return promise;
      }
    };
  }

  return {
    receive(onValue) {
      onValue(result);
    },
    toPromise() {
      return Promise.resolve(result);
    }
  };
}

function rejectedHistoryOperation<T>(error: unknown): HistoryOperation<T> {
  return {
    receive(_onValue, onError) {
      onError(error);
    },
    toPromise() {
      return Promise.reject(error);
    }
  };
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}
