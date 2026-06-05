import { type LightstreamerEventEnvelope } from "./event-envelope";

export type EventStoreListener = (events: readonly LightstreamerEventEnvelope[]) => void;

export type EventStore = {
  append(event: LightstreamerEventEnvelope): LightstreamerEventEnvelope;
  list(): LightstreamerEventEnvelope[];
  count(): number;
  clear(): void;
  subscribe(listener: EventStoreListener): () => void;
};

export type EventStoreOptions = {
  maxEvents?: number;
};

export function createEventStore(options: EventStoreOptions = {}): EventStore {
  const maxEvents = options.maxEvents ?? 1000;
  const events: LightstreamerEventEnvelope[] = [];
  const listeners = new Set<EventStoreListener>();

  function snapshot(): LightstreamerEventEnvelope[] {
    return [...events];
  }

  function notify(): void {
    const current = snapshot();
    for (const listener of listeners) {
      listener(current);
    }
  }

  return {
    append(event) {
      events.push(event);
      if (events.length > maxEvents) {
        events.splice(0, events.length - maxEvents);
      }
      notify();
      return event;
    },

    list() {
      return snapshot();
    },

    count() {
      return events.length;
    },

    clear() {
      events.length = 0;
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
