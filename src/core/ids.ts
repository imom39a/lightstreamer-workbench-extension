export type StableIdAllocator = {
  getId(value: object): string;
  has(value: object): boolean;
};

export function createStableIdAllocator(prefix: string): StableIdAllocator {
  const ids = new WeakMap<object, string>();
  let nextId = 1;

  return {
    getId(value: object): string {
      const existing = ids.get(value);
      if (existing) {
        return existing;
      }

      const id = `${prefix}-${nextId}`;
      nextId += 1;
      ids.set(value, id);
      return id;
    },

    has(value: object): boolean {
      return ids.has(value);
    }
  };
}
