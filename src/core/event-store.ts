import { type LightstreamerEventEnvelope } from "./event-envelope";

export type EventStoreStats = {
  retained: number;
  totalAppended: number;
  warningThreshold: number;
  warningActive: boolean;
};

export type EventStoreListener = (
  events: readonly LightstreamerEventEnvelope[],
  stats: EventStoreStats
) => void;

export type EventStore = {
  append(event: LightstreamerEventEnvelope): LightstreamerEventEnvelope;
  list(): LightstreamerEventEnvelope[];
  count(): number;
  stats(): EventStoreStats;
  clear(): void;
  subscribe(listener: EventStoreListener): () => void;
};

export type EventStoreOptions = {
  warningThreshold?: number;
};

export const DEFAULT_EVENT_WARNING_THRESHOLD = 10_000;

export function createEventStore(options: EventStoreOptions = {}): EventStore {
  const warningThreshold = Math.max(
    1,
    Math.floor(options.warningThreshold ?? DEFAULT_EVENT_WARNING_THRESHOLD)
  );
  const events: LightstreamerEventEnvelope[] = [];
  const listeners = new Set<EventStoreListener>();
  let totalAppended = 0;

  function snapshot(): LightstreamerEventEnvelope[] {
    return [...events];
  }

  function currentStats(): EventStoreStats {
    return {
      retained: events.length,
      totalAppended,
      warningThreshold,
      warningActive: events.length > warningThreshold
    };
  }

  function notify(): void {
    const current = snapshot();
    const stats = currentStats();
    for (const listener of listeners) {
      listener(current, stats);
    }
  }

  return {
    append(event) {
      events.push(event);
      totalAppended += 1;
      notify();
      return event;
    },

    list() {
      return snapshot();
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
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot(), currentStats());
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
