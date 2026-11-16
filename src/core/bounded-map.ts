/**
 * Insertion-ordered bounded collections.
 *
 * Eviction happens after an insertion pushes the collection over capacity and
 * removes the oldest inserted entries first. Re-setting an existing key keeps
 * its original position (ordinary Map/Set semantics), and reads never refresh
 * recency: these are FIFO ledgers, not LRU caches.
 */

/** Remove the oldest entries until `collection` holds at most `capacity` entries. */
export function evictOldest<K>(collection: Map<K, unknown> | Set<K>, capacity: number): void {
  while (collection.size > capacity) {
    const oldest = collection.keys().next();
    if (oldest.done) return;
    collection.delete(oldest.value);
  }
}

function assertCapacity(capacity: number): void {
  if (!Number.isSafeInteger(capacity) || capacity < 0) throw new RangeError("Bounded collection capacity must be a non-negative safe integer.");
}

export class BoundedMap<K, V> extends Map<K, V> {
  constructor(readonly capacity: number) {
    // Map's iterable constructor would call set() before capacity exists.
    super();
    assertCapacity(capacity);
  }

  override set(key: K, value: V): this {
    super.set(key, value);
    evictOldest(this, this.capacity);
    return this;
  }
}

export class BoundedSet<T> extends Set<T> {
  constructor(readonly capacity: number) {
    super();
    assertCapacity(capacity);
  }

  override add(value: T): this {
    super.add(value);
    evictOldest(this, this.capacity);
    return this;
  }
}
