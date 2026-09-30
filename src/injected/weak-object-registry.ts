/** Enumerates page-owned objects without extending their application lifetime. */
export function createWeakObjectRegistry<T extends object>(
  onCollected: (id: string) => void = () => undefined
) {
  const objects = new Map<string, WeakRef<T>>();
  const remove = (id: string, reference: WeakRef<T>) => {
    if (objects.get(id) !== reference) return;
    objects.delete(id);
    finalizer.unregister(reference);
    onCollected(id);
  };
  const finalizer = new FinalizationRegistry<{ id: string; reference: WeakRef<T> }>(
    ({ id, reference }) => remove(id, reference)
  );
  const prune = () => {
    for (const [id, reference] of objects) {
      if (!reference.deref()) remove(id, reference);
    }
  };
  return {
    register(id: string, object: T) {
      const previous = objects.get(id);
      if (previous?.deref() === object) return;
      if (previous) finalizer.unregister(previous);
      const reference = new WeakRef(object);
      objects.set(id, reference);
      finalizer.register(object, { id, reference }, reference);
    },
    get(id: string): T | undefined {
      const reference = objects.get(id);
      const object = reference?.deref();
      if (reference && !object) remove(id, reference);
      return object;
    },
    prune
  };
}
